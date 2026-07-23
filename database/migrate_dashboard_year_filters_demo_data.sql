-- Demo historical data for dashboard year filters: 2024 and 2025.
WITH demo_tasks("TaskCode", "TaskName", "ProjectId", "DepartmentId", "AssignedEmployeeId", "StartDate", "FinishDate", "ProgressPercent") AS (
  VALUES
    ('TSK-HIST-2024-AQ', 'Historical Aqueduct Progress 2024', 1, 1, 1, DATE '2024-01-10', DATE '2024-12-20', 100.00),
    ('TSK-HIST-2024-MV', 'Historical Viaduct Progress 2024', 2, 1, 2, DATE '2024-02-01', DATE '2024-12-15', 92.00),
    ('TSK-HIST-2025-AQ', 'Historical Aqueduct Progress 2025', 1, 1, 1, DATE '2025-01-05', DATE '2025-12-22', 100.00),
    ('TSK-HIST-2025-MV', 'Historical Viaduct Progress 2025', 2, 1, 2, DATE '2025-01-15', DATE '2025-12-18', 96.00)
)
INSERT INTO "Tasks" ("TaskCode", "TaskName", "Description", "ProjectId", "DepartmentId", "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity", "Unit", "Status", "ProgressPercent", "Remarks")
SELECT d."TaskCode", d."TaskName", 'Historical demo task for dashboard year filters', d."ProjectId", d."DepartmentId", d."AssignedEmployeeId", 'Medium', d."StartDate", d."FinishDate", 100, 'Percent', 'Closed', d."ProgressPercent", 'Historical dashboard seed'
FROM demo_tasks d
WHERE NOT EXISTS (SELECT 1 FROM "Tasks" t WHERE t."TaskCode" = d."TaskCode");

WITH monthly_points("TaskCode", "YearNo", "MonthNo", "ProgressValue") AS (
  VALUES
    ('TSK-HIST-2024-AQ', 2024, 1, 5), ('TSK-HIST-2024-AQ', 2024, 2, 12), ('TSK-HIST-2024-AQ', 2024, 3, 22), ('TSK-HIST-2024-AQ', 2024, 4, 30), ('TSK-HIST-2024-AQ', 2024, 5, 42), ('TSK-HIST-2024-AQ', 2024, 6, 53), ('TSK-HIST-2024-AQ', 2024, 7, 64), ('TSK-HIST-2024-AQ', 2024, 8, 73), ('TSK-HIST-2024-AQ', 2024, 9, 82), ('TSK-HIST-2024-AQ', 2024, 10, 90), ('TSK-HIST-2024-AQ', 2024, 11, 96), ('TSK-HIST-2024-AQ', 2024, 12, 100),
    ('TSK-HIST-2024-MV', 2024, 1, 0), ('TSK-HIST-2024-MV', 2024, 2, 8), ('TSK-HIST-2024-MV', 2024, 3, 16), ('TSK-HIST-2024-MV', 2024, 4, 24), ('TSK-HIST-2024-MV', 2024, 5, 34), ('TSK-HIST-2024-MV', 2024, 6, 43), ('TSK-HIST-2024-MV', 2024, 7, 54), ('TSK-HIST-2024-MV', 2024, 8, 63), ('TSK-HIST-2024-MV', 2024, 9, 72), ('TSK-HIST-2024-MV', 2024, 10, 80), ('TSK-HIST-2024-MV', 2024, 11, 88), ('TSK-HIST-2024-MV', 2024, 12, 92),
    ('TSK-HIST-2025-AQ', 2025, 1, 7), ('TSK-HIST-2025-AQ', 2025, 2, 15), ('TSK-HIST-2025-AQ', 2025, 3, 26), ('TSK-HIST-2025-AQ', 2025, 4, 38), ('TSK-HIST-2025-AQ', 2025, 5, 49), ('TSK-HIST-2025-AQ', 2025, 6, 60), ('TSK-HIST-2025-AQ', 2025, 7, 70), ('TSK-HIST-2025-AQ', 2025, 8, 78), ('TSK-HIST-2025-AQ', 2025, 9, 86), ('TSK-HIST-2025-AQ', 2025, 10, 93), ('TSK-HIST-2025-AQ', 2025, 11, 98), ('TSK-HIST-2025-AQ', 2025, 12, 100),
    ('TSK-HIST-2025-MV', 2025, 1, 4), ('TSK-HIST-2025-MV', 2025, 2, 13), ('TSK-HIST-2025-MV', 2025, 3, 21), ('TSK-HIST-2025-MV', 2025, 4, 32), ('TSK-HIST-2025-MV', 2025, 5, 44), ('TSK-HIST-2025-MV', 2025, 6, 55), ('TSK-HIST-2025-MV', 2025, 7, 65), ('TSK-HIST-2025-MV', 2025, 8, 74), ('TSK-HIST-2025-MV', 2025, 9, 82), ('TSK-HIST-2025-MV', 2025, 10, 89), ('TSK-HIST-2025-MV', 2025, 11, 94), ('TSK-HIST-2025-MV', 2025, 12, 96)
)
INSERT INTO "TaskProgress" ("TaskId", "EmployeeId", "WorkDate", "TodayQuantity", "TodayProgressPercent", "Remarks")
SELECT t."TaskId", t."AssignedEmployeeId", (DATE (mp."YearNo" || '-' || LPAD(mp."MonthNo"::text, 2, '0') || '-01') + interval '1 month - 1 day')::date, mp."ProgressValue", mp."ProgressValue", 'Historical dashboard progress seed'
FROM monthly_points mp
JOIN "Tasks" t ON t."TaskCode" = mp."TaskCode"
WHERE NOT EXISTS (
  SELECT 1 FROM "TaskProgress" tp
  WHERE tp."TaskId" = t."TaskId" AND tp."WorkDate" = (DATE (mp."YearNo" || '-' || LPAD(mp."MonthNo"::text, 2, '0') || '-01') + interval '1 month - 1 day')::date
);
