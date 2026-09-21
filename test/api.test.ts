import { describe, expect, it } from 'vitest';

import {
	BASE_URL_EXPRESSION,
	DEFAULT_BASE_URL,
	describeApiError,
	resolveBaseUrl,
} from '../nodes/TypeSafeAi/api';

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

describe('BASE_URL_EXPRESSION', () => {
	it('interpolates the default host rather than shipping the placeholder', () => {
		expect(BASE_URL_EXPRESSION).not.toContain('${');
		expect(BASE_URL_EXPRESSION).toContain(`|| '${DEFAULT_BASE_URL}'`);
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
