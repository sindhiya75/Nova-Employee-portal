import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest } from '../utils/access.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT u."UserId", u."UserCode", u."Name", u."Email", u."Role", u."EmployeeId", u."IsActive", e."EmployeeName", e."EmployeeCode",
      COALESCE(json_agg(json_build_object('ProjectId', p."ProjectId", 'ProjectName', p."ProjectName")) FILTER (WHERE p."ProjectId" IS NOT NULL), '[]') AS "Projects"
    FROM "Users" u
    LEFT JOIN "Employees" e ON e."EmployeeId"=u."EmployeeId"
    LEFT JOIN "UserProjectAccess" upa ON upa."UserId"=u."UserId"
    LEFT JOIN "Projects" p ON p."ProjectId"=upa."ProjectId"
    GROUP BY u."UserId", e."EmployeeName", e."EmployeeCode"
    ORDER BY u."Role", u."Name"
  `);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { name, email, password, role, employeeId, projectIds = [] } = req.body;
  const code = `USR-${role.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)}-${Date.now().toString().slice(-5)}`;
  const created = await query(`INSERT INTO "Users" ("UserCode", "Name", "Email", "PasswordHash", "Role", "EmployeeId", "IsActive") VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING *`, [code, name, email, password, role, employeeId || null]);
  for (const projectId of projectIds) await query(`INSERT INTO "UserProjectAccess" ("UserId", "ProjectId", "AccessLevel") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [created.rows[0].UserId, projectId, role]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'User Created', moduleName: 'User Configuration', recordType: 'Users', recordId: created.rows[0].UserId, recordCode: code, newValue: created.rows[0], description: `Credential created for ${name}` });
  res.status(201).json(created.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role !== 'Admin') return res.status(403).json({ message: 'Only Admin can edit users.' });
  const old = await query('SELECT * FROM "Users" WHERE "UserId"=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ message: 'User not found.' });
  const { name, email, role, employeeId, isActive } = req.body;
  if (!name || !email || !role) return res.status(400).json({ message: 'Name, email, and role are required.' });
  const duplicate = await query('SELECT "UserId" FROM "Users" WHERE lower("Email")=lower($1) AND "UserId"<>$2', [email, req.params.id]);
  if (duplicate.rows[0]) return res.status(409).json({ message: 'Email already exists.' });
  const result = await query(`UPDATE "Users" SET "Name"=$1, "Email"=$2, "Role"=$3, "EmployeeId"=$4, "IsActive"=$5, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "UserId"=$6 RETURNING "UserId", "UserCode", "Name", "Email", "Role", "EmployeeId", "IsActive"`, [name, email, role, employeeId || null, isActive !== false, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'User Updated', moduleName: 'User Configuration', recordType: 'Users', recordId: req.params.id, recordCode: result.rows[0].UserCode, oldValue: old.rows[0], newValue: result.rows[0], description: `User updated: ${name}` });
  res.json(result.rows[0]);
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role !== 'Admin') return res.status(403).json({ message: 'Only Admin can reset passwords.' });
  const { password } = req.body;
  if (!password) return res.status(400).json({ message: 'Password is required.' });
  const result = await query('UPDATE "Users" SET "PasswordHash"=$1, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "UserId"=$2 RETURNING "UserId", "UserCode", "Name", "Email", "Role"', [password, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: 'User not found.' });
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Password Reset', moduleName: 'User Configuration', recordType: 'Users', recordId: req.params.id, recordCode: result.rows[0].UserCode, description: `Password reset for ${result.rows[0].Name}` });
  res.json({ message: 'Password reset successfully.' });
}));

router.put('/:id/access', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { projectIds = [] } = req.body;
  await query('DELETE FROM "UserProjectAccess" WHERE "UserId"=$1', [req.params.id]);
  for (const projectId of projectIds) await query(`INSERT INTO "UserProjectAccess" ("UserId", "ProjectId", "AccessLevel") VALUES ($1,$2,'Manager') ON CONFLICT DO NOTHING`, [req.params.id, projectId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Project Access Updated', moduleName: 'User Configuration', recordType: 'Users', recordId: req.params.id, newValue: { projectIds }, description: 'User project access updated' });
  res.json({ message: 'Access updated' });
}));

export default router;
