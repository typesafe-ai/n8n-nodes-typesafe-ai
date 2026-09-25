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
			{ name: 'Choice', value: 'choice', description: 'Pick one from a list of options' },
			{ name: 'Noul (Yes/No)', value: 'noul', description: 'Return the probability of yes' },
			{ name: 'Score', value: 'score', description: 'Rate against semantically defined levels' },
		],
	},
	{
		displayName: 'ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. is_urgent',
		description: 'The field this answer is returned under. It is not sent to the model.',
	},
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Is this ticket urgent?',
		description: 'The question to ask about the state',
	},
	{
		displayName: 'Choice Options',
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
		placeholder: 'Add Option',
		default: {
			option: [
				{ name: '', description: '' },
				{ name: '', description: '' },
			],
		},
		displayOptions: { show: { type: ['choice'] } },
		description: `Between ${OPTION_BOUNDS.min} and ${OPTION_BOUNDS.max} options to choose between. Their order carries no meaning. To supply options generated from data, switch 'Questions Format' to 'Using Raw JSON'.`,
		options: [
			{
				name: 'option',
				displayName: 'Option',
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
		description: 'Sent to the model as a choice, and used as the label of this output',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		default: '',
		description: 'The criteria for choosing this route',
	},
];

const routeLevelFields: INodeProperties[] = [
	{
		displayName: 'Level',
		name: 'level',
		type: 'string',
		required: true,
		default: '',
		noDataExpression: true,
		description: 'What this level describes. Also labels the output.',
	},
];

const evaluateOperation = {
	name: 'Evaluate',
	value: 'evaluate',
	description: 'Evaluate the state against System One questions and output answers',
	action: 'Evaluate state against System One questions',
};

const routeOperation = {
	name: 'Route',
	value: 'route',
	description:
		'Evaluate the state against a System One question and send the item to the matching output',
	action: 'Route item by System One question',
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
		description: 'Which model to use',
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
				placeholder: 'e.g. jev-latest',
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
		description: 'The content to evaluate',
		placeholder: 'Add content for TypeSafe to evaluate',
	},
	{
		displayName: 'State',
		name: 'stateJson',
		type: 'json',
		required: true,
		default: '{}',
		displayOptions: { show: { stateFormat: ['json'] } },
		description: 'The content to evaluate',
		placeholder: 'Add content for TypeSafe to evaluate',
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
		displayName: 'Question Type',
		name: 'routeQuestionType',
		type: 'options',
		required: true,
		default: 'choice',
		noDataExpression: true,
		displayOptions: { show: { operation: ['route'] } },
		options: [
			{
				name: 'Choice',
				value: 'choice',
				description: 'Send the item to the route the model picks',
			},
			{
				name: 'Noul (Yes/No)',
				value: 'noul',
				description: 'Send the item by the probability of yes',
			},
			{
				name: 'Score',
				value: 'score',
				description: 'Send the item to the level nearest the score',
			},
		],
	},
	{
		displayName: 'Instructions',
		name: 'routeInstructions',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 2 },
		placeholder: 'e.g. Which department should handle this?',
		displayOptions: { show: { operation: ['route'] } },
		description: 'The question the model answers to route the item',
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
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['choice'] } },
		description: `Between ${OPTION_BOUNDS.min} and ${OPTION_BOUNDS.max} routes. Each one becomes an output.`,
		options: [{ name: 'route', displayName: 'Route', values: routeEntryFields }],
	},
	{
		displayName: 'Levels',
		name: 'routeLevels',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
			minRequiredFields: LEVEL_BOUNDS.min,
			maxAllowedFields: LEVEL_BOUNDS.max,
			fixedCollection: {
				itemTitle:
					'={{ [`Level ${$collection.item.index}`, $collection.item.value.level].filter(Boolean).join(": ") }}',
			},
		},
		placeholder: 'Add Level',
		default: { level: [{ level: '' }, { level: '' }] },
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['score'] } },
		description: `Between ${LEVEL_BOUNDS.min} and ${LEVEL_BOUNDS.max} levels, ordered from lowest to highest. Each one becomes an output.`,
		options: [{ name: 'level', displayName: 'Level', values: routeLevelFields }],
	},
	{
		displayName: 'Confidence Handling',
		name: 'confidenceHandling',
		type: 'options',
		required: true,
		default: 'bestOption',
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['choice'] } },
		options: [
			{
				name: 'Always Route',
				value: 'bestOption',
				description: 'Send all items to the highest probability route, regardless of confidence',
			},
			{
				name: 'Route to Separate Fallback Output',
				value: 'separateOutput',
				description: 'Send low-confidence items to an extra output',
			},
		],
	},
	{
		displayName: 'Confidence Threshold',
		name: 'confidenceThreshold',
		type: 'number',
		default: 0.5,
		typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
		displayOptions: {
			show: {
				operation: ['route'],
				routeQuestionType: ['choice'],
				confidenceHandling: ['separateOutput'],
			},
		},
		description: 'Items answered with less confidence than this go to the Fallback output',
		hint: 'How sure the model needs to be before an item follows its route (0.0 - 1.0).<br /><a href="https://docs.typesafe.ai/confidence" target="_blank">See docs</a> for more information on how TypeSafe reports confidence.',
	},
	{
		displayName: 'True Means',
		name: 'routeTrueMeans',
		type: 'string',
		default: '',
		noDataExpression: true,
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['noul'] } },
		description: 'What an answer near 1 means. Also labels the output.',
		placeholder: 'e.g. Needs a reply today',
	},
	{
		displayName: 'True Probability Threshold',
		name: 'trueThreshold',
		type: 'number',
		default: 0.5,
		noDataExpression: true,
		typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['noul'] } },
		description: 'Items answered at or above this go to the True output',
		hint: "Leave a gap above 'False Probability Threshold' to get an Uncertain output (0.0 - 1.0)",
	},
	{
		displayName: 'False Means',
		name: 'routeFalseMeans',
		type: 'string',
		default: '',
		noDataExpression: true,
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['noul'] } },
		description: 'What an answer near 0 means. Also labels the output.',
		placeholder: 'e.g. Can wait',
	},
	{
		displayName: 'False Probability Threshold',
		name: 'falseThreshold',
		type: 'number',
		default: 0.5,
		noDataExpression: true,
		typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
		displayOptions: { show: { operation: ['route'], routeQuestionType: ['noul'] } },
		description: 'Items answered at or below this go to the False output',
		hint: "Must not be above 'True Probability Threshold' (0.0 - 1.0)",
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
					"Whether to copy the incoming item's fields and binary data into the output. If an incoming field has the same name as one this node adds, such as answers or route, the node's value replaces it.",
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					"Whether to keep only each answer's value and confidence instead of returning the full response",
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
