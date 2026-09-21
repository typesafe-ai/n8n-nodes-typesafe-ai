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

export function resolveBaseUrl(raw: unknown): string {
	const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
	return trimmed === '' ? DEFAULT_BASE_URL : trimmed;
}

/** The same resolution as resolveBaseUrl, for the declarative credential test */
export const BASE_URL_EXPRESSION = `={{ ($credentials.baseUrl || '').trim().replace(/\\/+$/, '') || '${DEFAULT_BASE_URL}' }}`;

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
	options: { method: IHttpRequestMethods; path: string; body?: IDataObject; timeout?: number },
	itemIndex?: number,
): Promise<unknown> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	const response = await context.helpers.httpRequestWithAuthentication.call(
		context,
		CREDENTIAL_NAME,
		{
			method: options.method,
			url: `${resolveBaseUrl(credentials.baseUrl)}${options.path}`,
			body: options.body,
			timeout: options.timeout,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
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
): Promise<SystemOneResponse> {
	const response = await apiRequest(
		context,
		{ method: 'POST', path: '/v1/systemone', body, timeout },
		itemIndex,
	);
	return response as SystemOneResponse;
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
