CREATE TABLE IF NOT EXISTS "AttendanceLogs" (
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

CREATE INDEX IF NOT EXISTS "IX_AttendanceLogs_Date" ON "AttendanceLogs"("AttendanceDate");
CREATE INDEX IF NOT EXISTS "IX_AttendanceLogs_EmployeeId" ON "AttendanceLogs"("EmployeeId");

INSERT INTO "Clients" ("ClientName", "ContactPerson", "Email", "Phone", "Address")
SELECT 'NOVA Infrastructure Authority', 'P. Krishnan', 'authority@nova.test', '+91 90000 30001', 'Hyderabad, Telangana'
WHERE NOT EXISTS (SELECT 1 FROM "Clients" WHERE "ClientName"='NOVA Infrastructure Authority');

INSERT INTO "Clients" ("ClientName", "ContactPerson", "Email", "Phone", "Address")
SELECT 'River Link Development Board', 'Anita Shah', 'rldb@nova.test', '+91 90000 30002', 'Pune, Maharashtra'
WHERE NOT EXISTS (SELECT 1 FROM "Clients" WHERE "ClientName"='River Link Development Board');

INSERT INTO "Employees" ("EmployeeName", "Email", "Phone", "Designation", "Department", "IsActive")
SELECT name, lower(replace(name, ' ', '.')) || '@nova.test', '+91 90000 ' || lpad((30010 + rn)::text, 5, '0'), designation, department, true
FROM (VALUES
  (1, 'Rahul Verma', 'Site Engineer', 'Execution'),
  (2, 'Suresh Kumar', 'Field Supervisor', 'Execution'),
  (3, 'Isha Patel', 'Safety Officer', 'HSE'),
  (4, 'Naveen Reddy', 'Survey Engineer', 'Survey'),
  (5, 'Farah Khan', 'QA/QC Engineer', 'Quality'),
  (6, 'Karthik Balan', 'Planning Engineer', 'Planning'),
  (7, 'Priya Sharma', 'Store Manager', 'Stores'),
  (8, 'Dinesh Yadav', 'Equipment Manager', 'Plant')
) AS v(rn, name, designation, department)
WHERE NOT EXISTS (SELECT 1 FROM "Employees" e WHERE e."EmployeeName" = v.name);

WITH client_pick AS (
  SELECT "ClientId" FROM "Clients" ORDER BY "ClientId" LIMIT 1
), project_seed AS (
  SELECT * FROM (VALUES
    ('Aqueduct North Reach', 'PKG-AQ-02', 'Erode'),
    ('Road Bridge Casting Yard', 'PKG-RB-01', 'Salem'),
    ('Feeder Canal Section', 'PKG-FC-03', 'Karur'),
    ('Intake Pump House', 'PKG-IP-01', 'Trichy')
  ) AS v(project_name, package_name, location)
)
INSERT INTO "Projects" ("ProjectName", "ClientId", "Package", "Location", "StartDate", "EndDate", "Description")
SELECT ps.project_name, cp."ClientId", ps.package_name, ps.location, CURRENT_DATE - INTERVAL '160 days', CURRENT_DATE + INTERVAL '220 days', 'Auto-generated demonstration project for dashboard analytics.'
FROM project_seed ps CROSS JOIN client_pick cp
WHERE NOT EXISTS (SELECT 1 FROM "Projects" p WHERE p."ProjectName" = ps.project_name);

INSERT INTO "SubWorks" ("ProjectId", "ParentSubWorkId", "SubWorkName", "Description")
SELECT p."ProjectId", NULL, sw.name, 'Demo work package'
FROM "Projects" p
JOIN (VALUES ('Pile Foundation'), ('Pier'), ('Deck Slab'), ('Approach Road')) AS sw(name) ON TRUE
WHERE p."ProjectName" IN ('Aqueduct North Reach', 'Road Bridge Casting Yard', 'Feeder Canal Section', 'Intake Pump House')
AND NOT EXISTS (SELECT 1 FROM "SubWorks" s WHERE s."ProjectId"=p."ProjectId" AND s."SubWorkName"=sw.name);

WITH employee_pick AS (
  SELECT "EmployeeId", row_number() over (order by "EmployeeId") AS rn FROM "Employees"
), employee_count AS (
  SELECT COUNT(*) AS total FROM employee_pick
), project_pick AS (
  SELECT "ProjectId", "ProjectName", row_number() over (order by "ProjectId") AS prn FROM "Projects"
), subwork_pick AS (
  SELECT "SubWorkId", "ProjectId", row_number() over (partition by "ProjectId" order by "SubWorkId") AS srn FROM "SubWorks"
), task_seed AS (
  SELECT p."ProjectId", sw."SubWorkId", e."EmployeeId", gs AS task_no,
    p."ProjectName" || ' - Activity ' || gs AS task_name,
    CASE WHEN gs % 5 = 0 THEN 'Critical' WHEN gs % 3 = 0 THEN 'High' WHEN gs % 2 = 0 THEN 'Medium' ELSE 'Low' END AS priority,
    LEAST(100, GREATEST(0, ((p.prn * 11 + gs * 7) % 101)))::numeric AS progress,
    (CURRENT_DATE - ((70 - gs) || ' days')::interval)::date AS start_date,
    (CURRENT_DATE + ((gs * 3 - 15) || ' days')::interval)::date AS finish_date
  FROM project_pick p
  JOIN generate_series(1, 8) gs ON TRUE
  LEFT JOIN subwork_pick sw ON sw."ProjectId"=p."ProjectId" AND sw.srn=((gs - 1) % 4) + 1
  LEFT JOIN employee_count ec ON TRUE
  LEFT JOIN employee_pick e ON e.rn=((gs - 1) % ec.total) + 1
)
INSERT INTO "Tasks" ("TaskName", "Description", "ProjectId", "SubWorkId", "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity", "Unit", "Remarks", "Status", "ProgressPercent")
SELECT task_name, 'Generated task for full dashboard testing', "ProjectId", "SubWorkId", "EmployeeId", priority, start_date, finish_date, 100 + task_no * 10, 'Units', 'Demo dataset',
  CASE WHEN progress >= 100 THEN 'Closed' WHEN progress > 0 THEN 'Running' ELSE 'Open' END, progress
FROM task_seed ts
WHERE NOT EXISTS (SELECT 1 FROM "Tasks" t WHERE t."TaskName"=ts.task_name);

INSERT INTO "TaskProgress" ("TaskId", "EmployeeId", "WorkDate", "TodayQuantity", "TodayProgressPercent", "Remarks")
SELECT t."TaskId", t."AssignedEmployeeId", d::date, ROUND((5 + random() * 15)::numeric, 2),
  LEAST(100, GREATEST(0, ROUND((t."ProgressPercent"::numeric * (0.35 + (EXTRACT(DAY FROM d)::numeric / 45))), 2))),
  'Auto progress update for dashboard trend'
FROM "Tasks" t
JOIN LATERAL generate_series(GREATEST(t."StartDate", CURRENT_DATE - INTERVAL '45 days'), LEAST(CURRENT_DATE, COALESCE(t."FinishDate", CURRENT_DATE)), INTERVAL '7 days') d ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM "TaskProgress" tp WHERE tp."TaskId"=t."TaskId" AND tp."WorkDate"=d::date
);

INSERT INTO "AttendanceLogs" ("EmployeeId", "AttendanceDate", "CheckInTime", "CheckOutTime", "Status", "Remarks")
SELECT e."EmployeeId", d::date,
  d::date + time '08:50' + ((e."EmployeeId" % 4) * interval '8 minutes'),
  d::date + time '17:40' + ((e."EmployeeId" % 3) * interval '12 minutes'),
  CASE WHEN EXTRACT(DOW FROM d) = 0 THEN 'Leave' WHEN e."EmployeeId" % 9 = 0 THEN 'Absent' WHEN e."EmployeeId" % 5 = 0 THEN 'Late' ELSE 'Present' END,
  'Generated attendance log'
FROM "Employees" e
JOIN generate_series(CURRENT_DATE - INTERVAL '70 days', CURRENT_DATE, INTERVAL '1 day') d ON TRUE
WHERE e."IsActive" = TRUE
ON CONFLICT ("EmployeeId", "AttendanceDate") DO NOTHING;
