import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
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
			helpers: {
				httpRequestWithAuthentication: request,
				assertBinaryData: (itemIndex: number, propertyName: string) => {
					const binary = items[itemIndex].binary?.[propertyName];
					if (binary === undefined) {
						throw new NodeOperationError(node, `No binary data in '${propertyName}'`);
					}
					return binary;
				},
				async getBinaryDataBuffer(itemIndex: number, propertyName: string) {
					return Buffer.from(this.assertBinaryData(itemIndex, propertyName).data, 'base64');
				},
			},
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
			route: { choice: 'technical', confidence: 0.9 },
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
		expect(outputs[2][0].json.route).toEqual({ choice: 'billing', confidence: 0.4 });
	});

	it('keeps an unsure item on its route when routing to the best option', async () => {
		const { functions } = createFunctions(
			{ ...routeParameters, confidenceHandling: 'bestOption' },
			items,
			() => choiceResponse('billing', 0.4),
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(2);
		expect(outputs[0][0].json.route).toEqual({ choice: 'billing', confidence: 0.4 });
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

	it('attaches the API error to the item, for the error output', async () => {
		const { functions } = createFunctions(routeParameters, items, failure, true);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[2][0].error).toBeInstanceOf(NodeApiError);
		expect(outputs[2][0].error?.message).toBe('Server exploded');
	});

	it('attaches a configuration error to the item', async () => {
		const { functions } = createFunctions(
			routeParameters,
			items,
			() => choiceResponse('sales', 0.9),
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[2][0].error).toBeInstanceOf(NodeOperationError);
		expect(outputs[2][0].json.error).toMatch(/not one of the configured routes/);
	});

	it('wraps a request that throws, such as a timeout, as a node error', async () => {
		const { functions } = createFunctions(
			routeParameters,
			items,
			() => {
				throw new Error('timeout of 5000ms exceeded');
			},
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs[2][0].error).toBeInstanceOf(NodeOperationError);
		expect(outputs[2][0].json.error).toBe('timeout of 5000ms exceeded');
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
			route: { noul: 0.9 },
			model: 'jev-1.13.0',
		});
	});

	it('sends a low probability to the False output', async () => {
		const { outputs } = await route(noulParameters, 0.1);

		expect(outputs[1][0].json.route).toEqual({ noul: 0.1 });
	});

	it('sends a probability inside the gap to the Uncertain output', async () => {
		const { outputs } = await route(noulParameters, 0.5);

		expect(outputs[0]).toHaveLength(0);
		expect(outputs[1]).toHaveLength(0);
		expect(outputs[2][0].json.route).toEqual({ noul: 0.5 });
	});

	it.each([
		[0.8, 0, 'True'],
		[0.2, 1, 'False'],
	])('routes a probability exactly on a threshold (%s) to %s', async (noul, index) => {
		const { outputs } = await route(noulParameters, noul);

		expect(outputs[index][0].json.route).toEqual({ noul });
	});

	it('has no Uncertain output when the thresholds meet', async () => {
		const { outputs } = await route(
			{ ...noulParameters, trueThreshold: 0.5, falseThreshold: 0.5 },
			0.5,
		);

		expect(outputs).toHaveLength(2);
		expect(outputs[0][0].json.route).toEqual({ noul: 0.5 });
	});

	it('returns the API answer and usage unchanged when not simplifying', async () => {
		const { outputs } = await route({ ...noulParameters, 'options.simplify': false }, 0.9);

		expect(outputs[0][0].json).toEqual({
			ticket: 1,
			route: { type: 'noul', noul: 0.9 },
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
			/'True Probability Threshold' \(0.3\) is below 'False Probability Threshold' \(0.7\)/,
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

describe('Route by Score', () => {
	const scoreParameters: Record<string, unknown> = {
		operation: 'route',
		routeQuestionType: 'score',
		model: { mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' },
		stateFormat: 'inputItem',
		routeInstructions: 'How frustrated is the customer?',
		'routeLevels.level': [{ level: 'Calm' }, { level: 'Frustrated' }, { level: 'Furious' }],
	};

	const scoreResponse = (score: number) => () => ({
		statusCode: 200,
		body: {
			model: 'jev-1.13.0',
			answers: {
				route: {
					type: 'score',
					score,
					confidence: 0.9,
					legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Furious' },
				},
			},
			usage: { input_tokens: 296, output_tokens: 20 },
		},
	});

	async function route(parameters: Record<string, unknown>, score: number) {
		const { functions, request } = createFunctions(parameters, items, scoreResponse(score));
		return { outputs: await TypeSafeAi.prototype.execute.call(functions), request };
	}

	it('asks a score question with the levels in order, lowest first', async () => {
		const { request } = await route(scoreParameters, 1);
		const body = (request.mock.calls[0] as unknown as [unknown, { body: unknown }])[1].body;

		expect(body).toEqual({
			state: { ticket: 1 },
			model: 'jev-latest',
			questions: {
				route: {
					type: 'score',
					instructions: 'How frustrated is the customer?',
					criteria: ['Calm', 'Frustrated', 'Furious'],
				},
			},
		});
	});

	it('sends the item to the level nearest the score', async () => {
		const { outputs } = await route(scoreParameters, 1.3);

		expect(outputs).toHaveLength(3);
		expect(outputs[0]).toHaveLength(0);
		expect(outputs[1][0].json).toEqual({
			ticket: 1,
			route: { score: 1.3, confidence: 0.9 },
			model: 'jev-1.13.0',
		});
		expect(outputs[2]).toHaveLength(0);
	});

	it.each([
		[0.49, 0],
		[0.5, 1],
		[1.5, 2],
	])('routes a score of %s to level %i', async (score, index) => {
		const { outputs } = await route(scoreParameters, score);

		expect(outputs[index]).toHaveLength(1);
	});

	it('keeps a score outside the levels on the nearest end', async () => {
		const { outputs } = await route(scoreParameters, 2.7);

		expect(outputs[2]).toHaveLength(1);
	});

	it('returns the API answer and usage unchanged when not simplifying', async () => {
		const { outputs } = await route({ ...scoreParameters, 'options.simplify': false }, 2);

		expect(outputs[2][0].json).toEqual({
			ticket: 1,
			route: {
				type: 'score',
				score: 2,
				confidence: 0.9,
				legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Furious' },
			},
			model: 'jev-1.13.0',
			usage: { input_tokens: 296, output_tokens: 20 },
		});
	});

	it('rejects a blank level', async () => {
		const { functions } = createFunctions(
			{ ...scoreParameters, 'routeLevels.level': [{ level: 'Calm' }, { level: ' ' }] },
			items,
			scoreResponse(1),
		);

		await expect(TypeSafeAi.prototype.execute.call(functions)).rejects.toThrow(
			/'Levels': every level needs a description/,
		);
	});

	it('sends a failing item to the first output', async () => {
		const { functions } = createFunctions(
			scoreParameters,
			items,
			() => ({ statusCode: 500, body: { detail: 'Server exploded' } }),
			true,
		);
		const outputs = await TypeSafeAi.prototype.execute.call(functions);

		expect(outputs).toHaveLength(3);
		expect(outputs[0][0].json).toMatchObject({ ticket: 1, error: 'Server exploded' });
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
			answers: { is_urgent: { noul: 0.85 } },
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

	it.each([
		[42, '42'],
		[false, 'false'],
	])('sends a Text state of %s as the string %s', async (stateText, sent) => {
		const { functions, request } = createFunctions(
			{ ...evaluateParameters, stateText },
			items,
			() => evaluateResponse,
		);
		await TypeSafeAi.prototype.execute.call(functions);

		const body = (request.mock.calls[0] as unknown as [unknown, { body: { state: unknown } }])[1]
			.body;
		expect(body.state).toBe(sent);
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

describe('Images', () => {
	const PNG_BYTES = Buffer.from('fake png bytes');
	const JPEG_BYTES = Buffer.from('fake jpeg bytes');

	const imageItems: INodeExecutionData[] = [
		{
			json: { ticket: 1 },
			binary: {
				data: { data: PNG_BYTES.toString('base64'), mimeType: 'image/png', fileName: 'a.png' },
				second: {
					data: JPEG_BYTES.toString('base64'),
					mimeType: 'image/jpeg',
					fileName: 'b.jpg',
				},
				animation: { data: 'R0lG', mimeType: 'image/gif', fileName: 'c.gif' },
				unnamed: { data: JPEG_BYTES.toString('base64'), mimeType: 'image/jpg' },
				download: {
					data: JPEG_BYTES.toString('base64'),
					mimeType: 'application/octet-stream',
					fileName: 'photo.bin',
				},
			},
		},
	];

	const imageParameters: Record<string, unknown> = {
		operation: 'evaluate',
		model: { mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' },
		stateFormat: 'json',
		stateJson: '{"photo": "photo-ref"}',
		questionsFormat: 'fields',
		'questions.question': [{ id: 'is_dog', instructions: 'Is `photo` a dog?', type: 'noul' }],
		'images.image': [{ binaryPropertyName: 'data', reference: 'photo-ref' }],
	};

	const noulResponse = {
		statusCode: 200,
		body: { model: 'jev-1.13.0', answers: { is_dog: { type: 'noul', noul: 0.9 } } },
	};

	type SentOptions = { body: unknown; headers?: Record<string, string> };

	async function send(parameters: Record<string, unknown>, response: unknown = noulResponse) {
		const { functions, request } = createFunctions(parameters, imageItems, () => response);
		await TypeSafeAi.prototype.execute.call(functions);
		return (request.mock.calls[0] as unknown as [unknown, SentOptions])[1];
	}

	async function requestJson(form: FormData) {
		return JSON.parse(await (form.get('request') as Blob).text()) as Record<string, unknown>;
	}

	it('sends the images as multipart parts named in the assets', async () => {
		const options = await send(imageParameters);

		expect(options.body).toBeInstanceOf(FormData);
		const form = options.body as FormData;
		expect([...form.keys()]).toEqual(['request', 'image-0']);
		expect((form.get('request') as Blob).type).toBe('application/json');
		expect(await requestJson(form)).toMatchObject({
			state: { photo: 'photo-ref' },
			assets: { 'photo-ref': { type: 'image', part: 'image-0' } },
		});
		const image = form.get('image-0') as File;
		expect(image.type).toBe('image/png');
		expect(image.name).toBe('a.png');
		expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG_BYTES);
		expect(options.headers).toEqual({ 'TypeSafe-Danger-Zone-Images': 'true' });
	});

	it('sends plain JSON without the images header when there are no images', async () => {
		const options = await send({ ...imageParameters, 'images.image': [] });

		expect(options.body).toEqual(expect.objectContaining({ state: { photo: 'photo-ref' } }));
		expect(options.body).not.toHaveProperty('assets');
		expect(options.headers).toBeUndefined();
	});

	it('gives each image its own part', async () => {
		const options = await send({
			...imageParameters,
			'questions.question': [
				{ id: 'same_dog', instructions: 'Is `photo` the dog in poster-ref?', type: 'noul' },
			],
			'images.image': [
				{ binaryPropertyName: 'data', reference: 'photo-ref' },
				{ binaryPropertyName: 'second', reference: 'poster-ref' },
			],
		});

		const form = options.body as FormData;
		expect([...form.keys()]).toEqual(['request', 'image-0', 'image-1']);
		expect((await requestJson(form)).assets).toEqual({
			'photo-ref': { type: 'image', part: 'image-0' },
			'poster-ref': { type: 'image', part: 'image-1' },
		});
		expect((form.get('image-1') as File).type).toBe('image/jpeg');
	});

	it('also sends images with Route, referenced in the instructions', async () => {
		const options = await send(
			{
				...routeParameters,
				routeInstructions: 'Which department handles the receipt in photo-ref?',
				'images.image': [{ binaryPropertyName: 'data', reference: 'photo-ref' }],
			},
			choiceResponse('billing', 0.9),
		);

		expect(options.body).toBeInstanceOf(FormData);
		expect((await requestJson(options.body as FormData)).assets).toEqual({
			'photo-ref': { type: 'image', part: 'image-0' },
		});
	});

	it('sends image/jpg as image/jpeg, named after its part when it has no file name', async () => {
		const options = await send({
			...imageParameters,
			'images.image': [{ binaryPropertyName: 'unnamed', reference: 'photo-ref' }],
		});

		const image = (options.body as FormData).get('image-0') as File;
		expect(image.type).toBe('image/jpeg');
		expect(image.name).toBe('image-0');
	});

	it('sends application/octet-stream as is, for the API to check', async () => {
		const options = await send({
			...imageParameters,
			'images.image': [{ binaryPropertyName: 'download', reference: 'photo-ref' }],
		});

		const image = (options.body as FormData).get('image-0') as File;
		expect(image.type).toBe('application/octet-stream');
		expect(Buffer.from(await image.arrayBuffer())).toEqual(JPEG_BYTES);
	});

	it('accepts a reference used only in criteria', async () => {
		const options = await send({
			...imageParameters,
			questionsFormat: 'json',
			questionsJson: JSON.stringify({
				gesture: {
					type: 'choice',
					instructions: 'Which gesture is in `photo`?',
					criteria: { thumbs_up: 'thumb-ref', none: 'No hand' },
				},
			}),
			'images.image': [
				{ binaryPropertyName: 'data', reference: 'photo-ref' },
				{ binaryPropertyName: 'second', reference: 'thumb-ref' },
			],
		});

		expect(options.body).toBeInstanceOf(FormData);
	});

	it('accepts a reference an expression resolved to a number', async () => {
		const options = await send({
			...imageParameters,
			stateJson: '{"photo": "42"}',
			'images.image': [{ binaryPropertyName: 'data', reference: 42 }],
		});

		expect((await requestJson(options.body as FormData)).assets).toEqual({
			'42': { type: 'image', part: 'image-0' },
		});
	});

	it.each([
		[[{ binaryPropertyName: 'nope', reference: 'photo-ref' }], /No binary data in 'nope'/],
		[[{ binaryPropertyName: 'animation', reference: 'gif-ref' }], /Only PNG and JPEG/],
		[[{ binaryPropertyName: 'data', reference: '  ' }], /'Reference' is empty/],
		[
			[
				{ binaryPropertyName: 'data', reference: 'same' },
				{ binaryPropertyName: 'second', reference: 'same' },
			],
			/'Reference' "same" is used more than once/,
		],
		[
			[{ binaryPropertyName: 'data', reference: 'unused-ref' }],
			/'Reference' "unused-ref" does not appear/,
		],
	])('rejects %j before sending', async (entries, message) => {
		const { functions, request } = createFunctions(
			{ ...imageParameters, 'images.image': entries },
			imageItems,
			() => noulResponse,
		);

		await expect(TypeSafeAi.prototype.execute.call(functions)).rejects.toThrow(message);
		expect(request).not.toHaveBeenCalled();
	});

	it.each([
		['a key in the state', { stateJson: '{"photo-ref": "a photo"}' }, 'photo-ref'],
		['part of the model name', {}, 'jev'],
	])('rejects a reference that appears only as %s', async (_where, overrides, reference) => {
		const { functions, request } = createFunctions(
			{
				...imageParameters,
				...overrides,
				'images.image': [{ binaryPropertyName: 'data', reference }],
			},
			imageItems,
			() => noulResponse,
		);

		await expect(TypeSafeAi.prototype.execute.call(functions)).rejects.toThrow(/does not appear/);
		expect(request).not.toHaveBeenCalled();
	});
});

describe('Request', () => {
	it('keeps the API key off a cross-origin redirect', async () => {
		const { functions, request } = createFunctions(routeParameters, items, () =>
			choiceResponse('billing', 0.9),
		);
		await TypeSafeAi.prototype.execute.call(functions);

		const [, options] = request.mock.calls[0] as unknown as [
			unknown,
			{ sendCredentialsOnCrossOriginRedirect: unknown },
		];
		expect(options.sendCredentialsOnCrossOriginRedirect).toBe(false);
	});

	it('sends requests to the custom base URL when it is switched on', async () => {
		const { functions, request } = createFunctions(routeParameters, items, () =>
			choiceResponse('billing', 0.9),
		);
		functions.getCredentials = async () => ({
			apiKey: 'k',
			baseUrl: '',
			useCustomBaseUrl: true,
			customBaseUrl: 'https://gateway.example.com/typesafe/',
		});
		await TypeSafeAi.prototype.execute.call(functions);

		const [, options] = request.mock.calls[0] as unknown as [unknown, { url: unknown }];
		expect(options.url).toBe('https://gateway.example.com/typesafe/v1/systemone');
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
