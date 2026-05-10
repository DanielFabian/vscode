#!/usr/bin/env node
// Applies a computed Sovereign release version to a derived build worktree.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function usage() {
	console.error(`Usage: apply-release-version.mjs --repo <path> --version <version>`);
}

function parseArgs(argv) {
	const args = { repo: undefined, version: undefined };
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--repo') {
			args.repo = argv[++i];
		} else if (arg === '--version') {
			args.version = argv[++i];
		} else if (arg === '-h' || arg === '--help') {
			usage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
		if (argv[i] === undefined) {
			throw new Error(`Missing value for ${arg}`);
		}
	}
	if (!args.repo || !args.version) {
		usage();
		process.exit(2);
	}
	return args;
}

function main() {
	const args = parseArgs(process.argv);
	if (!/^\d+\.\d+\.\d+$/.test(args.version)) {
		throw new Error(`Version must be numeric x.y.z, got '${args.version}'`);
	}

	const repo = path.resolve(args.repo);
	const packageJsonPath = path.join(repo, 'package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
	const oldVersion = packageJson.version;
	packageJson.version = args.version;
	fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, '\t') + '\n');

	console.log(`apply-release-version: ${packageJsonPath}: ${oldVersion} -> ${args.version}`);
}

try {
	main();
} catch (error) {
	console.error(`apply-release-version: ${error.message}`);
	process.exit(1);
}
