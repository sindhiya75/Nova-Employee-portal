ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS "ProjectHeadUserId" INT REFERENCES "Users"("UserId");

CREATE TABLE IF NOT EXISTS "ProjectHeadHistory" (
  "HistoryId" SERIAL PRIMARY KEY,
  "ProjectId" INT NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
  "OldHeadUserId" INT REFERENCES "Users"("UserId"),
  "NewHeadUserId" INT REFERENCES "Users"("UserId"),
  "TransferMode" VARCHAR(40) NOT NULL DEFAULT 'access_only',
  "EffectiveAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "ChangedByUserId" INT REFERENCES "Users"("UserId"),
  "Remarks" TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_head_history_project ON "ProjectHeadHistory"("ProjectId", "EffectiveAt" DESC);

UPDATE "Projects" p
SET "ProjectHeadUserId" = upa."UserId"
FROM "UserProjectAccess" upa
JOIN "Users" u ON u."UserId" = upa."UserId" AND u."Role"='Manager'
WHERE p."ProjectId" = upa."ProjectId"
  AND p."ProjectHeadUserId" IS NULL;
