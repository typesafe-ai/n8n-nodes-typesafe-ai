import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'typeSafeAiApi';
export const DEFAULT_BASE_URL = 'https://api.typesafe.ai';

/** Limits the API itself imposes on a question's criteria */
export const OPTION_BOUNDS = { min: 2, max: 255 };
export const LEVEL_BOUNDS = { min: 2, max: 10 };

function trimBaseUrl(raw: unknown): string {
	return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

export function resolveBaseUrl(raw: unknown): string {
	const trimmed = trimBaseUrl(raw);
	return trimmed === '' ? DEFAULT_BASE_URL : trimmed;
}

/** The custom base URL when it's switched on and filled in, otherwise the base URL */
export function credentialBaseUrl(credentials: {
	baseUrl?: unknown;
	useCustomBaseUrl?: unknown;
	customBaseUrl?: unknown;
}): string {
	const custom =
		credentials.useCustomBaseUrl === true ? trimBaseUrl(credentials.customBaseUrl) : '';
	return custom === '' ? resolveBaseUrl(credentials.baseUrl) : custom;
}

/** The same resolution as credentialBaseUrl, for the declarative credential test */
export const BASE_URL_EXPRESSION = `={{ ($credentials.useCustomBaseUrl === true && ($credentials.customBaseUrl || '').trim().replace(/\\/+$/, '')) || ($credentials.baseUrl || '').trim().replace(/\\/+$/, '') || '${DEFAULT_BASE_URL}' }}`;

export type QuestionType = 'choice' | 'noul' | 'score';

export interface ModelCard {
	name: string;
	description: string;
	release_date: string;
}

export interface ChoiceAnswer {
	type: 'choice';
	choice: string;
	confidence?: number;
	probabilities?: Record<string, number>;
}

export interface NoulAnswer {
	type: 'noul';
	noul: number;
}

export interface ScoreAnswer {
	type: 'score';
	score: number;
	confidence?: number;
	legend?: Record<string, string>;
	probabilities?: Record<string, number>;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface ImagePart {
	reference: string;
	mimeType: string;
	fileName?: string;
	data: Buffer;
}

export interface SystemOneResponse {
	model: string;
	answers: Record<string, Answer>;
	usage?: IDataObject;
}

function describeValidationIssue(issue: unknown): string {
	const { loc, msg } = (issue ?? {}) as { loc?: unknown[]; msg?: unknown };
	const field = Array.isArray(loc) ? loc.filter((part) => part !== 'body').join('.') : '';
	const message = typeof msg === 'string' ? msg : 'is invalid';
	return field === '' ? message : `${field}: ${message}`;
}

export function describeApiError(body: unknown, statusCode: number): string {
	const detail = (body as { detail?: unknown } | null | undefined)?.detail;
	if (Array.isArray(detail) && detail.length > 0) {
		return detail.map(describeValidationIssue).join('; ');
	}
	if (typeof detail === 'string' && detail !== '') {
		return detail;
	}
	const message = (detail as { message?: unknown } | null | undefined)?.message;
	if (typeof message === 'string' && message !== '') {
		return message;
	}
	if (typeof body === 'string' && body.trim() !== '' && !body.trimStart().startsWith('<')) {
		return body.trim();
	}
	return `The TypeSafe AI API returned status ${statusCode}`;
}

async function apiRequest(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	options: {
		method: IHttpRequestMethods;
		path: string;
		body?: IDataObject | FormData;
		headers?: IDataObject;
		timeout?: number;
	},
	itemIndex?: number,
): Promise<unknown> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	const response = await context.helpers.httpRequestWithAuthentication.call(
		context,
		CREDENTIAL_NAME,
		{
			method: options.method,
			url: `${credentialBaseUrl(credentials)}${options.path}`,
			// n8n types the body as the form-data package's FormData. A native one
			// is passed through as is, and the HTTP client sets its multipart headers.
			body: options.body as IDataObject,
			headers: options.headers,
			timeout: options.timeout,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			// Keep the API key on the configured host if a response redirects elsewhere
			sendCredentialsOnCrossOriginRedirect: false,
		},
	);
	const { statusCode, body } = response as { statusCode: number; body: unknown };
	if (statusCode >= 300) {
		throw new NodeApiError(context.getNode(), (body ?? {}) as JsonObject, {
			message: describeApiError(body, statusCode),
			httpCode: String(statusCode),
			itemIndex,
		});
	}
	return body;
}

export async function evaluateState(
	context: IExecuteFunctions,
	itemIndex: number,
	body: IDataObject,
	timeout: number,
	images: ImagePart[] = [],
): Promise<SystemOneResponse> {
	const request =
		images.length === 0
			? { body }
			: {
					body: buildMultipartBody(body, images),
					headers: { 'TypeSafe-Danger-Zone-Images': 'true' },
				};
	const response = await apiRequest(
		context,
		{ method: 'POST', path: '/v1/systemone', ...request, timeout },
		itemIndex,
	);
	return response as SystemOneResponse;
}

/** The API requires the JSON part, named `request`, to come first */
function buildMultipartBody(body: IDataObject, images: ImagePart[]): FormData {
	const partName = (index: number) => `image-${index}`;
	const assets = Object.fromEntries(
		images.map(({ reference }, index) => [reference, { type: 'image', part: partName(index) }]),
	);
	const form = new FormData();
	form.append(
		'request',
		new Blob([JSON.stringify({ ...body, assets })], { type: 'application/json' }),
	);
	images.forEach(({ data, mimeType, fileName }, index) => {
		// Blob takes an ArrayBuffer-backed view, which a Buffer is not typed as
		const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
		form.append(
			partName(index),
			new Blob([bytes], { type: mimeType }),
			fileName ?? partName(index),
		);
	});
	return form;
}

export async function searchModels(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = (await apiRequest(this, { method: 'GET', path: '/v1/models' })) as {
		models?: ModelCard[];
	};
	const needle = (filter ?? '').toLowerCase();
	const results = (response.models ?? [])
		.filter((model) => model.name.toLowerCase().includes(needle))
		.map((model) => ({
			name: model.name,
			value: model.name,
			description: `${model.description} (released ${model.release_date.slice(0, 10)})`,
		}));
	return { results };
}
