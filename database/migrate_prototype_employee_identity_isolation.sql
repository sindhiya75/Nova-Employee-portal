BEGIN;

INSERT INTO "Employees" ("EmployeeName", "Email", "Designation", "Department", "DepartmentId", "IsActive")
SELECT source.employee_name, source.email, 'Employee', 'Execution', (SELECT "DepartmentId" FROM "Departments" WHERE "DepartmentName"='Execution' LIMIT 1), TRUE
FROM (VALUES
  ('Ram', 'ram@nova.local'),
  ('Ragul', 'ragul@nova.local'),
  ('Kavin', 'kavin@nova.local')
) AS source(employee_name, email)
WHERE NOT EXISTS (SELECT 1 FROM "Employees" employee WHERE lower(employee."Email")=lower(source.email));

INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive")
SELECT source.user_code, source.employee_name, source.email, '1234', 'Employee', employee."EmployeeId", TRUE
FROM (VALUES
  ('USR-EMP-RAM', 'Ram', 'ram@nova.local'),
  ('USR-EMP-RAGUL', 'Ragul', 'ragul@nova.local'),
  ('USR-EMP-KAVIN', 'Kavin', 'kavin@nova.local')
) AS source(user_code, employee_name, email)
JOIN "Employees" employee ON lower(employee."Email")=lower(source.email)
WHERE NOT EXISTS (SELECT 1 FROM "Users" user_account WHERE lower(user_account."Email")=lower(source.email));

UPDATE "Tasks" task
SET "AssignedEmployeeId"=(SELECT "EmployeeId" FROM "Employees" WHERE lower("Email")='ram@nova.local')
WHERE task."TaskCode" IN ('TSK-00005','TSK-00006','TSK-00007','TSK-00009','TSK-00010');

WITH employee_tasks(task_code, task_name, employee_email, progress_percent) AS (
  VALUES
    ('TSK-RAGUL-001', 'Ragul Site Preparation - Activity 1', 'ragul@nova.local', 15),
    ('TSK-RAGUL-002', 'Ragul Foundation Survey - Activity 1', 'ragul@nova.local', 35),
    ('TSK-KAVIN-001', 'Kavin Reinforcement Check - Activity 1', 'kavin@nova.local', 20),
    ('TSK-KAVIN-002', 'Kavin Concrete Inspection - Activity 1', 'kavin@nova.local', 55)
)
INSERT INTO "Tasks" ("TaskCode", "TaskName", "Description", "ProjectId", "DepartmentId", "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity", "CompletedQuantity", "Unit", "Status", "ProgressPercent", "Remarks")
SELECT source.task_code, source.task_name, 'Employee-isolated prototype task', project."ProjectId",
  (SELECT "DepartmentId" FROM "Departments" WHERE "DepartmentName"='Execution' LIMIT 1), employee."EmployeeId",
  'Medium', CURRENT_DATE, CURRENT_DATE + 14, 100, source.progress_percent, 'Units', 'Running', source.progress_percent, 'Identity isolation test task'
FROM employee_tasks source
JOIN "Employees" employee ON lower(employee."Email")=lower(source.employee_email)
CROSS JOIN LATERAL (SELECT "ProjectId" FROM "Projects" ORDER BY "ProjectId" LIMIT 1) project
WHERE NOT EXISTS (SELECT 1 FROM "Tasks" task WHERE task."TaskCode"=source.task_code);

COMMIT;
