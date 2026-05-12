#!/usr/bin/env node
// Writes the Sovereign stock-updater manifest from GitHub Release provenance assets.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_REPOSITORY = 'DanielFabian/vscode';
const DEFAULT_QUALITY = 'stable';
const DEFAULT_PLATFORM_MAPPINGS = [
	{ platform: 'linux-x64', arch: 'x64' },
	{ platform: 'linux-arm64', arch: 'arm64' },
];

function usage() {
	console.error(`Usage: write-update-manifest.mjs --release-tag <tag> --output <manifest.json> [--github-repository <owner/repo>] [--quality <quality>] [--platform <platform>=<release-arch>] [--dry-run]`);
}

function parseArgs(argv) {
	const args = {
		releaseTag: undefined,
		output: undefined,
		githubRepository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
		quality: DEFAULT_QUALITY,
		platforms: [],
		dryRun: false,
	};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--release-tag') {
			args.releaseTag = argv[++i];
		} else if (arg === '--output') {
			args.output = argv[++i];
		} else if (arg === '--github-repository') {
			args.githubRepository = argv[++i];
		} else if (arg === '--quality') {
			args.quality = argv[++i];
		} else if (arg === '--platform') {
			args.platforms.push(parsePlatformMapping(argv[++i]));
		} else if (arg === '--dry-run') {
			args.dryRun = true;
		} else if (arg === '-h' || arg === '--help') {
			usage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
		if (arg !== '--dry-run' && (arg === '--release-tag' || arg === '--output' || arg === '--github-repository' || arg === '--quality' || arg === '--platform') && argv[i] === undefined) {
			throw new Error(`Missing value for ${arg}`);
		}
	}
	if (!args.releaseTag || (!args.output && !args.dryRun)) {
		usage();
		process.exit(2);
	}
	if (!/^[^/]+\/[^/]+$/.test(args.githubRepository)) {
		throw new Error(`GitHub repository must be owner/repo, got '${args.githubRepository}'`);
	}
	if (!/^[a-z][a-z0-9-]*$/.test(args.quality)) {
		throw new Error(`Quality must be a simple lowercase channel name, got '${args.quality}'`);
	}
	if (args.platforms.length === 0) {
		args.platforms = DEFAULT_PLATFORM_MAPPINGS;
	}
	assertUnique(args.platforms.map(mapping => mapping.platform), 'platform');
	return args;
}

function parsePlatformMapping(value) {
	if (value === undefined) {
		throw new Error('Missing value for --platform');
	}
	const match = /^([a-z0-9-]+)=([a-z0-9-]+)$/.exec(value);
	if (!match) {
		throw new Error(`--platform must be <platform>=<release-arch>, got '${value}'`);
	}
	return { platform: match[1], arch: match[2] };
}

function assertUnique(values, label) {
	const seen = new Set();
	for (const value of values) {
		if (seen.has(value)) {
			throw new Error(`Duplicate ${label}: ${value}`);
		}
		seen.add(value);
	}
}

function token() {
	return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
}

async function fetchText(url, accept) {
	const headers = {
		'accept': accept,
		'user-agent': 'sovereign-update-manifest',
	};
	const authToken = token();
	if (authToken && new URL(url).hostname === 'api.github.com') {
		headers.authorization = `Bearer ${authToken}`;
	}

	const response = await fetch(url, { headers });
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`GET ${url} failed: HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
	}
	return text;
}

async function fetchJson(url) {
	const text = await fetchText(url, 'application/vnd.github+json');
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`GET ${url} did not return JSON: ${error.message}`);
	}
}

function assertObject(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
}

function assertString(value, label) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function assertPattern(value, pattern, label) {
	assertString(value, label);
	if (!pattern.test(value)) {
		throw new Error(`${label} has unexpected value '${value}'`);
	}
	return value;
}

function assetMap(release) {
	if (!Array.isArray(release.assets)) {
		throw new Error('release.assets must be an array');
	}
	const assets = new Map();
	for (const asset of release.assets) {
		assertObject(asset, 'release asset');
		const name = assertString(asset.name, 'release asset name');
		const url = assertString(asset.browser_download_url, `release asset ${name} browser_download_url`);
		if (assets.has(name)) {
			throw new Error(`Release contains duplicate asset '${name}'`);
		}
		assets.set(name, { name, url });
	}
	return assets;
}

async function loadRelease(repository, releaseTag) {
	const encodedTag = encodeURIComponent(releaseTag);
	const release = await fetchJson(`https://api.github.com/repos/${repository}/releases/tags/${encodedTag}`);
	assertObject(release, 'release');
	if (release.tag_name !== releaseTag) {
		throw new Error(`GitHub release tag_name '${release.tag_name}' did not match requested tag '${releaseTag}'`);
	}
	const publishedAt = assertString(release.published_at, 'release.published_at');
	const timestamp = Date.parse(publishedAt);
	if (!Number.isFinite(timestamp)) {
		throw new Error(`release.published_at is not parseable: '${publishedAt}'`);
	}
	return { release, timestamp, assets: assetMap(release) };
}

async function loadProvenance(assets, releaseTag, arch) {
	const provenanceName = `sovereign-linux-${arch}-${releaseTag}.provenance.json`;
	const provenanceAsset = assets.get(provenanceName);
	if (!provenanceAsset) {
		throw new Error(`Missing provenance asset '${provenanceName}'`);
	}
	const provenance = JSON.parse(await fetchText(provenanceAsset.url, 'application/json'));
	assertObject(provenance, provenanceName);
	return { provenanceName, provenance };
}

async function validateSidecar(assets, artifactName, expectedSha256) {
	const sidecarName = `${artifactName}.sha256`;
	const sidecarAsset = assets.get(sidecarName);
	if (!sidecarAsset) {
		throw new Error(`Missing SHA256 sidecar asset '${sidecarName}'`);
	}
	const text = await fetchText(sidecarAsset.url, 'text/plain');
	const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	if (lines.length !== 1) {
		throw new Error(`SHA256 sidecar '${sidecarName}' must contain exactly one non-empty line`);
	}
	const match = /^([0-9a-f]{64})\s+(\*?\S+)$/.exec(lines[0]);
	if (!match) {
		throw new Error(`SHA256 sidecar '${sidecarName}' has unexpected content '${lines[0]}'`);
	}
	const [, sha256, fileNameWithMode] = match;
	const fileName = fileNameWithMode.startsWith('*') ? fileNameWithMode.slice(1) : fileNameWithMode;
	if (sha256 !== expectedSha256) {
		throw new Error(`SHA256 sidecar '${sidecarName}' has sha256 ${sha256}, expected ${expectedSha256}`);
	}
	if (fileName !== artifactName) {
		throw new Error(`SHA256 sidecar '${sidecarName}' names '${fileName}', expected '${artifactName}'`);
	}
}

async function projectEntry(context, mapping) {
	const { assets, releaseTag, timestamp } = context;
	const { provenanceName, provenance } = await loadProvenance(assets, releaseTag, mapping.arch);
	if (provenance.schema !== 1) {
		throw new Error(`${provenanceName} has schema ${provenance.schema}, expected 1`);
	}
	if (provenance.releaseTag !== releaseTag) {
		throw new Error(`${provenanceName} has releaseTag ${provenance.releaseTag}, expected ${releaseTag}`);
	}
	const productVersion = assertPattern(provenance.releaseVersion, /^\d+\.\d+\.\d+$/, `${provenanceName}.releaseVersion`);
	const version = assertPattern(provenance.composeCommit, /^[0-9a-f]{40}$/, `${provenanceName}.composeCommit`);
	assertObject(provenance.artifact, `${provenanceName}.artifact`);
	const artifactName = assertString(provenance.artifact.name, `${provenanceName}.artifact.name`);
	const sha256hash = assertPattern(provenance.artifact.sha256, /^[0-9a-f]{64}$/, `${provenanceName}.artifact.sha256`);
	const artifact = assets.get(artifactName);
	if (!artifact) {
		throw new Error(`${provenanceName} references missing artifact '${artifactName}'`);
	}
	await validateSidecar(assets, artifactName, sha256hash);
	return {
		platform: mapping.platform,
		entry: {
			url: artifact.url,
			version,
			productVersion,
			sha256hash,
			timestamp,
		},
	};
}

function validatePromotion(entries) {
	const first = entries[0]?.entry;
	if (!first) {
		throw new Error('No entries projected');
	}
	for (const { platform, entry } of entries) {
		if (entry.productVersion !== first.productVersion) {
			throw new Error(`${platform} productVersion ${entry.productVersion} does not match ${first.productVersion}`);
		}
		if (entry.timestamp !== first.timestamp) {
			throw new Error(`${platform} timestamp ${entry.timestamp} does not match ${first.timestamp}`);
		}
	}
}

function readManifest(output) {
	if (!output || !fs.existsSync(output)) {
		return { schemaVersion: 1, channels: {} };
	}
	const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
	assertObject(manifest, output);
	if (manifest.schemaVersion !== 1) {
		throw new Error(`${output} has schemaVersion ${manifest.schemaVersion}, expected 1`);
	}
	assertObject(manifest.channels, `${output}.channels`);
	return manifest;
}

function writeFileAtomic(file, contents) {
	fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	const tmp = path.join(path.dirname(path.resolve(file)), `.${path.basename(file)}.${process.pid}.tmp`);
	try {
		fs.writeFileSync(tmp, contents);
		fs.renameSync(tmp, file);
	} catch (error) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// Ignore cleanup failure for a temporary file.
		}
		throw error;
	}
}

function applyEntries(manifest, quality, entries) {
	if (!Object.prototype.hasOwnProperty.call(manifest.channels, quality)) {
		manifest.channels[quality] = {};
	}
	assertObject(manifest.channels[quality], `manifest.channels.${quality}`);
	const previous = new Map();
	for (const { platform, entry } of entries) {
		const oldEntry = manifest.channels[quality][platform];
		previous.set(platform, oldEntry && typeof oldEntry === 'object' ? oldEntry.version : undefined);
		manifest.channels[quality][platform] = entry;
	}
	return previous;
}

function printSummary(stream, args, entries, previous) {
	stream.write(`write-update-manifest: release ${args.releaseTag} -> ${args.quality}\n`);
	for (const { platform, entry } of entries) {
		stream.write(`  ${platform}: ${previous.get(platform) ?? '<none>'} -> ${entry.version}\n`);
	}
	if (!args.dryRun && args.output) {
		stream.write(`wrote ${args.output}\n`);
	}
}

async function main() {
	const args = parseArgs(process.argv);
	const releaseContext = await loadRelease(args.githubRepository, args.releaseTag);
	const context = { ...releaseContext, releaseTag: args.releaseTag };
	const entries = [];
	for (const mapping of args.platforms) {
		entries.push(await projectEntry(context, mapping));
	}
	validatePromotion(entries);

	const manifest = readManifest(args.output);
	const previous = applyEntries(manifest, args.quality, entries);
	const contents = JSON.stringify(manifest, null, '\t') + '\n';
	if (args.dryRun) {
		process.stdout.write(contents);
		printSummary(process.stderr, args, entries, previous);
	} else {
		writeFileAtomic(args.output, contents);
		printSummary(process.stdout, args, entries, previous);
	}
}

main().catch(error => {
	console.error(`write-update-manifest: ${error.message}`);
	process.exit(1);
});
