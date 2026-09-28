#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Template drizzle schema (lib/db) used by the api-server artifact.
pnpm --filter db push
# The grant app owns its schema through Prisma migrations. Task-agent merges
# land migration files on main without applying them; publishing derives the
# production schema change from the development database, so the dev DB must
# be migrated here or production ends up missing the new tables.
pnpm --filter @workspace/app run db:migrate
pnpm --filter @workspace/app run db:generate
