---
name: GitHub push + Jira sync from the sandbox
description: How code reaches bensommer/grant-allocation-tool and how Jira stories are transitioned; pitfalls hit on 2026-09-23.
---
- No git token is available in the shell; push by committing locally, then replaying the commit onto GitHub via the Git Data API (Octokit from listConnections("github") inside "use impure": createBlob per changed file → createTree with base_tree → createCommit → updateRef). An empty repo rejects the Git Data API — seed one file via the Contents API first.
- The GitHub connection lacks the `workflow` OAuth scope: any tree containing `.github/workflows/*` fails with a 404 on createTree, and pushing the YAML via the Contents API through the connector proxy gets blocked by Cloudflare. CI YAML must be pushed by the user manually.
- Jira (cloudId 5fe4b259-a659-4a52-adda-a4d488c3f702) transition ids: 11 To Do, 21 In Progress, 31 In Review, 41 Done. Comments use ADF via /rest/api/3/issue/{key}/comment.
- Jira proxyFetch paths must be prefixed with `/ex/jira/<cloudId>` (base is api.atlassian.com); a bare `/rest/api/3/...` returns a Spring-style 404, not an auth error.
- Replit platform refs (refs/heads/replit-agent, refs/replit/agent-ledger, gitsafe-backup) keep every local commit reachable; squashing `main` does not purge a commit from them. Tree-replay pushes never carry history, so that is acceptable — never push all refs/--mirror.
- **Why:** repeating discovery costs several failed API rounds each session.
- Task-agent merges land on local `main` only: GitHub is not pushed and the Jira story stays "To Do" with no comment. Closing a ticket means replaying that ticket's merge commit tree (`git show <sha>:<path>`, not the working tree, when later phases are already merged on top), then commenting AC→test + verification and transitioning to Done — the same shape as the JPH-20/21 comments.
- Same applies to work done directly on `main` when a session ends early: a ticket can be fully committed locally while GitHub and Jira still show the previous phase. Before re-implementing a ticket, diff `git log` against the remote head and the Jira status; closing out (push + comment + transition) may be all that is left.
- Notebook-persisted helper functions that wrap "use impure" bodies can fail later with `executeJs is not defined`; redefine the helper in the same CodeExecution call instead of relying on earlier definitions.

## Parallel subagents share one dev DB
Two subagents running DB tests / demo restores concurrently created duplicate Org rows and flaky
e2e runs. Either serialize DB-touching verification or have the main agent do the final restore
and full test pass itself.

## Pushing binaries (PNG baselines, woff2)
Read files with node:fs inside the "use impure" function and base64 there; passing base64 through
the durable scope blows the 3 MB per-block budget. Parse `git diff --name-status -z` (tabs are lost
in shellExec output).
- After every push, verify by comparing `git ls-tree -r HEAD` blob shas against the remote recursive tree;
  a per-commit-range replay once silently skipped a file (programs/labels.ts) and the remote wouldn't build.
- shellExec output carries `\r` at line ends: strip it from every parsed path before fs.readFile inside the impure block, or reads fail with ENOENT on a path that plainly exists.
- createCommit can return "Tree SHA does not exist" immediately after createTree (eventual consistency); retry with backoff instead of rebuilding the tree.
