/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import type { AgentHostTraceContext } from './agentHostTraceContext.js';
import { AgentHostSpanStatusCode, type AgentHostCompletedSpan, type AgentHostOTelConfig, type AgentHostSpanAttributeValue, type AgentHostSpanAttributes, type AgentHostSpanEvent, type AgentHostSpanOptions, type IAgentHostOTelService, type IAgentHostSpanHandle } from './agentHostOTelService.js';

function newTraceId(): string {
	return generateUuid().replaceAll('-', '');
}

function newSpanId(): string {
	return newTraceId().substring(0, 16);
}

class InMemoryAgentHostSpanHandle implements IAgentHostSpanHandle {
	private readonly _startTime = Date.now();
	private readonly _attributes: AgentHostSpanAttributes = {};
	private readonly _events: AgentHostSpanEvent[] = [];
	private _status: { code: AgentHostSpanStatusCode; message?: string } = { code: AgentHostSpanStatusCode.UNSET };
	private _ended = false;

	constructor(
		private readonly _service: InMemoryAgentHostOTelService,
		readonly name: string,
		private readonly _kind: AgentHostSpanOptions['kind'],
		readonly traceId: string,
		readonly spanId: string,
		private readonly _parentSpanId: string | undefined,
		options: AgentHostSpanOptions | undefined,
	) {
		this.setAttributes(options?.attributes ?? {});
	}

	setAttribute(key: string, value: AgentHostSpanAttributeValue): void {
		this._attributes[key] = value;
	}

	setAttributes(attributes: Record<string, AgentHostSpanAttributeValue | undefined>): void {
		for (const [key, value] of Object.entries(attributes)) {
			if (value !== undefined) {
				this._attributes[key] = value;
			}
		}
	}

	setStatus(code: AgentHostSpanStatusCode, message?: string): void {
		this._status = { code, message };
	}

	recordException(error: unknown): void {
		this.setStatus(AgentHostSpanStatusCode.ERROR, error instanceof Error ? error.message : String(error));
	}

	addEvent(name: string, attributes?: AgentHostSpanAttributes): void {
		this._events.push({ name, timestamp: Date.now(), attributes });
	}

	getSpanContext(): AgentHostTraceContext {
		return { traceId: this.traceId, spanId: this.spanId, traceFlags: 1 };
	}

	end(): void {
		if (this._ended) {
			return;
		}
		this._ended = true;
		this._service.acceptCompletedSpan({
			name: this.name,
			kind: this._kind,
			spanId: this.spanId,
			traceId: this.traceId,
			parentSpanId: this._parentSpanId,
			startTime: this._startTime,
			endTime: Date.now(),
			status: this._status,
			attributes: Object.freeze({ ...this._attributes }),
			events: Object.freeze([...this._events]),
		});
	}
}

export class InMemoryAgentHostOTelService extends Disposable implements IAgentHostOTelService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCompleteSpan = this._register(new Emitter<AgentHostCompletedSpan>());
	readonly onDidCompleteSpan = this._onDidCompleteSpan.event;

	private _activeSpan: InMemoryAgentHostSpanHandle | undefined;
	private _activeRemoteContext: AgentHostTraceContext | undefined;

	constructor(readonly config: AgentHostOTelConfig) {
		super();
	}

	startSpan(name: string, options?: AgentHostSpanOptions): IAgentHostSpanHandle {
		const parentContext = options?.parentTraceContext ?? this._activeSpan?.getSpanContext() ?? this._activeRemoteContext;
		return new InMemoryAgentHostSpanHandle(
			this,
			name,
			options?.kind,
			parentContext?.traceId ?? newTraceId(),
			newSpanId(),
			parentContext?.spanId,
			options,
		);
	}

	async startActiveSpan<T>(name: string, options: AgentHostSpanOptions, fn: (span: IAgentHostSpanHandle) => Promise<T>): Promise<T> {
		const span = this.startSpan(name, options);
		const previous = this._activeSpan;
		this._activeSpan = span instanceof InMemoryAgentHostSpanHandle ? span : undefined;
		try {
			const result = await fn(span);
			span.setStatus(AgentHostSpanStatusCode.OK);
			return result;
		} catch (error) {
			span.recordException(error);
			throw error;
		} finally {
			span.end();
			this._activeSpan = previous;
		}
	}

	getActiveTraceContext(): AgentHostTraceContext | undefined {
		return this._activeSpan?.getSpanContext() ?? this._activeRemoteContext;
	}

	runWithTraceContext<T>(traceContext: AgentHostTraceContext, fn: () => T): T {
		const previous = this._activeRemoteContext;
		this._activeRemoteContext = traceContext;
		try {
			const result = fn();
			if (isThenable(result)) {
				return result.finally(() => {
					this._activeRemoteContext = previous;
				}) as T;
			}
			this._activeRemoteContext = previous;
			return result;
		} catch (error) {
			this._activeRemoteContext = previous;
			throw error;
		}
	}

	injectCompletedSpan(span: AgentHostCompletedSpan): void {
		this.acceptCompletedSpan(span);
	}

	emitLogRecord(_body: string, _attributes?: Record<string, unknown>): void { }

	async flush(): Promise<void> { }

	async shutdown(): Promise<void> {
		this.dispose();
	}

	acceptCompletedSpan(span: AgentHostCompletedSpan): void {
		this._onDidCompleteSpan.fire(span);
	}
}

function isThenable<T>(value: T): value is T & Promise<unknown> {
	return typeof value === 'object' && value !== null && 'finally' in value && typeof value.finally === 'function';
}
