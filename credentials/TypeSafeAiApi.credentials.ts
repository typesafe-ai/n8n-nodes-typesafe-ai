import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

import { BASE_URL_EXPRESSION, DEFAULT_BASE_URL } from '../nodes/TypeSafeAi/api';

export class TypeSafeAiApi implements ICredentialType {
	name = 'typeSafeAiApi';

	displayName = 'TypeSafe AI API';

	documentationUrl = 'https://docs.typesafe.ai';

	icon: Icon = {
		light: 'file:../nodes/TypeSafeAi/typeSafeAi.svg',
		dark: 'file:../nodes/TypeSafeAi/typeSafeAi.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Create one in the TypeSafe AI console',
		},
		{
			displayName: 'Use Custom Base URL',
			name: 'useCustomBaseUrl',
			type: 'boolean',
			default: false,
			description:
				'Whether to send requests to a proxy or gateway that implements the TypeSafe API, instead of TypeSafe AI',
		},
		{
			displayName: 'Custom Base URL',
			name: 'customBaseUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'e.g. https://gateway.example.com/typesafe',
			description:
				'The host to call, without the /v1 path. The API key is sent to it, so only use a gateway you trust.',
			displayOptions: { show: { useCustomBaseUrl: [true] } },
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'hidden',
			default: DEFAULT_BASE_URL,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: BASE_URL_EXPRESSION,
			url: '/v1/models',
			method: 'GET',
		},
	};
}
