BEGIN;

ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletedQuantity" NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "ProgressMode" VARCHAR(20) NOT NULL DEFAULT 'Quantity';
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "BaselineStartDate" DATE;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "BaselineFinishDate" DATE;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "BaselineQuantity" NUMERIC(18,2);
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "StartedAt" TIMESTAMPTZ;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "PausedAt" TIMESTAMPTZ;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "PauseReason" TEXT;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletionStatus" VARCHAR(30) NOT NULL DEFAULT 'Not Submitted';
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletionSubmittedAt" TIMESTAMPTZ;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletionSubmittedByEmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletionReviewedAt" TIMESTAMPTZ;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletionReviewedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CompletionRemarks" TEXT;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "CreatedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL;

ALTER TABLE "Tasks" DROP CONSTRAINT IF EXISTS "CK_Tasks_Status";
ALTER TABLE "Tasks" ADD CONSTRAINT "CK_Tasks_Status" CHECK ("Status" IN ('Open','Running','Paused','Awaiting Approval','Closed'));

UPDATE "Tasks" SET
  "BaselineStartDate"=COALESCE("BaselineStartDate", "StartDate"),
  "BaselineFinishDate"=COALESCE("BaselineFinishDate", "FinishDate"),
  "BaselineQuantity"=COALESCE("BaselineQuantity", "PlannedQuantity");
UPDATE "Tasks" t SET "CompletedQuantity"=COALESCE((SELECT SUM(COALESCE(tp."TodayQuantity",0)) FROM "TaskProgress" tp WHERE tp."TaskId"=t."TaskId"),0);

CREATE TABLE IF NOT EXISTS "TaskAssignmentHistory" (
  "AssignmentHistoryId" SERIAL PRIMARY KEY, "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "PreviousEmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL, "NewEmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL,
  "ChangedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL, "ChangeReason" TEXT NOT NULL, "ProgressAtTransfer" NUMERIC(5,2), "ChangedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "TaskBaselineRevisions" (
  "RevisionId" SERIAL PRIMARY KEY, "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "OldStartDate" DATE, "NewStartDate" DATE, "OldFinishDate" DATE, "NewFinishDate" DATE, "OldQuantity" NUMERIC(18,2), "NewQuantity" NUMERIC(18,2),
  "Reason" TEXT NOT NULL, "CreatedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL, "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "TaskDependencies" (
  "DependencyId" SERIAL PRIMARY KEY, "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "DependsOnTaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE, "DependencyType" VARCHAR(20) NOT NULL DEFAULT 'Finish-to-Start',
  "LagDays" INTEGER NOT NULL DEFAULT 0, "CreatedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL, "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UQ_TaskDependency" UNIQUE ("TaskId", "DependsOnTaskId"), CONSTRAINT "CK_TaskDependencySelf" CHECK ("TaskId" <> "DependsOnTaskId")
);
CREATE TABLE IF NOT EXISTS "TaskCheckpoints" (
  "CheckpointId" SERIAL PRIMARY KEY, "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "CheckpointType" VARCHAR(20) NOT NULL, "Title" VARCHAR(180) NOT NULL, "IsMandatory" BOOLEAN NOT NULL DEFAULT TRUE,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'Pending', "Remarks" TEXT, "ReviewedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL,
  "ReviewedAt" TIMESTAMPTZ, "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "TaskComments" (
  "CommentId" SERIAL PRIMARY KEY, "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "UserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL, "EmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL,
  "CommentText" TEXT NOT NULL, "IsInstruction" BOOLEAN NOT NULL DEFAULT FALSE, "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "TaskCompletionReviews" (
  "ReviewId" SERIAL PRIMARY KEY, "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "SubmittedByEmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL, "SubmittedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SubmissionRemarks" TEXT, "Decision" VARCHAR(20) NOT NULL DEFAULT 'Pending', "ReviewedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL,
  "ReviewedAt" TIMESTAMPTZ, "ReviewRemarks" TEXT
);

CREATE INDEX IF NOT EXISTS "IX_Tasks_V2_Filter" ON "Tasks"("ProjectId","DepartmentId","Status","FinishDate");
CREATE INDEX IF NOT EXISTS "IX_TaskAssignmentHistory_Task" ON "TaskAssignmentHistory"("TaskId","ChangedAt" DESC);
CREATE INDEX IF NOT EXISTS "IX_TaskComments_Task" ON "TaskComments"("TaskId","CreatedAt" DESC);
CREATE INDEX IF NOT EXISTS "IX_TaskCompletionReviews_Task" ON "TaskCompletionReviews"("TaskId","SubmittedAt" DESC);
COMMIT;
