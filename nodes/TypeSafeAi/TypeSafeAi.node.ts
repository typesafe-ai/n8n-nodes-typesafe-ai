import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from './api';
import { CREDENTIAL_NAME, evaluateState, searchModels } from './api';
import { typeSafeAiProperties } from './descriptions';
import type { CriteriaEntry, ItemContext, LevelEntry, QuestionEntry } from './helpers';
import {
	buildCriteriaMap,
	buildLevels,
	buildNoulQuestion,
	buildOutputItem,
	buildQuestionsFromEntries,
	configuredOutputs,
	fail,
	nearestLevel,
	parseJsonParameter,
	parseQuestionsJson,
	ROUTE_QUESTION_ID,
	simplifyAnswer,
	simplifyAnswers,
} from './helpers';

function buildState(
	functions: IExecuteFunctions,
	context: ItemContext,
	item: INodeExecutionData,
): unknown {
	const { itemIndex } = context;
	const format = functions.getNodeParameter('stateFormat', itemIndex) as string;
	if (format === 'inputItem') {
		return item.json;
	}
	if (format === 'json') {
		const parsed = parseJsonParameter(
			context,
			functions.getNodeParameter('stateJson', itemIndex),
			'State',
		);
		if (typeof parsed !== 'object' || parsed === null) {
			fail(context, "'State' must be a JSON object or array");
		}
		return parsed;
	}
	const text = functions.getNodeParameter('stateText', itemIndex);
	if (typeof text === 'object' && text !== null) {
		return text;
	}
	// An expression can resolve to a number or boolean, which is sent as text
	if (typeof text === 'number' || typeof text === 'boolean') {
		return String(text);
	}
	if (typeof text !== 'string' || text.trim() === '') {
		fail(context, "'State' is empty", 'Enter the content to evaluate');
	}
	return text;
}

function isNoulRoute(functions: IExecuteFunctions, itemIndex: number): boolean {
	return functions.getNodeParameter('routeQuestionType', itemIndex, 'choice') === 'noul';
}

function isScoreRoute(functions: IExecuteFunctions, itemIndex: number): boolean {
	return functions.getNodeParameter('routeQuestionType', itemIndex, 'choice') === 'score';
}

/** The two probability thresholds, checked so that they cannot overlap */
function readThresholds(
	functions: IExecuteFunctions,
	context: ItemContext,
): { trueThreshold: number; falseThreshold: number } {
	const trueThreshold = functions.getNodeParameter(
		'trueThreshold',
		context.itemIndex,
		0.5,
	) as number;
	const falseThreshold = functions.getNodeParameter(
		'falseThreshold',
		context.itemIndex,
		0.5,
	) as number;
	if (trueThreshold < falseThreshold) {
		fail(
			context,
			`'True Probability Threshold' (${trueThreshold}) is below 'False Probability Threshold' (${falseThreshold})`,
			"Set 'True Probability Threshold' at or above 'False Probability Threshold'",
		);
	}
	return { trueThreshold, falseThreshold };
}

/** The index of the output a Choice answer routes to */
function resolveChoiceRoute(
	functions: IExecuteFunctions,
	context: ItemContext,
	answer: ChoiceAnswer | undefined,
	routeNames: string[],
	separateLowConfidence: boolean,
): number {
	const chosen = answer?.choice ?? '';
	const targetIndex = routeNames.indexOf(chosen);
	if (targetIndex === -1) {
		fail(context, `The model answered "${chosen}", which is not one of the configured routes`);
	}
	const threshold = functions.getNodeParameter('confidenceThreshold', context.itemIndex, 0.5);
	const lowConfidence = separateLowConfidence && (answer?.confidence ?? 0) < (threshold as number);
	return lowConfidence ? routeNames.length : targetIndex;
}

/** The index of the output a Noul answer routes to: True, False, then Uncertain */

function resolveNoulRoute(
	functions: IExecuteFunctions,
	context: ItemContext,
	answer: NoulAnswer | undefined,
	hasUncertain: boolean,
): number {
	if (answer === undefined) {
		fail(context, 'The model returned no answer for this route');
	}
	const { trueThreshold, falseThreshold } = readThresholds(functions, context);
	if (answer.noul >= trueThreshold) {
		return 0;
	}
	if (answer.noul <= falseThreshold) {
		return 1;
	}
	return hasUncertain ? 2 : 1;
}

/** The index of the output a Score answer routes to: its nearest level */
function resolveScoreRoute(
	context: ItemContext,
	answer: ScoreAnswer | undefined,
	levelCount: number,
): number {
	if (answer === undefined) {
		fail(context, 'The model returned no answer for this route');
	}
	return nearestLevel(answer.score, levelCount);
}

function buildQuestions(
	functions: IExecuteFunctions,
	context: ItemContext,
	operation: string,
): IDataObject {
	const { itemIndex } = context;
	if (operation === 'route') {
		const instructions = (
			functions.getNodeParameter('routeInstructions', itemIndex) as string
		).trim();
		if (instructions === '') {
			fail(
				context,
				"'Instructions' is empty",
				'Enter the question the model answers to route the item',
			);
		}
		if (isNoulRoute(functions, itemIndex)) {
			readThresholds(functions, context);
			return {
				[ROUTE_QUESTION_ID]: buildNoulQuestion(
					instructions,
					functions.getNodeParameter('routeTrueMeans', itemIndex, ''),
					functions.getNodeParameter('routeFalseMeans', itemIndex, ''),
				),
			};
		}
		if (isScoreRoute(functions, itemIndex)) {
			const levels = functions.getNodeParameter('routeLevels.level', itemIndex, []) as LevelEntry[];
			return {
				[ROUTE_QUESTION_ID]: {
					type: 'score',
					instructions,
					criteria: buildLevels(context, levels, "'Levels'"),
				},
			};
		}
		const routes = functions.getNodeParameter('routes.route', itemIndex, []) as CriteriaEntry[];
		return {
			[ROUTE_QUESTION_ID]: {
				type: 'choice',
				instructions,
				criteria: buildCriteriaMap(context, routes, 'route', "'Routes'"),
			},
		};
	}
	if ((functions.getNodeParameter('questionsFormat', itemIndex) as string) === 'json') {
		return parseQuestionsJson(context, functions.getNodeParameter('questionsJson', itemIndex));
	}
	return buildQuestionsFromEntries(
		context,
		functions.getNodeParameter('questions.question', itemIndex, []) as QuestionEntry[],
	);
}

export class TypeSafeAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TypeSafe AI',
		name: 'typeSafeAi',
		icon: { light: 'file:typeSafeAi.svg', dark: 'file:typeSafeAi.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Ask TypeSafe typed questions and get calibrated probabilities',
		defaults: { name: 'TypeSafe AI' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: `={{ (${configuredOutputs})($parameter) }}`,
		credentials: [{ name: CREDENTIAL_NAME, required: true }],
		properties: typeSafeAiProperties,
	};

	methods = {
		listSearch: { searchModels },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const node = this.getNode();
		const operation = this.getNodeParameter('operation', 0) as string;
		const isRoute = operation === 'route';
		const isNoul = isRoute && isNoulRoute(this, 0);
		const isScore = isRoute && isScoreRoute(this, 0);
		const levelCount = (this.getNodeParameter('routeLevels.level', 0, []) as LevelEntry[]).length;
		const routeNames = (this.getNodeParameter('routes.route', 0, []) as CriteriaEntry[])
			.map(({ name }) => (name ?? '').trim())
			.filter(Boolean);
		const separateLowConfidence =
			isRoute &&
			!isNoul &&
			!isScore &&
			this.getNodeParameter('confidenceHandling', 0) === 'separateOutput';
		// Route outputs, in order: the routes then Fallback, True, False and
		// Uncertain, or one per level. Uncertain exists only when the thresholds
		// leave a gap.
		const hasUncertain =
			isNoul &&
			(this.getNodeParameter('trueThreshold', 0, 0.5) as number) >
				(this.getNodeParameter('falseThreshold', 0, 0.5) as number);
		const outputCount = isNoul
			? 2 + (hasUncertain ? 1 : 0)
			: isScore
				? levelCount
				: isRoute
					? routeNames.length + (separateLowConfidence ? 1 : 0)
					: 1;
		const outputs: INodeExecutionData[][] = Array.from(
			{ length: Math.max(outputCount, 1) },
			() => [],
		);

		const processItem = async (itemIndex: number, includeOtherFields: boolean): Promise<void> => {
			const item = items[itemIndex];
			const context: ItemContext = { node, itemIndex };

			const response = await evaluateState(
				this,
				itemIndex,
				{
					state: buildState(this, context, item),
					model: this.getNodeParameter('model', itemIndex, '', { extractValue: true }) as string,
					questions: buildQuestions(this, context, operation),
				} as IDataObject,
				this.getNodeParameter('options.timeout', itemIndex, 5000) as number,
			);

			if (!isRoute) {
				const answers: Record<string, Answer> = response.answers ?? {};
				const simplify = this.getNodeParameter('options.simplify', itemIndex, true) as boolean;
				const fields: IDataObject = simplify
					? { answers: simplifyAnswers(answers), model: response.model }
					: { answers, model: response.model, usage: response.usage };
				outputs[0].push(buildOutputItem(item, fields, includeOtherFields, itemIndex));
				return;
			}

			// The route object is the answer exactly as Evaluate would emit it for
			// the current Simplify setting. The output it leaves from is the decision.
			const answer = response.answers?.[ROUTE_QUESTION_ID];
			const simplify = this.getNodeParameter('options.simplify', itemIndex, true) as boolean;
			const answerFields =
				answer === undefined
					? {}
					: simplify
						? simplifyAnswer(answer)
						: (answer as unknown as IDataObject);
			const targetIndex = isNoul
				? resolveNoulRoute(this, context, answer as NoulAnswer | undefined, hasUncertain)
				: isScore
					? resolveScoreRoute(context, answer as ScoreAnswer | undefined, levelCount)
					: resolveChoiceRoute(
							this,
							context,
							answer as ChoiceAnswer | undefined,
							routeNames,
							separateLowConfidence,
						);
			const fields: IDataObject = {
				route: answerFields,
				model: response.model,
			};
			if (!simplify) {
				fields.usage = response.usage;
			}
			outputs[targetIndex].push(buildOutputItem(item, fields, includeOtherFields, itemIndex));
		};

		const continueOnFail = this.continueOnFail();
		// A failure is not a routing decision, so it goes to Fallback or Uncertain
		// where one exists. In Noul mode that is always the last output. A Score
		// has neither, so it goes to the first output.
		const errorOutputIndex = isNoul
			? outputs.length - 1
			: separateLowConfidence
				? routeNames.length
				: 0;
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const includeOtherFields = this.getNodeParameter(
				'options.includeOtherFields',
				itemIndex,
				true,
			) as boolean;
			if (!continueOnFail) {
				await processItem(itemIndex, includeOtherFields);
				continue;
			}
			try {
				await processItem(itemIndex, includeOtherFields);
			} catch (error) {
				// n8n moves an item carrying `error` to the error output when On Error
				// is set to use one, whatever else the item holds
				const failure =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(node, error as Error, { itemIndex });
				outputs[errorOutputIndex].push({
					...buildOutputItem(
						items[itemIndex],
						{ error: (error as Error).message },
						includeOtherFields,
						itemIndex,
					),
					error: failure,
				});
			}
		}

		return outputs;
	}
}
