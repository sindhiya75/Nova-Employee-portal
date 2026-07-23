CREATE TABLE IF NOT EXISTS "UserProjectAccess" (
  "AccessId" SERIAL PRIMARY KEY,
  "UserId" INT NOT NULL REFERENCES "Users"("UserId") ON DELETE CASCADE,
  "ProjectId" INT NOT NULL REFERENCES "Projects"("ProjectId") ON DELETE CASCADE,
  "AccessLevel" VARCHAR(30) NOT NULL DEFAULT 'Manager',
  "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("UserId", "ProjectId")
);

CREATE TABLE IF NOT EXISTS "TaskReopenRequests" (
  "RequestId" SERIAL PRIMARY KEY,
  "TaskId" INT NOT NULL REFERENCES "Tasks"("TaskId") ON DELETE CASCADE,
  "EmployeeId" INT NOT NULL REFERENCES "Employees"("EmployeeId") ON DELETE CASCADE,
  "RequestedByUserId" INT REFERENCES "Users"("UserId"),
  "Reason" TEXT NOT NULL,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
  "ManagerRemarks" TEXT,
  "ApprovedByUserId" INT REFERENCES "Users"("UserId"),
  "ApprovedAt" TIMESTAMP,
  "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_project_access_user ON "UserProjectAccess"("UserId");
CREATE INDEX IF NOT EXISTS idx_task_reopen_requests_task ON "TaskReopenRequests"("TaskId");
CREATE INDEX IF NOT EXISTS idx_task_reopen_requests_status ON "TaskReopenRequests"("Status");

INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive")
SELECT 'USR-MGR-P1', 'Package 1 Manager', 'manager.p1@nova.local', 'manager123', 'Manager', NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM "Users" WHERE lower("Email")='manager.p1@nova.local');

INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive")
SELECT 'USR-MGR-P2', 'Package 2 Manager', 'manager.p2@nova.local', 'manager123', 'Manager', NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM "Users" WHERE lower("Email")='manager.p2@nova.local');

INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive")
SELECT 'USR-EMP-AARAV', 'Aarav Employee', 'aarav.employee@nova.local', 'employee123', 'Employee', 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM "Users" WHERE lower("Email")='aarav.employee@nova.local');

INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive")
SELECT 'USR-EMP-MEERA', 'Meera Employee', 'meera.employee@nova.local', 'employee123', 'Employee', 2, TRUE
WHERE NOT EXISTS (SELECT 1 FROM "Users" WHERE lower("Email")='meera.employee@nova.local');

INSERT INTO "UserProjectAccess" ("UserId", "ProjectId", "AccessLevel")
SELECT u."UserId", p."ProjectId", 'Manager'
FROM "Users" u CROSS JOIN LATERAL (SELECT "ProjectId" FROM "Projects" ORDER BY "ProjectId" LIMIT 1) p
WHERE lower(u."Email") IN ('manager@nova.local','manager.p1@nova.local')
ON CONFLICT ("UserId", "ProjectId") DO NOTHING;

INSERT INTO "UserProjectAccess" ("UserId", "ProjectId", "AccessLevel")
SELECT u."UserId", p."ProjectId", 'Manager'
FROM "Users" u CROSS JOIN LATERAL (SELECT "ProjectId" FROM "Projects" ORDER BY "ProjectId" OFFSET 1 LIMIT 1) p
WHERE lower(u."Email")='manager.p2@nova.local'
ON CONFLICT ("UserId", "ProjectId") DO NOTHING;
