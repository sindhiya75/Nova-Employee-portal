DROP TABLE IF EXISTS "TaskImages" CASCADE;
DROP TABLE IF EXISTS "TaskProgress" CASCADE;
DROP TABLE IF EXISTS "AttendanceLogs" CASCADE;
DROP TABLE IF EXISTS "Tasks" CASCADE;
DROP TABLE IF EXISTS "SubWorks" CASCADE;
DROP TABLE IF EXISTS "Projects" CASCADE;
DROP TABLE IF EXISTS "Employees" CASCADE;
DROP TABLE IF EXISTS "Clients" CASCADE;
DROP TABLE IF EXISTS "Users" CASCADE;

CREATE TABLE "Users" (
    "UserId" SERIAL PRIMARY KEY,
    "Name" VARCHAR(120) NOT NULL,
    "Email" VARCHAR(160) NOT NULL UNIQUE,
    "Role" VARCHAR(30) NOT NULL DEFAULT 'Employee',
    "PasswordHash" VARCHAR(255),
    "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Clients" (
    "ClientId" SERIAL PRIMARY KEY,
    "ClientName" VARCHAR(160) NOT NULL,
    "ContactPerson" VARCHAR(120),
    "Email" VARCHAR(160),
    "Phone" VARCHAR(40),
    "Address" VARCHAR(300),
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ
);

CREATE TABLE "Employees" (
    "EmployeeId" SERIAL PRIMARY KEY,
    "EmployeeName" VARCHAR(140) NOT NULL,
    "Email" VARCHAR(160),
    "Phone" VARCHAR(40),
    "Designation" VARCHAR(100),
    "Department" VARCHAR(100),
    "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ
);


CREATE TABLE "AttendanceLogs" (
    "AttendanceId" SERIAL PRIMARY KEY,
    "EmployeeId" INTEGER NOT NULL REFERENCES "Employees"("EmployeeId") ON DELETE CASCADE,
    "AttendanceDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "CheckInTime" TIMESTAMPTZ,
    "CheckOutTime" TIMESTAMPTZ,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'Present',
    "Remarks" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ,
    CONSTRAINT "UQ_AttendanceLogs_Employee_Date" UNIQUE ("EmployeeId", "AttendanceDate"),
    CONSTRAINT "CK_AttendanceLogs_Status" CHECK ("Status" IN ('Present', 'Absent', 'Late', 'Leave'))
);
CREATE TABLE "Projects" (
    "ProjectId" SERIAL PRIMARY KEY,
    "ProjectName" VARCHAR(180) NOT NULL,
    "ClientId" INTEGER NOT NULL REFERENCES "Clients"("ClientId"),
    "Package" VARCHAR(120),
    "Location" VARCHAR(180),
    "StartDate" DATE,
    "EndDate" DATE,
    "Description" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ
);

CREATE TABLE "SubWorks" (
    "SubWorkId" SERIAL PRIMARY KEY,
    "ProjectId" INTEGER NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
    "ParentSubWorkId" INTEGER REFERENCES "SubWorks"("SubWorkId") ON DELETE SET NULL,
    "SubWorkName" VARCHAR(180) NOT NULL,
    "Description" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ
);

CREATE TABLE "Tasks" (
    "TaskId" SERIAL PRIMARY KEY,
    "TaskName" VARCHAR(180) NOT NULL,
    "Description" TEXT,
    "ProjectId" INTEGER NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
    "SubWorkId" INTEGER REFERENCES "SubWorks"("SubWorkId") ON DELETE SET NULL,
    "AssignedEmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL,
    "Priority" VARCHAR(30) NOT NULL DEFAULT 'Medium',
    "StartDate" DATE,
    "FinishDate" DATE,
    "PlannedQuantity" NUMERIC(18,2),
    "Unit" VARCHAR(30),
    "Remarks" TEXT,
    "Status" VARCHAR(30) NOT NULL DEFAULT 'Open',
    "ProgressPercent" NUMERIC(5,2) NOT NULL DEFAULT 0,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ,
    CONSTRAINT "CK_Tasks_Status" CHECK ("Status" IN ('Open', 'Running', 'Closed')),
    CONSTRAINT "CK_Tasks_Priority" CHECK ("Priority" IN ('Low', 'Medium', 'High', 'Critical'))
);

CREATE TABLE "TaskProgress" (
    "ProgressId" SERIAL PRIMARY KEY,
    "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
    "EmployeeId" INTEGER REFERENCES "Employees"("EmployeeId") ON DELETE SET NULL,
    "WorkDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "TodayQuantity" NUMERIC(18,2),
    "TodayProgressPercent" NUMERIC(5,2) NOT NULL DEFAULT 0,
    "Remarks" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TaskImages" (
    "ImageId" SERIAL PRIMARY KEY,
    "TaskId" INTEGER NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
    "ProgressId" INTEGER REFERENCES "TaskProgress"("ProgressId") ON DELETE CASCADE,
    "ImageType" VARCHAR(40) NOT NULL,
    "FilePath" VARCHAR(500) NOT NULL,
    "OriginalName" VARCHAR(260),
    "MimeType" VARCHAR(120),
    "UploadedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_TaskImages_Type" CHECK ("ImageType" IN ('ReferenceImage', 'ReferenceDrawing', 'ReferencePdf', 'Before', 'Progress', 'Completion'))
);

CREATE INDEX "IX_AttendanceLogs_Date" ON "AttendanceLogs"("AttendanceDate");
CREATE INDEX "IX_AttendanceLogs_EmployeeId" ON "AttendanceLogs"("EmployeeId");
CREATE INDEX "IX_Projects_ClientId" ON "Projects"("ClientId");
CREATE INDEX "IX_SubWorks_ProjectId" ON "SubWorks"("ProjectId");
CREATE INDEX "IX_Tasks_ProjectId" ON "Tasks"("ProjectId");
CREATE INDEX "IX_Tasks_AssignedEmployeeId" ON "Tasks"("AssignedEmployeeId");
CREATE INDEX "IX_TaskProgress_TaskId" ON "TaskProgress"("TaskId");
CREATE INDEX "IX_TaskImages_TaskId" ON "TaskImages"("TaskId");


