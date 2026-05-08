/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line no-restricted-imports
import * as path from 'path';

/**
 * Returns the directory containing the ripgrep binary, resolved from
 * VS Code's `appRoot`. In packaged builds the per-platform package
 * lives inside `node_modules.asar`; the binary itself is unpacked
 * next door so we rewrite the path.
 */
export function rgBinDir(appRoot: string): string {
	const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
	return path.join(appRoot, 'node_modules', platformPkg, 'bin')
		.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked');
}
