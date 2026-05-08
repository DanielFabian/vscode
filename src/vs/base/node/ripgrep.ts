/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vscode/ripgrep is ESM-only; resolve the binary path lazily via dynamic import.
// In packaged builds the binary lives inside node_modules.asar; the actual
// executable is unpacked next door so we rewrite the path.
let _rgDiskPath: Promise<string> | undefined;
export function rgDiskPath(): Promise<string> {
	return _rgDiskPath ??= import('@vscode/ripgrep').then(m => m.rgPath.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked'));
}
