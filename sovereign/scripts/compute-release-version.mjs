#!/usr/bin/env node
// Computes the next Sovereign release version for the current upstream base.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function usage() {
	console.error(`Usage: compute-release-version.mjs [--upstream-base <version>] [--remote <remote>] [--override <version>] [--github-output <path>] [--json <path>]`);
}

function parseArgs(argv) {
	const args = {
		remote: 'origin',
		upstreamBase: undefined,
		override: undefined,
		githubOutput: undefined,
		json: undefined,
	};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--remote') {
			args.remote = argv[++i];
		} else if (arg === '--upstream-base') {
			args.upstreamBase = argv[++i];
		} else if (arg === '--override') {
			args.override = argv[++i];
		} else if (arg === '--github-output') {
			args.githubOutput = argv[++i];
		} else if (arg === '--json') {
			args.json = argv[++i];
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
	return args;
}

function parseVersion(version, label) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
	if (!match) {
		throw new Error(`${label} must be a numeric x.y.z version, got '${version}'`);
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		version,
	};
}

function readUpstreamBase() {
	const file = path.join(root, 'sovereign', 'upstream-base');
	const line = fs.readFileSync(file, 'utf8')
		.split(/\r?\n/)
		.map(value => value.replace(/#.*/, '').trim())
		.find(Boolean);
	if (!line) {
		throw new Error(`No upstream base found in ${file}`);
	}
	return line;
}

function listRemoteTags(remote) {
	const output = execFileSync('git', ['ls-remote', '--tags', '--refs', remote], {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return output
		.split(/\r?\n/)
		.filter(Boolean)
		.map(line => line.split(/\s+/)[1]?.replace(/^refs\/tags\//, ''))
		.filter(Boolean);
}

function assertInLane(candidate, base, laneStart) {
	if (candidate.major !== base.major || candidate.minor !== base.minor) {
		throw new Error(`Release version '${candidate.version}' must share major.minor with upstream base '${base.version}'`);
	}
	const counter = candidate.patch - laneStart;
	if (counter < 1 || counter > 99) {
		throw new Error(`Release version '${candidate.version}' is outside the Sovereign lane for '${base.version}' (${base.major}.${base.minor}.${laneStart + 1}..${base.major}.${base.minor}.${laneStart + 99})`);
	}
	return counter;
}

function writeGithubOutput(file, result) {
	const entries = {
		upstream_base: result.upstreamBase,
		release_version: result.releaseVersion,
		release_tag: result.releaseTag,
		counter: String(result.counter),
		lane_start: String(result.laneStart),
	};
	fs.appendFileSync(file, Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
}

function main() {
	const args = parseArgs(process.argv);
	const upstreamBase = args.upstreamBase ?? readUpstreamBase();
	const base = parseVersion(upstreamBase, 'upstream base');
	if (base.patch >= 10000) {
		throw new Error(`Upstream base '${upstreamBase}' looks like a Sovereign release-lane version`);
	}

	const laneStart = 10000 + (base.patch * 100);
	const remoteTags = listRemoteTags(args.remote);
	const existingReleaseTags = remoteTags
		.filter(tag => /^\d+\.\d+\.\d+$/.test(tag))
		.map(tag => parseVersion(tag, 'remote tag'))
		.filter(tag => tag.major === base.major && tag.minor === base.minor && tag.patch > laneStart && tag.patch < laneStart + 100)
		.map(tag => tag.version)
		.sort((a, b) => parseVersion(a, 'release tag').patch - parseVersion(b, 'release tag').patch);

	let releaseVersion;
	let counter;
	if (args.override) {
		const override = parseVersion(args.override, 'release override');
		counter = assertInLane(override, base, laneStart);
		releaseVersion = override.version;
	} else {
		const highestCounter = existingReleaseTags
			.map(tag => parseVersion(tag, 'release tag').patch - laneStart)
			.reduce((max, value) => Math.max(max, value), 0);
		counter = highestCounter + 1;
		if (counter > 99) {
			throw new Error(`Sovereign release lane for '${upstreamBase}' is exhausted`);
		}
		releaseVersion = `${base.major}.${base.minor}.${laneStart + counter}`;
	}

	const result = {
		upstreamBase,
		releaseVersion,
		releaseTag: releaseVersion,
		major: base.major,
		minor: base.minor,
		upstreamPatch: base.patch,
		laneStart,
		counter,
		remote: args.remote,
		existingReleaseTags,
	};

	if (args.githubOutput) {
		writeGithubOutput(args.githubOutput, result);
	}
	if (args.json) {
		fs.writeFileSync(args.json, JSON.stringify(result, null, '\t') + '\n');
	}
	console.log(JSON.stringify(result, null, '\t'));
}

try {
	main();
} catch (error) {
	console.error(`compute-release-version: ${error.message}`);
	process.exit(1);
}
