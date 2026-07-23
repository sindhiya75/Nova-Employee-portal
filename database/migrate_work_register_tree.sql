ALTER TABLE "WorkItems" ADD COLUMN IF NOT EXISTS "UpdatedBy" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL;
ALTER TABLE "WorkItems" ADD COLUMN IF NOT EXISTS "VersionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkItems" ADD COLUMN IF NOT EXISTS "IsArchived" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "WorkItems" ADD COLUMN IF NOT EXISTS "ArchivedAt" TIMESTAMPTZ;
ALTER TABLE "WorkItems" ADD COLUMN IF NOT EXISTS "ArchivedBy" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL;

ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "WorkPathSnapshot" TEXT;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "WorkItemCodeSnapshot" VARCHAR(80);
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "WorkItemNameSnapshot" VARCHAR(180);
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "WorkItemLevelSnapshot" VARCHAR(30);

CREATE INDEX IF NOT EXISTS "IX_WorkItems_CreatedBy" ON "WorkItems"("CreatedBy");
CREATE INDEX IF NOT EXISTS "IX_WorkItems_Archived" ON "WorkItems"("IsArchived");

WITH RECURSIVE work_paths AS (
  SELECT wi."WorkItemId", wi."WorkName"::text AS "WorkPath"
  FROM "WorkItems" wi
  WHERE wi."ParentWorkItemId" IS NULL
  UNION ALL
  SELECT child."WorkItemId", parent."WorkPath" || ' / ' || child."WorkName"
  FROM "WorkItems" child
  JOIN work_paths parent ON parent."WorkItemId" = child."ParentWorkItemId"
)
UPDATE "Tasks" task
SET "WorkPathSnapshot" = COALESCE(task."WorkPathSnapshot", path."WorkPath"),
    "WorkItemCodeSnapshot" = COALESCE(task."WorkItemCodeSnapshot", work."WorkItemCode"),
    "WorkItemNameSnapshot" = COALESCE(task."WorkItemNameSnapshot", work."WorkName"),
    "WorkItemLevelSnapshot" = COALESCE(task."WorkItemLevelSnapshot", work."LevelType")
FROM "WorkItems" work
LEFT JOIN work_paths path ON path."WorkItemId" = work."WorkItemId"
WHERE task."WorkItemId" = work."WorkItemId";

UPDATE "WorkItems" work
SET "CreatedBy" = source."UserId"
FROM (
  SELECT DISTINCT ON (audit."WorkItemId") audit."WorkItemId", audit."UserId"
  FROM "AuditLogs" audit
  WHERE audit."WorkItemId" IS NOT NULL AND audit."UserId" IS NOT NULL
  ORDER BY audit."WorkItemId", audit."CreatedAt"
) source
WHERE work."WorkItemId" = source."WorkItemId" AND work."CreatedBy" IS NULL;
