-- JPH-30 follow-up: the first backfill counted every QboReportUpload, including reports that
-- were only staged and never imported. A staged upload is not a membership signal. Put such
-- grants back on crosswalk when nothing else says membership. Data-only; no schema change.
UPDATE "Grant" g
SET "trackingMode" = 'crosswalk'
WHERE g."trackingMode" = 'membership'
  AND cardinality(g."memberClassIds") = 0
  AND cardinality(g."memberPartyIds") = 0
  AND NOT EXISTS (SELECT 1 FROM "GrantMembership" m WHERE m."grantId" = g."id")
  AND NOT EXISTS (SELECT 1 FROM "ImportBatch" b WHERE b."scopeGrantId" = g."id")
  AND NOT EXISTS (SELECT 1 FROM "QboReportUpload" u WHERE u."grantId" = g."id" AND u."batchId" IS NOT NULL);
