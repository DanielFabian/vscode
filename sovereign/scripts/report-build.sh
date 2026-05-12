#!/usr/bin/env bash
# Report Sovereign release-build results to GitHub Issues.
#
# Usage:
#   sovereign/scripts/report-build.sh failure
#   sovereign/scripts/report-build.sh success
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ISSUE_TITLE='Sovereign Build: release publication failed'

usage() {
	grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
}

ensure_gh() {
	if ! command -v gh >/dev/null 2>&1; then
		echo 'report-build: gh CLI is required' >&2
		exit 1
	fi
}

find_issue() {
	local state="${1:-all}"
	TITLE="$ISSUE_TITLE" gh issue list \
		--state "$state" \
		--limit 200 \
		--json number,title,state \
		--jq '.[] | select(.title == env.TITLE) | [.number, .state] | @tsv' | head -n1
}

read_upstream_base() {
	awk 'NF && $1 !~ /^#/ { print $1; exit }' sovereign/upstream-base
}

write_failure_body() {
	local body_file="$1"
	local upstream_base
	upstream_base="$(read_upstream_base)"

	{
		echo 'A Sovereign release build or publication run failed.'
		echo
		echo '| Field | Value |'
		echo '| --- | --- |'
		echo "| Run | ${REPORT_BUILD_RUN_URL:-unknown} |"
		echo "| Workflow ref | \`${REPORT_BUILD_REF:-unknown}\` |"
		echo "| Head SHA | \`${REPORT_BUILD_SHA:-unknown}\` |"
		echo "| Upstream base | \`$upstream_base\` |"
		echo "| Release version input | \`${REPORT_BUILD_RELEASE_VERSION_INPUT:-<auto>}\` |"
		echo "| linux-archive result | \`${REPORT_BUILD_LINUX_ARCHIVE_RESULT:-unknown}\` |"
		echo "| publish-release result | \`${REPORT_BUILD_PUBLISH_RELEASE_RESULT:-unknown}\` |"
		echo "| verify_marketplace | \`${REPORT_BUILD_VERIFY_MARKETPLACE:-unknown}\` |"
		echo "| mark_prerelease | \`${REPORT_BUILD_MARK_PRERELEASE:-unknown}\` |"
		echo
		echo 'Marketplace reachability is intentionally not a GitHub-hosted release gate because the Marketplace proxy is VPN-only. A failure here is about build/package/publication mechanics unless the logs say otherwise.'
	} > "$body_file"
}

report_failure() {
	local body_file
	body_file="$(mktemp)"
	trap 'rm -f "$body_file"' RETURN
	write_failure_body "$body_file"

	local issue_line number state
	issue_line="$(find_issue all || true)"
	if [[ -n "$issue_line" ]]; then
		number="${issue_line%%$'\t'*}"
		state="${issue_line##*$'\t'}"
		gh issue edit "$number" --title "$ISSUE_TITLE" --body-file "$body_file"
		if [[ "$state" != 'OPEN' ]]; then
			gh issue reopen "$number" --comment "Release build is failing again: ${REPORT_BUILD_RUN_URL:-unknown}."
		else
			gh issue comment "$number" --body "Release build is still failing; issue body updated: ${REPORT_BUILD_RUN_URL:-unknown}."
		fi
	else
		gh issue create --title "$ISSUE_TITLE" --body-file "$body_file"
	fi
}

report_success() {
	local issue_line number
	issue_line="$(find_issue open || true)"
	if [[ -z "$issue_line" ]]; then
		return 0
	fi
	number="${issue_line%%$'\t'*}"
	gh issue close "$number" --comment "Resolved by successful release build: ${REPORT_BUILD_RUN_URL:-unknown}."
}

main() {
	if [[ $# -ne 1 ]]; then
		usage >&2
		exit 2
	fi
	ensure_gh

	case "$1" in
		failure)
			report_failure
			;;
		success)
			report_success
			;;
		*)
			usage >&2
			exit 2
			;;
	esac
}

main "$@"
