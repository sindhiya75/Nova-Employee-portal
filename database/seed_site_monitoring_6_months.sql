-- Six months of demo data for Site Monitoring: Feb 2026 to Jul 2026.
-- Safe to rerun: it refreshes only records with DWL-DEMO-2026 / HIN-DEMO-2026 codes.
BEGIN;

DELETE FROM "DailyWorkLogs" WHERE "DailyWorkLogCode" LIKE 'DWL-DEMO-2026-%';

WITH task_pool AS (
  SELECT * FROM (
    SELECT t."TaskId", t."ProjectId", t."DepartmentId", t."WorkItemId", t."PlannedQuantity", COALESCE(NULLIF(t."Unit", ''), 'm') AS "Unit",
      ROW_NUMBER() OVER (ORDER BY t."ProjectId", t."TaskId") AS seq
    FROM "Tasks" t
    WHERE t."DepartmentId" IS NOT NULL
  ) picked
  WHERE seq <= 12
), pool_count AS (
  SELECT COUNT(*)::int AS count FROM task_pool
), date_pool AS (
  SELECT gs::date AS log_date, ROW_NUMBER() OVER (ORDER BY gs)::int AS day_seq
  FROM generate_series(DATE '2026-02-03', DATE '2026-07-14', interval '7 days') gs
), base AS (
  SELECT dp.log_date, dp.day_seq, slot.slot_no, tp.*, ROW_NUMBER() OVER (PARTITION BY tp."TaskId" ORDER BY dp.log_date, slot.slot_no)::int AS task_run_no
  FROM date_pool dp
  CROSS JOIN generate_series(1, 3) AS slot(slot_no)
  JOIN LATERAL (
    SELECT * FROM task_pool
    ORDER BY seq
    OFFSET ((dp.day_seq + slot.slot_no - 2) % (SELECT GREATEST(count, 1) FROM pool_count))
    LIMIT 1
  ) tp ON TRUE
), computed AS (
  SELECT *,
    GREATEST(COALESCE("PlannedQuantity", 0), 300 + (slot_no * 40))::numeric(18,3) AS planned_qty,
    (12 + slot_no * 3 + EXTRACT(MONTH FROM log_date)::numeric * 1.5 + (day_seq % 3) * 2)::numeric(18,3) AS today_qty
  FROM base
), shaped AS (
  SELECT *,
    LEAST(planned_qty, GREATEST(0, (task_run_no - 1) * today_qty))::numeric(18,3) AS previous_qty,
    LEAST(planned_qty, GREATEST(0, task_run_no * today_qty))::numeric(18,3) AS cumulative_qty
  FROM computed
), inserted_logs AS (
  INSERT INTO "DailyWorkLogs" (
    "DailyWorkLogCode", "ProjectId", "DepartmentId", "WorkItemId", "TaskId", "LogDate", "Shift",
    "LocationName", "ChainageFrom", "ChainageTo", "Weather", "PlannedQuantity", "PreviousCumulativeQuantity",
    "CompletedQuantity", "CumulativeQuantity", "BalanceQuantity", "Unit", "ProgressPercent", "Status", "Remarks", "SubmittedByUserId"
  )
  SELECT
    'DWL-DEMO-2026-' || TO_CHAR(log_date, 'YYYYMMDD') || '-' || LPAD(slot_no::text, 2, '0'),
    "ProjectId", "DepartmentId", "WorkItemId", "TaskId", log_date,
    CASE WHEN slot_no = 3 THEN 'Both' WHEN slot_no = 2 THEN 'Night' ELSE 'Day' END,
    CASE slot_no WHEN 1 THEN 'Canal reach' WHEN 2 THEN 'Pier zone' ELSE 'Deck slab zone' END,
    'KM ' || (10 + day_seq) || '+000',
    'KM ' || (10 + day_seq) || '+' || LPAD((180 + slot_no * 60)::text, 3, '0'),
    CASE WHEN day_seq % 5 = 0 THEN 'Cloudy' WHEN day_seq % 7 = 0 THEN 'Light rain' ELSE 'Clear' END,
    planned_qty,
    previous_qty,
    GREATEST(cumulative_qty - previous_qty, 0),
    cumulative_qty,
    GREATEST(planned_qty - cumulative_qty, 0),
    "Unit",
    ROUND((cumulative_qty / NULLIF(planned_qty, 0)) * 100, 2),
    CASE WHEN cumulative_qty >= planned_qty THEN 'Approved' ELSE 'Submitted' END,
    'Six month demo site monitoring data for dashboard and monthly verification',
    (SELECT "UserId" FROM "Users" WHERE "Role" IN ('Admin','Manager') ORDER BY CASE "Role" WHEN 'Admin' THEN 1 ELSE 2 END, "UserId" LIMIT 1)
  FROM shaped
  RETURNING "DailyWorkLogId", "DailyWorkLogCode", "ProjectId", "DepartmentId", "TaskId", "LogDate", "CompletedQuantity", "Unit"
), numbered_logs AS (
  SELECT il.*, ROW_NUMBER() OVER (ORDER BY il."LogDate", il."DailyWorkLogCode")::int AS rn
  FROM inserted_logs il
), labour_insert AS (
  INSERT INTO "DailyLabourUsage" (
    "DailyWorkLogId", "SupervisorCount", "EngineerCount", "SkilledCount", "UnskilledCount", "OperatorCount", "HelperCount",
    "TotalLabour", "WorkingHours", "OvertimeHours", "Mandays", "ContractorName", "Remarks"
  )
  SELECT "DailyWorkLogId",
    1 + (rn % 2), 1, 8 + (rn % 5), 14 + (rn % 8), 2 + (rn % 3), 5 + (rn % 4),
    (1 + (rn % 2)) + 1 + (8 + (rn % 5)) + (14 + (rn % 8)) + (2 + (rn % 3)) + (5 + (rn % 4)),
    CASE WHEN rn % 4 = 0 THEN 10 ELSE 8 END,
    CASE WHEN rn % 4 = 0 THEN 2 ELSE 0 END,
    ROUND((((1 + (rn % 2)) + 1 + (8 + (rn % 5)) + (14 + (rn % 8)) + (2 + (rn % 3)) + (5 + (rn % 4)))::numeric * CASE WHEN rn % 4 = 0 THEN 10 ELSE 8 END) / 8, 2),
    CASE WHEN rn % 3 = 0 THEN 'Sri Infra Labour Contractor' ELSE 'NGBI Site Crew' END,
    'Demo labour consumption for daily/monthly productivity'
  FROM numbered_logs
  RETURNING "DailyWorkLogId"
), material_rows AS (
  SELECT nl.*, m."MaterialId", m."MaterialName", m."Unit" AS material_unit, mi.material_slot
  FROM numbered_logs nl
  JOIN LATERAL (VALUES (1), (2)) mi(material_slot) ON TRUE
  JOIN LATERAL (
    SELECT * FROM "Materials" ORDER BY "MaterialId" OFFSET ((nl.rn + mi.material_slot - 2) % (SELECT COUNT(*) FROM "Materials")) LIMIT 1
  ) m ON TRUE
), material_insert AS (
  INSERT INTO "DailyMaterialUsage" (
    "DailyWorkLogId", "MaterialId", "MaterialNameSnapshot", "Unit", "OpeningStock", "ReceivedQuantity", "IssuedQuantity",
    "ConsumedQuantity", "WastageQuantity", "BalanceStock", "SupplierName", "InvoiceNo", "Remarks"
  )
  SELECT "DailyWorkLogId", "MaterialId", "MaterialName", material_unit,
    600 + rn * 6 + material_slot * 25,
    CASE WHEN rn % 4 = 0 THEN 140 + material_slot * 15 ELSE 0 END,
    ROUND(("CompletedQuantity" * (1.8 + material_slot * 0.7))::numeric, 3),
    ROUND(("CompletedQuantity" * (1.5 + material_slot * 0.5))::numeric, 3),
    ROUND(("CompletedQuantity" * 0.04 * material_slot)::numeric, 3),
    ROUND((600 + rn * 6 + material_slot * 25 + CASE WHEN rn % 4 = 0 THEN 140 + material_slot * 15 ELSE 0 END - ("CompletedQuantity" * (1.5 + material_slot * 0.5)) - ("CompletedQuantity" * 0.04 * material_slot))::numeric, 3),
    CASE WHEN material_slot = 1 THEN 'ABC Suppliers' ELSE 'Metro Build Mart' END,
    'DC-' || TO_CHAR("LogDate", 'YYYYMMDD') || '-' || material_slot,
    'Demo material usage for consumption and wastage charts'
  FROM material_rows
  RETURNING "DailyWorkLogId"
), machinery_rows AS (
  SELECT nl.*, mc."MachineryId", mc."MachineryName", mi.machine_slot
  FROM numbered_logs nl
  JOIN LATERAL (VALUES (1), (2)) mi(machine_slot) ON TRUE
  JOIN LATERAL (
    SELECT * FROM "Machinery" ORDER BY "MachineryId" OFFSET ((nl.rn + mi.machine_slot - 2) % (SELECT COUNT(*) FROM "Machinery")) LIMIT 1
  ) mc ON TRUE
  WHERE mi.machine_slot = 1 OR nl.rn % 2 = 0
), machinery_insert AS (
  INSERT INTO "DailyMachineryUsage" (
    "DailyWorkLogId", "MachineryId", "MachineryNameSnapshot", "OperatorName", "WorkingHours", "IdleHours", "BreakdownHours",
    "FuelConsumed", "OutputQuantity", "Status", "Remarks"
  )
  SELECT "DailyWorkLogId", "MachineryId", "MachineryName",
    CASE machine_slot WHEN 1 THEN 'Ravi Kumar' ELSE 'Suresh Kumar' END,
    CASE WHEN rn % 6 = 0 AND machine_slot = 2 THEN 4 ELSE 7 + machine_slot END,
    CASE WHEN rn % 5 = 0 THEN 2 ELSE machine_slot - 1 END,
    CASE WHEN rn % 11 = 0 THEN 1.5 ELSE 0 END,
    ROUND((32 + machine_slot * 12 + rn % 9)::numeric, 2),
    ROUND(("CompletedQuantity" / CASE WHEN machine_slot = 1 THEN 1 ELSE 2 END)::numeric, 3),
    CASE WHEN rn % 11 = 0 THEN 'Breakdown' WHEN rn % 5 = 0 THEN 'Idle' ELSE 'Working' END,
    'Demo machinery usage for utilization and productivity charts'
  FROM machinery_rows
  RETURNING "DailyWorkLogId"
)
INSERT INTO "HindranceLogs" (
  "HindranceCode", "DailyWorkLogId", "ProjectId", "DepartmentId", "TaskId", "HindranceType", "Description",
  "ImpactHours", "ImpactQuantity", "ResponsibleDepartment", "Priority", "ExpectedResolutionDate", "ActualResolutionDate", "Status", "RaisedByUserId"
)
SELECT
  'HIN-DEMO-2026-' || TO_CHAR("LogDate", 'YYYYMMDD') || '-' || LPAD(rn::text, 3, '0'),
  "DailyWorkLogId", "ProjectId", "DepartmentId", "TaskId",
  CASE rn % 5 WHEN 0 THEN 'Material Shortage' WHEN 1 THEN 'Drawing Delay' WHEN 2 THEN 'Machinery Breakdown' WHEN 3 THEN 'Weather' ELSE 'Client Approval' END,
  CASE rn % 5 WHEN 0 THEN 'Steel delivery delayed for reinforcement work' WHEN 1 THEN 'Latest drawing revision pending from design team' WHEN 2 THEN 'Equipment stopped for field repair' WHEN 3 THEN 'Work slowed due to rain at site' ELSE 'Inspection clearance pending' END,
  CASE WHEN rn % 4 = 0 THEN 6 ELSE 3 END,
  ROUND(("CompletedQuantity" * 0.18)::numeric, 3),
  CASE rn % 5 WHEN 0 THEN 'Stores' WHEN 1 THEN 'Planning' WHEN 2 THEN 'Plant & Machinery' WHEN 3 THEN 'Site Team' ELSE 'Client' END,
  CASE WHEN rn % 10 = 0 THEN 'Critical' WHEN rn % 3 = 0 THEN 'High' ELSE 'Medium' END,
  "LogDate" + interval '3 days',
  CASE WHEN rn % 4 = 0 THEN NULL ELSE "LogDate" + interval '2 days' END,
  CASE WHEN rn % 4 = 0 THEN 'Open' WHEN rn % 3 = 0 THEN 'In Review' ELSE 'Resolved' END,
  (SELECT "UserId" FROM "Users" WHERE "Role" IN ('Admin','Manager') ORDER BY CASE "Role" WHEN 'Admin' THEN 1 ELSE 2 END, "UserId" LIMIT 1)
FROM numbered_logs
WHERE rn % 5 = 0 OR rn % 7 = 0;

COMMIT;

