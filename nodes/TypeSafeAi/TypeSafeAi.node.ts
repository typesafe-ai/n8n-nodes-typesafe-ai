import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Answer, ChoiceAnswer } from './api';
import { CREDENTIAL_NAME, evaluateState, searchModels } from './api';
import { typeSafeAiProperties } from './descriptions';
import type { CriteriaEntry, ItemContext, QuestionEntry } from './helpers';
import {
	buildCriteriaMap,
	buildOutputItem,
	buildQuestionsFromEntries,
	configuredOutputs,
	fail,
	parseJsonParameter,
	parseQuestionsJson,
	ROUTE_QUESTION_ID,
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
		const routeNames = (this.getNodeParameter('routes.route', 0, []) as CriteriaEntry[])
			.map(({ name }) => name?.trim())
			.filter(Boolean);
		const separateLowConfidence =
			isRoute && this.getNodeParameter('confidenceHandling', 0) === 'separateOutput';
		const outputCount = isRoute ? routeNames.length + (separateLowConfidence ? 1 : 0) : 1;
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

			const answer = response.answers?.[ROUTE_QUESTION_ID] as ChoiceAnswer | undefined;
			const chosen = answer?.choice ?? '';
			const targetIndex = routeNames.indexOf(chosen);
			if (targetIndex === -1) {
				fail(context, `The model answered "${chosen}", which is not one of the configured routes`);
			}
			const confidence = answer?.confidence ?? 0;
			const threshold = this.getNodeParameter('confidenceThreshold', itemIndex, 0.5) as number;
			const lowConfidence = separateLowConfidence && confidence < threshold;
			const fields: IDataObject = {
				route: {
					route: chosen,
					confidence,
					lowConfidence,
					probabilities: answer?.probabilities ?? {},
				},
				model: response.model,
			};
			outputs[lowConfidence ? routeNames.length : targetIndex].push(
				buildOutputItem(item, fields, includeOtherFields, itemIndex),
			);
		};

		const continueOnFail = this.continueOnFail();
		const errorOutputIndex = separateLowConfidence ? routeNames.length : 0;
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
