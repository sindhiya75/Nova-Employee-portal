import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../utils/audit.js';
import { issueSessionToken } from '../utils/sessionToken.js';

const router = express.Router();

const prototypeTaskCodes = ['TSK-00005', 'TSK-00006', 'TSK-00007', 'TSK-00009', 'TSK-00010'];

async function ensurePrototypeActiveWork(employeeId) {
  await query(`
    WITH templates AS (
      SELECT DISTINCT ON ("TaskCode")
        "TaskCode", "TaskName", "Description", "ProjectId", "DepartmentId", "SubWorkId", "WorkItemId",
        "Priority", "StartDate", "FinishDate", "PlannedQuantity", "CompletedQuantity", "Unit", "Status",
        "ProgressPercent", "Remarks", "WorkPathSnapshot", "WorkItemCodeSnapshot", "WorkItemNameSnapshot", "WorkItemLevelSnapshot"
      FROM "Tasks"
      WHERE "TaskCode" = ANY($1::text[])
      ORDER BY "TaskCode", "TaskId"
    )
    INSERT INTO "Tasks" (
      "TaskCode", "TaskName", "Description", "ProjectId", "DepartmentId", "SubWorkId", "WorkItemId",
      "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity", "CompletedQuantity",
      "Unit", "Status", "ProgressPercent", "Remarks", "WorkPathSnapshot", "WorkItemCodeSnapshot",
      "WorkItemNameSnapshot", "WorkItemLevelSnapshot"
    )
    SELECT
      template."TaskCode", template."TaskName", template."Description", template."ProjectId", template."DepartmentId",
      template."SubWorkId", template."WorkItemId", $2::int, template."Priority", template."StartDate", template."FinishDate",
      template."PlannedQuantity", template."CompletedQuantity", template."Unit", 'Running', template."ProgressPercent",
      template."Remarks", template."WorkPathSnapshot", template."WorkItemCodeSnapshot", template."WorkItemNameSnapshot",
      template."WorkItemLevelSnapshot"
    FROM templates template
    WHERE NOT EXISTS (
      SELECT 1 FROM "Tasks" existing
      WHERE existing."AssignedEmployeeId"=$2::int AND existing."TaskCode"=template."TaskCode"
    )
  `, [prototypeTaskCodes, employeeId]);

  await query(`
    WITH defaults("TaskCode", "ProgressPercent") AS (
      VALUES
        ('TSK-00005', 18::numeric),
        ('TSK-00006', 29::numeric),
        ('TSK-00007', 40::numeric),
        ('TSK-00009', 62::numeric),
        ('TSK-00010', 73::numeric)
    )
    UPDATE "Tasks" task
    SET "ProgressPercent"=defaults."ProgressPercent",
        "CompletedQuantity"=defaults."ProgressPercent",
        "Status"='Running'
    FROM defaults
    WHERE task."AssignedEmployeeId"=$1::int
      AND task."TaskCode"=defaults."TaskCode"
      AND NOT EXISTS (SELECT 1 FROM "TaskProgress" progress WHERE progress."TaskId"=task."TaskId")
  `, [employeeId]);
}

async function assignedProjects(userId, role) {
  if (role === 'Admin') {
    const result = await query('SELECT "ProjectId", "ProjectName" FROM "Projects" ORDER BY "ProjectName"');
    return result.rows;
  }
  if (role === 'Manager') {
    const result = await query(`
      SELECT p."ProjectId", p."ProjectName"
      FROM "UserProjectAccess" upa
      JOIN "Projects" p ON p."ProjectId" = upa."ProjectId"
      WHERE upa."UserId"=$1
      ORDER BY p."ProjectName"
    `, [userId]);
    return result.rows;
  }
  if (role === 'Client Viewer') {
    const result = await query(`
      SELECT project."ProjectId", project."ProjectName"
      FROM "Projects" project JOIN "Users" user_account ON user_account."ClientId"=project."ClientId"
      WHERE user_account."UserId"=$1 ORDER BY project."ProjectName"
    `, [userId]);
    return result.rows;
  }
  return [];
}

router.post('/login', asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body;
  const identity = username || email;
  if (!identity || !password) return res.status(400).json({ message: 'Username and password are required.' });
  let result = await query(`
    SELECT u."UserId", u."UserCode", u."Name", u."Email", u."Role", u."EmployeeId", u."ClientId", u."IsActive", e."EmployeeName", e."DepartmentId"
    FROM "Users" u LEFT JOIN "Employees" e ON e."EmployeeId" = u."EmployeeId"
    WHERE (lower(u."Email")=lower($1) OR lower(u."Name")=lower($1) OR lower(u."UserCode")=lower($1))
      AND u."PasswordHash"=$2 AND u."IsActive"=TRUE
    ORDER BY CASE WHEN lower(u."Name")=lower($1) THEN 0 WHEN lower(u."Email")=lower($1) THEN 1 ELSE 2 END
    LIMIT 1
  `, [identity, password]);
  let user = result.rows[0];

  if (!user && role === 'Employee' && password === '1234') {
    const existingIdentity = await query(`
      SELECT "UserId" FROM "Users"
      WHERE lower("Email")=lower($1) OR lower("Name")=lower($1) OR lower("UserCode")=lower($1)
      LIMIT 1
    `, [identity]);
    if (existingIdentity.rows[0]) return res.status(401).json({ message: 'Invalid credentials or role.' });

    const displayName = String(identity).trim();
    const employeeResult = await query(`
      INSERT INTO "Employees" ("EmployeeName", "Designation", "Department", "DepartmentId", "IsActive")
      VALUES ($1, 'Employee', 'Execution', (SELECT "DepartmentId" FROM "Departments" WHERE "DepartmentName"='Execution' LIMIT 1), TRUE)
      RETURNING "EmployeeId"
    `, [displayName]);
    const employeeId = employeeResult.rows[0].EmployeeId;
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || `employee${employeeId}`;
    await query(`
      INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive")
      VALUES ($1, $2, $3, '1234', 'Employee', $4, TRUE)
    `, [`USR-EMP-${String(employeeId).padStart(5, '0')}`, displayName, `${slug}.${employeeId}@prototype.nova.local`, employeeId]);
    result = await query(`
      SELECT u."UserId", u."UserCode", u."Name", u."Email", u."Role", u."EmployeeId", u."ClientId", u."IsActive", e."EmployeeName", e."DepartmentId"
      FROM "Users" u LEFT JOIN "Employees" e ON e."EmployeeId"=u."EmployeeId"
      WHERE u."EmployeeId"=$1 AND u."Role"='Employee'
    `, [employeeId]);
    user = result.rows[0];
  }

  if (!user || (role && user.Role !== role)) return res.status(401).json({ message: 'Invalid credentials or role.' });
  if (user.Role === 'Employee' && user.EmployeeId) await ensurePrototypeActiveWork(user.EmployeeId);
  user.Projects = await assignedProjects(user.UserId, user.Role);
  user.DefaultProjectId = user.Projects?.[0]?.ProjectId || null;
  await query('UPDATE "Users" SET "LastLoginAt"=CURRENT_TIMESTAMP WHERE "UserId"=$1', [user.UserId]);
  await logAudit(req, { userId: user.UserId, employeeId: user.EmployeeId, userRole: user.Role, actionType: 'Login', moduleName: 'Auth', recordType: 'Users', recordId: user.UserId, recordCode: user.UserCode, description: `${user.Name} logged in as ${user.Role}` });
  res.json({ user, token: issueSessionToken(user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null;
  const employeeId = req.headers['x-employee-id'] ? Number(req.headers['x-employee-id']) : null;
  const userRole = req.headers['x-user-role'] || null;
  await logAudit(req, { userId, employeeId, userRole, actionType: 'Logout', moduleName: 'Auth', recordType: 'Users', recordId: userId, description: `User ${userId || 'unknown'} logged out` });
  res.status(204).send();
}));

router.post('/change-password', asyncHandler(async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  const result = await query('UPDATE "Users" SET "PasswordHash"=$1, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "UserId"=$2 AND "PasswordHash"=$3 RETURNING "UserId", "UserCode", "Email", "Role"', [newPassword, userId, oldPassword]);
  if (!result.rows[0]) return res.status(400).json({ message: 'Old password is incorrect.' });
  await logAudit(req, { userId, userRole: result.rows[0].Role, actionType: 'Password Changed', moduleName: 'Auth', recordType: 'Users', recordId: userId, recordCode: result.rows[0].UserCode, description: 'Password changed' });
  res.json({ message: 'Password changed successfully.' });
}));

export default router;
