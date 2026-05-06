/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env } from '../../../../base/common/process.js';
import type { AgentHostOTelConfig } from '../../common/otel/agentHostOTelService.js';

export const enum AgentHostOTelEnvVar {
	Enabled = 'VSCODE_AGENT_HOST_OTEL_ENABLED',
	VerboseTracing = 'VSCODE_AGENT_HOST_OTEL_VERBOSE_TRACING',
	CaptureContent = 'VSCODE_AGENT_HOST_OTEL_CAPTURE_CONTENT',
	MaxAttributeSizeChars = 'VSCODE_AGENT_HOST_OTEL_MAX_ATTRIBUTE_SIZE_CHARS',
	OtlpEndpoint = 'VSCODE_AGENT_HOST_OTEL_OTLP_ENDPOINT',
	ServiceName = 'VSCODE_AGENT_HOST_OTEL_SERVICE_NAME',
}

export const DEFAULT_AGENT_HOST_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';

export interface ResolvedAgentHostOTelConfig extends AgentHostOTelConfig {
	readonly otlpEndpoint: string;
	readonly serviceName: string;
}

export function resolveAgentHostOTelConfig(input: Record<string, string | undefined> = env): ResolvedAgentHostOTelConfig {
	const enabled = envBool(input[AgentHostOTelEnvVar.Enabled]) ?? false;
	return Object.freeze({
		enabled,
		verboseTracing: envBool(input[AgentHostOTelEnvVar.VerboseTracing]) ?? false,
		captureContent: envBool(input[AgentHostOTelEnvVar.CaptureContent]) ?? false,
		maxAttributeSizeChars: parseNonNegativeInteger(input[AgentHostOTelEnvVar.MaxAttributeSizeChars]) ?? 0,
		otlpEndpoint: normalizeOtlpTraceEndpoint(input[AgentHostOTelEnvVar.OtlpEndpoint]) ?? DEFAULT_AGENT_HOST_OTLP_ENDPOINT,
		serviceName: input[AgentHostOTelEnvVar.ServiceName] || 'vscode-agent-host',
	});
}

function envBool(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === '1' || value === 'true') {
		return true;
	}
	if (value === '0' || value === 'false') {
		return false;
	}
	return undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		return undefined;
	}
	return parsed;
}

function normalizeOtlpTraceEndpoint(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.replace(/^["']|["']$/g, '');
	try {
		const url = new URL(trimmed);
		if (!url.pathname || url.pathname === '/') {
			url.pathname = '/v1/traces';
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

