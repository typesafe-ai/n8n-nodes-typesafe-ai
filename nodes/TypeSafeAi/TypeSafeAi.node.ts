import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Answer, ChoiceAnswer, NoulAnswer } from './api';
import { CREDENTIAL_NAME, evaluateState, searchModels } from './api';
import { typeSafeAiProperties } from './descriptions';
import type { CriteriaEntry, ItemContext, QuestionEntry } from './helpers';
import {
	buildCriteriaMap,
	buildNoulQuestion,
	buildOutputItem,
	buildQuestionsFromEntries,
	configuredOutputs,
	fail,
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
			fail(context, 'State must be a JSON object or array');
		}
		return parsed;
	}
	const text = functions.getNodeParameter('stateText', itemIndex);
	if (typeof text === 'object' && text !== null) {
		return text;
	}
	if (typeof text !== 'string' || text.trim() === '') {
		fail(context, 'State is empty. Enter the content to evaluate.');
	}
	return text;
}

function isNoulRoute(functions: IExecuteFunctions, itemIndex: number): boolean {
	return functions.getNodeParameter('routeQuestionType', itemIndex, 'choice') === 'noul';
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
			`True Probability Threshold (${trueThreshold}) is below False Probability Threshold (${falseThreshold}), so the two overlap. Raise the true threshold or lower the false one.`,
		);
	}
	return { trueThreshold, falseThreshold };
}

interface RouteTarget {
	targetIndex: number;
	decision: IDataObject;
}

function resolveChoiceRoute(
	functions: IExecuteFunctions,
	context: ItemContext,
	answer: ChoiceAnswer | undefined,
	routeNames: string[],
	separateLowConfidence: boolean,
): RouteTarget {
	const chosen = answer?.choice ?? '';
	const targetIndex = routeNames.indexOf(chosen);
	if (targetIndex === -1) {
		fail(context, `The model answered "${chosen}", which is not one of the configured routes`);
	}
	const threshold = functions.getNodeParameter('confidenceThreshold', context.itemIndex, 0.5);
	const lowConfidence = separateLowConfidence && (answer?.confidence ?? 0) < (threshold as number);
	return {
		targetIndex: lowConfidence ? routeNames.length : targetIndex,
		decision: { lowConfidence },
	};
}

function resolveNoulRoute(
	functions: IExecuteFunctions,
	context: ItemContext,
	answer: NoulAnswer | undefined,
	hasUncertain: boolean,
): RouteTarget {
	if (answer === undefined) {
		fail(context, 'The model returned no answer for this route');
	}
	const { trueThreshold, falseThreshold } = readThresholds(functions, context);
	if (answer.noul >= trueThreshold) {
		return { targetIndex: 0, decision: { uncertain: false } };
	}
	if (answer.noul <= falseThreshold) {
		return { targetIndex: 1, decision: { uncertain: false } };
	}
	return { targetIndex: hasUncertain ? 2 : 1, decision: { uncertain: true } };
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
			fail(context, 'Instructions are empty. Describe what the model should decide.');
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
		const routes = functions.getNodeParameter('routes.route', itemIndex, []) as CriteriaEntry[];
		return {
			[ROUTE_QUESTION_ID]: {
				type: 'choice',
				instructions,
				criteria: buildCriteriaMap(context, routes, 'route', 'Routes'),
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
		const routeNames = (this.getNodeParameter('routes.route', 0, []) as CriteriaEntry[])
			.map(({ name }) => (name ?? '').trim())
			.filter(Boolean);
		const separateLowConfidence =
			isRoute && !isNoul && this.getNodeParameter('confidenceHandling', 0) === 'separateOutput';
		// Route outputs, in order: the routes then Fallback, or True, False and
		// Uncertain. Uncertain exists only when the thresholds leave a gap.
		const hasUncertain =
			isNoul &&
			(this.getNodeParameter('trueThreshold', 0, 0.5) as number) >
				(this.getNodeParameter('falseThreshold', 0, 0.5) as number);
		const outputCount = isNoul
			? 2 + (hasUncertain ? 1 : 0)
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
			// the current Simplify setting, plus the one flag naming the decision.
			const answer = response.answers?.[ROUTE_QUESTION_ID];
			const simplify = this.getNodeParameter('options.simplify', itemIndex, true) as boolean;
			const answerFields =
				answer === undefined
					? {}
					: simplify
						? simplifyAnswer(answer)
						: (answer as unknown as IDataObject);
			const { targetIndex, decision } = isNoul
				? resolveNoulRoute(this, context, answer as NoulAnswer | undefined, hasUncertain)
				: resolveChoiceRoute(
						this,
						context,
						answer as ChoiceAnswer | undefined,
						routeNames,
						separateLowConfidence,
					);
			const fields: IDataObject = {
				route: { ...answerFields, ...decision },
				model: response.model,
			};
			if (!simplify) {
				fields.usage = response.usage;
			}
			outputs[targetIndex].push(buildOutputItem(item, fields, includeOtherFields, itemIndex));
		};

		const continueOnFail = this.continueOnFail();
		// A failure is not a routing decision, so it goes to Fallback or Uncertain
		// where one exists. In Noul mode that is always the last output.
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
				outputs[errorOutputIndex].push(
					buildOutputItem(
						items[itemIndex],
						{ error: (error as Error).message },
						includeOtherFields,
						itemIndex,
					),
				);
			}
		}

		return outputs;
	}
}
