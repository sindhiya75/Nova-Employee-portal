ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS "ProjectCode" VARCHAR(40);
ALTER TABLE "AttendanceLogs" ADD COLUMN IF NOT EXISTS "ProjectId" INT REFERENCES "Projects"("ProjectId");
ALTER TABLE "AttendanceLogs" ADD COLUMN IF NOT EXISTS "DepartmentId" INT REFERENCES "Departments"("DepartmentId");

WITH numbered AS (
  SELECT "ProjectId", 'PRJ-2026-' || LPAD(ROW_NUMBER() OVER (ORDER BY "ProjectId")::text, 4, '0') AS code
  FROM "Projects"
)
UPDATE "Projects" p SET "ProjectCode" = n.code FROM numbered n WHERE n."ProjectId" = p."ProjectId" AND p."ProjectCode" IS NULL;

UPDATE "Employees" SET "EmployeeCode" = 'EMP-2026-' || LPAD("EmployeeId"::text, 4, '0') WHERE "EmployeeCode" IS NULL OR "EmployeeCode" NOT LIKE 'EMP-2026-%';

UPDATE "AttendanceLogs" al
SET "ProjectId" = src."ProjectId", "DepartmentId" = src."DepartmentId"
FROM (
  SELECT DISTINCT ON ("AssignedEmployeeId") "AssignedEmployeeId", "ProjectId", "DepartmentId"
  FROM "Tasks"
  WHERE "AssignedEmployeeId" IS NOT NULL
  ORDER BY "AssignedEmployeeId", "UpdatedAt" DESC NULLS LAST, "CreatedAt" DESC
) src
WHERE al."EmployeeId" = src."AssignedEmployeeId" AND al."ProjectId" IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_project ON "AttendanceLogs"("ProjectId");
CREATE INDEX IF NOT EXISTS idx_attendance_department ON "AttendanceLogs"("DepartmentId");
