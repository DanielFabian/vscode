/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentHostCompletedSpan, AgentHostSpanAttributeValue, AgentHostSpanStatusCode } from './agentHostOTelService.js';

interface IOtlpAnyValue {
	readonly stringValue?: string;
	readonly intValue?: string;
	readonly doubleValue?: number;
	readonly boolValue?: boolean;
	readonly arrayValue?: { readonly values: readonly IOtlpAnyValue[] };
}

interface IOtlpKeyValue {
	readonly key: string;
	readonly value: IOtlpAnyValue;
}

export interface IOtlpTraceExportRequest {
	readonly resourceSpans: readonly {
		readonly resource: { readonly attributes: readonly IOtlpKeyValue[] };
		readonly scopeSpans: readonly {
			readonly scope: { readonly name: string };
			readonly spans: readonly IOtlpSpan[];
		}[];
	}[];
}

interface IOtlpSpan {
	readonly traceId: string;
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly name: string;
	readonly kind: number;
	readonly startTimeUnixNano: string;
	readonly endTimeUnixNano: string;
	readonly attributes: readonly IOtlpKeyValue[];
	readonly events: readonly IOtlpEvent[];
	readonly status: { readonly code: AgentHostSpanStatusCode; readonly message?: string };
}

interface IOtlpEvent {
	readonly name: string;
	readonly timeUnixNano: string;
	readonly attributes: readonly IOtlpKeyValue[];
}

export function toOtlpTraceExportRequest(span: AgentHostCompletedSpan, serviceName: string): IOtlpTraceExportRequest {
	return {
		resourceSpans: [{
			resource: {
				attributes: [
					{ key: 'service.name', value: { stringValue: serviceName } },
				],
			},
			scopeSpans: [{
				scope: { name: 'vscode-agent-host' },
				spans: [{
					traceId: span.traceId,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId,
					name: span.name,
					kind: span.kind ?? 1,
					startTimeUnixNano: msToUnixNano(span.startTime),
					endTimeUnixNano: msToUnixNano(span.endTime),
					attributes: attributesToOtlp(span.attributes),
					events: span.events.map(event => ({
						name: event.name,
						timeUnixNano: msToUnixNano(event.timestamp),
						attributes: attributesToOtlp(event.attributes ?? {}),
					})),
					status: span.status,
				}],
			}],
		}],
	};
}

function attributesToOtlp(attributes: Readonly<Record<string, AgentHostSpanAttributeValue>>): IOtlpKeyValue[] {
	return Object.entries(attributes).map(([key, value]) => ({ key, value: toOtlpAnyValue(value) }));
}

function toOtlpAnyValue(value: AgentHostSpanAttributeValue): IOtlpAnyValue {
	if (typeof value === 'string') {
		return { stringValue: value };
	}
	if (typeof value === 'number') {
		if (Number.isInteger(value)) {
			return { intValue: String(value) };
		}
		return { doubleValue: value };
	}
	if (typeof value === 'boolean') {
		return { boolValue: value };
	}
	return { arrayValue: { values: value.map(v => ({ stringValue: v })) } };
}

function msToUnixNano(time: number): string {
	return String(Math.round(time * 1_000_000));
}
