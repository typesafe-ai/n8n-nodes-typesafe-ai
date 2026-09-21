import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { TypeSafeAi } from '../nodes/TypeSafeAi/TypeSafeAi.node';

const node: INode = {
	id: 'a',
	name: 'TypeSafe AI',
	type: 'typeSafeAi',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const routeParameters: Record<string, unknown> = {
	operation: 'route',
	model: { mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' },
	stateFormat: 'inputItem',
	routeInstructions: 'Which department should handle this?',
	'routes.route': [{ name: 'billing' }, { name: 'technical' }],
	confidenceHandling: 'separateOutput',
	confidenceThreshold: 0.5,
};

function choiceResponse(choice: string, confidence: number) {
	return {
		statusCode: 200,
		body: {
			model: 'jev-1.13.0',
			answers: {
				route: {
					type: 'choice',
					choice,
					confidence,
					probabilities: { billing: confidence, technical: Number((1 - confidence).toFixed(2)) },
				},
			},
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	};
}

function createFunctions(
	parameters: Record<string, unknown>,
	items: INodeExecutionData[],
	respond: (body: unknown) => unknown,
	continueOnFail = false,
) {
	const request = vi.fn(async () => respond(undefined));
	return {
		request,
		functions: {
			getInputData: () => items,
			getNode: () => node,
			continueOnFail: () => continueOnFail,
			getCredentials: async () => ({ apiKey: 'k', baseUrl: '' }),
			getNodeParameter: (
				name: string,
				_itemIndex: number,
				fallback?: unknown,
				options?: { extractValue?: boolean },
			) => {
				const value = name in parameters ? parameters[name] : fallback;
				if (options?.extractValue === true && typeof value === 'object' && value !== null) {
					return (value as { value: unknown }).value;
				}
				return value;
			},
			helpers: { httpRequestWithAuthentication: request },
		} as unknown as IExecuteFunctions,
	};
}

const items: INodeExecutionData[] = [{ json: { ticket: 1 } }];

describe('Route', () => {
	it('sends a confident item to the matching output', async () => {
		const { functions, request } = createFunctions(routeParameters, items, () =>
			choiceResponse('technical', 0.9),
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(3);
		expect(outputs[0]).toHaveLength(0);
		expect(outputs[1][0].json).toEqual({
			ticket: 1,
			route: {
				route: 'technical',
				confidence: 0.9,
				lowConfidence: false,
				probabilities: { billing: 0.9, technical: 0.1 },
			},
			model: 'jev-1.13.0',
		});
		expect(outputs[2]).toHaveLength(0);

		const body = (request.mock.calls[0] as unknown as [unknown, { body: unknown }])[1].body;
		expect(body).toEqual({
			state: { ticket: 1 },
			model: 'jev-latest',
			questions: {
				route: {
					type: 'choice',
					instructions: 'Which department should handle this?',
					criteria: { billing: null, technical: null },
				},
			},
		});
	});

	it('sends an unsure item to the Fallback output', async () => {
		const { functions } = createFunctions(routeParameters, items, () =>
			choiceResponse('billing', 0.4),
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[0]).toHaveLength(0);
		expect(outputs[2][0].json.route).toMatchObject({ route: 'billing', lowConfidence: true });
	});

	it('keeps an unsure item on its route when routing to the best option', async () => {
		const { functions } = createFunctions(
			{ ...routeParameters, confidenceHandling: 'bestOption' },
			items,
			() => choiceResponse('billing', 0.4),
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(2);
		expect(outputs[0][0].json.route).toMatchObject({ route: 'billing', lowConfidence: false });
	});
});

describe('Route errors with Continue On Fail', () => {
	const failure = () => ({ statusCode: 500, body: { detail: 'Server exploded' } });

	it('sends a failing item to the Fallback, not to the first route', async () => {
		const { functions } = createFunctions(routeParameters, items, failure, true);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[0]).toHaveLength(0);
		expect(outputs[1]).toHaveLength(0);
		expect(outputs[2][0].json).toMatchObject({ ticket: 1, error: 'Server exploded' });
	});

	it('falls back to the first output when there is no Fallback', async () => {
		const { functions } = createFunctions(
			{ ...routeParameters, confidenceHandling: 'bestOption' },
			items,
			failure,
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(2);
		expect(outputs[0][0].json).toMatchObject({ ticket: 1, error: 'Server exploded' });
	});

	it('honours Include Other Input Fields on the failing item', async () => {
		const { functions } = createFunctions(
			{ ...routeParameters, 'options.includeOtherFields': false },
			items,
			failure,
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[2][0].json).toEqual({ error: 'Server exploded' });
	});
});

describe('Evaluate', () => {
	const evaluateParameters: Record<string, unknown> = {
		operation: 'evaluate',
		model: { mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' },
		stateFormat: 'text',
		stateText: 'Charged twice',
		questionsFormat: 'fields',
		'questions.question': [{ id: 'is_urgent', instructions: 'Urgent?', type: 'noul' }],
	};

	const evaluateResponse = {
		statusCode: 200,
		body: {
			model: 'jev-1.13.0',
			answers: { is_urgent: { type: 'noul', noul: 0.85 } },
			usage: { input_tokens: 296, output_tokens: 20 },
		},
	};

	it('simplifies the answers and omits usage by default', async () => {
		const { functions } = createFunctions(evaluateParameters, items, () => evaluateResponse);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(1);
		expect(outputs[0][0].json).toEqual({
			ticket: 1,
			answers: { is_urgent: { value: 0.85 } },
			model: 'jev-1.13.0',
		});
	});

	it('returns the API answers and usage unchanged when not simplifying', async () => {
		const { functions } = createFunctions(
			{ ...evaluateParameters, 'options.simplify': false, 'options.includeOtherFields': false },
			items,
			() => evaluateResponse,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[0][0].json).toEqual({
			answers: { is_urgent: { type: 'noul', noul: 0.85 } },
			model: 'jev-1.13.0',
			usage: { input_tokens: 296, output_tokens: 20 },
		});
	});

	it('reports a 422 as one readable sentence', async () => {
		const { functions } = createFunctions(evaluateParameters, items, () => ({
			statusCode: 422,
			body: { detail: [{ loc: ['body', 'model'], msg: 'Field required' }] },
		}));

		await expect(TypeSafeAi.prototype.execute.call(functions)).rejects.toThrow(
			/model: Field required/,
		);
	});

	it('emits the failing item on the first output when continuing on fail', async () => {
		const { functions } = createFunctions(
			evaluateParameters,
			items,
			() => ({ statusCode: 500, body: { detail: 'Server exploded' } }),
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[0][0].json).toMatchObject({ ticket: 1, error: 'Server exploded' });
	});
});

describe('Model', () => {
	const modelParameters = (model: unknown) => ({ ...routeParameters, model });

	async function postedModel(model: unknown) {
		const { functions, request } = createFunctions(modelParameters(model), items, () =>
			choiceResponse('billing', 0.9),
		);
		await TypeSafeAi.prototype.execute.call(functions);
		const [, options] = request.mock.calls[0] as unknown as [unknown, { body: { model: unknown } }];
		return options.body.model;
	}

	it('sends the ID chosen from the list, not the resource locator', async () => {
		expect(
			await postedModel({ mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' }),
		).toBe('jev-latest');
	});

	it('sends an ID entered directly', async () => {
		expect(await postedModel({ mode: 'id', value: 'jev-1.13.0' })).toBe('jev-1.13.0');
	});
});
