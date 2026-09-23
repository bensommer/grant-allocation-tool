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
