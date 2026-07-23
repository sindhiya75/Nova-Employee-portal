BEGIN;

INSERT INTO "Projects" ("ProjectName", "ClientId", "Package", "Location", "Description")
SELECT project_name, (SELECT "ClientId" FROM "Clients" ORDER BY "ClientId" LIMIT 1), 'Employee Portal', 'Project Site', 'Reference active work for NOVA+ employee portal'
FROM (VALUES
  ('Feeder Canal Section'),
  ('Intake Pump House'),
  ('Elevated Metro Viaduct'),
  ('Canal Aqueduct Package A'),
  ('Aqueduct North Reach')
) AS source(project_name)
WHERE NOT EXISTS (SELECT 1 FROM "Projects" project WHERE project."ProjectName"=source.project_name);

INSERT INTO "SubWorks" ("ProjectId", "SubWorkName", "Description")
SELECT project."ProjectId", source.work_area, 'Employee portal work area'
FROM (VALUES
  ('Feeder Canal Section', 'Pile Foundation'),
  ('Intake Pump House', 'Approach Road'),
  ('Elevated Metro Viaduct', 'Viaduct'),
  ('Canal Aqueduct Package A', 'Aqueduct'),
  ('Aqueduct North Reach', 'Deck Slab')
) AS source(project_name, work_area)
JOIN "Projects" project ON project."ProjectName"=source.project_name
WHERE NOT EXISTS (
  SELECT 1 FROM "SubWorks" subwork
  WHERE subwork."ProjectId"=project."ProjectId" AND subwork."SubWorkName"=source.work_area
);

WITH reference_tasks(task_code, project_name, work_area, progress_percent) AS (
  VALUES
    ('TSK-00007', 'Feeder Canal Section', 'Pile Foundation', 40),
    ('TSK-00010', 'Intake Pump House', 'Approach Road', 73),
    ('TSK-00006', 'Elevated Metro Viaduct', 'Viaduct', 29),
    ('TSK-00005', 'Canal Aqueduct Package A', 'Aqueduct', 18),
    ('TSK-00009', 'Aqueduct North Reach', 'Deck Slab', 62)
)
INSERT INTO "Tasks" (
  "TaskCode", "TaskName", "Description", "ProjectId", "DepartmentId", "SubWorkId",
  "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity",
  "CompletedQuantity", "Unit", "Status", "ProgressPercent", "Remarks"
)
SELECT
  reference.task_code,
  reference.project_name || ' - Activity 1',
  'Generated task for full dashboard testing',
  project."ProjectId",
  (SELECT "DepartmentId" FROM "Departments" WHERE "DepartmentName"='Execution' LIMIT 1),
  subwork."SubWorkId",
  1,
  'High',
  DATE '2026-07-01',
  DATE '2026-07-09',
  100,
  reference.progress_percent,
  'Units',
  'Running',
  reference.progress_percent,
  'Reference active work list'
FROM reference_tasks reference
JOIN "Projects" project ON project."ProjectName"=reference.project_name
JOIN "SubWorks" subwork ON subwork."ProjectId"=project."ProjectId" AND subwork."SubWorkName"=reference.work_area
WHERE NOT EXISTS (SELECT 1 FROM "Tasks" task WHERE task."TaskCode"=reference.task_code);

COMMIT;
