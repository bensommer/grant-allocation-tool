# Build decisions (from chat with Ben, 2026-09-23)

- Source of truth: Jira epic JPH-3 (gravitasiq.atlassian.net), cloudId 5fe4b259-a659-4a52-adda-a4d488c3f702. Full text in docs/jira-epic-JPH-3-spec.txt.
- Do stories JPH-4..JPH-13 and JPH-15. SKIP JPH-14 (live QBO connector).
- JPH-15: build CSV side fully; QBO-specific parts (CDC sync, TrialBalance report pull) are clearly-marked stubs behind the DataSource interface; note this in the Jira ticket.
- GitHub: bensommer/grant-allocation-tool (private).
- Jira: transition each story To Do -> In Progress -> Done and comment with the PR/commit link.
- Anthropic: Ben has ANTHROPIC_API_KEY; request it as a project secret when JPH-13 starts. NARRATIVE_MODEL from env.
- Styling: Tailwind (document in README). Rounding: integer cents, largest remainder, ties to lowest target sort order.
- Developer uses tcsh: README snippets must be tcsh-compatible or npm scripts.
- Golden suite (fixtures/demo/expected.json) is the gate for stories 07/08/09.

## Post-review hardening (JPH-8..10)

- Recompute is serialized per org with `pg_advisory_xact_lock` for the whole pipeline; if the config
  hash differs at promotion time the new run is promoted but flagged stale immediately. A partial
  unique index (one current run per org) was considered and dropped because Prisma cannot express it
  and `migrate dev` would generate a migration removing it.
- Rule previews run the real engine over the date range with the candidate rule inserted (or
  replacing the rule being edited) and count the pieces it actually wins, so the preview total equals
  the rule's contribution after recompute. `contested` counts pieces lost to a priority tie.
- Every id submitted from a form (programs, accounts, classes, locations, parties, grants, budget
  lines) is checked against the org in the service layer (`src/services/refs.ts`).
- Known limitation: a changed re-import updates source lines in place and marks the current run
  stale; historical runs are not snapshotted, so `/runs/[id]/diff` against a pre-import run reflects
  the new source amounts.
