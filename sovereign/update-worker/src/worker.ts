/*---------------------------------------------------------------------------------------------
 *  Sovereign Update Feed Worker
 *
 *  Implements the public update endpoint that stock VS Code clients call:
 *      GET /api/update/{platform}/{quality}/{commit}
 *
 *  Semantics (intentionally minimal; mirrors update.code.visualstudio.com):
 *    - unknown route / disallowed platform / quality / missing entry -> 404
 *    - entry present and entry.version === commit                    -> 204
 *    - otherwise                                                     -> 200 + entry JSON
 *    - manifest fetch failure                                        -> 503
 *
 *  The worker has zero state. The source of truth is a single `manifest.json`
 *  on the `manifest` branch of DanielFabian/vscode, fetched via
 *  raw.githubusercontent.com. Promotion = a commit on that branch.
 *--------------------------------------------------------------------------------------------*/

const MANIFEST_URL = 'https://raw.githubusercontent.com/DanielFabian/vscode/manifest/manifest.json';

const ALLOWED_PLATFORMS = new Set(['linux-x64', 'linux-arm64']);
const ALLOWED_QUALITIES = new Set(['stable']);

// Matches GET /api/update/<platform>/<quality>/<commit> with an optional trailing slash.
// Querystring (background, internalOrg) is matched on URL.pathname only and ignored.
const ROUTE = /^\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)\/?$/;

const CACHE_HEADERS = { 'cache-control': 'public, max-age=60' } as const;

interface UpdateEntry {
	readonly url: string;
	readonly version: string;
	readonly productVersion: string;
	readonly sha256hash: string;
	readonly timestamp: number;
}

interface Manifest {
	readonly schemaVersion: 1;
	readonly channels: Readonly<Record<string, Readonly<Record<string, UpdateEntry>>>>;
}

export default {
	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
		}

		const url = new URL(request.url);
		const match = ROUTE.exec(url.pathname);
		if (!match) {
			return new Response(null, { status: 404 });
		}

		const [, platform, quality, commit] = match;
		if (!ALLOWED_PLATFORMS.has(platform) || !ALLOWED_QUALITIES.has(quality)) {
			return new Response(null, { status: 404 });
		}

		const manifest = await loadManifest();
		if (!manifest) {
			return new Response(null, { status: 503 });
		}

		const entry = manifest.channels?.[quality]?.[platform];
		if (!entry) {
			return new Response(null, { status: 404 });
		}

		if (entry.version === commit) {
			return new Response(null, { status: 204, headers: CACHE_HEADERS });
		}

		return new Response(JSON.stringify(entry), {
			status: 200,
			headers: { ...CACHE_HEADERS, 'content-type': 'application/json; charset=utf-8' },
		});
	},
};

async function loadManifest(): Promise<Manifest | null> {
	let response: Response;
	try {
		response = await fetch(MANIFEST_URL, {
			// Edge-cache the manifest fetch for 60s. Cloudflare-specific init field;
			// harmless when running under `wrangler dev` against a stock Node fetch.
			cf: { cacheTtl: 60, cacheEverything: true },
		} as RequestInit);
	} catch {
		return null;
	}
	if (!response.ok) {
		return null;
	}
	try {
		return await response.json() as Manifest;
	} catch {
		return null;
	}
}
