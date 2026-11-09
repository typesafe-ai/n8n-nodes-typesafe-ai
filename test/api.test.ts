import { describe, expect, it } from 'vitest';

import {
	BASE_URL_EXPRESSION,
	credentialBaseUrl,
	DEFAULT_BASE_URL,
	describeApiError,
	resolveBaseUrl,
} from '../nodes/TypeSafeAi/api';

const CREDENTIAL_CASES: Array<[string, Record<string, unknown>, string]> = [
	['no fields set', {}, 'https://api.typesafe.ai'],
	['the hidden base URL', { baseUrl: 'https://eu.typesafe.ai/' }, 'https://eu.typesafe.ai'],
	[
		'a custom base URL while the switch is off',
		{ useCustomBaseUrl: false, customBaseUrl: 'https://gateway.example.com' },
		'https://api.typesafe.ai',
	],
	[
		'a custom base URL while the switch is on',
		{ useCustomBaseUrl: true, customBaseUrl: '  https://gateway.example.com/typesafe//  ' },
		'https://gateway.example.com/typesafe',
	],
	[
		'the switch on over a hidden base URL',
		{
			useCustomBaseUrl: true,
			customBaseUrl: 'https://gateway.example.com',
			baseUrl: 'https://eu.typesafe.ai',
		},
		'https://gateway.example.com',
	],
	[
		'the switch on with a blank custom base URL',
		{ useCustomBaseUrl: true, customBaseUrl: '   ', baseUrl: 'https://eu.typesafe.ai' },
		'https://eu.typesafe.ai',
	],
];

describe('resolveBaseUrl', () => {
	it.each([
		[undefined, 'https://api.typesafe.ai'],
		['', 'https://api.typesafe.ai'],
		['   ', 'https://api.typesafe.ai'],
		['  https://eu.typesafe.ai///  ', 'https://eu.typesafe.ai'],
	])('resolves %s', (raw, expected) => {
		expect(resolveBaseUrl(raw)).toBe(expected);
	});
});

describe('credentialBaseUrl', () => {
	it.each(CREDENTIAL_CASES)('resolves %s', (_case, credentials, expected) => {
		expect(credentialBaseUrl(credentials)).toBe(expected);
	});
});

describe('BASE_URL_EXPRESSION', () => {
	it('interpolates the default host rather than shipping the placeholder', () => {
		expect(BASE_URL_EXPRESSION).not.toContain('${');
		expect(BASE_URL_EXPRESSION).toContain(`|| '${DEFAULT_BASE_URL}'`);
	});

	it('prefers the custom base URL only while the switch is on', () => {
		expect(BASE_URL_EXPRESSION).toContain(
			"($credentials.useCustomBaseUrl === true && ($credentials.customBaseUrl || '')",
		);
		expect(BASE_URL_EXPRESSION.indexOf('$credentials.customBaseUrl')).toBeLessThan(
			BASE_URL_EXPRESSION.indexOf('$credentials.baseUrl'),
		);
	});
});

describe('describeApiError', () => {
	it('flattens a 422 detail list into one sentence', () => {
		const body = {
			detail: [
				{ loc: ['body', 'questions', 'q', 'choice', 'criteria'], msg: 'Field required' },
				{ loc: ['body', 'model'], msg: 'Input should be a valid string' },
			],
		};
		expect(describeApiError(body, 422)).toBe(
			'questions.q.choice.criteria: Field required; model: Input should be a valid string',
		);
	});

	it('uses the message of a detail object', () => {
		const body = { detail: { error_type: 'api_usage_error', message: 'Unknown model: jev-9.9.9' } };
		expect(describeApiError(body, 400)).toBe('Unknown model: jev-9.9.9');
	});

	it('uses a plain text body that did not parse as JSON', () => {
		expect(describeApiError('  Upstream connect error  ', 502)).toBe('Upstream connect error');
	});

	it.each([undefined, '', '   ', '<html><body>502 Bad Gateway</body></html>'])(
		'falls back to the status code given %s',
		(body) => {
			expect(describeApiError(body, 502)).toBe('The TypeSafe AI API returned status 502');
		},
	);
});
