/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { LanguageModelToolInformation } from 'vscode';
import { ToolName } from '../../../common/toolNames';
import { BuiltInToolGroupHandler } from '../../../common/virtualTools/builtInToolGroupHandler';
import { VirtualTool, VIRTUAL_TOOL_NAME_PREFIX } from '../../../common/virtualTools/virtualTool';

function makeTool(name: string): LanguageModelToolInformation {
	return {
		name,
		description: `Tool for ${name}`,
		inputSchema: undefined,
		source: undefined,
		tags: [],
	};
}

describe('BuiltInToolGroupHandler', () => {
	it('keeps memory available as an individual core tool', () => {
		const handler = new BuiltInToolGroupHandler();
		const tools = [
			makeTool(ToolName.Memory),
			makeTool(ToolName.InstallExtension),
			makeTool(ToolName.RunVscodeCmd),
			makeTool(ToolName.ReadFile),
		];

		const result = handler.createBuiltInToolGroups(tools);
		const groupedVsCodeInteraction = result.find((tool): tool is VirtualTool => tool instanceof VirtualTool && tool.name === `${VIRTUAL_TOOL_NAME_PREFIX}vs_code_interaction`);

		expect(groupedVsCodeInteraction).toBeDefined();
		expect(groupedVsCodeInteraction?.contents.map(tool => tool.name)).toEqual([
			ToolName.InstallExtension,
			ToolName.RunVscodeCmd,
		]);
		expect(result.some((tool): boolean => !(tool instanceof VirtualTool) && tool.name === ToolName.Memory)).toBe(true);
		expect(result.some((tool): boolean => !(tool instanceof VirtualTool) && tool.name === ToolName.ReadFile)).toBe(true);
	});
});