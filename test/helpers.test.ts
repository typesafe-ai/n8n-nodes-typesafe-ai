import type { INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	buildCriteriaMap,
	buildLevels,
	buildNoulQuestion,
	buildOutputItem,
	buildQuestion,
	buildQuestionsFromEntries,
	configuredOutputs,
	parseQuestionsJson,
	simplifyAnswers,
} from '../nodes/TypeSafeAi/helpers';
import type { ItemContext } from '../nodes/TypeSafeAi/helpers';
import type { Answer } from '../nodes/TypeSafeAi/api';

const node: INode = {
	id: 'a',
	name: 'TypeSafe AI',
	type: 'typeSafeAi',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const context: ItemContext = { node, itemIndex: 0 };

describe('buildQuestion', () => {
	it('omits noul criteria when both meanings are blank', () => {
		expect(buildQuestion(context, { instructions: 'Urgent?', type: 'noul' }, 'q')).toEqual({
			type: 'noul',
			instructions: 'Urgent?',
		});
	});

	it('sends only the noul meanings that were given', () => {
		expect(
			buildQuestion(context, { instructions: 'Urgent?', type: 'noul', trueMeans: ' Today ' }, 'q'),
		).toEqual({ type: 'noul', instructions: 'Urgent?', criteria: { true: 'Today' } });
	});

	it('maps choice options to descriptions, with null where blank', () => {
		const question = buildQuestion(
			context,
			{
				instructions: 'Which team?',
				type: 'choice',
				choiceOptions: {
					option: [
						{ name: 'billing', description: 'Payments' },
						{ name: 'sales', description: '  ' },
					],
				},
			},
			'q',
		);
		expect(question).toEqual({
			type: 'choice',
			instructions: 'Which team?',
			criteria: { billing: 'Payments', sales: null },
		});
	});

	it('sends score levels as an ordered array, lowest first', () => {
		const question = buildQuestion(
			context,
			{
				instructions: 'How angry?',
				type: 'score',
				scoreLevels: { level: [{ level: 'Calm' }, { level: 'Furious' }] },
			},
			'q',
		);
		expect(question).toEqual({
			type: 'score',
			instructions: 'How angry?',
			criteria: ['Calm', 'Furious'],
		});
	});

	it('rejects blank instructions', () => {
		expect(() => buildQuestion(context, { instructions: '  ', type: 'noul' }, 'q')).toThrow(
			/instructions are empty/,
		);
	});
});

describe('criteria and level bounds', () => {
	const options = (count: number) =>
		Array.from({ length: count }, (_unused, index) => ({ name: `option-${index}` }));

	it('rejects fewer than two options', () => {
		expect(() => buildCriteriaMap(context, options(1), 'option', 'Q')).toThrow(/between 2 and 255/);
	});

	it('rejects more than 255 options', () => {
		expect(() => buildCriteriaMap(context, options(256), 'option', 'Q')).toThrow(
			/between 2 and 255/,
		);
	});

	it('rejects duplicate option names', () => {
		expect(() =>
			buildCriteriaMap(context, [{ name: 'a' }, { name: ' a ' }], 'route', 'Routes'),
		).toThrow(/used more than once/);
	});

	it('rejects a blank option name', () => {
		expect(() =>
			buildCriteriaMap(context, [{ name: 'a' }, { name: '' }], 'route', 'Routes'),
		).toThrow(/every route needs a name/);
	});

	it.each([1, 11])('rejects %i levels', (count) => {
		const levels = Array.from({ length: count }, (_unused, index) => ({ level: `L${index}` }));
		expect(() => buildLevels(context, levels, 'Q')).toThrow(/between 2 and 10/);
	});
});

describe('buildQuestionsFromEntries', () => {
	it('keys questions by ID', () => {
		const questions = buildQuestionsFromEntries(context, [
			{ id: ' urgent ', instructions: 'Urgent?', type: 'noul' },
		]);
		expect(Object.keys(questions)).toEqual(['urgent']);
	});

	it('rejects duplicate IDs', () => {
		expect(() =>
			buildQuestionsFromEntries(context, [
				{ id: 'a', instructions: 'One', type: 'noul' },
				{ id: 'a', instructions: 'Two', type: 'noul' },
			]),
		).toThrow(/used more than once/);
	});

	it('rejects an empty list', () => {
		expect(() => buildQuestionsFromEntries(context, [])).toThrow(/at least one question/);
	});
});

describe('parseQuestionsJson', () => {
	it('passes a valid map through unchanged', () => {
		const raw = '{"q":{"type":"noul","instructions":"Urgent?"}}';
		expect(parseQuestionsJson(context, raw)).toEqual({
			q: { type: 'noul', instructions: 'Urgent?' },
		});
	});

	it('rejects invalid JSON', () => {
		expect(() => parseQuestionsJson(context, '{')).toThrow(/not valid JSON/);
	});

	it('rejects a JSON array', () => {
		expect(() => parseQuestionsJson(context, '[]')).toThrow(/keyed by question ID/);
	});
});

describe('simplifyAnswers', () => {
	const answers: Record<string, Answer> = {
		is_urgent: { type: 'noul', noul: 0.85 },
		department: {
			type: 'choice',
			choice: 'billing',
			confidence: 1,
			probabilities: { billing: 1, technical: 0 },
		},
		frustration: {
			type: 'score',
			score: 2.29,
			confidence: 0.71,
			legend: { '0': 'Calm', '1': 'Mildly annoyed', '2': 'Frustrated', '3': 'Furious' },
			probabilities: { '0': 0, '1': 0, '2': 0.71, '3': 0.29 },
		},
	};

	it('returns one nested value per question', () => {
		expect(simplifyAnswers(answers)).toEqual({
			is_urgent: { value: 0.85 },
			department: { value: 'billing', confidence: 1 },
			frustration: { value: 2.29, level: 'Frustrated', confidence: 0.71 },
		});
	});

	it('falls back to the level nearest the score when probabilities are missing', () => {
		const simplified = simplifyAnswers({
			frustration: { type: 'score', score: 2.29, legend: { '0': 'Calm', '2': 'Frustrated' } },
		});
		expect(simplified.frustration).toEqual({ value: 2.29, level: 'Frustrated' });
	});

	it('omits the level when there is no legend', () => {
		expect(simplifyAnswers({ q: { type: 'score', score: 1 } })).toEqual({ q: { value: 1 } });
	});
});

describe('configuredOutputs', () => {
	const routes = { route: [{ name: 'billing' }, { name: 'technical' }] };

	it('gives Evaluate a single main output', () => {
		expect(configuredOutputs({ operation: 'evaluate' })).toEqual([{ type: 'main' }]);
	});

	it('appends Fallback output last when that handling is chosen', () => {
		expect(
			configuredOutputs({ operation: 'route', routes, confidenceHandling: 'separateOutput' }),
		).toEqual([
			{ type: 'main', displayName: 'billing' },
			{ type: 'main', displayName: 'technical' },
			{ type: 'main', displayName: 'Fallback' },
		]);
	});

	it('adds no extra output when routing to the best option', () => {
		expect(
			configuredOutputs({ operation: 'route', routes, confidenceHandling: 'bestOption' }),
		).toEqual([
			{ type: 'main', displayName: 'billing' },
			{ type: 'main', displayName: 'technical' },
		]);
	});

	it('adds no Fallback output when the handling parameter is absent', () => {
		expect(configuredOutputs({ operation: 'route', routes })).toEqual([
			{ type: 'main', displayName: 'billing' },
			{ type: 'main', displayName: 'technical' },
		]);
	});

	it('labels the Noul outputs with the True and False meanings', () => {
		expect(
			configuredOutputs({
				operation: 'route',
				routeQuestionType: 'noul',
				routeTrueMeans: 'Needs a reply today',
				routeFalseMeans: 'Can wait',
				trueThreshold: 0.8,
				falseThreshold: 0.2,
			}),
		).toEqual([
			{ type: 'main', displayName: 'Needs a reply today' },
			{ type: 'main', displayName: 'Can wait' },
			{ type: 'main', displayName: 'Uncertain' },
		]);
	});

	it('falls back to True and False when no meanings are given', () => {
		expect(configuredOutputs({ operation: 'route', routeQuestionType: 'noul' })).toEqual([
			{ type: 'main', displayName: 'True' },
			{ type: 'main', displayName: 'False' },
		]);
	});

	it('adds no Uncertain output when the thresholds leave no gap', () => {
		expect(
			configuredOutputs({
				operation: 'route',
				routeQuestionType: 'noul',
				trueThreshold: 0.5,
				falseThreshold: 0.5,
			}),
		).toHaveLength(2);
	});

	it('keeps one output while no route is named yet', () => {
		expect(configuredOutputs({ operation: 'route', routes: {} })).toEqual([{ type: 'main' }]);
	});
});

describe('buildNoulQuestion', () => {
	it('omits the criteria when neither meaning is given', () => {
		expect(buildNoulQuestion('Urgent?', '', '  ')).toEqual({
			type: 'noul',
			instructions: 'Urgent?',
		});
	});

	it('sends only the meanings that were given, trimmed', () => {
		expect(buildNoulQuestion('Urgent?', ' Today ', '')).toEqual({
			type: 'noul',
			instructions: 'Urgent?',
			criteria: { true: 'Today' },
		});
	});
});

describe('buildOutputItem', () => {
	const item = { json: { ticket: 1, model: 'old' }, binary: { file: { data: '', mimeType: '' } } };

	it('writes the node fields over the incoming ones and carries binary through', () => {
		expect(buildOutputItem(item, { model: 'jev-1.13.0' }, true, 3)).toEqual({
			json: { ticket: 1, model: 'jev-1.13.0' },
			binary: item.binary,
			pairedItem: { item: 3 },
		});
	});

	it('drops the incoming fields and binary when not including them', () => {
		expect(buildOutputItem(item, { model: 'jev-1.13.0' }, false, 3)).toEqual({
			json: { model: 'jev-1.13.0' },
			pairedItem: { item: 3 },
		});
	});
});
