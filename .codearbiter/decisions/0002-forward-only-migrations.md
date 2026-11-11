---
status: accepted
date: 2026-11-11
title: Forward-only schema migrations
decided-by: SUaDtL@users.noreply.github.com
supersedes: none
governs: src/db/migrations/*, src/db/migrate.ts
---

# ADR-0002 — Forward-only schema migrations

## Status
Accepted

## Context
SIM datasets are local `.sqlite` files that consultants carry between sites and
reopen with whatever SIM build they have. The schema is versioned with
`PRAGMA user_version` and evolved by migrations in `src/db/migrations/`
(WORK-004, spec SPEC-SCHEMA-PERSISTENCE). The migration review of schema v1 noted
that the forward-only approach was decided only in that spec, and recommended
recording it before migration 0002 lands so later migrations, including
destructive ones, follow a policy the user actually chose (DECOMP-PROJECT Q-031).

## Decision
Schema migrations are forward-only. Each migration has an `up` step and no `down`
step; it runs in its own transaction together with its `user_version` bump. A
migration that has been merged to `main` is never edited; any change ships as a
new, higher-numbered migration. SIM refuses to open a dataset whose version is
newer than the build. Opening an older dataset migrates it forward in memory; the
file on disk changes only when the user saves.

## Alternatives considered
- **Reversible migrations with `down` steps** — not chosen: datasets are files the
  user keeps; recovery from a bad upgrade is the unsaved original file, not an
  in-app downgrade path.

## Consequences
Released datasets keep a stable meaning for each version number. Every schema
change needs a new migration and tests, even small corrections. A dataset saved by
a newer SIM cannot be opened by an older build.

## Risks
A destructive migration (dropping or narrowing data) would be irreversible once
the user saves; such a migration needs explicit review and a clear warning before
save. If users need to hand datasets to people on older SIM builds, this decision
should be revisited.
