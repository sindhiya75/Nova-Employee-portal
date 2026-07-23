-- Site Monitoring module: daily output, labour, material, machinery, and hindrance tracking.
BEGIN;

CREATE TABLE IF NOT EXISTS "Materials" (
  "MaterialId" SERIAL PRIMARY KEY,
  "MaterialCode" VARCHAR(40) NOT NULL UNIQUE,
  "MaterialName" VARCHAR(160) NOT NULL,
  "Unit" VARCHAR(30) NOT NULL DEFAULT 'nos',
  "MinimumStock" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "Machinery" (
  "MachineryId" SERIAL PRIMARY KEY,
  "MachineryCode" VARCHAR(40) NOT NULL UNIQUE,
  "MachineryName" VARCHAR(160) NOT NULL,
  "MachineryType" VARCHAR(80),
  "RegistrationNo" VARCHAR(80),
  "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "DailyWorkLogs" (
  "DailyWorkLogId" SERIAL PRIMARY KEY,
  "DailyWorkLogCode" VARCHAR(50) NOT NULL UNIQUE,
  "ProjectId" INTEGER NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
  "DepartmentId" INTEGER REFERENCES "Departments"("DepartmentId") ON DELETE SET NULL,
  "WorkItemId" INTEGER REFERENCES "WorkItems"("WorkItemId") ON DELETE SET NULL,
  "TaskId" INTEGER REFERENCES "Tasks"("TaskId") ON DELETE SET NULL,
  "LogDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "Shift" VARCHAR(20) NOT NULL DEFAULT 'Day',
  "LocationName" VARCHAR(180),
  "ChainageFrom" VARCHAR(60),
  "ChainageTo" VARCHAR(60),
  "Weather" VARCHAR(80),
  "PlannedQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "PreviousCumulativeQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "CompletedQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "CumulativeQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "BalanceQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "Unit" VARCHAR(30) NOT NULL DEFAULT 'm',
  "ProgressPercent" NUMERIC(6,2) NOT NULL DEFAULT 0,
  "Status" VARCHAR(30) NOT NULL DEFAULT 'Submitted',
  "Remarks" TEXT,
  "SubmittedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMPTZ,
  CONSTRAINT "CK_DailyWorkLogs_Shift" CHECK ("Shift" IN ('Day','Night','Both')),
  CONSTRAINT "CK_DailyWorkLogs_Status" CHECK ("Status" IN ('Draft','Submitted','Approved','Rejected'))
);

CREATE TABLE IF NOT EXISTS "DailyLabourUsage" (
  "LabourUsageId" SERIAL PRIMARY KEY,
  "DailyWorkLogId" INTEGER NOT NULL REFERENCES "DailyWorkLogs"("DailyWorkLogId") ON DELETE CASCADE,
  "SupervisorCount" INTEGER NOT NULL DEFAULT 0,
  "EngineerCount" INTEGER NOT NULL DEFAULT 0,
  "SkilledCount" INTEGER NOT NULL DEFAULT 0,
  "UnskilledCount" INTEGER NOT NULL DEFAULT 0,
  "OperatorCount" INTEGER NOT NULL DEFAULT 0,
  "HelperCount" INTEGER NOT NULL DEFAULT 0,
  "TotalLabour" INTEGER NOT NULL DEFAULT 0,
  "WorkingHours" NUMERIC(10,2) NOT NULL DEFAULT 8,
  "OvertimeHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "Mandays" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "ContractorName" VARCHAR(160),
  "Remarks" TEXT,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DailyMaterialUsage" (
  "MaterialUsageId" SERIAL PRIMARY KEY,
  "DailyWorkLogId" INTEGER NOT NULL REFERENCES "DailyWorkLogs"("DailyWorkLogId") ON DELETE CASCADE,
  "MaterialId" INTEGER REFERENCES "Materials"("MaterialId") ON DELETE SET NULL,
  "MaterialNameSnapshot" VARCHAR(160) NOT NULL,
  "Unit" VARCHAR(30) NOT NULL,
  "OpeningStock" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "ReceivedQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "IssuedQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "ConsumedQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "WastageQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "BalanceStock" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "SupplierName" VARCHAR(160),
  "InvoiceNo" VARCHAR(120),
  "Remarks" TEXT,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DailyMachineryUsage" (
  "MachineryUsageId" SERIAL PRIMARY KEY,
  "DailyWorkLogId" INTEGER NOT NULL REFERENCES "DailyWorkLogs"("DailyWorkLogId") ON DELETE CASCADE,
  "MachineryId" INTEGER REFERENCES "Machinery"("MachineryId") ON DELETE SET NULL,
  "MachineryNameSnapshot" VARCHAR(160) NOT NULL,
  "OperatorName" VARCHAR(140),
  "WorkingHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "IdleHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "BreakdownHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "FuelConsumed" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "OutputQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "Status" VARCHAR(30) NOT NULL DEFAULT 'Working',
  "Remarks" TEXT,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CK_DailyMachineryUsage_Status" CHECK ("Status" IN ('Working','Idle','Breakdown','Maintenance'))
);

CREATE TABLE IF NOT EXISTS "HindranceLogs" (
  "HindranceId" SERIAL PRIMARY KEY,
  "HindranceCode" VARCHAR(50) NOT NULL UNIQUE,
  "DailyWorkLogId" INTEGER REFERENCES "DailyWorkLogs"("DailyWorkLogId") ON DELETE CASCADE,
  "ProjectId" INTEGER NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
  "DepartmentId" INTEGER REFERENCES "Departments"("DepartmentId") ON DELETE SET NULL,
  "TaskId" INTEGER REFERENCES "Tasks"("TaskId") ON DELETE SET NULL,
  "HindranceType" VARCHAR(80) NOT NULL,
  "Description" TEXT NOT NULL,
  "ImpactHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "ImpactQuantity" NUMERIC(18,3) NOT NULL DEFAULT 0,
  "ResponsibleDepartment" VARCHAR(140),
  "Priority" VARCHAR(20) NOT NULL DEFAULT 'Medium',
  "ExpectedResolutionDate" DATE,
  "ActualResolutionDate" DATE,
  "Status" VARCHAR(30) NOT NULL DEFAULT 'Open',
  "RaisedByUserId" INTEGER REFERENCES "Users"("UserId") ON DELETE SET NULL,
  "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMPTZ,
  CONSTRAINT "CK_HindranceLogs_Status" CHECK ("Status" IN ('Open','In Review','Resolved','Closed')),
  CONSTRAINT "CK_HindranceLogs_Priority" CHECK ("Priority" IN ('Low','Medium','High','Critical'))
);

CREATE INDEX IF NOT EXISTS "IX_DailyWorkLogs_ProjectDate" ON "DailyWorkLogs"("ProjectId", "LogDate" DESC);
CREATE INDEX IF NOT EXISTS "IX_DailyWorkLogs_Task" ON "DailyWorkLogs"("TaskId");
CREATE INDEX IF NOT EXISTS "IX_DailyLabourUsage_Log" ON "DailyLabourUsage"("DailyWorkLogId");
CREATE INDEX IF NOT EXISTS "IX_DailyMaterialUsage_Log" ON "DailyMaterialUsage"("DailyWorkLogId");
CREATE INDEX IF NOT EXISTS "IX_DailyMachineryUsage_Log" ON "DailyMachineryUsage"("DailyWorkLogId");
CREATE INDEX IF NOT EXISTS "IX_HindranceLogs_ProjectStatus" ON "HindranceLogs"("ProjectId", "Status");

INSERT INTO "Materials" ("MaterialCode", "MaterialName", "Unit", "MinimumStock") VALUES
  ('MAT-2026-0001', 'Cement', 'bag', 100),
  ('MAT-2026-0002', 'Steel Rebar', 'ton', 10),
  ('MAT-2026-0003', 'Concrete', 'm3', 25),
  ('MAT-2026-0004', 'Sand', 'm3', 30),
  ('MAT-2026-0005', 'Aggregate', 'm3', 30)
ON CONFLICT ("MaterialCode") DO NOTHING;

INSERT INTO "Machinery" ("MachineryCode", "MachineryName", "MachineryType", "RegistrationNo") VALUES
  ('MCY-2026-0001', 'Excavator E-12', 'Excavator', 'EQ-EX-012'),
  ('MCY-2026-0002', 'Transit Mixer TM-04', 'Transit Mixer', 'EQ-TM-004'),
  ('MCY-2026-0003', 'Concrete Pump CP-02', 'Concrete Pump', 'EQ-CP-002'),
  ('MCY-2026-0004', 'Crane CR-08', 'Crane', 'EQ-CR-008')
ON CONFLICT ("MachineryCode") DO NOTHING;

COMMIT;
