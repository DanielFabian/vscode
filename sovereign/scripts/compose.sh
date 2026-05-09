#!/usr/bin/env bash
# Compose the Sovereign integration ref by applying topic branches
# listed in `sovereign/series` on top of an upstream base ref.
#
# Usage:
#   sovereign/scripts/compose.sh [--develop] [--base <ref>]
#
# Options:
#   --develop      Also apply any `topic/*` branches not listed in
#                  `sovereign/series`, ordered by their first-commit
#                  date. Local-dev view only; CI never uses this.
#   --base <ref>   Upstream base ref to compose onto. Defaults to
#                  `upstream/main`. The ref must exist locally; this
#                  script does NOT fetch.
#
# Output:
#   Updates the local ref `sovereign/integration` (or
#   `sovereign/develop` with --develop) to point at the composed tip.
#
# Notes:
#   - Composition uses a dedicated git worktree at
#     `.git/sovereign-compose/` so the user's main worktree is never
#     disturbed. The worktree is reused across runs.
#   - Each topic is applied via `git cherry-pick <merge-base>..<topic>`
#     in the dedicated worktree, which preserves the topic's commits
#     onto the evolving integration tip without touching the topic
#     branch ref itself.
#   - On any rebase failure, the script aborts the rebase and exits
#     non-zero. The integration ref is left unchanged.
set -euo pipefail

DEVELOP=0
BASE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--develop) DEVELOP=1; shift ;;
		--base)    BASE="$2"; shift 2 ;;
		--base=*)  BASE="${1#--base=}"; shift ;;
		-h|--help)
			grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*) echo "compose: unknown argument: $1" >&2; exit 2 ;;
	esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BASE="${BASE:-upstream/main}"
SERIES_FILE="sovereign/series"
INT_REF="sovereign/integration"
DEV_REF="sovereign/develop"
WORKTREE_DIR=".git/sovereign-compose"
TARGET_REF="$INT_REF"
[[ "$DEVELOP" -eq 1 ]] && TARGET_REF="$DEV_REF"

if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
	echo "compose: base ref '$BASE' does not exist (did you fetch upstream?)" >&2
	exit 1
fi
if [[ ! -f "$SERIES_FILE" ]]; then
	echo "compose: series file '$SERIES_FILE' missing" >&2
	exit 1
fi

# Refuse to run if the main worktree HEAD is on a computed ref —
# guards against accidentally checking out a thing meant to be
# computed-only.
HEAD_REF="$(git symbolic-ref --quiet HEAD || true)"
case "$HEAD_REF" in
	"refs/heads/$INT_REF"|"refs/heads/$DEV_REF")
		echo "compose: refusing to run — main worktree is on '$HEAD_REF'." >&2
		echo "         '$INT_REF' / '$DEV_REF' are computed refs; never check them out." >&2
		exit 1
		;;
esac

# Read series, stripping comments and blank lines while preserving order.
mapfile -t SERIES < <(awk '
	{ sub(/#.*/, "") }
	/[^[:space:]]/ { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print }
' "$SERIES_FILE")

# Collect develop-only topics if requested.
DEVELOP_TOPICS=()
if [[ "$DEVELOP" -eq 1 ]]; then
	declare -A IN_SERIES=()
	for t in "${SERIES[@]}"; do IN_SERIES["$t"]=1; done

	while IFS=$'\t' read -r ts ref; do
		t="${ref#refs/heads/}"
		[[ -n "${IN_SERIES[$t]:-}" ]] && continue
		DEVELOP_TOPICS+=("$t")
	done < <(
		for ref in $(git for-each-ref --format='%(refname)' 'refs/heads/topic/*'); do
			first_ts="$(git log --reverse --format='%at' "$BASE..$ref" 2>/dev/null | head -n1 || true)"
			[[ -z "$first_ts" ]] && first_ts=0
			printf '%s\t%s\n' "$first_ts" "$ref"
		done | sort -n -k1,1
	)
fi

ALL_TOPICS=("${SERIES[@]}" "${DEVELOP_TOPICS[@]}")

# Prepare the compose worktree.
if [[ ! -d "$WORKTREE_DIR" ]]; then
	git worktree add --detach -f "$WORKTREE_DIR" "$BASE" >/dev/null
fi

(
	cd "$WORKTREE_DIR"
	# Abort any in-progress operations from a prior run.
	git cherry-pick --abort 2>/dev/null || true
	git rebase --abort 2>/dev/null || true
	git am --abort     2>/dev/null || true
	# CRITICAL: the worktree must be detached before reset/clean,
	# otherwise reset would clobber whatever branch HEAD pointed at.
	# A previous run might have left HEAD attached to a topic branch.
	git checkout --detach >/dev/null 2>&1 || true
	git reset --hard "$BASE" >/dev/null
	git clean -fdx >/dev/null
)

echo "compose: base = $BASE"
echo "compose: target = $TARGET_REF"
echo "compose: applying ${#ALL_TOPICS[@]} topic(s)"
[[ "$DEVELOP" -eq 1 && ${#DEVELOP_TOPICS[@]} -gt 0 ]] && \
	echo "compose: develop-only: ${DEVELOP_TOPICS[*]}"

failed_topic=""
for t in "${ALL_TOPICS[@]}"; do
	if ! git rev-parse --verify "refs/heads/$t" >/dev/null 2>&1; then
		echo "compose: topic '$t' does not exist (refs/heads/$t)" >&2
		failed_topic="$t"
		break
	fi

	mb="$(git merge-base "$BASE" "$t")"
	# If the topic shares no history beyond BASE, nothing to apply.
	if [[ "$mb" = "$(git rev-parse "$t")" ]]; then
		echo "compose: topic '$t' has no commits beyond base — skipping" >&2
		continue
	fi
	if ! (
		cd "$WORKTREE_DIR"
		git cherry-pick "$mb..$t"
	); then
		(cd "$WORKTREE_DIR" && git cherry-pick --abort 2>/dev/null || true)
		failed_topic="$t"
		break
	fi
done

if [[ -n "$failed_topic" ]]; then
	echo "compose: FAILED applying topic '$failed_topic'" >&2
	echo "compose: worktree at $WORKTREE_DIR is left for inspection" >&2
	exit 1
fi

NEW_TIP="$(cd "$WORKTREE_DIR" && git rev-parse HEAD)"
git update-ref "refs/heads/$TARGET_REF" "$NEW_TIP"

echo "compose: $TARGET_REF -> $NEW_TIP"
echo "compose: $(git log --oneline "$BASE..$TARGET_REF" | wc -l) commit(s) on top of $BASE"
