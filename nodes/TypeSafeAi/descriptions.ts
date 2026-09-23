import type { INodeProperties } from 'n8n-workflow';

import { LEVEL_BOUNDS, OPTION_BOUNDS } from './api';

const QUESTIONS_JSON_EXAMPLE = JSON.stringify(
	{
		is_urgent: {
			type: 'noul',
			instructions: 'Is this ticket urgent?',
			criteria: { true: 'Needs a reply today', false: 'Can wait' },
		},
		department: {
			type: 'choice',
			instructions: 'Which department should handle this?',
			criteria: { billing: 'Payments and invoices', technical: 'Bugs and outages' },
		},
	},
	null,
	2,
);

const questionEntryFields: INodeProperties[] = [
	{
		displayName: 'Question Type',
		name: 'type',
		type: 'options',
		required: true,
		default: 'noul',
		options: [
			{ name: 'Choice', value: 'choice', description: 'Pick one of your options' },
			{ name: 'Noul (Yes/No)', value: 'noul', description: 'Return the probability of yes' },
			{ name: 'Score', value: 'score', description: 'Rate against ordered levels' },
		],
	},
	{
		displayName: 'ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'is_urgent',
		description: 'The key this answer is returned under. It is not sent to the model.',
	},
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Is this ticket urgent?',
		description: 'The question to ask about the state',
	},
	{
		displayName: 'Answer Options',
		name: 'choiceOptions',
		type: 'fixedCollection',
		// n8n cannot enforce minRequiredFields on a list nested inside another
		// list, so the bounds are checked at run time and the list starts at the
		// minimum.
		typeOptions: {
			multipleValues: true,
			sortable: true,
			fixedCollection: { itemTitle: '={{ $collection.item.value.name }}' },
		},
		placeholder: 'Add Answer Option',
		default: {
			option: [
				{ name: '', description: '' },
				{ name: '', description: '' },
			],
		},
		displayOptions: { show: { type: ['choice'] } },
		description: `Between ${OPTION_BOUNDS.min} and ${OPTION_BOUNDS.max} options to choose between. Their order carries no meaning. To supply options generated from data, switch Questions Format to Using Raw JSON.`,
		options: [
			{
				name: 'option',
				displayName: 'Answer Option',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						required: true,
						default: '',
						description: 'Sent to the model and returned as the answer',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'A description of this option, used as its rubric',
					},
				],
			},
		],
	},
	{
		displayName: 'Levels',
		name: 'scoreLevels',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
			fixedCollection: {
				itemTitle:
					'={{ [`Level ${$collection.item.index}`, $collection.item.value.level].filter(Boolean).join(": ") }}',
			},
		},
		placeholder: 'Add Level',
		default: { level: [{ level: '' }, { level: '' }] },
		displayOptions: { show: { type: ['score'] } },
		description: `Between ${LEVEL_BOUNDS.min} and ${LEVEL_BOUNDS.max} levels, ordered from lowest to highest`,
		options: [
			{
				name: 'level',
				displayName: 'Level',
				values: [
					{
						displayName: 'Level',
						name: 'level',
						type: 'string',
						required: true,
						default: '',
						description: 'What this level describes',
					},
				],
			},
		],
	},
	{
		displayName: 'True Means',
		name: 'trueMeans',
		type: 'string',
		default: '',
		displayOptions: { show: { type: ['noul'] } },
		description: 'What an answer near 1 means',
	},
	{
		displayName: 'False Means',
		name: 'falseMeans',
		type: 'string',
		default: '',
		displayOptions: { show: { type: ['noul'] } },
		description: 'What an answer near 0 means',
	},
];

const routeEntryFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		noDataExpression: true,
		description: 'Sent to the model as the option, and used as the label of this output',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		default: '',
		description: 'A description of this route, used as its rubric',
	},
];

const evaluateOperation = {
	name: 'Evaluate',
	value: 'evaluate',
	description: 'Evaluate the state against the configured questions and return the answers',
	action: 'Evaluate a state against typed questions',
};

const routeOperation = {
	name: 'Route',
	value: 'route',
	description:
		'Evaluate the state against one choice question and send the item to the matching output',
	action: 'Route an item by a typed question',
};

const operationProperty = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options' as const,
	noDataExpression: true,
	default: 'evaluate',
};

export const typeSafeAiProperties: INodeProperties[] = [
	{
		...operationProperty,
		displayOptions: { show: { '@tool': [false] } },
		options: [evaluateOperation, routeOperation],
	},
	{
		// As a tool the node hands its result back to the agent, so Route's extra
		// outputs would connect to nothing.
		...operationProperty,
		displayOptions: { show: { '@tool': [true] } },
		options: [evaluateOperation],
	},
	{
		displayName: 'Model',
		name: 'model',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: 'jev-latest', cachedResultName: 'jev-latest' },
		description:
			'Aliases such as jev-latest move with every new release. Pin a version such as jev-1.13.0 to keep answers stable.',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchModels', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'jev-1.13.0',
				hint: 'Versioned IDs are accepted even when they are not in the list',
			},
		],
	},
	{
		displayName: 'State Format',
		name: 'stateFormat',
		type: 'options',
		required: true,
		default: 'text',
		options: [
			{ name: 'Input Item', value: 'inputItem', description: 'Send the JSON of the incoming item' },
			{ name: 'JSON', value: 'json', description: 'Send a JSON object or array' },
			{ name: 'Text', value: 'text', description: 'Send plain text' },
		],
		description: 'Where the content to evaluate comes from',
	},
	{
		displayName: 'State',
		name: 'stateText',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 4 },
		displayOptions: { show: { stateFormat: ['text'] } },
		description: 'The content to evaluate. Every question sees this same state.',
		placeholder: 'Add context for TypeSafe to evaluate',
	},
	{
		displayName: 'State',
		name: 'stateJson',
		type: 'json',
		required: true,
		default: '{}',
		displayOptions: { show: { stateFormat: ['json'] } },
		description: 'The content to evaluate. Every question sees this same state.',
		placeholder: 'Add context for TypeSafe to evaluate',
	},
	{
		displayName: 'Questions Format',
		name: 'questionsFormat',
		type: 'options',
		required: true,
		default: 'fields',
		displayOptions: { show: { operation: ['evaluate'] } },
		options: [
			{ name: 'Using Fields Below', value: 'fields' },
			{ name: 'Using Raw JSON', value: 'json' },
		],
	},
	{
		displayName: 'Questions',
		name: 'questions',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
			minRequiredFields: 1,
			fixedCollection: { itemTitle: '={{ $collection.item.value.id }}' },
		},
		placeholder: 'Add Question',
		default: {},
		displayOptions: { show: { operation: ['evaluate'], questionsFormat: ['fields'] } },
		options: [{ name: 'question', displayName: 'Question', values: questionEntryFields }],
	},
	{
		displayName: 'Questions',
		name: 'questionsJson',
		type: 'json',
		required: true,
		default: QUESTIONS_JSON_EXAMPLE,
		typeOptions: { rows: 12 },
		displayOptions: { show: { operation: ['evaluate'], questionsFormat: ['json'] } },
		description: 'A map of question ID to question, sent to the API as written',
	},
	{
		displayName: 'Instructions',
		name: 'routeInstructions',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 2 },
		placeholder: 'Which department should handle this?',
		displayOptions: { show: { operation: ['route'] } },
		description: 'What the model should decide when picking a route',
	},
	{
		displayName: 'Routes',
		name: 'routes',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
			minRequiredFields: OPTION_BOUNDS.min,
			maxAllowedFields: OPTION_BOUNDS.max,
			fixedCollection: { itemTitle: '={{ $collection.item.value.name }}' },
		},
		placeholder: 'Add Route',
		default: {},
		displayOptions: { show: { operation: ['route'] } },
		description: `Between ${OPTION_BOUNDS.min} and ${OPTION_BOUNDS.max} routes. Each one becomes an output.`,
		options: [{ name: 'route', displayName: 'Route', values: routeEntryFields }],
	},
	{
		displayName: 'Confidence Handling',
		name: 'confidenceHandling',
		type: 'options',
		required: true,
		default: 'bestOption',
		displayOptions: { show: { operation: ['route'] } },
		options: [
			{
				name: 'Route to Best Option',
				value: 'bestOption',
				description: 'Every item follows the chosen route, however unsure the model was',
			},
			{
				name: 'Route to Separate Fallback Output',
				value: 'separateOutput',
				description: 'Send unsure items to an extra output instead of the chosen route',
			},
		],
	},
	{
		displayName: 'Confidence Threshold',
		name: 'confidenceThreshold',
		type: 'number',
		default: 0.5,
		typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
		displayOptions: { show: { operation: ['route'], confidenceHandling: ['separateOutput'] } },
		description: 'Items answered with less confidence than this go to the Fallback output',
		hint: 'How sure the model needs to be before routing to an option (0.0 - 1.0)',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Include Other Input Fields',
				name: 'includeOtherFields',
				type: 'boolean',
				default: true,
				description:
					'Whether to keep the fields of the incoming item alongside the result. Fields named answers, route or model are overwritten.',
			},
			{
				displayName: 'Simplify Output',
				name: 'simplify',
				type: 'boolean',
				default: true,
				displayOptions: { show: { '/operation': ['evaluate'] } },
				description: 'Whether to return one value per question instead of the full response',
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				default: 5000,
				typeOptions: { minValue: 1000 },
				description:
					'Time in ms to wait for the server to send response headers (and start the response body) before aborting the request',
			},
		],
	},
];
