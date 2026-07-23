import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../utils/audit.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const params = [];
  const where = [];
  if (req.query.departmentId) { params.push(req.query.departmentId); where.push(`e."DepartmentId"=$${params.length}`); }
  if (req.query.activeOnly !== 'false') where.push('e."IsActive" = TRUE');
  const projectIds = await accessibleProjectIds(actor);
  if (actor.role === 'Manager' && projectIds !== null) {
    if (!projectIds.length) where.push('1=0');
    else { params.push(projectIds); where.push(`EXISTS (SELECT 1 FROM "Tasks" tx WHERE tx."AssignedEmployeeId"=e."EmployeeId" AND tx."ProjectId"=ANY($${params.length}::int[]))`); }
  }
  const result = await query(`
    SELECT e.*, d."DepartmentName", d."DepartmentCode",
      COALESCE(SUM(CASE WHEN t."Status" = 'Open' THEN 1 ELSE 0 END), 0)::int AS "AssignedTasks",
      COALESCE(SUM(CASE WHEN t."Status" = 'Running' THEN 1 ELSE 0 END), 0)::int AS "RunningTasks",
      COALESCE(SUM(CASE WHEN t."Status" = 'Closed' THEN 1 ELSE 0 END), 0)::int AS "CompletedTasks"
    FROM "Employees" e
    LEFT JOIN "Departments" d ON d."DepartmentId"=e."DepartmentId"
    LEFT JOIN "Tasks" t ON t."AssignedEmployeeId" = e."EmployeeId"
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY e."EmployeeId", d."DepartmentName", d."DepartmentCode"
    ORDER BY d."DepartmentName", e."EmployeeName"
  `, params);
  res.json(result.rows);
}));

router.get('/:id/tasks', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT t.*, p."ProjectCode", p."ProjectName", sw."SubWorkName", d."DepartmentName", wi."WorkName"
    FROM "Tasks" t
    JOIN "Projects" p ON p."ProjectId" = t."ProjectId"
    LEFT JOIN "SubWorks" sw ON sw."SubWorkId" = t."SubWorkId"
    LEFT JOIN "Departments" d ON d."DepartmentId" = t."DepartmentId"
    LEFT JOIN "WorkItems" wi ON wi."WorkItemId" = t."WorkItemId"
    WHERE t."AssignedEmployeeId" = $1
    ORDER BY t."Status", t."FinishDate"
  `, [req.params.id]);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { employeeName, email, phone, designation, department, departmentId, isActive = true } = req.body;
  const result = await query(`INSERT INTO "Employees" ("EmployeeName", "Email", "Phone", "Designation", "Department", "DepartmentId", "IsActive") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [employeeName, email, phone, designation, department, departmentId || null, isActive]);
  await query('UPDATE "Employees" SET "EmployeeCode"=$1 WHERE "EmployeeId"=$2', [`EMP-2026-${String(result.rows[0].EmployeeId).padStart(4, '0')}`, result.rows[0].EmployeeId]);
  await logAudit(req, { actionType: 'Create', moduleName: 'Employees', recordType: 'Employees', recordId: result.rows[0].EmployeeId, newValue: result.rows[0], description: `Employee created: ${employeeName}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { employeeName, email, phone, designation, department, departmentId, isActive = true } = req.body;
  const old = await query('SELECT * FROM "Employees" WHERE "EmployeeId"=$1', [req.params.id]);
  const result = await query(`UPDATE "Employees" SET "EmployeeName"=$1, "Email"=$2, "Phone"=$3, "Designation"=$4, "Department"=$5, "DepartmentId"=$6, "IsActive"=$7, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "EmployeeId"=$8 RETURNING *`, [employeeName, email, phone, designation, department, departmentId || null, isActive, req.params.id]);
  await logAudit(req, { actionType: 'Update', moduleName: 'Employees', recordType: 'Employees', recordId: req.params.id, oldValue: old.rows[0], newValue: result.rows[0], description: `Employee updated: ${employeeName}` });
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const old = await query('SELECT * FROM "Employees" WHERE "EmployeeId"=$1', [req.params.id]);
  await query('DELETE FROM "Employees" WHERE "EmployeeId"=$1', [req.params.id]);
  await logAudit(req, { actionType: 'Delete', moduleName: 'Employees', recordType: 'Employees', recordId: req.params.id, oldValue: old.rows[0], description: 'Employee deleted' });
  res.status(204).send();
}));

export default router;
