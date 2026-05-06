/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import type { AgentHostTraceContext } from './agentHostTraceContext.js';
import { AgentHostSpanStatusCode, type AgentHostCompletedSpan, type AgentHostOTelConfig, type AgentHostSpanAttributeValue, type AgentHostSpanAttributes, type AgentHostSpanOptions, type IAgentHostOTelService, type IAgentHostSpanHandle } from './agentHostOTelService.js';

const disabledConfig: AgentHostOTelConfig = Object.freeze({
	enabled: false,
	verboseTracing: false,
	captureContent: false,
	maxAttributeSizeChars: 0,
});

class NoopAgentHostSpanHandle implements IAgentHostSpanHandle {
	setAttribute(_key: string, _value: AgentHostSpanAttributeValue): void { }
	setAttributes(_attributes: Record<string, AgentHostSpanAttributeValue | undefined>): void { }
	setStatus(_code: AgentHostSpanStatusCode, _message?: string): void { }
	recordException(_error: unknown): void { }
	addEvent(_name: string, _attributes?: AgentHostSpanAttributes): void { }
	getSpanContext(): AgentHostTraceContext | undefined { return undefined; }
	end(): void { }
}

export class NoopAgentHostOTelService implements IAgentHostOTelService {
	declare readonly _serviceBrand: undefined;

	static readonly INSTANCE = new NoopAgentHostOTelService();

	readonly config = disabledConfig;
	readonly onDidCompleteSpan: Event<AgentHostCompletedSpan> = Event.None;

	injectCompletedSpan(_span: AgentHostCompletedSpan): void { }

	startSpan(_name: string, _options?: AgentHostSpanOptions): IAgentHostSpanHandle {
		return new NoopAgentHostSpanHandle();
	}

	async startActiveSpan<T>(_name: string, _options: AgentHostSpanOptions, fn: (span: IAgentHostSpanHandle) => Promise<T>): Promise<T> {
		return fn(new NoopAgentHostSpanHandle());
	}

	getActiveTraceContext(): AgentHostTraceContext | undefined {
		return undefined;
	}

	runWithTraceContext<T>(_traceContext: AgentHostTraceContext, fn: () => T): T {
		return fn();
	}

	emitLogRecord(_body: string, _attributes?: Record<string, unknown>): void { }

	async flush(): Promise<void> { }

	async shutdown(): Promise<void> { }
}
