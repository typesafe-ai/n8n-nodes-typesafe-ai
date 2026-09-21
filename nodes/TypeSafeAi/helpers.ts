import type { IDataObject, INode, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { Answer, QuestionType } from './api';
import { LEVEL_BOUNDS, OPTION_BOUNDS } from './api';

export const ROUTE_QUESTION_ID = 'route';

export interface ItemContext {
	node: INode;
	itemIndex: number;
}

export function fail(context: ItemContext, message: string): never {
	throw new NodeOperationError(context.node, message, { itemIndex: context.itemIndex });
}

export interface CriteriaEntry {
	name?: string;
	description?: string;
}

export interface LevelEntry {
	level?: string;
}

export interface QuestionEntry {
	id?: string;
	instructions?: string;
	type?: QuestionType;
	trueMeans?: string;
	falseMeans?: string;
	choiceOptions?: { option?: CriteriaEntry[] };
	scoreLevels?: { level?: LevelEntry[] };
}

function compact(object: IDataObject): IDataObject {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function blankToUndefined(value: unknown): string | undefined {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed === '' ? undefined : trimmed;
}

export function parseJsonParameter(context: ItemContext, raw: unknown, label: string): unknown {
	if (typeof raw !== 'string') return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return fail(context, `${label} is not valid JSON`);
	}
}

export function buildCriteriaMap(
	context: ItemContext,
	entries: CriteriaEntry[],
	noun: string,
	where: string,
): IDataObject {
	const criteria: IDataObject = Object.create(null);
	for (const entry of entries) {
		const name = (entry.name ?? '').trim();
		if (name === '') {
			fail(context, `${where}: every ${noun} needs a name`);
		}
		if (criteria[name] !== undefined) {
			fail(
				context,
				`${where}: the ${noun} name "${name}" is used more than once, and every ${noun} needs a unique name`,
			);
		}
		criteria[name] = blankToUndefined(entry.description) ?? null;
	}
	const count = Object.keys(criteria).length;
	if (count < OPTION_BOUNDS.min || count > OPTION_BOUNDS.max) {
		fail(
			context,
			`${where}: configure between ${OPTION_BOUNDS.min} and ${OPTION_BOUNDS.max} ${noun}s, found ${count}`,
		);
	}
	return criteria;
}

export function buildLevels(context: ItemContext, entries: LevelEntry[], where: string): string[] {
	const levels = entries.map((entry) => (entry.level ?? '').trim());
	if (levels.some((level) => level === '')) {
		fail(context, `${where}: every level needs a description`);
	}
	if (levels.length < LEVEL_BOUNDS.min || levels.length > LEVEL_BOUNDS.max) {
		fail(
			context,
			`${where}: configure between ${LEVEL_BOUNDS.min} and ${LEVEL_BOUNDS.max} levels, found ${levels.length}`,
		);
	}
	return levels;
}

export function buildQuestion(context: ItemContext, entry: QuestionEntry, id: string): IDataObject {
	const where = `Question "${id}"`;
	const instructions = (entry.instructions ?? '').trim();
	if (instructions === '') {
		fail(context, `${where}: instructions are empty`);
	}
	const type = entry.type ?? 'noul';
	if (type === 'choice') {
		return {
			type,
			instructions,
			criteria: buildCriteriaMap(context, entry.choiceOptions?.option ?? [], 'option', where),
		};
	}
	if (type === 'score') {
		return {
			type,
			instructions,
			criteria: buildLevels(context, entry.scoreLevels?.level ?? [], where),
		};
	}
	const criteria = compact({
		true: blankToUndefined(entry.trueMeans),
		false: blankToUndefined(entry.falseMeans),
	});
	return Object.keys(criteria).length === 0
		? { type, instructions }
		: { type, instructions, criteria };
}

export function buildQuestionsFromEntries(
	context: ItemContext,
	entries: QuestionEntry[],
): IDataObject {
	if (entries.length === 0) {
		fail(context, 'Add at least one question');
	}
	const questions: IDataObject = Object.create(null);
	for (const entry of entries) {
		const id = (entry.id ?? '').trim();
		if (id === '') {
			fail(context, 'Every question needs an ID');
		}
		if (questions[id] !== undefined) {
			fail(
				context,
				`The question ID "${id}" is used more than once, and every question needs a unique ID`,
			);
		}
		questions[id] = buildQuestion(context, entry, id);
	}
	return questions;
}

export function parseQuestionsJson(context: ItemContext, raw: unknown): IDataObject {
	const parsed = parseJsonParameter(context, raw, 'Questions');
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		fail(context, 'Questions must be a JSON object keyed by question ID');
	}
	return parsed as IDataObject;
}

function resolveLevel(
	legend: Record<string, string> | undefined,
	probabilities: Record<string, number> | undefined,
	score: number,
): string | undefined {
	if (legend === undefined) return undefined;
	const ranked = Object.entries(probabilities ?? {});
	if (ranked.length > 0) {
		const best = ranked.reduce((winner, entry) => (entry[1] > winner[1] ? entry : winner));
		return legend[best[0]];
	}
	const keys = Object.keys(legend);
	if (keys.length === 0) return undefined;
	const nearest = keys.reduce((winner, key) =>
		Math.abs(Number(key) - score) < Math.abs(Number(winner) - score) ? key : winner,
	);
	return legend[nearest];
}

export function simplifyAnswer(answer: Answer): IDataObject {
	if (answer.type === 'noul') {
		return { value: answer.noul };
	}
	if (answer.type === 'choice') {
		return compact({ value: answer.choice, confidence: answer.confidence });
	}
	return compact({
		value: answer.score,
		level: resolveLevel(answer.legend, answer.probabilities, answer.score),
		confidence: answer.confidence,
	});
}

export function simplifyAnswers(answers: Record<string, Answer>): IDataObject {
	return Object.fromEntries(
		Object.entries(answers).map(([id, answer]) => [id, simplifyAnswer(answer)]),
	);
}

/** Serialized method used in expression, must not use any externally defined variables */
export const configuredOutputs = (
	parameters: {
		operation?: string;
		routes?: { route?: Array<{ name?: string }> };
		confidenceHandling?: string;
	} = {},
) => {
	if (parameters.operation !== 'route') {
		return [{ type: 'main' }];
	}
	const routes = parameters.routes?.route ?? [];
	const outputs = routes
		.map(({ name }) => name?.trim())
		.filter(Boolean)
		.map((name) => ({ type: 'main', displayName: name }));
	if (outputs.length === 0) {
		return [{ type: 'main' }];
	}
	if (parameters.confidenceHandling === 'separateOutput') {
		outputs.push({ type: 'main', displayName: 'Fallback' });
	}
	return outputs;
};

export function buildOutputItem(
	item: INodeExecutionData,
	fields: IDataObject,
	includeOtherFields: boolean,
	itemIndex: number,
): INodeExecutionData {
	if (!includeOtherFields) {
		return { json: fields, pairedItem: { item: itemIndex } };
	}
	return {
		json: { ...item.json, ...fields },
		binary: item.binary,
		pairedItem: { item: itemIndex },
	};
}
