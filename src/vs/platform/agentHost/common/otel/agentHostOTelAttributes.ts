/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AgentHostGenAiOperationName = {
	CHAT: 'chat',
	INVOKE_AGENT: 'invoke_agent',
	EXECUTE_TOOL: 'execute_tool',
	EXECUTE_HOOK: 'execute_hook',
} as const;

export const AgentHostGenAiProviderName = {
	GITHUB: 'github',
	ANTHROPIC: 'anthropic',
} as const;

export const AgentHostGenAiAttr = {
	OPERATION_NAME: 'gen_ai.operation.name',
	PROVIDER_NAME: 'gen_ai.provider.name',
	REQUEST_MODEL: 'gen_ai.request.model',
	RESPONSE_MODEL: 'gen_ai.response.model',
	USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
	USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
	USAGE_CACHE_READ_INPUT_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
	USAGE_CACHE_CREATION_INPUT_TOKENS: 'gen_ai.usage.cache_creation.input_tokens',
	USAGE_REASONING_TOKENS: 'gen_ai.usage.reasoning_tokens',
	CONVERSATION_ID: 'gen_ai.conversation.id',
	AGENT_NAME: 'gen_ai.agent.name',
	AGENT_ID: 'gen_ai.agent.id',
	TOOL_NAME: 'gen_ai.tool.name',
	TOOL_CALL_ID: 'gen_ai.tool.call.id',
	TOOL_CALL_ARGUMENTS: 'gen_ai.tool.call.arguments',
	TOOL_CALL_RESULT: 'gen_ai.tool.call.result',
	INPUT_MESSAGES: 'gen_ai.input.messages',
	OUTPUT_MESSAGES: 'gen_ai.output.messages',
	TOOL_DEFINITIONS: 'gen_ai.tool.definitions',
} as const;

export const AgentHostOTelAttr = {
	SESSION_ID: 'vscode_agent_host.session_id',
	CHAT_SESSION_ID: 'vscode_agent_host.chat_session_id',
	PROVIDER: 'vscode_agent_host.provider',
	OPERATION: 'vscode_agent_host.operation',
	SDK_CALL: 'vscode_agent_host.sdk.call',
	SDK_REASON: 'vscode_agent_host.sdk.reason',
	CONNECTION_AUTHORITY: 'vscode_agent_host.connection_authority',
	TURN_ID: 'vscode_agent_host.turn_id',
	TURN_INDEX: 'vscode_agent_host.turn.index',
	TOOL_CALL_COUNT: 'vscode_agent_host.tool_call_count',
	TOOL_HANDLER: 'vscode_agent_host.tool_handler',
	CANCELED: 'vscode_agent_host.canceled',
	VERBOSE: 'vscode_agent_host.verbose',
	MODE: 'vscode_agent_host.mode',
	ATTACHMENT_COUNT: 'vscode_agent_host.attachment_count',
	PROMPT_LENGTH: 'vscode_agent_host.prompt_length',
	REQUEST_MESSAGE_LENGTH: 'vscode_agent_host.request.message_length',
	REQUEST_ATTACHMENT_COUNT: 'vscode_agent_host.request.attachment_count',
	PERMISSION_KIND: 'vscode_agent_host.permission.kind',
	PERMISSION_APPROVED: 'vscode_agent_host.permission.approved',
	SUCCESS: 'vscode_agent_host.success',
	HOOK_TYPE: 'vscode_agent_host.hook.type',
	HOOK_INVOCATION_ID: 'vscode_agent_host.hook.invocation_id',
	SESSION_COUNT: 'vscode_agent_host.session_count',
	DB_HIT: 'vscode_agent_host.db.hit',
	DB_HIT_COUNT: 'vscode_agent_host.db.hit_count',
	DB_KEY_COUNT: 'vscode_agent_host.db.key_count',
	FAILURE_COUNT: 'vscode_agent_host.failure_count',
	PROVISIONAL: 'vscode_agent_host.provisional',
	FORK: 'vscode_agent_host.fork',
	ACTIVE_CLIENT: 'vscode_agent_host.active_client',
	HAS_INITIAL_CONFIG: 'vscode_agent_host.has_initial_config',
	HAS_MODEL: 'vscode_agent_host.has_model',
	HAS_PROJECT: 'vscode_agent_host.has_project',
	HAS_SESSION_CONFIG: 'vscode_agent_host.has_session_config',
	HAS_SNAPSHOT: 'vscode_agent_host.has_snapshot',
	HAS_WORKING_DIRECTORY: 'vscode_agent_host.has_working_directory',
	TURN_COUNT: 'vscode_agent_host.turn_count',
} as const;

export const AgentHostStdAttr = {
	ERROR_TYPE: 'error.type',
} as const;
