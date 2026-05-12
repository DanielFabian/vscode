#!/usr/bin/env bash
# Import selected Microsoft VS Code product metadata from the official archive
# for the upstream release tag that Sovereign is building on.
set -euo pipefail

REPO=".git/sovereign-compose"
UPSTREAM_BASE=""
PLATFORM="linux-x64"
QUALITY="stable"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--repo) REPO="$2"; shift 2 ;;
		--repo=*) REPO="${1#--repo=}"; shift ;;
		--upstream-base) UPSTREAM_BASE="$2"; shift 2 ;;
		--upstream-base=*) UPSTREAM_BASE="${1#--upstream-base=}"; shift ;;
		--platform) PLATFORM="$2"; shift 2 ;;
		--platform=*) PLATFORM="${1#--platform=}"; shift ;;
		--quality) QUALITY="$2"; shift 2 ;;
		--quality=*) QUALITY="${1#--quality=}"; shift ;;
		-h|--help)
			cat <<'USAGE'
Usage: sovereign/scripts/import-official-product-metadata.sh \
  --repo <composed-repo> \
  --upstream-base <semver-tag> \
	[--platform linux-x64|linux-arm64] \
  [--quality stable]

Copies selected product metadata from the official VS Code archive for the
matching upstream release into the composed Sovereign worktree. This keeps
upstream-owned product metadata (currently extensionEnabledApiProposals and
win32ContextMenu) out of long-lived topic diffs while still making official
Marketplace extensions and Windows packaging work.
USAGE
			exit 0
			;;
		*) echo "import-official-product-metadata: unknown argument: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$UPSTREAM_BASE" ]]; then
	echo 'import-official-product-metadata: --upstream-base is required' >&2
	exit 2
fi
if [[ ! -f "$REPO/product.json" ]]; then
	echo "import-official-product-metadata: missing product.json in repo '$REPO'" >&2
	exit 1
fi

archive_root="VSCode-$PLATFORM"
archive_url="https://update.code.visualstudio.com/$UPSTREAM_BASE/$PLATFORM/$QUALITY"
tmpdir="$(mktemp -d)"
cleanup() {
	rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "import-official-product-metadata: fetching $archive_url"
curl -fL --retry 2 --retry-delay 2 "$archive_url" \
	| tar -xz -C "$tmpdir" --strip-components=3 "$archive_root/resources/app/product.json"

node - "$REPO/product.json" "$tmpdir/product.json" "$UPSTREAM_BASE" <<'NODE'
const fs = require('fs');

const [targetPath, officialPath, upstreamBase] = process.argv.slice(2);
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const official = JSON.parse(fs.readFileSync(officialPath, 'utf8'));

if (official.version !== upstreamBase) {
	throw new Error(`Official product version '${official.version}' did not match upstream base '${upstreamBase}'`);
}

const proposals = official.extensionEnabledApiProposals;
if (!proposals || typeof proposals !== 'object' || Object.keys(proposals).length === 0) {
	throw new Error('Official product metadata is missing extensionEnabledApiProposals');
}

target.extensionEnabledApiProposals = proposals;
const copied = [`extensionEnabledApiProposals for ${Object.keys(proposals).length} extension(s)`];

if (official.win32ContextMenu && typeof official.win32ContextMenu === 'object') {
	target.win32ContextMenu = official.win32ContextMenu;
	copied.push('win32ContextMenu');
}

fs.writeFileSync(targetPath, `${JSON.stringify(target, null, '\t')}\n`);

console.log(`import-official-product-metadata: copied ${copied.join(', ')}`);
NODE
