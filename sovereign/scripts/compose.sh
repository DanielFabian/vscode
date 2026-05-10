#!/usr/bin/env bash
# Compose the Sovereign integration ref by applying topic patch ranges
# listed in `sovereign/series` on top of an upstream base ref.
#
# Usage:
#   sovereign/scripts/compose.sh [--develop] [--base <ref>]
#
# Options:
#   --develop      Also apply any `topic/*` branches not listed in
#                  `sovereign/series`, ordered by their first-commit
#                  date. Local-dev view only; CI never uses this.
#   --base <ref>   Upstream base ref to compose onto. Defaults to the
#                  tag named in `sovereign/upstream-base`, or
#                  `upstream/main` when that file is missing. The ref
#                  must exist locally; this script does NOT fetch.
#
# Output:
#   Updates the local ref `sovereign/integration` (or
#   `sovereign/develop` with --develop) to point at the composed tip.
#
# Notes:
#   - Composition uses a dedicated git worktree at
#     `.git/sovereign-compose/` so the user's main worktree is never
#     disturbed. The worktree is reused across runs.
#   - Each topic is applied via
#     `git cherry-pick topic-base/<name>..topic/<name>` in the
#     dedicated worktree. Topic branches are treated as patch files:
#     `topic-base/<name>` is the start delimiter and `topic/<name>` is
#     the tip.
#   - On any cherry-pick failure, the script writes
#     `.git/sovereign-compose/compose-failure.env`, updates
#     `topic-repair-base/<name>` to the freshly composed prefix before
#     the failing topic, leaves the dedicated worktree in conflict for
#     inspection, and exits non-zero. The integration ref is left
#     unchanged.
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

SERIES_FILE="sovereign/series"
UPSTREAM_BASE_FILE="sovereign/upstream-base"
if [[ -z "$BASE" ]]; then
	if [[ -f "$UPSTREAM_BASE_FILE" ]]; then
		BASE="$(awk 'NF && $1 !~ /^#/ { print $1; exit }' "$UPSTREAM_BASE_FILE")"
	else
		BASE="upstream/main"
	fi
fi
INT_REF="sovereign/integration"
DEV_REF="sovereign/develop"
WORKTREE_DIR=".git/sovereign-compose"
FAILURE_ENV="$WORKTREE_DIR/compose-failure.env"
TARGET_REF="$INT_REF"
[[ "$DEVELOP" -eq 1 ]] && TARGET_REF="$DEV_REF"

topic_suffix() {
	local topic="$1"
	case "$topic" in
		topic/*)
			printf '%s\n' "${topic#topic/}"
			;;
		*)
			echo "compose: topic '$topic' must live under refs/heads/topic/" >&2
			return 1
			;;
	esac
}

quote_env() {
	local name="$1"
	local value="$2"
	printf '%s=%q\n' "$name" "$value"
}

write_failure_state() {
	local topic="$1"
	local suffix="$2"
	local failure_kind="$3"
	local failure_message="$4"
	local repair_sha="$5"
	local topic_base_ref="${6:-}"
	local topic_base_sha="${7:-}"
	local topic_tip_sha="${8:-}"
	local repair_ref="topic-repair-base/$suffix"

	mkdir -p "$(dirname "$FAILURE_ENV")"
	git update-ref "refs/heads/$repair_ref" "$repair_sha"
	{
		quote_env FAILED_TOPIC "$topic"
		quote_env TOPIC_SUFFIX "$suffix"
		quote_env FAILURE_KIND "$failure_kind"
		quote_env FAILURE_MESSAGE "$failure_message"
		quote_env TARGET_BASE "$BASE"
		quote_env TARGET_REF "$TARGET_REF"
		quote_env TOPIC_BASE_REF "$topic_base_ref"
		quote_env TOPIC_BASE_SHA "$topic_base_sha"
		quote_env TOPIC_TIP_REF "$topic"
		quote_env TOPIC_TIP_SHA "$topic_tip_sha"
		quote_env REPAIR_BASE_REF "$repair_ref"
		quote_env REPAIR_BASE_SHA "$repair_sha"
		quote_env WORKTREE_DIR "$WORKTREE_DIR"
	} > "$FAILURE_ENV"
}

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
			suffix="${ref#refs/heads/topic/}"
			base_ref="refs/heads/topic-base/$suffix"
			if git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
				first_ts="$(git log --reverse --format='%at' "$base_ref..$ref" 2>/dev/null | head -n1 || true)"
			else
				first_ts="$(git log --reverse --format='%at' "$BASE..$ref" 2>/dev/null | head -n1 || true)"
			fi
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
rm -f "$FAILURE_ENV"

echo "compose: base = $BASE"
echo "compose: target = $TARGET_REF"
echo "compose: applying ${#ALL_TOPICS[@]} topic(s)"
[[ "$DEVELOP" -eq 1 && ${#DEVELOP_TOPICS[@]} -gt 0 ]] && \
	echo "compose: develop-only: ${DEVELOP_TOPICS[*]}"

failed_topic=""
for t in "${ALL_TOPICS[@]}"; do
	suffix="$(topic_suffix "$t")" || {
		failed_topic="$t"
		break
	}
	topic_ref="refs/heads/$t"
	topic_base_name="topic-base/$suffix"
	topic_base_ref="refs/heads/$topic_base_name"
	repair_sha="$(cd "$WORKTREE_DIR" && git rev-parse HEAD)"

	if ! topic_tip_sha="$(git rev-parse --verify "$topic_ref" 2>/dev/null)"; then
		echo "compose: topic '$t' does not exist (refs/heads/$t)" >&2
		write_failure_state "$t" "$suffix" "missing-topic" "Topic ref '$topic_ref' does not exist." "$repair_sha" "$topic_base_name"
		failed_topic="$t"
		break
	fi
	if ! topic_base_sha="$(git rev-parse --verify "$topic_base_ref" 2>/dev/null)"; then
		echo "compose: topic base '$topic_base_name' does not exist ($topic_base_ref)" >&2
		echo "compose: create it at the patch start for '$t' before composing" >&2
		write_failure_state "$t" "$suffix" "missing-topic-base" "Topic base ref '$topic_base_ref' does not exist." "$repair_sha" "$topic_base_name" "" "$topic_tip_sha"
		failed_topic="$t"
		break
	fi
	if ! git merge-base --is-ancestor "$topic_base_sha" "$topic_tip_sha"; then
		echo "compose: topic base '$topic_base_name' is not an ancestor of '$t'" >&2
		echo "compose: '$topic_base_name..$t' is not a valid patch range" >&2
		write_failure_state "$t" "$suffix" "invalid-topic-base" "Topic base '$topic_base_name' is not an ancestor of '$t'." "$repair_sha" "$topic_base_name" "$topic_base_sha" "$topic_tip_sha"
		failed_topic="$t"
		break
	fi
	merge_commit="$(git rev-list --merges --max-count=1 "$topic_base_sha..$topic_tip_sha")"
	if [[ -n "$merge_commit" ]]; then
		echo "compose: topic '$t' contains merge commit $merge_commit in '$topic_base_name..$t'" >&2
		echo "compose: topics must be linear so they behave like patch files" >&2
		write_failure_state "$t" "$suffix" "merge-in-topic" "Topic '$t' contains merge commit $merge_commit in '$topic_base_name..$t'." "$repair_sha" "$topic_base_name" "$topic_base_sha" "$topic_tip_sha"
		failed_topic="$t"
		break
	fi

	# If the topic has no commits beyond its patch delimiter, nothing to apply.
	if [[ "$topic_base_sha" = "$topic_tip_sha" ]]; then
		echo "compose: topic '$t' has no commits beyond '$topic_base_name' — skipping" >&2
		continue
	fi
	echo "compose: applying $topic_base_name..$t"
	if ! (
		cd "$WORKTREE_DIR"
		git cherry-pick "$topic_base_sha..$topic_tip_sha"
	); then
		write_failure_state "$t" "$suffix" "cherry-pick" "Cherry-pick failed while applying '$topic_base_name..$t'." "$repair_sha" "$topic_base_name" "$topic_base_sha" "$topic_tip_sha"
		failed_topic="$t"
		break
	fi
done

if [[ -n "$failed_topic" ]]; then
	echo "compose: FAILED applying topic '$failed_topic'" >&2
	if [[ -f "$FAILURE_ENV" ]]; then
		echo "compose: failure state written to $FAILURE_ENV" >&2
	fi
	echo "compose: worktree at $WORKTREE_DIR is left for inspection" >&2
	exit 1
fi

NEW_TIP="$(cd "$WORKTREE_DIR" && git rev-parse HEAD)"
git update-ref "refs/heads/$TARGET_REF" "$NEW_TIP"

echo "compose: $TARGET_REF -> $NEW_TIP"
echo "compose: $(git log --oneline "$BASE..$TARGET_REF" | wc -l) commit(s) on top of $BASE"
