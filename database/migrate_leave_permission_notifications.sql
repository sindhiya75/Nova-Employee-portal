ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "ReportingManagerUserId" INT REFERENCES "Users"("UserId");
ALTER TABLE "Clients" ADD COLUMN IF NOT EXISTS "ClientCode" VARCHAR(40);
ALTER TABLE "AttendanceLogs" ADD COLUMN IF NOT EXISTS "AttendanceCode" VARCHAR(50);

CREATE TABLE IF NOT EXISTS "LeavePermissionRequests" (
  "RequestId" SERIAL PRIMARY KEY,
  "RequestCode" VARCHAR(50) UNIQUE,
  "RequestType" VARCHAR(30) NOT NULL,
  "EmployeeId" INT NOT NULL REFERENCES "Employees"("EmployeeId") ON DELETE CASCADE,
  "ProjectId" INT REFERENCES "Projects"("ProjectId"),
  "DepartmentId" INT REFERENCES "Departments"("DepartmentId"),
  "ReportingManagerUserId" INT REFERENCES "Users"("UserId"),
  "FromDate" DATE,
  "ToDate" DATE,
  "HalfDaySession" VARCHAR(20),
  "PermissionDate" DATE,
  "FromTime" TIME,
  "ToTime" TIME,
  "Reason" TEXT NOT NULL,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
  "ManagerRemarks" TEXT,
  "ApprovedByUserId" INT REFERENCES "Users"("UserId"),
  "ApprovedAt" TIMESTAMP,
  "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_permission_employee ON "LeavePermissionRequests"("EmployeeId");
CREATE INDEX IF NOT EXISTS idx_leave_permission_manager ON "LeavePermissionRequests"("ReportingManagerUserId");
CREATE INDEX IF NOT EXISTS idx_leave_permission_status ON "LeavePermissionRequests"("Status");

WITH numbered AS (SELECT "ClientId", 'CLT-2026-' || LPAD(ROW_NUMBER() OVER (ORDER BY "ClientId")::text, 4, '0') AS code FROM "Clients")
UPDATE "Clients" c SET "ClientCode"=n.code FROM numbered n WHERE n."ClientId"=c."ClientId" AND c."ClientCode" IS NULL;

UPDATE "AttendanceLogs" SET "AttendanceCode" = 'ATT-' || TO_CHAR("AttendanceDate", 'YYYYMMDD') || '-' || LPAD("AttendanceId"::text, 4, '0') WHERE "AttendanceCode" IS NULL;

UPDATE "Employees" e SET "ReportingManagerUserId" = u."UserId"
FROM "Users" u
WHERE u."Role"='Manager' AND e."ReportingManagerUserId" IS NULL;
