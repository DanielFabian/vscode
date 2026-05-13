# Windows Release Fan-In Plan

This document tracks the path from the current Windows installer smoke workflow to a first-class release lane in the Sovereign release pipeline.

## Current State

- [x] Linux x64 and arm64 archives are built by `sovereign-build.yml`.
- [x] Linux artifacts fan into a GitHub Release.
- [x] The `manifest` branch is updated only after Linux release publication succeeds.
- [x] The public update worker serves stock VS Code update protocol responses for Linux platforms.
- [x] Windows x64 user setup can be built by `sovereign-windows-build.yml`.
- [x] Windows runtime smoke has worked once: installer ran, auth fell back to device login, and a corporate Copilot model responded.
- [x] New upstream-tag canary promotion now fans out to both Linux release build and Windows installer build.
- [ ] Windows installer artifacts fan into the GitHub Release.
- [ ] Windows `win32-x64-user` entries fan into the update manifest.
- [ ] The public update worker allows `win32-x64-user`.

## Target Shape

The desired release graph is:

```text
new upstream tag detected
  -> canary compose/import smoke
  -> promote sovereign/upstream-base
  -> prepare one release version
      -> linux-x64 archive
      -> linux-arm64 archive
      -> win32-x64 user setup
  -> publish one GitHub Release containing all platform assets
  -> publish one update manifest containing all supported update platforms
  -> validate the public update endpoint for every promoted platform
```

The manifest update is the final deployment switch. If any required platform artifact is missing or invalid, the manifest branch must not advance.

## Release Invariants

- [ ] A release version is computed exactly once per release graph.
- [ ] Every platform artifact uses the same `releaseVersion`.
- [ ] Every platform artifact uses the same `upstreamBase`.
- [ ] Every platform artifact uses the same composed patch-stack commit.
- [ ] Every artifact has a SHA256 sidecar.
- [ ] Every artifact has a provenance sidecar.
- [ ] Release publication validates that all provenance sidecars agree before creating or updating a release.
- [ ] Manifest publication validates that all release assets referenced by the manifest exist and match their sidecars.
- [ ] The update endpoint is validated for each platform after manifest publication.

## Platform Mapping

Known stock updater platform strings:

- [x] `linux-x64`
- [x] `linux-arm64`
- [ ] `win32-x64-user`

The Windows updater constructs the platform string in `src/vs/platform/update/electron-main/updateService.win32.ts`:

```ts
let platform = `win32-${process.arch}`;

if (getUpdateType() === UpdateType.Archive) {
	platform += '-archive';
} else if (this.productService.target === 'user') {
	platform += '-user';
}
```

For the user setup built by `vscode-win32-x64-user-setup`, the update platform is therefore `win32-x64-user`.

## Phase 1 — Keep Windows Smoke, Reduce Flakiness

- [x] Keep `sovereign-windows-build.yml` as a manual smoke/artifact workflow.
- [x] Dispatch Windows smoke automatically after future upstream-base promotions.
- [ ] Add retry semantics around transient network installs, especially `npm ci` on Windows.
- [ ] Decide whether `actions/setup-python` should pin a specific known-good Python version instead of `3.x` if native module builds get noisy.
- [ ] Preserve installer logs as artifacts when Inno setup succeeds with warnings or fails.

Notes:

- The failed run `25763236518` died during `npm ci` with `ECONNRESET`, before Windows build/package logic. That is pipeline flake, not platform semantics.
- The first successful installer build proved AppX context menu packaging, Inno user setup packaging, and product metadata import all work.

## Phase 2 — Add Windows to Release Asset Fan-In

- [ ] Move or duplicate the Windows build job into `sovereign-build.yml` as a first-class release job.
- [ ] Make `publish-release` depend on Linux archive jobs and the Windows setup job.
- [ ] Download the Windows artifact in `publish-release`.
- [ ] Include Windows artifacts in the GitHub Release:
  - [ ] `CodeOSSUserSetup-x64-<releaseVersion>.exe`
  - [ ] `CodeOSSUserSetup-x64-<releaseVersion>.exe.sha256`
  - [ ] `sovereign-win32-x64-user-setup-<releaseVersion>.provenance.json`
- [ ] Update release notes to list Windows assets alongside Linux assets.
- [ ] Validate Windows provenance in the release fan-in step.
- [ ] Validate Windows SHA256 sidecar in the release fan-in step.

Open design question:

- [ ] Should `sovereign-windows-build.yml` remain separate as only a manual smoke workflow after Windows joins `sovereign-build.yml`?

Current bias: yes. Keep the manual workflow for quick isolated retries; make the release workflow authoritative.

## Phase 3 — Generalize Manifest Projection

Current `sovereign/scripts/write-update-manifest.mjs` assumes Linux-style provenance names:

```js
const provenanceName = `sovereign-linux-${arch}-${releaseTag}.provenance.json`;
```

That is too narrow for Windows.

- [ ] Replace the current `platform=arch` mapping with artifact/provenance-aware platform descriptors.
- [ ] Support Linux descriptors:
  - [ ] `linux-x64`
  - [ ] `linux-arm64`
- [ ] Support Windows descriptor:
  - [ ] `win32-x64-user`
- [ ] Ensure the manifest entry URL points directly at the Windows `.exe` asset.
- [ ] Ensure the Windows manifest entry uses the composed commit as `version`.
- [ ] Ensure the Windows manifest entry uses the Sovereign release version as `productVersion`.
- [ ] Ensure the Windows manifest entry includes `sha256hash` for the `.exe`.
- [ ] Keep validation strict: all projected entries must agree on `productVersion` and timestamp.

Possible descriptor shape:

```jsonc
{
	"platform": "win32-x64-user",
	"artifactName": "CodeOSSUserSetup-x64-${releaseVersion}.exe",
	"provenanceName": "sovereign-win32-x64-user-setup-${releaseVersion}.provenance.json"
}
```

The exact CLI shape can be decided when implementing. The semantic requirement is that platform update entries are no longer inferred from a Linux architecture string alone.

## Phase 4 — Enable Windows in the Update Worker

Current worker allowlist:

```ts
const ALLOWED_PLATFORMS = new Set(['linux-x64', 'linux-arm64']);
```

Required change:

- [ ] Add `win32-x64-user` to the allowed platforms.
- [ ] Add worker tests or equivalent smoke commands for:
  - [ ] current `win32-x64-user` commit returns `204`.
  - [ ] stale `win32-x64-user` commit returns `200` with JSON.
  - [ ] unknown Windows platform still returns `404`.
- [ ] Deploy the worker change before publishing Windows manifest entries, or publish both in one controlled operation.

## Phase 5 — Validate End-to-End Windows Update Semantics

- [ ] Install a released Windows setup artifact.
- [ ] Confirm `product.json` contains expected `quality`, `commit`, `updateUrl`, `downloadUrl`, and `target: user` semantics.
- [ ] Call the public endpoint manually:

```text
GET /api/update/win32-x64-user/stable/<packaged-commit>
```

- [ ] Confirm current commit returns `204`.
- [ ] Confirm a stale fake commit returns update JSON pointing at the GitHub Release `.exe`.
- [ ] Let the app check for updates against a newer published manifest.
- [ ] Confirm the downloaded installer checksum is accepted.
- [ ] Confirm Inno update flow applies or prompts as expected.

## Inline Shell vs Build Library Direction

The current Sovereign workflows contain large inline shell/PowerShell blocks. They worked for discovery, but they are becoming a liability:

- YAML has weak structure and weak local testability.
- Shell quoting differs across Bash and PowerShell.
- Release graph invariants are spread across multiple jobs.
- Artifact naming/provenance/update-manifest rules are duplicated or implicit.

Upstream VS Code already uses TypeScript heavily for build logic:

- `build/gulpfile.vscode.ts` packages app trees.
- `build/gulpfile.vscode.win32.ts` packages Windows setup artifacts.
- `build/lib/extensions.ts` packages built-in extensions.
- `build/azure-pipelines/**/*.yml` mostly orchestrate typed scripts/gulp tasks rather than encoding all semantics inline.

Observed upstream patterns worth stealing:

- `build/azure-pipelines/product-build.yml` exposes platform booleans and fans out platform stages from one build definition.
- `build/azure-pipelines/win32/product-build-win32.yml` declares Windows outputs as data: system setup, user setup, archive, server archive, and web archive each have explicit artifact names and target paths.
- `build/azure-pipelines/win32/steps/product-build-win32-compile.yml` keeps runner/action orchestration in YAML, but delegates real behavior to scripts and gulp tasks such as `mixin-quality.ts`, `downloadCopilotVsix.ts`, `extract-telemetry.ts`, `codesign.ts`, and `npm run gulp vscode-win32-$(VSCODE_ARCH)-min-ci`.
- Upstream uses `retryCountOnTaskFailure: 5` for `npm ci`; our observed Windows `ECONNRESET` is exactly the kind of failure this catches.
- Upstream uses `deemon` for background/awaited artifact dependencies, notably waiting for CLI artifacts and Copilot VSIX downloads.
- Upstream artifact publication is descriptor-driven: Azure template outputs carry `artifactName`, `targetPath`, SBOM metadata, and conditions. We should emulate the descriptor idea even if GitHub Actions upload/download syntax differs.

Practical steal-list:

- [ ] Add retry around `npm ci` in Windows and Linux release jobs.
- [ ] Introduce a Sovereign artifact descriptor registry rather than handwritten release asset loops per platform.
- [ ] Keep platform command invocations near YAML, but move naming/provenance/manifest validation into TypeScript.
- [ ] Treat Windows `user-setup` as one artifact descriptor among peers, not as a one-off side workflow.
- [ ] Consider using a small helper script to emit GitHub Actions outputs for artifact names/paths, analogous to upstream's Azure artifact descriptor data.

Sovereign should follow that pattern.

Checklist:

- [ ] Inventory current large inline script blocks in `sovereign-build.yml` and `sovereign-windows-build.yml`.
- [ ] Classify each block:
  - [ ] orchestration glue that should stay in YAML.
  - [ ] deterministic release logic that should move to TypeScript.
  - [ ] platform-specific command invocation that may remain shell/PowerShell.
- [ ] Create a small Sovereign release library under `sovereign/scripts/` or `sovereign/release/`.
- [ ] Prefer TypeScript/JavaScript for:
  - [ ] release version planning.
  - [ ] artifact descriptor generation.
  - [ ] provenance validation.
  - [ ] release asset fan-in validation.
  - [ ] update manifest projection.
- [ ] Keep YAML responsible for:
  - [ ] runner selection.
  - [ ] checkout/setup actions.
  - [ ] cache/artifact upload/download actions.
  - [ ] invoking one deterministic script per semantic stage.

Potential end-state commands:

```bash
node sovereign/release/prepare-release.mjs --github-output "$GITHUB_OUTPUT"
node sovereign/release/validate-artifacts.mjs --release-version "$release_version" --root .build/sovereign-release-downloads
node sovereign/release/prepare-release-assets.mjs --release-version "$release_version" --output .build/sovereign-release-assets
node sovereign/release/write-update-manifest.mjs --release-tag "$release_tag" --output "$manifest_worktree/manifest.json"
```

Do not move everything at once. The safe migration path is to extract logic only when we have a green pipeline and a concrete duplicated invariant to preserve.

## Open Questions

- [ ] Do we want Windows auto-update enabled immediately after Windows artifacts are added to GitHub Releases, or should there be one release where Windows is release-asset-only?
- [ ] Should the Linux and Windows artifact names use a common descriptor registry so release notes and manifest projection cannot drift?
- [ ] Should Windows setup artifacts be uploaded to GitHub Releases as `.exe` directly, or zipped to avoid browser/proxy/security-product weirdness?
- [ ] Do we want to publish Windows checksums in Authenticode-friendly form later?
- [ ] Should we add retries around all network-heavy package manager steps, or only the observed flaky `npm ci` step?
- [ ] Should the Windows lane become release-blocking immediately, or after one more successful automatic run?

## Current Bias

- Add Windows to GitHub Release fan-in first.
- Keep Windows out of the update manifest until at least one release contains the Windows asset and we manually verify update endpoint semantics.
- Then add `win32-x64-user` to the update manifest and worker allowlist.
- Extract TypeScript release helpers opportunistically as the release fan-in grows, rather than doing a giant build-system rewrite upfront.
