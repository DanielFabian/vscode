import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoArgIndex = process.argv.indexOf('--repo');
if (repoArgIndex !== -1 && !process.argv[repoArgIndex + 1]) {
	console.error('Usage: inspect-product.mjs [--repo <path>] [--assert-patched]');
	process.exit(2);
}
const repo = repoArgIndex === -1
	? path.resolve(here, '..', '..')
	: path.resolve(process.argv[repoArgIndex + 1]);
const product = JSON.parse(fs.readFileSync(path.join(repo, 'product.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const assertPatched = process.argv.includes('--assert-patched');
globalThis._VSCODE_PRODUCT_JSON = { ...product };
globalThis._VSCODE_PACKAGE_JSON = { ...pkg };

// NOTE: bootstrap-esm.ts does NOT add a Dev suffix; that logic lives in
// src/vs/platform/product/common/product.ts itself, gated on env.VSCODE_DEV.
// So we only need to set the globals here and let the product module do its
// thing — toggling VSCODE_DEV before importing it is sufficient.

const dev = !!process.env.VSCODE_DEV;

// Resolve relative to the repo root (this script lives at sovereign/scripts/).
const productMod = await import(pathToFileURL(path.join(repo, 'out/vs/platform/product/common/product.js')).href);
const p = productMod.default;

const fields = [
	'quality', 'version', 'commit',
	'nameShort', 'nameLong', 'applicationName', 'dataFolderName',
	'urlProtocol', 'updateUrl', 'downloadUrl',
];
console.log(`-- IProductService snapshot (VSCODE_DEV=${dev ? '1' : '0'}) --`);
for (const f of fields) { console.log(`${f}:`, JSON.stringify(p[f])); }
console.log('defaultChatAgent.chatExtensionId:', p.defaultChatAgent && p.defaultChatAgent.chatExtensionId);
console.log('extensionsGallery:', p.extensionsGallery ? Object.keys(p.extensionsGallery) : 'undefined');
console.log('builtInExtensionsEnabledWithAutoUpdates:', p.builtInExtensionsEnabledWithAutoUpdates);

// Show the update URL the AbstractUpdateService would build
const platform = `linux-${process.arch}`;
const commit = p.commit ?? 'dev';
console.log(`\n-- Synthetic update URL --`);
console.log(`${p.updateUrl}/api/update/${platform}/${p.quality}/${commit}`);

if (assertPatched) {
	const failures = [];
	if (typeof p.quality === 'undefined') {
		failures.push('quality is undefined');
	}
	if (p.applicationName === 'code-oss') {
		failures.push('applicationName is still code-oss');
	}
	if (failures.length > 0) {
		console.error(`\n-- assert-patched failed --`);
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exitCode = 1;
	}
}
