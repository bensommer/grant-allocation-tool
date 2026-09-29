---
name: .replit-artifact/artifact.toml must stay tracked
description: Ignoring or untracking the app's artifact.toml de-registers the artifact and deletes its workflow.
---
- Rule: never add `.replit-artifact/` to .gitignore or `git rm --cached` an artifact.toml. Replit's artifact discovery skips git-ignored paths: the moment it was ignored (2026-09-28) the "Grant Allocation Tool" artifact and the `artifacts/app: web` workflow disappeared, even though the file stayed on disk.
- Recovery: revert the ignore, then call `verifyAndReplaceArtifactToml` with an identical temp copy — that re-registers the artifact and recreates the workflow (touching the file does not). The first restart after that can exceed 30 s while `/` compiles; use a longer workflow timeout.
- **Why:** the toml is the only definition of the dev command, port and production build/start; the deployment log's "artifact manifest discovery" also reads it.
