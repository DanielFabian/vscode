/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncLocalStorage } from 'async_hooks';
import { ILogService } from '../../../log/common/log.js';
import { InMemoryAgentHostOTelService } from '../../common/otel/inMemoryAgentHostOTelService.js';
import { AgentHostSpanStatusCode, type AgentHostCompletedSpan, type AgentHostSpanOptions, type IAgentHostSpanHandle } from '../../common/otel/agentHostOTelService.js';
import { NoopAgentHostOTelService } from '../../common/otel/noopAgentHostOTelService.js';
import { resolveAgentHostOTelConfig, type ResolvedAgentHostOTelConfig } from './agentHostOTelConfig.js';
import { toOtlpTraceExportRequest } from '../../common/otel/agentHostOTelExporter.js';
import type { AgentHostTraceContext } from '../../common/otel/agentHostTraceContext.js';

export class AgentHostOTelService extends InMemoryAgentHostOTelService {
	private readonly _traceContextStore = new AsyncLocalStorage<AgentHostTraceContext>();

	constructor(
		readonly resolvedConfig: ResolvedAgentHostOTelConfig,
		@ILogService private readonly _logService: ILogService,
	) {
		super(resolvedConfig);
	}

	override startSpan(name: string, options?: AgentHostSpanOptions): IAgentHostSpanHandle {
		const parentTraceContext = options?.parentTraceContext ?? this._traceContextStore.getStore();
		return super.startSpan(name, parentTraceContext ? { ...options, parentTraceContext } : options);
	}

	override async startActiveSpan<T>(name: string, options: AgentHostSpanOptions, fn: (span: IAgentHostSpanHandle) => Promise<T>): Promise<T> {
		const span = this.startSpan(name, options);
		const spanContext = span.getSpanContext();
		const run = async () => {
			try {
				const result = await fn(span);
				span.setStatus(AgentHostSpanStatusCode.OK);
				return result;
			} catch (error) {
				span.recordException(error);
				throw error;
			} finally {
				span.end();
			}
		};
		return spanContext ? this._traceContextStore.run(spanContext, run) : run();
	}

	override getActiveTraceContext(): AgentHostTraceContext | undefined {
		return this._traceContextStore.getStore() ?? super.getActiveTraceContext();
	}

	override runWithTraceContext<T>(traceContext: AgentHostTraceContext, fn: () => T): T {
		return this._traceContextStore.run(traceContext, fn);
	}

	override acceptCompletedSpan(span: AgentHostCompletedSpan): void {
		super.acceptCompletedSpan(span);
		this._exportSpan(span).catch(error => {
			this._logService.warn(`[AgentHostOTel] Failed to export span '${span.name}': ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	private async _exportSpan(span: AgentHostCompletedSpan): Promise<void> {
		const response = await fetch(this.resolvedConfig.otlpEndpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify(toOtlpTraceExportRequest(span, this.resolvedConfig.serviceName)),
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
	}
}

export function createAgentHostOTelService(logService: ILogService): AgentHostOTelService | NoopAgentHostOTelService {
	const config = resolveAgentHostOTelConfig();
	if (!config.enabled) {
		return NoopAgentHostOTelService.INSTANCE;
	}
	logService.info(`[AgentHostOTel] Enabled: endpoint=${config.otlpEndpoint}, captureContent=${config.captureContent}, verboseTracing=${config.verboseTracing}`);
	return new AgentHostOTelService(config, logService);
}
