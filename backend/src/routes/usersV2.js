import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest } from '../utils/access.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();
const userCode = (role, id) => `USR-${String(role).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)}-${String(id).padStart(5, '0')}`;

function requireAdmin(req, res) {
  const actor = actorFromRequest(req);
  if (actor.role !== 'Admin') { res.status(403).json({ message: 'Only Admin can maintain user configuration.' }); return null; }
  return actor;
}

async function validateUserLinks({ role, employeeId, clientId, currentUserId = null }) {
  if (role === 'Employee' && !employeeId) return 'Employee credentials must be linked to an employee record.';
  if (role === 'Client Viewer' && !clientId) return 'Client Viewer credentials must be linked to a client.';
  if (employeeId) {
    const params = [employeeId];
    let sql = 'SELECT "UserId" FROM "Users" WHERE "EmployeeId"=$1';
    if (currentUserId) { params.push(currentUserId); sql += ' AND "UserId"<>$2'; }
    const existing = await query(sql, params);
    if (existing.rows[0]) return 'This employee already has login credentials.';
  }
  return null;
}

router.get('/', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT user_account."UserId",user_account."UserCode",user_account."Name",user_account."Email",user_account."Role",
      user_account."EmployeeId",user_account."ClientId",user_account."IsActive",user_account."CreatedAt",user_account."LastLoginAt",
      employee."EmployeeName",employee."EmployeeCode",department."DepartmentCode",department."DepartmentName",
      client."ClientCode",client."ClientName",
      COALESCE(json_agg(DISTINCT jsonb_build_object('ProjectId',project."ProjectId",'ProjectCode',project."ProjectCode",'ProjectName',project."ProjectName")) FILTER (WHERE project."ProjectId" IS NOT NULL),'[]') AS "Projects"
    FROM "Users" user_account
    LEFT JOIN "Employees" employee ON employee."EmployeeId"=user_account."EmployeeId"
    LEFT JOIN "Departments" department ON department."DepartmentId"=employee."DepartmentId"
    LEFT JOIN "Clients" client ON client."ClientId"=user_account."ClientId"
    LEFT JOIN "UserProjectAccess" access ON access."UserId"=user_account."UserId"
    LEFT JOIN "Projects" project ON project."ProjectId"=access."ProjectId" OR (user_account."Role"='Client Viewer' AND project."ClientId"=user_account."ClientId")
    GROUP BY user_account."UserId",employee."EmployeeName",employee."EmployeeCode",department."DepartmentCode",department."DepartmentName",client."ClientCode",client."ClientName"
    ORDER BY user_account."Role",user_account."Name"
  `);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = requireAdmin(req, res);
  if (!actor) return;
  const { name, email, password, role, employeeId, clientId, projectIds = [] } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ message: 'Name, email, password, and role are required.' });
  const linkError = await validateUserLinks({ role, employeeId, clientId });
  if (linkError) return res.status(400).json({ message: linkError });
  const duplicate = await query('SELECT "UserId" FROM "Users" WHERE lower("Email")=lower($1)', [email]);
  if (duplicate.rows[0]) return res.status(409).json({ message: 'Email already exists.' });
  const created = await query(`
    INSERT INTO "Users" ("Name","Email","PasswordHash","Role","EmployeeId","ClientId","IsActive")
    VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING *
  `, [name, email, password, role, role === 'Employee' ? employeeId : null, role === 'Client Viewer' ? clientId : null]);
  const code = userCode(role, created.rows[0].UserId);
  const result = await query('UPDATE "Users" SET "UserCode"=$1 WHERE "UserId"=$2 RETURNING *', [code, created.rows[0].UserId]);
  if (role === 'Manager') {
    for (const projectId of projectIds) await query('INSERT INTO "UserProjectAccess" ("UserId","ProjectId","AccessLevel") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [created.rows[0].UserId, projectId, role]);
  }
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'User Created', moduleName: 'User Configuration', recordType: 'Users', recordId: created.rows[0].UserId, recordCode: code, employeeId: role === 'Employee' ? employeeId : null, newValue: result.rows[0], description: `Credential created for ${name}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actor = requireAdmin(req, res);
  if (!actor) return;
  const current = await query('SELECT * FROM "Users" WHERE "UserId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'User not found.' });
  const { name, email, role, employeeId, clientId, isActive } = req.body;
  if (!name || !email || !role) return res.status(400).json({ message: 'Name, email, and role are required.' });
  const linkError = await validateUserLinks({ role, employeeId, clientId, currentUserId: req.params.id });
  if (linkError) return res.status(400).json({ message: linkError });
  const duplicate = await query('SELECT "UserId" FROM "Users" WHERE lower("Email")=lower($1) AND "UserId"<>$2', [email, req.params.id]);
  if (duplicate.rows[0]) return res.status(409).json({ message: 'Email already exists.' });
  const result = await query(`
    UPDATE "Users" SET "Name"=$1,"Email"=$2,"Role"=$3,"EmployeeId"=$4,"ClientId"=$5,"IsActive"=$6,"UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "UserId"=$7 RETURNING "UserId","UserCode","Name","Email","Role","EmployeeId","ClientId","IsActive"
  `, [name, email, role, role === 'Employee' ? employeeId : null, role === 'Client Viewer' ? clientId : null, isActive !== false, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'User Updated', moduleName: 'User Configuration', recordType: 'Users', recordId: req.params.id, recordCode: result.rows[0].UserCode, employeeId: result.rows[0].EmployeeId, oldValue: old, newValue: result.rows[0], description: `User updated: ${name}` });
  res.json(result.rows[0]);
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const actor = requireAdmin(req, res);
  if (!actor) return;
  if (!req.body.password) return res.status(400).json({ message: 'Password is required.' });
  const result = await query('UPDATE "Users" SET "PasswordHash"=$1,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "UserId"=$2 RETURNING "UserId","UserCode","Name","Email","Role"', [req.body.password, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: 'User not found.' });
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Password Reset', moduleName: 'User Configuration', recordType: 'Users', recordId: req.params.id, recordCode: result.rows[0].UserCode, description: `Password reset for ${result.rows[0].Name}` });
  res.json({ message: 'Password reset successfully.' });
}));

router.put('/:id/access', asyncHandler(async (req, res) => {
  const actor = requireAdmin(req, res);
  if (!actor) return;
  const user = await query('SELECT "Role" FROM "Users" WHERE "UserId"=$1', [req.params.id]);
  if (!user.rows[0]) return res.status(404).json({ message: 'User not found.' });
  if (user.rows[0].Role !== 'Manager') return res.status(400).json({ message: 'Direct project assignment is available only for Manager users.' });
  const { projectIds = [] } = req.body;
  await query('DELETE FROM "UserProjectAccess" WHERE "UserId"=$1', [req.params.id]);
  for (const projectId of projectIds) await query('INSERT INTO "UserProjectAccess" ("UserId","ProjectId","AccessLevel") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, projectId, 'Manager']);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Project Access Updated', moduleName: 'User Configuration', recordType: 'Users', recordId: req.params.id, newValue: { projectIds }, description: 'Manager project access updated' });
  res.json({ message: 'Access updated.' });
}));

export default router;
