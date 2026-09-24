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
			route: { value: 'technical', confidence: 0.9, lowConfidence: false },
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
		expect(outputs[2][0].json.route).toMatchObject({ value: 'billing', lowConfidence: true });
	});

	it('keeps an unsure item on its route when routing to the best option', async () => {
		const { functions } = createFunctions(
			{ ...routeParameters, confidenceHandling: 'bestOption' },
			items,
			() => choiceResponse('billing', 0.4),
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(2);
		expect(outputs[0][0].json.route).toMatchObject({ value: 'billing', lowConfidence: false });
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

describe('Route by Noul', () => {
	const noulParameters: Record<string, unknown> = {
		operation: 'route',
		routeQuestionType: 'noul',
		model: { mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' },
		stateFormat: 'inputItem',
		routeInstructions: 'Is this ticket urgent?',
		routeTrueMeans: 'Needs a reply today',
		routeFalseMeans: 'Can wait',
		trueThreshold: 0.8,
		falseThreshold: 0.2,
	};

	const noulResponse = (noul: number) => () => ({
		statusCode: 200,
		body: {
			model: 'jev-1.13.0',
			answers: { route: { type: 'noul', noul } },
			usage: { input_tokens: 296, output_tokens: 20 },
		},
	});

	async function route(parameters: Record<string, unknown>, noul: number, continueOnFail = false) {
		const { functions, request } = createFunctions(
			parameters,
			items,
			noulResponse(noul),
			continueOnFail,
		);
		return { outputs: await TypeSafeAi.prototype.execute.call(functions), request };
	}

	it('asks a noul question carrying both meanings', async () => {
		const { request } = await route(noulParameters, 0.9);
		const body = (request.mock.calls[0] as unknown as [unknown, { body: unknown }])[1].body;

		expect(body).toEqual({
			state: { ticket: 1 },
			model: 'jev-latest',
			questions: {
				route: {
					type: 'noul',
					instructions: 'Is this ticket urgent?',
					criteria: { true: 'Needs a reply today', false: 'Can wait' },
				},
			},
		});
	});

	it('sends a high probability to the True output', async () => {
		const { outputs } = await route(noulParameters, 0.9);

		expect(outputs).toHaveLength(3);
		expect(outputs[0][0].json).toEqual({
			ticket: 1,
			route: { value: 0.9, uncertain: false },
			model: 'jev-1.13.0',
		});
	});

	it('sends a low probability to the False output', async () => {
		const { outputs } = await route(noulParameters, 0.1);

		expect(outputs[1][0].json.route).toEqual({ value: 0.1, uncertain: false });
	});

	it('sends a probability inside the gap to the Uncertain output', async () => {
		const { outputs } = await route(noulParameters, 0.5);

		expect(outputs[0]).toHaveLength(0);
		expect(outputs[1]).toHaveLength(0);
		expect(outputs[2][0].json.route).toEqual({ value: 0.5, uncertain: true });
	});

	it.each([
		[0.8, 0, 'True'],
		[0.2, 1, 'False'],
	])('routes a probability exactly on a threshold (%s) to %s', async (noul, index) => {
		const { outputs } = await route(noulParameters, noul);

		expect(outputs[index][0].json.route).toEqual({ value: noul, uncertain: false });
	});

	it('has no Uncertain output when the thresholds meet', async () => {
		const { outputs } = await route(
			{ ...noulParameters, trueThreshold: 0.5, falseThreshold: 0.5 },
			0.5,
		);

		expect(outputs).toHaveLength(2);
		expect(outputs[0][0].json.route).toEqual({ value: 0.5, uncertain: false });
	});

	it('returns the API answer and usage unchanged when not simplifying', async () => {
		const { outputs } = await route({ ...noulParameters, 'options.simplify': false }, 0.9);

		expect(outputs[0][0].json).toEqual({
			ticket: 1,
			route: { type: 'noul', noul: 0.9, uncertain: false },
			model: 'jev-1.13.0',
			usage: { input_tokens: 296, output_tokens: 20 },
		});
	});

	it('rejects thresholds that overlap', async () => {
		const { functions } = createFunctions(
			{ ...noulParameters, trueThreshold: 0.3, falseThreshold: 0.7 },
			items,
			noulResponse(0.5),
		);

		await expect(TypeSafeAi.prototype.execute.call(functions)).rejects.toThrow(
			/True Probability Threshold \(0.3\) is below False Probability Threshold \(0.7\)/,
		);
	});

	it('sends a failing item to the last output', async () => {
		const { functions } = createFunctions(
			noulParameters,
			items,
			() => ({ statusCode: 500, body: { detail: 'Server exploded' } }),
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[0]).toHaveLength(0);
		expect(outputs[1]).toHaveLength(0);
		expect(outputs[2][0].json).toMatchObject({ ticket: 1, error: 'Server exploded' });
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
