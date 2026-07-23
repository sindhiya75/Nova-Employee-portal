ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "DateOfJoining" DATE;
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "BirthDate" DATE;
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "AlternatePhone" VARCHAR(40);
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "Gender" VARCHAR(30);
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "Allergy" TEXT;
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "PrimaryProjectId" INTEGER REFERENCES "Projects"("ProjectId") ON DELETE SET NULL;
ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "ReportingManagerUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL;

ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "ClientId" INTEGER REFERENCES "Clients"("ClientId") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IX_Employees_PrimaryProjectId" ON "Employees"("PrimaryProjectId");
CREATE INDEX IF NOT EXISTS "IX_Employees_ReportingManager" ON "Employees"("ReportingManagerUserId");
CREATE INDEX IF NOT EXISTS "IX_Users_ClientId" ON "Users"("ClientId");

UPDATE "Employees" employee
SET "PrimaryProjectId" = source."ProjectId",
    "DepartmentId" = COALESCE(source."DepartmentId", employee."DepartmentId"),
    "Department" = COALESCE(department."DepartmentName", employee."Department")
FROM (
  SELECT DISTINCT ON ("AssignedEmployeeId") "AssignedEmployeeId", "ProjectId", "DepartmentId"
  FROM "Tasks"
  WHERE "AssignedEmployeeId" IS NOT NULL
  ORDER BY "AssignedEmployeeId", COALESCE("UpdatedAt", "CreatedAt") DESC
) source
LEFT JOIN "Departments" department ON department."DepartmentId"=source."DepartmentId"
WHERE employee."EmployeeId" = source."AssignedEmployeeId";

UPDATE "Departments"
SET "DepartmentCode" = 'DEPT-PRJ' || LPAD(COALESCE("ProjectId", 0)::text, 3, '0') || '-' || LPAD("DepartmentId"::text, 4, '0')
WHERE "DepartmentCode" IS NULL OR BTRIM("DepartmentCode") = '';
