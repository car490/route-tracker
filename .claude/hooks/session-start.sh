#!/bin/bash
# SessionStart hook — forces every session (web, CLI, IDE-embedded) to orient
# against the actual current state of the repo before doing anything else.
#
# Why this exists: this repo has repeatedly had sessions/agents work from a
# stale picture — either a branch behind origin/develop (CLAUDE.md/DECISIONS.md
# already warn master is routinely dozens of commits behind), or a doc whose
# "not built yet" claim had already been overtaken by same-day code (see
# docs/ANNOUNCE-PRODUCT-TIERS.md's "Open items" list, corrected 2026-08-27
# after describing already-shipped work as undone). This hook can't fix that
# by itself, but it can stop a session from silently starting on the wrong
# foot by putting the real state in front of the model on turn one.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Not a git repo (e.g. a stray invocation) — nothing to report.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

# Best-effort fetch — never let a network hiccup block session start.
if command -v timeout >/dev/null 2>&1; then
  timeout 15s git fetch origin develop --quiet 2>/dev/null || true
else
  git fetch origin develop --quiet 2>/dev/null || true
fi

DEVELOP_REF="origin/develop"
git rev-parse --verify "$DEVELOP_REF" >/dev/null 2>&1 || DEVELOP_REF=""

BEHIND=""
AHEAD=""
RECENT_COMMITS=""
if [ -n "$DEVELOP_REF" ]; then
  BEHIND="$(git rev-list --count HEAD.."$DEVELOP_REF" 2>/dev/null || echo '?')"
  AHEAD="$(git rev-list --count "$DEVELOP_REF"..HEAD 2>/dev/null || echo '?')"
  RECENT_COMMITS="$(git log "$DEVELOP_REF" -8 --format='%ad %h %s' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null || echo '(could not read log)')"
fi

CONTEXT="REPO ORIENTATION — read this before making any claim about what is or isn't built.

Current branch: ${CURRENT_BRANCH}"

if [ -n "$DEVELOP_REF" ]; then
  CONTEXT="${CONTEXT}
Branch vs origin/develop: ${BEHIND} commits behind, ${AHEAD} ahead."
  if [ "$BEHIND" != "0" ] && [ "$BEHIND" != "?" ]; then
    CONTEXT="${CONTEXT}
WARNING: this branch is ${BEHIND} commits behind origin/develop. Per this
repo's own convention (CLAUDE.md \"Git / deploy workflow\", docs/DECISIONS.md),
develop is the only branch that reflects current decisions — re-derive any
architecture/status claim from origin/develop, not from what this branch
happens to contain, before trusting it."
  fi
  CONTEXT="${CONTEXT}

Last 8 commits on origin/develop (oldest claim you should trust without
checking is whatever a doc says happened before these):
${RECENT_COMMITS}"
else
  CONTEXT="${CONTEXT}
Could not fetch/resolve origin/develop (no network, or the remote is
unreachable from this environment) — treat any \"current state\" claim
below with extra caution until you can verify against origin/develop
directly."
fi

CONTEXT="${CONTEXT}

Standing rule for this repo, learned the hard way (see
docs/ANNOUNCE-PRODUCT-TIERS.md's Open Items correction, 2026-08-27): a doc
saying something is \"not built yet\", \"still open\", or \"TODO\" is a
snapshot, not a guarantee — code moves faster than docs get updated. Before
telling the user something isn't built, or re-designing something a doc
describes as unbuilt, grep/read the actual source first (the relevant
module, its tests, its migration, its wiring into callers). If you find the
doc was stale, fix it in the same change — don't leave the next session to
rediscover the same gap the hard way.

Read CLAUDE.md and docs/DECISIONS.md now if you haven't already this
session — they are the project's own map of what's actually settled vs.
genuinely open, and DECISIONS.md exists specifically because this repo has
flip-flopped on hardware/architecture decisions before."

# Emit as additionalContext so it lands in the model's context, not just the
# terminal — a human skimming past this hook's stdout is exactly the failure
# mode it exists to prevent.
if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "$CONTEXT" \
    '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
else
  printf '%s\n' "$CONTEXT"
fi
