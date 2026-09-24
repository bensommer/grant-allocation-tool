---
name: GitHub push + Jira sync from the sandbox
description: How code reaches bensommer/grant-allocation-tool and how Jira stories are transitioned; pitfalls hit on 2026-09-23.
---
- No git token is available in the shell; push by committing locally, then replaying the commit onto GitHub via the Git Data API (Octokit from listConnections("github") inside "use impure": createBlob per changed file → createTree with base_tree → createCommit → updateRef). An empty repo rejects the Git Data API — seed one file via the Contents API first.
- The GitHub connection lacks the `workflow` OAuth scope: any tree containing `.github/workflows/*` fails with a 404 on createTree, and pushing the YAML via the Contents API through the connector proxy gets blocked by Cloudflare. CI YAML must be pushed by the user manually.
- Jira (cloudId 5fe4b259-a659-4a52-adda-a4d488c3f702) transition ids: 11 To Do, 21 In Progress, 31 In Review, 41 Done. Comments use ADF via /rest/api/3/issue/{key}/comment.
- **Why:** repeating discovery costs several failed API rounds each session.
- Notebook-persisted helper functions that wrap "use impure" bodies can fail later with `executeJs is not defined`; redefine the helper in the same CodeExecution call instead of relying on earlier definitions.

## Parallel subagent split for stories
Splitting two Jira stories across two general subagents with explicit file ownership (and "do not
run the full test suite / restart the workflow") worked cleanly for JPH-11/12; shared pieces
(exports for BvA) were wired by the main agent afterwards via a small generic helper.
