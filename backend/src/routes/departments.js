import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const filters = [];
  if (req.query.projectId) { params.push(req.query.projectId); filters.push(`d."ProjectId"=$${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(d."DepartmentName" ILIKE $${params.length} OR d."DepartmentCode" ILIKE $${params.length})`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    SELECT d.*, p."ProjectName", e."EmployeeName" AS "DepartmentHeadName"
    FROM "Departments" d
    LEFT JOIN "Projects" p ON p."ProjectId"=d."ProjectId"
    LEFT JOIN "Employees" e ON e."EmployeeId"=d."DepartmentHeadId"
    ${where}
    ORDER BY d."DepartmentName"
  `, params);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { projectId, departmentName, departmentCode, departmentHeadId, description, status = 'Active' } = req.body;
  if (!departmentName) return res.status(400).json({ message: 'Department name is required' });
  const code = departmentCode || `DEPT-${departmentName.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const result = await query(`
    INSERT INTO "Departments" ("DepartmentCode", "ProjectId", "DepartmentName", "DepartmentHeadId", "Description", "Status")
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [code, projectId || null, departmentName, departmentHeadId || null, description, status]);
  await logAudit(req, { actionType: 'Create', moduleName: 'Departments', recordType: 'Departments', recordId: result.rows[0].DepartmentId, recordCode: result.rows[0].DepartmentCode, projectId, newValue: result.rows[0], description: `Department created: ${departmentName}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { projectId, departmentName, departmentCode, departmentHeadId, description, status = 'Active' } = req.body;
  if (!departmentName) return res.status(400).json({ message: 'Department name is required' });
  const current = await query('SELECT * FROM "Departments" WHERE "DepartmentId"=$1', [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ message: 'Department not found' });
  const result = await query(`
    UPDATE "Departments"
    SET "DepartmentCode"=$1, "ProjectId"=$2, "DepartmentName"=$3, "DepartmentHeadId"=$4,
        "Description"=$5, "Status"=$6, "UpdatedAt"=NOW()
    WHERE "DepartmentId"=$7
    RETURNING *
  `, [departmentCode, projectId || null, departmentName, departmentHeadId || null, description, status, req.params.id]);
  await logAudit(req, { actionType: 'Update', moduleName: 'Departments', recordType: 'Departments', recordId: req.params.id, recordCode: result.rows[0].DepartmentCode, projectId, oldValue: current.rows[0], newValue: result.rows[0], description: `Department updated: ${departmentName}` });
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const current = await query('SELECT * FROM "Departments" WHERE "DepartmentId"=$1', [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ message: 'Department not found' });
  const used = await query('SELECT COUNT(*)::int AS count FROM "Employees" WHERE "DepartmentId"=$1 UNION ALL SELECT COUNT(*)::int AS count FROM "Tasks" WHERE "DepartmentId"=$1', [req.params.id]);
  const usedCount = used.rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  if (usedCount > 0) return res.status(400).json({ message: 'Department is used by employees or tasks. Change those records before deleting.' });
  await query('DELETE FROM "Departments" WHERE "DepartmentId"=$1', [req.params.id]);
  await logAudit(req, { actionType: 'Delete', moduleName: 'Departments', recordType: 'Departments', recordId: req.params.id, recordCode: current.rows[0].DepartmentCode, oldValue: current.rows[0], description: `Department deleted: ${current.rows[0].DepartmentName}` });
  res.json({ message: 'Department deleted' });
}));

export default router;
