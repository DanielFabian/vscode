/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const traceIdPattern = /^[0-9a-f]{32}$/i;
const spanIdPattern = /^[0-9a-f]{16}$/i;
const traceFlagsPattern = /^[0-9a-f]{2}$/i;
const zeroTraceId = '00000000000000000000000000000000';
const zeroSpanId = '0000000000000000';

export interface AgentHostTraceContext {
	readonly traceId: string;
	readonly spanId: string;
	readonly traceFlags?: number;
	readonly traceState?: string;
}

export function parseTraceParent(traceparent: string, tracestate?: string): AgentHostTraceContext | undefined {
	const parts = traceparent.split('-');
	if (parts.length !== 4) {
		return undefined;
	}

	const [version, traceId, spanId, flags] = parts;
	if (version !== '00' || !isValidTraceId(traceId) || !isValidSpanId(spanId) || !traceFlagsPattern.test(flags)) {
		return undefined;
	}

	return {
		traceId: traceId.toLowerCase(),
		spanId: spanId.toLowerCase(),
		traceFlags: Number.parseInt(flags, 16),
		traceState: tracestate,
	};
}

export function formatTraceParent(context: AgentHostTraceContext): string | undefined {
	if (!isValidTraceId(context.traceId) || !isValidSpanId(context.spanId)) {
		return undefined;
	}

	const flags = (context.traceFlags ?? 1) & 0xff;
	return `00-${context.traceId.toLowerCase()}-${context.spanId.toLowerCase()}-${flags.toString(16).padStart(2, '0')}`;
}

export function isValidTraceParent(traceparent: string): boolean {
	return parseTraceParent(traceparent) !== undefined;
}

export function isValidTraceId(traceId: string): boolean {
	return traceIdPattern.test(traceId) && traceId !== zeroTraceId;
}

export function isValidSpanId(spanId: string): boolean {
	return spanIdPattern.test(spanId) && spanId !== zeroSpanId;
}

