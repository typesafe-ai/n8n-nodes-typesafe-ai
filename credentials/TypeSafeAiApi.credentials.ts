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
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: DEFAULT_BASE_URL,
			description: 'Leave the default TypeSafe endpoint or set a custom API base URL',
			placeholder: 'https://api.typesafe.ai',
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
