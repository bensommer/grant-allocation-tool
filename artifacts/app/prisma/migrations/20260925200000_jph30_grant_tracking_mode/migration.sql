-- JPH-30: record which pipeline produces a grant's figures. Additive: a new enum and a
-- defaulted column, backfilled from the membership signals already in the data
-- (member classes / projects, member lines, a report import scoped to the grant).
CREATE TYPE "TrackingMode" AS ENUM ('crosswalk', 'membership');

ALTER TABLE "Grant" ADD COLUMN "trackingMode" "TrackingMode" NOT NULL DEFAULT 'crosswalk';

UPDATE "Grant" g
SET "trackingMode" = 'membership'
WHERE cardinality(g."memberClassIds") > 0
   OR cardinality(g."memberPartyIds") > 0
   OR EXISTS (SELECT 1 FROM "GrantMembership" m WHERE m."grantId" = g."id")
   OR EXISTS (SELECT 1 FROM "ImportBatch" b WHERE b."scopeGrantId" = g."id")
   OR EXISTS (SELECT 1 FROM "QboReportUpload" u WHERE u."grantId" = g."id");
