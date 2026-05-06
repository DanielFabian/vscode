/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { AgentHostGenAiAttr, AgentHostGenAiOperationName, AgentHostSpanStatusCode } from '../../common/otel/index.js';
import { AgentHostOTelEnvVar, DEFAULT_AGENT_HOST_OTLP_ENDPOINT, resolveAgentHostOTelConfig } from '../../node/otel/agentHostOTelConfig.js';
import { AgentHostOTelService } from '../../node/otel/agentHostOTelService.js';
import { toOtlpTraceExportRequest } from '../../common/otel/agentHostOTelExporter.js';

suite('AgentHostOTelService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves environment configuration', () => {
		assert.deepStrictEqual(resolveAgentHostOTelConfig({
			[AgentHostOTelEnvVar.Enabled]: '1',
			[AgentHostOTelEnvVar.VerboseTracing]: 'true',
			[AgentHostOTelEnvVar.CaptureContent]: 'false',
			[AgentHostOTelEnvVar.MaxAttributeSizeChars]: '1024',
			[AgentHostOTelEnvVar.OtlpEndpoint]: 'http://localhost:4318',
			[AgentHostOTelEnvVar.ServiceName]: 'test-agent-host',
		}), {
			enabled: true,
			verboseTracing: true,
			captureContent: false,
			maxAttributeSizeChars: 1024,
			otlpEndpoint: 'http://localhost:4318/v1/traces',
			serviceName: 'test-agent-host',
		});
	});

	test('uses safe defaults for invalid environment configuration', () => {
		assert.deepStrictEqual(resolveAgentHostOTelConfig({
			[AgentHostOTelEnvVar.Enabled]: 'maybe',
			[AgentHostOTelEnvVar.MaxAttributeSizeChars]: '-1',
			[AgentHostOTelEnvVar.OtlpEndpoint]: 'not a url',
		}), {
			enabled: false,
			verboseTracing: false,
			captureContent: false,
			maxAttributeSizeChars: 0,
			otlpEndpoint: DEFAULT_AGENT_HOST_OTLP_ENDPOINT,
			serviceName: 'vscode-agent-host',
		});
	});

	test('serializes completed spans to OTLP HTTP JSON', () => {
		const request = toOtlpTraceExportRequest({
			name: 'invoke_agent copilotcli',
			traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
			spanId: '00f067aa0ba902b7',
			parentSpanId: '1111111111111111',
			startTime: 1000,
			endTime: 1005,
			status: { code: AgentHostSpanStatusCode.OK },
			attributes: {
				[AgentHostGenAiAttr.OPERATION_NAME]: AgentHostGenAiOperationName.INVOKE_AGENT,
				[AgentHostGenAiAttr.USAGE_INPUT_TOKENS]: 42,
			},
			events: [{
				name: 'session/turnStarted',
				timestamp: 1001,
				attributes: { turnId: 'turn-1' },
			}],
		}, 'test-agent-host');

		assert.deepStrictEqual(request, {
			resourceSpans: [{
				resource: {
					attributes: [
						{ key: 'service.name', value: { stringValue: 'test-agent-host' } },
					],
				},
				scopeSpans: [{
					scope: { name: 'vscode-agent-host' },
					spans: [{
						traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
						spanId: '00f067aa0ba902b7',
						parentSpanId: '1111111111111111',
						name: 'invoke_agent copilotcli',
						kind: 1,
						startTimeUnixNano: '1000000000',
						endTimeUnixNano: '1005000000',
						attributes: [
							{ key: 'gen_ai.operation.name', value: { stringValue: 'invoke_agent' } },
							{ key: 'gen_ai.usage.input_tokens', value: { intValue: '42' } },
						],
						events: [{
							name: 'session/turnStarted',
							timeUnixNano: '1001000000',
							attributes: [
								{ key: 'turnId', value: { stringValue: 'turn-1' } },
							],
						}],
						status: { code: AgentHostSpanStatusCode.OK },
					}],
				}],
			}],
		});
	});

	test('keeps concurrent async trace contexts isolated in node service', async () => {
		const service = disposables.add(new AgentHostOTelService({
			enabled: true,
			verboseTracing: true,
			captureContent: false,
			maxAttributeSizeChars: 0,
			otlpEndpoint: DEFAULT_AGENT_HOST_OTLP_ENDPOINT,
			serviceName: 'test-agent-host',
		}, new NullLogService()));
		const firstContext = {
			traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
			spanId: '00f067aa0ba902b7',
			traceFlags: 1,
		};
		const secondContext = {
			traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			spanId: 'bbbbbbbbbbbbbbbb',
			traceFlags: 1,
		};
		const firstEntered = new DeferredPromise<void>();
		const releaseFirst = new DeferredPromise<void>();

		const first = service.runWithTraceContext(firstContext, async () => {
			firstEntered.complete();
			await releaseFirst.p;
			return service.getActiveTraceContext();
		});
		await firstEntered.p;
		const second = service.runWithTraceContext(secondContext, async () => {
			await Promise.resolve();
			return service.getActiveTraceContext();
		});

		assert.deepStrictEqual(await second, secondContext);
		releaseFirst.complete();
		assert.deepStrictEqual(await first, firstContext);
		assert.strictEqual(service.getActiveTraceContext(), undefined);
	});
});
