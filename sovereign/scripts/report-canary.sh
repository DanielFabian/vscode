#!/usr/bin/env bash
# Report Sovereign compose/canary results to GitHub Issues.
#
# Usage:
#   sovereign/scripts/report-canary.sh failure <compose-failure.env> [target-tag]
#   sovereign/scripts/report-canary.sh success [target-tag] [topic/<name>]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SERIES_FILE="sovereign/series"

usage() {
	grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
}

read_series() {
	awk '
		{ sub(/#.*/, "") }
		/[^[:space:]]/ { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print }
	' "$SERIES_FILE"
}

issue_title() {
	local topic="$1"
	printf 'Canary: %s no longer applies cleanly\n' "$topic"
}

ensure_gh() {
	if ! command -v gh >/dev/null 2>&1; then
		echo "report-canary: gh CLI is required" >&2
		exit 1
	fi
}

find_issue() {
	local title="$1"
	local state="${2:-all}"
	TITLE="$title" gh issue list \
		--state "$state" \
		--limit 200 \
		--json number,title,state \
		--jq '.[] | select(.title == env.TITLE) | [.number, .state] | @tsv' | head -n1
}

append_command_output() {
	local body_file="$1"
	local heading="$2"
	shift 2
	{
		echo
		echo "### $heading"
		echo
		echo '```'
		"$@" 2>&1 | sed -n '1,240p' || true
		echo '```'
	} >> "$body_file"
}

write_failure_body() {
	local body_file="$1"
	local target_tag="$2"

	{
		echo "The Sovereign canary failed while replaying \`$FAILED_TOPIC\`."
		echo
		echo "| Field | Value |"
		echo "| --- | --- |"
		echo "| Target upstream base | \`${target_tag:-$TARGET_BASE}\` |"
		echo "| Failure kind | \`$FAILURE_KIND\` |"
		echo "| Failure message | $FAILURE_MESSAGE |"
		echo "| Topic | \`$FAILED_TOPIC\` |"
		echo "| Topic base | \`$TOPIC_BASE_REF\` \`${TOPIC_BASE_SHA:-unknown}\` |"
		echo "| Topic tip | \`$TOPIC_TIP_REF\` \`${TOPIC_TIP_SHA:-unknown}\` |"
		echo "| Repair base | \`$REPAIR_BASE_REF\` \`$REPAIR_BASE_SHA\` |"
		echo
		echo "Repair this one topic by rebasing its patch range onto the generated repair base:"
		echo
		echo '```bash'
		cat <<EOF
git fetch origin \\
  refs/heads/$FAILED_TOPIC:refs/heads/$FAILED_TOPIC \\
  refs/heads/$TOPIC_BASE_REF:refs/heads/$TOPIC_BASE_REF \\
  refs/heads/$REPAIR_BASE_REF:refs/heads/$REPAIR_BASE_REF
git switch $FAILED_TOPIC
git rebase --onto $REPAIR_BASE_REF $TOPIC_BASE_REF $FAILED_TOPIC
# resolve conflicts, then: git rebase --continue
git update-ref refs/heads/$TOPIC_BASE_REF $REPAIR_BASE_REF
git push origin refs/heads/$FAILED_TOPIC:refs/heads/$FAILED_TOPIC refs/heads/$TOPIC_BASE_REF:refs/heads/$TOPIC_BASE_REF
EOF
		echo '```'
	} > "$body_file"

	if [[ -d "${WORKTREE_DIR:-}" ]]; then
		append_command_output "$body_file" "Conflicting files" git -C "$WORKTREE_DIR" diff --name-only --diff-filter=U
		append_command_output "$body_file" "Worktree status" git -C "$WORKTREE_DIR" status --short
		append_command_output "$body_file" "Conflict diff" git -C "$WORKTREE_DIR" diff --cc
	fi
}

report_failure() {
	local failure_env="$1"
	local target_tag="${2:-}"

	if [[ ! -f "$failure_env" ]]; then
		echo "report-canary: failure env '$failure_env' not found" >&2
		exit 1
	fi
	# shellcheck disable=SC1090
	source "$failure_env"

	local title
	title="$(issue_title "$FAILED_TOPIC")"
	local body_file
	body_file="$(mktemp)"
	trap 'rm -f "$body_file"' RETURN
	write_failure_body "$body_file" "$target_tag"

	local issue_line number state
	issue_line="$(find_issue "$title" all || true)"
	if [[ -n "$issue_line" ]]; then
		number="${issue_line%%$'\t'*}"
		state="${issue_line##*$'\t'}"
		gh issue edit "$number" --title "$title" --body-file "$body_file"
		if [[ "$state" != "OPEN" ]]; then
			gh issue reopen "$number" --comment "Still failing on ${target_tag:-$TARGET_BASE}; reopening."
		else
			gh issue comment "$number" --body "Still failing on ${target_tag:-$TARGET_BASE}; issue body updated."
		fi
	else
		gh issue create --title "$title" --body-file "$body_file"
	fi
}

close_topic_issue() {
	local topic="$1"
	local target_tag="$2"
	local title issue_line number
	title="$(issue_title "$topic")"
	issue_line="$(find_issue "$title" open || true)"
	if [[ -z "$issue_line" ]]; then
		return 0
	fi
	number="${issue_line%%$'\t'*}"
	gh issue close "$number" --comment "Resolved on ${target_tag:-current target}; canary replayed cleanly."
}

report_success() {
	local target_tag="${1:-}"
	local only_topic="${2:-}"

	if [[ -n "$only_topic" ]]; then
		close_topic_issue "$only_topic" "$target_tag"
		return 0
	fi

	while IFS= read -r topic; do
		[[ -z "$topic" ]] && continue
		close_topic_issue "$topic" "$target_tag"
	done < <(read_series)
}

main() {
	if [[ $# -lt 1 ]]; then
		usage >&2
		exit 2
	fi
	ensure_gh

	case "$1" in
		failure)
			if [[ $# -lt 2 || $# -gt 3 ]]; then
				usage >&2
				exit 2
			fi
			report_failure "$2" "${3:-}"
			;;
		success)
			if [[ $# -gt 3 ]]; then
				usage >&2
				exit 2
			fi
			report_success "${2:-}" "${3:-}"
			;;
		*)
			usage >&2
			exit 2
			;;
	esac
}

main "$@"
