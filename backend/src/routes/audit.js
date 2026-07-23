import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const filters = [];
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(a."ActionType" ILIKE $${params.length} OR a."ModuleName" ILIKE $${params.length} OR a."RecordCode" ILIKE $${params.length} OR a."Description" ILIKE $${params.length} OR u."Name" ILIKE $${params.length} OR u."Email" ILIKE $${params.length} OR p."ProjectName" ILIKE $${params.length} OR d."DepartmentName" ILIKE $${params.length} OR w."WorkName" ILIKE $${params.length} OR t."TaskName" ILIKE $${params.length})`);
  }
  if (req.query.userId) { params.push(req.query.userId); filters.push(`a."UserId"=$${params.length}`); }
  if (req.query.moduleName) { params.push(req.query.moduleName); filters.push(`a."ModuleName"=$${params.length}`); }
  if (req.query.actionType) { params.push(req.query.actionType); filters.push(`a."ActionType"=$${params.length}`); }
  if (req.query.dateFrom) { params.push(`${req.query.dateFrom}T${req.query.timeFrom || '00:00'}:00`); filters.push(`a."CreatedAt" >= $${params.length}::timestamp`); }
  if (req.query.dateTo) { params.push(`${req.query.dateTo}T${req.query.timeTo || '23:59'}:59`); filters.push(`a."CreatedAt" <= $${params.length}::timestamp`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    SELECT a.*, u."Name" AS "UserName", u."Email" AS "UserEmail", e."EmployeeName", p."ProjectName", d."DepartmentName", w."WorkName", t."TaskName", t."TaskCode"
    FROM "AuditLogs" a
    LEFT JOIN "Users" u ON u."UserId"=a."UserId"
    LEFT JOIN "Employees" e ON e."EmployeeId"=a."EmployeeId"
    LEFT JOIN "Projects" p ON p."ProjectId"=a."ProjectId"
    LEFT JOIN "Departments" d ON d."DepartmentId"=a."DepartmentId"
    LEFT JOIN "WorkItems" w ON w."WorkItemId"=a."WorkItemId"
    LEFT JOIN "Tasks" t ON t."TaskId"=a."TaskId"
    ${where}
    ORDER BY a."CreatedAt" DESC LIMIT 500
  `, params);
  res.json(result.rows);
}));

export default router;
