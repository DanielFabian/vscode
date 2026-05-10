#!/usr/bin/env node
// Writes a provenance manifest for a derived Sovereign build artifact.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const recipeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function usage() {
	console.error(`Usage: write-release-provenance.mjs --repo <compose-worktree> --release-version <version> --upstream-base <version> --output <path> [--artifact <path>] [--sha256 <hex>]`);
}

function parseArgs(argv) {
	const args = {
		repo: undefined,
		releaseVersion: undefined,
		upstreamBase: undefined,
		output: undefined,
		artifact: undefined,
		sha256: undefined,
	};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--repo') {
			args.repo = argv[++i];
		} else if (arg === '--release-version') {
			args.releaseVersion = argv[++i];
		} else if (arg === '--upstream-base') {
			args.upstreamBase = argv[++i];
		} else if (arg === '--output') {
			args.output = argv[++i];
		} else if (arg === '--artifact') {
			args.artifact = argv[++i];
		} else if (arg === '--sha256') {
			args.sha256 = argv[++i];
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
	for (const key of ['repo', 'releaseVersion', 'upstreamBase', 'output']) {
		if (!args[key]) {
			usage();
			process.exit(2);
		}
	}
	return args;
}

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function readSeries() {
	const seriesFile = path.join(recipeRoot, 'sovereign', 'series');
	return fs.readFileSync(seriesFile, 'utf8')
		.split(/\r?\n/)
		.map(line => line.replace(/#.*/, '').trim())
		.filter(Boolean);
}

function topicSuffix(topic) {
	if (!topic.startsWith('topic/')) {
		throw new Error(`Series topic '${topic}' must live under topic/`);
	}
	return topic.slice('topic/'.length);
}

function main() {
	const args = parseArgs(process.argv);
	const composeRepo = path.resolve(args.repo);
	const topics = readSeries().map(topic => {
		const suffix = topicSuffix(topic);
		const baseRef = `topic-base/${suffix}`;
		return {
			topic,
			topicTip: git(recipeRoot, ['rev-parse', topic]),
			base: baseRef,
			baseTip: git(recipeRoot, ['rev-parse', baseRef]),
		};
	});

	const artifact = args.artifact ? path.basename(args.artifact) : undefined;
	const provenance = {
		schema: 1,
		releaseVersion: args.releaseVersion,
		releaseTag: args.releaseVersion,
		upstreamBase: args.upstreamBase,
		upstreamBaseCommit: git(recipeRoot, ['rev-parse', args.upstreamBase]),
		sovereignMain: git(recipeRoot, ['rev-parse', 'HEAD']),
		composeCommit: git(composeRepo, ['rev-parse', 'HEAD']),
		topics,
		artifact: artifact ? {
			name: artifact,
			sha256: args.sha256,
		} : undefined,
		github: process.env.GITHUB_RUN_ID ? {
			repository: process.env.GITHUB_REPOSITORY,
			runId: process.env.GITHUB_RUN_ID,
			runAttempt: process.env.GITHUB_RUN_ATTEMPT,
			workflow: process.env.GITHUB_WORKFLOW,
			sha: process.env.GITHUB_SHA,
			ref: process.env.GITHUB_REF,
		} : undefined,
		createdAt: new Date().toISOString(),
	};

	fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
	fs.writeFileSync(args.output, JSON.stringify(provenance, null, '\t') + '\n');
	console.log(`write-release-provenance: wrote ${args.output}`);
}

try {
	main();
} catch (error) {
	console.error(`write-release-provenance: ${error.message}`);
	process.exit(1);
}
