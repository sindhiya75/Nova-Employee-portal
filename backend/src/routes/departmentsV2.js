import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../utils/audit.js';
import { actorFromRequest } from '../utils/access.js';

const router = express.Router();
const departmentCode = (projectId, departmentId) => `DEPT-PRJ${String(projectId || 0).padStart(3, '0')}-${String(departmentId).padStart(4, '0')}`;

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const filters = [];
  if (req.query.projectId) { params.push(req.query.projectId); filters.push(`department."ProjectId"=$${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(department."DepartmentName" ILIKE $${params.length} OR department."DepartmentCode" ILIKE $${params.length})`);
  }
  if (req.query.activeOnly !== 'false') filters.push(`department."Status"='Active'`);
  const result = await query(`
    SELECT department.*, project."ProjectCode", project."ProjectName",
      head."EmployeeCode" AS "DepartmentHeadCode", head."EmployeeName" AS "DepartmentHeadName",
      (SELECT COUNT(*)::int FROM "Employees" employee WHERE employee."DepartmentId"=department."DepartmentId") AS "EmployeeCount",
      (SELECT COUNT(*)::int FROM "WorkItems" work WHERE work."DepartmentId"=department."DepartmentId") AS "WorkCount"
    FROM "Departments" department
    LEFT JOIN "Projects" project ON project."ProjectId"=department."ProjectId"
    LEFT JOIN "Employees" head ON head."EmployeeId"=department."DepartmentHeadId"
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY project."ProjectName", department."DepartmentName"
  `, params);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { projectId, departmentName, departmentHeadId, description, status = 'Active' } = req.body;
  if (!projectId || !departmentName) return res.status(400).json({ message: 'Project and department name are required.' });
  const duplicate = await query('SELECT "DepartmentId" FROM "Departments" WHERE "ProjectId"=$1 AND lower("DepartmentName")=lower($2)', [projectId, departmentName.trim()]);
  if (duplicate.rows[0]) return res.status(409).json({ message: 'This department already exists in the selected project.' });
  const pendingCode = `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await query(`
    INSERT INTO "Departments" ("DepartmentCode","ProjectId","DepartmentName","DepartmentHeadId","Description","Status")
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [pendingCode, projectId, departmentName.trim(), departmentHeadId || null, description || null, status]);
  const code = departmentCode(projectId, created.rows[0].DepartmentId);
  const result = await query('UPDATE "Departments" SET "DepartmentCode"=$1 WHERE "DepartmentId"=$2 RETURNING *', [code, created.rows[0].DepartmentId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Create', moduleName: 'Departments', recordType: 'Departments', recordId: result.rows[0].DepartmentId, recordCode: code, projectId, departmentId: result.rows[0].DepartmentId, newValue: result.rows[0], description: `Department created: ${departmentName}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const current = await query('SELECT * FROM "Departments" WHERE "DepartmentId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Department not found.' });
  const { projectId = old.ProjectId, departmentName, departmentHeadId, description, status = 'Active' } = req.body;
  if (!departmentName) return res.status(400).json({ message: 'Department name is required.' });
  if (Number(projectId) !== Number(old.ProjectId)) {
    const usage = await query('SELECT (SELECT COUNT(*) FROM "WorkItems" WHERE "DepartmentId"=$1) + (SELECT COUNT(*) FROM "Tasks" WHERE "DepartmentId"=$1) + (SELECT COUNT(*) FROM "Employees" WHERE "DepartmentId"=$1) AS count', [req.params.id]);
    if (Number(usage.rows[0]?.count || 0) > 0) return res.status(409).json({ message: 'A used department cannot be moved to another project.' });
  }
  const duplicate = await query('SELECT "DepartmentId" FROM "Departments" WHERE "ProjectId"=$1 AND lower("DepartmentName")=lower($2) AND "DepartmentId"<>$3', [projectId, departmentName.trim(), req.params.id]);
  if (duplicate.rows[0]) return res.status(409).json({ message: 'This department already exists in the selected project.' });
  const code = departmentCode(projectId, old.DepartmentId);
  const result = await query(`
    UPDATE "Departments" SET "DepartmentCode"=$1,"ProjectId"=$2,"DepartmentName"=$3,"DepartmentHeadId"=$4,
      "Description"=$5,"Status"=$6,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "DepartmentId"=$7 RETURNING *
  `, [code, projectId, departmentName.trim(), departmentHeadId || null, description || null, status, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Update', moduleName: 'Departments', recordType: 'Departments', recordId: old.DepartmentId, recordCode: code, projectId, departmentId: old.DepartmentId, oldValue: old, newValue: result.rows[0], description: `Department updated: ${departmentName}` });
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const current = await query('SELECT * FROM "Departments" WHERE "DepartmentId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Department not found.' });
  const usage = await query('SELECT (SELECT COUNT(*) FROM "Employees" WHERE "DepartmentId"=$1) + (SELECT COUNT(*) FROM "Tasks" WHERE "DepartmentId"=$1) + (SELECT COUNT(*) FROM "WorkItems" WHERE "DepartmentId"=$1) AS count', [req.params.id]);
  if (Number(usage.rows[0]?.count || 0) > 0) return res.status(409).json({ message: 'Department is linked to employees, tasks, or works. Mark it inactive instead.' });
  await query('DELETE FROM "Departments" WHERE "DepartmentId"=$1', [req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Delete', moduleName: 'Departments', recordType: 'Departments', recordId: old.DepartmentId, recordCode: old.DepartmentCode, projectId: old.ProjectId, departmentId: old.DepartmentId, oldValue: old, description: `Department deleted: ${old.DepartmentName}` });
  res.status(204).send();
}));

export default router;
