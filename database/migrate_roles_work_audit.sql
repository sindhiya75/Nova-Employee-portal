CREATE TABLE IF NOT EXISTS "Departments" (
  "DepartmentId" SERIAL PRIMARY KEY,
  "DepartmentCode" VARCHAR(40) NOT NULL UNIQUE,
  "ProjectId" INTEGER REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
  "DepartmentName" VARCHAR(140) NOT NULL,
  "DepartmentHeadId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL,
  "Description" TEXT,
  "Status" VARCHAR(30) NOT NULL DEFAULT 'Active',
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "WorkItems" (
  "WorkItemId" SERIAL PRIMARY KEY,
  "WorkItemCode" VARCHAR(80) NOT NULL UNIQUE,
  "ProjectId" INTEGER NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
  "DepartmentId" INTEGER REFERENCES "Departments"("DepartmentId") ON DELETE SET NULL,
  "ParentWorkItemId" INTEGER REFERENCES "WorkItems"("WorkItemId") ON DELETE CASCADE,
  "LevelType" VARCHAR(30) NOT NULL,
  "WorkName" VARCHAR(180) NOT NULL,
  "Description" TEXT,
  "SortOrder" INTEGER NOT NULL DEFAULT 0,
  "Status" VARCHAR(30) NOT NULL DEFAULT 'Active',
  "CreatedBy" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMPTZ,
  CONSTRAINT "CK_WorkItems_LevelType" CHECK ("LevelType" IN ('ParentWork', 'MainWork', 'SubTask', 'Task', 'LeastTask')),
  CONSTRAINT "UQ_WorkItems_Level_Name" UNIQUE ("ProjectId", "DepartmentId", "ParentWorkItemId", "LevelType", "WorkName")
);

CREATE TABLE IF NOT EXISTS "AuditLogs" (
  "AuditId" SERIAL PRIMARY KEY,
  "AuditCode" VARCHAR(80) UNIQUE,
  "UserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL,
  "EmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL,
  "UserRole" VARCHAR(40),
  "ActionType" VARCHAR(60) NOT NULL,
  "ModuleName" VARCHAR(80) NOT NULL,
  "RecordType" VARCHAR(80),
  "RecordId" INTEGER,
  "RecordCode" VARCHAR(120),
  "ProjectId" INTEGER REFERENCES "Projects"("ProjectId") ON DELETE SET NULL,
  "DepartmentId" INTEGER REFERENCES "Departments"("DepartmentId") ON DELETE SET NULL,
  "WorkItemId" INTEGER REFERENCES "WorkItems"("WorkItemId") ON DELETE SET NULL,
  "TaskId" INTEGER REFERENCES "Tasks"("TaskId") ON DELETE SET NULL,
  "OldValue" JSONB,
  "NewValue" JSONB,
  "Description" TEXT,
  "IpAddress" VARCHAR(80),
  "UserAgent" TEXT,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "UserCode" VARCHAR(60);
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "EmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL;
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "LastLoginAt" TIMESTAMPTZ;
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "UpdatedAt" TIMESTAMPTZ;
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "EmployeeCode" VARCHAR(60);
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "DepartmentId" INTEGER REFERENCES "Departments"("DepartmentId") ON DELETE SET NULL;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "TaskCode" VARCHAR(100);
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "DepartmentId" INTEGER REFERENCES "Departments"("DepartmentId") ON DELETE SET NULL;
ALTER TABLE "Tasks" ADD COLUMN IF NOT EXISTS "WorkItemId" INTEGER REFERENCES "WorkItems"("WorkItemId") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IX_Departments_ProjectId" ON "Departments"("ProjectId");
CREATE INDEX IF NOT EXISTS "IX_WorkItems_Project_Department" ON "WorkItems"("ProjectId", "DepartmentId");
CREATE INDEX IF NOT EXISTS "IX_WorkItems_Parent" ON "WorkItems"("ParentWorkItemId");
CREATE INDEX IF NOT EXISTS "IX_AuditLogs_CreatedAt" ON "AuditLogs"("CreatedAt");
CREATE INDEX IF NOT EXISTS "IX_Tasks_DepartmentId" ON "Tasks"("DepartmentId");
CREATE INDEX IF NOT EXISTS "IX_Tasks_WorkItemId" ON "Tasks"("WorkItemId");

WITH first_project AS (SELECT "ProjectId" FROM "Projects" ORDER BY "ProjectId" LIMIT 1), dept_seed AS (
  SELECT * FROM (VALUES
    ('DEPT-EXEC-001', 'Execution'),
    ('DEPT-QAQC-001', 'QA/QC'),
    ('DEPT-HSE-001', 'HSE'),
    ('DEPT-SURV-001', 'Survey'),
    ('DEPT-PLAN-001', 'Planning'),
    ('DEPT-STORE-001', 'Stores'),
    ('DEPT-PLANT-001', 'Plant & Machinery')
  ) AS v(code, name)
)
INSERT INTO "Departments" ("DepartmentCode", "ProjectId", "DepartmentName", "Description")
SELECT ds.code, fp."ProjectId", ds.name, ds.name || ' department'
FROM dept_seed ds CROSS JOIN first_project fp
WHERE NOT EXISTS (SELECT 1 FROM "Departments" d WHERE d."DepartmentCode" = ds.code);

UPDATE "Employees" e SET "EmployeeCode" = COALESCE(e."EmployeeCode", 'EMP-' || LPAD(e."EmployeeId"::text, 4, '0'));
UPDATE "Employees" e SET "DepartmentId" = d."DepartmentId"
FROM "Departments" d
WHERE e."DepartmentId" IS NULL AND (
  (e."Department" ILIKE '%Execution%' AND d."DepartmentName"='Execution') OR
  (e."Department" ILIKE '%Quality%' AND d."DepartmentName"='QA/QC') OR
  (e."Department" ILIKE '%HSE%' AND d."DepartmentName"='HSE') OR
  (e."Department" ILIKE '%Survey%' AND d."DepartmentName"='Survey') OR
  (e."Department" ILIKE '%Planning%' AND d."DepartmentName"='Planning') OR
  (e."Department" ILIKE '%Store%' AND d."DepartmentName"='Stores') OR
  (e."Department" ILIKE '%Plant%' AND d."DepartmentName"='Plant & Machinery')
);
UPDATE "Employees" e SET "DepartmentId" = (SELECT "DepartmentId" FROM "Departments" WHERE "DepartmentName"='Execution' LIMIT 1) WHERE e."DepartmentId" IS NULL;

INSERT INTO "Users" ("UserCode", "Name", "Email", "Role", "PasswordHash", "EmployeeId", "IsActive")
SELECT * FROM (VALUES
  ('USR-ADMIN-001', 'Admin User', 'admin@nova.local', 'Admin', 'admin123', NULL::integer, TRUE),
  ('USR-MANAGER-001', 'Project Manager', 'manager@nova.local', 'Manager', 'manager123', NULL::integer, TRUE),
  ('USR-EMP-001', 'Employee User', 'employee@nova.local', 'Employee', 'employee123', (SELECT "EmployeeId" FROM "Employees" ORDER BY "EmployeeId" LIMIT 1), TRUE),
  ('USR-CLIENT-001', 'Client Viewer', 'client@nova.local', 'Client Viewer', 'client123', NULL::integer, TRUE)
) AS v("UserCode", "Name", "Email", "Role", "PasswordHash", "EmployeeId", "IsActive")
WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Email" = v."Email");

WITH base AS (
  SELECT p."ProjectId", d."DepartmentId"
  FROM "Projects" p CROSS JOIN "Departments" d
  WHERE d."DepartmentName"='Execution'
  ORDER BY p."ProjectId" LIMIT 1
), parent AS (
  INSERT INTO "WorkItems" ("WorkItemCode", "ProjectId", "DepartmentId", "LevelType", "WorkName", "Description")
  SELECT 'WRK-PARENT-AQ-001', "ProjectId", "DepartmentId", 'ParentWork', 'Aqueduct', 'Parent work'
  FROM base
  ON CONFLICT DO NOTHING
  RETURNING "WorkItemId", "ProjectId", "DepartmentId"
), parent_pick AS (
  SELECT "WorkItemId", "ProjectId", "DepartmentId" FROM parent
  UNION ALL
  SELECT wi."WorkItemId", wi."ProjectId", wi."DepartmentId" FROM "WorkItems" wi WHERE wi."WorkItemCode"='WRK-PARENT-AQ-001'
  LIMIT 1
), main AS (
  INSERT INTO "WorkItems" ("WorkItemCode", "ProjectId", "DepartmentId", "ParentWorkItemId", "LevelType", "WorkName", "Description")
  SELECT 'WRK-MAIN-FND-001', "ProjectId", "DepartmentId", "WorkItemId", 'MainWork', 'Foundation Work', 'Main work'
  FROM parent_pick
  ON CONFLICT DO NOTHING
  RETURNING "WorkItemId", "ProjectId", "DepartmentId"
), main_pick AS (
  SELECT "WorkItemId", "ProjectId", "DepartmentId" FROM main
  UNION ALL
  SELECT wi."WorkItemId", wi."ProjectId", wi."DepartmentId" FROM "WorkItems" wi WHERE wi."WorkItemCode"='WRK-MAIN-FND-001'
  LIMIT 1
), subtask AS (
  INSERT INTO "WorkItems" ("WorkItemCode", "ProjectId", "DepartmentId", "ParentWorkItemId", "LevelType", "WorkName", "Description")
  SELECT 'WRK-SUB-PILE-001', "ProjectId", "DepartmentId", "WorkItemId", 'SubTask', 'Pile Foundation', 'Sub task'
  FROM main_pick
  ON CONFLICT DO NOTHING
  RETURNING "WorkItemId", "ProjectId", "DepartmentId"
), sub_pick AS (
  SELECT "WorkItemId", "ProjectId", "DepartmentId" FROM subtask
  UNION ALL
  SELECT wi."WorkItemId", wi."ProjectId", wi."DepartmentId" FROM "WorkItems" wi WHERE wi."WorkItemCode"='WRK-SUB-PILE-001'
  LIMIT 1
), task_level AS (
  INSERT INTO "WorkItems" ("WorkItemCode", "ProjectId", "DepartmentId", "ParentWorkItemId", "LevelType", "WorkName", "Description")
  SELECT 'WRK-TASK-BORING-001', "ProjectId", "DepartmentId", "WorkItemId", 'Task', 'Pile Boring', 'Task level'
  FROM sub_pick
  ON CONFLICT DO NOTHING
  RETURNING "WorkItemId", "ProjectId", "DepartmentId"
)
INSERT INTO "WorkItems" ("WorkItemCode", "ProjectId", "DepartmentId", "ParentWorkItemId", "LevelType", "WorkName", "Description")
SELECT 'WRK-LEAST-P1-001', "ProjectId", "DepartmentId", "WorkItemId", 'LeastTask', 'Pile Boring at Pier P1', 'Least task'
FROM task_level
ON CONFLICT DO NOTHING;

UPDATE "Tasks" t SET "TaskCode" = COALESCE(t."TaskCode", 'TSK-' || LPAD(t."TaskId"::text, 5, '0'));
UPDATE "Tasks" t SET "DepartmentId" = e."DepartmentId"
FROM "Employees" e
WHERE t."DepartmentId" IS NULL AND e."EmployeeId" = t."AssignedEmployeeId";
UPDATE "Tasks" t SET "DepartmentId" = (SELECT "DepartmentId" FROM "Departments" WHERE "DepartmentName"='Execution' LIMIT 1) WHERE t."DepartmentId" IS NULL;
