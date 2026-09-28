-- JPH-29 E4: first-grant setup wizard state (additive).
CREATE TABLE "GrantDraft" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "grantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrantDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GrantDraft_token_key" ON "GrantDraft"("token");
CREATE INDEX "GrantDraft_orgId_idx" ON "GrantDraft"("orgId");
