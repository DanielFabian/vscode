/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import type { AgentHostTraceContext } from './agentHostTraceContext.js';

export const IAgentHostOTelService = createDecorator<IAgentHostOTelService>('agentHostOTelService');

export const enum AgentHostSpanKind {
	INTERNAL = 1,
	CLIENT = 3,
}

export const enum AgentHostSpanStatusCode {
	UNSET = 0,
	OK = 1,
	ERROR = 2,
}

export interface AgentHostOTelConfig {
	readonly enabled: boolean;
	readonly verboseTracing: boolean;
	readonly captureContent: boolean;
	readonly maxAttributeSizeChars: number;
	readonly otlpEndpoint?: string;
	readonly serviceName?: string;
}

export interface AgentHostSpanOptions {
	readonly kind?: AgentHostSpanKind;
	readonly attributes?: AgentHostSpanAttributes;
	readonly parentTraceContext?: AgentHostTraceContext;
}

export type AgentHostSpanAttributeValue = string | number | boolean | readonly string[];
export type AgentHostSpanAttributes = Record<string, AgentHostSpanAttributeValue>;

export interface IAgentHostSpanHandle {
	setAttribute(key: string, value: AgentHostSpanAttributeValue): void;
	setAttributes(attributes: Record<string, AgentHostSpanAttributeValue | undefined>): void;
	setStatus(code: AgentHostSpanStatusCode, message?: string): void;
	recordException(error: unknown): void;
	addEvent(name: string, attributes?: AgentHostSpanAttributes): void;
	getSpanContext(): AgentHostTraceContext | undefined;
	end(): void;
}

export interface AgentHostCompletedSpan {
	readonly name: string;
	readonly kind?: AgentHostSpanKind;
	readonly spanId: string;
	readonly traceId: string;
	readonly parentSpanId?: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly status: { readonly code: AgentHostSpanStatusCode; readonly message?: string };
	readonly attributes: Readonly<AgentHostSpanAttributes>;
	readonly events: readonly AgentHostSpanEvent[];
}

export interface AgentHostSpanEvent {
	readonly name: string;
	readonly timestamp: number;
	readonly attributes?: Readonly<AgentHostSpanAttributes>;
}

export interface IAgentHostOTelService {
	readonly _serviceBrand: undefined;
	readonly config: AgentHostOTelConfig;
	readonly onDidCompleteSpan: Event<AgentHostCompletedSpan>;
	injectCompletedSpan(span: AgentHostCompletedSpan): void;
	startSpan(name: string, options?: AgentHostSpanOptions): IAgentHostSpanHandle;
	startActiveSpan<T>(name: string, options: AgentHostSpanOptions, fn: (span: IAgentHostSpanHandle) => Promise<T>): Promise<T>;
	getActiveTraceContext(): AgentHostTraceContext | undefined;
	runWithTraceContext<T>(traceContext: AgentHostTraceContext, fn: () => T): T;
	emitLogRecord(body: string, attributes?: Record<string, unknown>): void;
	flush(): Promise<void>;
	shutdown(): Promise<void>;
}
