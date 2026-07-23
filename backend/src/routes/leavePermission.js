import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';
import { nextBusinessCode } from '../utils/codes.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();
const requestPrefixes = { Permission: 'PER', 'On Duty': 'OD', 'Full Day Leave': 'LEV', 'Half Day Leave': 'LEV' };

async function defaultEmployeeScope(employeeId) {
  const result = await query(`
    SELECT e."EmployeeId", e."DepartmentId", e."ReportingManagerUserId", t."ProjectId"
    FROM "Employees" e
    LEFT JOIN LATERAL (SELECT "ProjectId" FROM "Tasks" WHERE "AssignedEmployeeId"=e."EmployeeId" ORDER BY COALESCE("UpdatedAt", "CreatedAt") DESC LIMIT 1) t ON TRUE
    WHERE e."EmployeeId"=$1
  `, [employeeId]);
  return result.rows[0] || {};
}

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const params = [];
  const filters = [];
  if (actor.role === 'Employee') { params.push(actor.employeeId); filters.push(`lpr."EmployeeId"=$${params.length}`); }
  else if (actor.role === 'Manager') {
    const ids = await accessibleProjectIds(actor);
    if (!ids.length) filters.push('1=0');
    else { params.push(ids); filters.push(`lpr."ProjectId"=ANY($${params.length}::int[])`); }
  }
  if (req.query.status) { params.push(req.query.status); filters.push(`lpr."Status"=$${params.length}`); }
  if (req.query.mine === 'true' && actor.employeeId) { params.push(actor.employeeId); filters.push(`lpr."EmployeeId"=$${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    SELECT lpr.*, e."EmployeeCode", e."EmployeeName", p."ProjectCode", p."ProjectName", d."DepartmentName", u."Name" AS "ReportingManagerName", au."Name" AS "ApprovedByName"
    FROM "LeavePermissionRequests" lpr
    JOIN "Employees" e ON e."EmployeeId"=lpr."EmployeeId"
    LEFT JOIN "Projects" p ON p."ProjectId"=lpr."ProjectId"
    LEFT JOIN "Departments" d ON d."DepartmentId"=lpr."DepartmentId"
    LEFT JOIN "Users" u ON u."UserId"=lpr."ReportingManagerUserId"
    LEFT JOIN "Users" au ON au."UserId"=lpr."ApprovedByUserId"
    ${where}
    ORDER BY lpr."CreatedAt" DESC
  `, params);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const employeeId = actor.role === 'Employee' ? actor.employeeId : req.body.employeeId;
  if (!employeeId) return res.status(400).json({ message: 'Employee is required.' });
  const { requestType, fromDate, toDate, halfDaySession, permissionDate, fromTime, toTime, reason } = req.body;
  if (!requestType || !reason) return res.status(400).json({ message: 'Request type and reason are required.' });
  if (!['Full Day Leave', 'Half Day Leave', 'Permission', 'On Duty'].includes(requestType)) return res.status(400).json({ message: 'Invalid request type.' });
  const scope = await defaultEmployeeScope(employeeId);
  const code = await nextBusinessCode('LeavePermissionRequests', 'RequestCode', { prefix: requestPrefixes[requestType] || 'REQ' });
  const result = await query(`
    INSERT INTO "LeavePermissionRequests" ("RequestCode", "RequestType", "EmployeeId", "ProjectId", "DepartmentId", "ReportingManagerUserId", "FromDate", "ToDate", "HalfDaySession", "PermissionDate", "FromTime", "ToTime", "Reason")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
  `, [code, requestType, employeeId, req.body.projectId || scope.ProjectId || null, req.body.departmentId || scope.DepartmentId || null, req.body.reportingManagerUserId || scope.ReportingManagerUserId || null, fromDate || null, toDate || null, halfDaySession || null, permissionDate || null, fromTime || null, toTime || null, reason]);
  await logAudit(req, { userId: actor.userId, employeeId, userRole: actor.role, actionType: 'Attendance Request Created', moduleName: 'Attendance', recordType: 'LeavePermissionRequests', recordId: result.rows[0].RequestId, recordCode: code, projectId: result.rows[0].ProjectId, departmentId: result.rows[0].DepartmentId, newValue: result.rows[0], description: `${requestType} requested` });
  res.status(201).json(result.rows[0]);
}));

router.post('/:id/decision', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (!['Admin', 'Manager'].includes(actor.role)) return res.status(403).json({ message: 'Only Admin/Manager can approve requests.' });
  const { decision, managerRemarks } = req.body;
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
  const current = await query('SELECT * FROM "LeavePermissionRequests" WHERE "RequestId"=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ message: 'Request not found.' });
  if (actor.role === 'Manager') {
    const ids = await accessibleProjectIds(actor);
    if (current.rows[0].ProjectId && !ids.includes(Number(current.rows[0].ProjectId))) return res.status(403).json({ message: 'Request is outside assigned project.' });
  }
  const result = await query(`UPDATE "LeavePermissionRequests" SET "Status"=$1, "ManagerRemarks"=$2, "ApprovedByUserId"=$3, "ApprovedAt"=CURRENT_TIMESTAMP, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "RequestId"=$4 RETURNING *`, [decision, managerRemarks || null, actor.userId || null, req.params.id]);
  if (decision === 'Approved') await syncAttendance(result.rows[0]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, employeeId: result.rows[0].EmployeeId, actionType: `Attendance Request ${decision}`, moduleName: 'Attendance', recordType: 'LeavePermissionRequests', recordId: req.params.id, recordCode: result.rows[0].RequestCode, projectId: result.rows[0].ProjectId, departmentId: result.rows[0].DepartmentId, newValue: result.rows[0], description: `${result.rows[0].RequestType} ${decision.toLowerCase()}` });
  res.json(result.rows[0]);
}));

async function syncAttendance(request) {
  if (request.RequestType === 'Permission') return;
  const status = request.RequestType === 'Half Day Leave' ? 'Half Day Leave' : request.RequestType === 'On Duty' ? 'On Duty' : 'Leave';
  const start = request.FromDate || request.PermissionDate;
  const end = request.ToDate || request.FromDate || request.PermissionDate;
  await query(`
    INSERT INTO "AttendanceLogs" ("EmployeeId", "AttendanceDate", "Status", "Remarks", "ProjectId", "DepartmentId", "AttendanceCode")
    SELECT $1, d::date, $2, $3, $4, $5, 'ATT-' || TO_CHAR(d::date, 'YYYYMMDD') || '-' || LPAD($1::text, 4, '0')
    FROM generate_series($6::date, $7::date, interval '1 day') d
    ON CONFLICT ("EmployeeId", "AttendanceDate") DO UPDATE SET "Status"=EXCLUDED."Status", "Remarks"=EXCLUDED."Remarks", "ProjectId"=EXCLUDED."ProjectId", "DepartmentId"=EXCLUDED."DepartmentId", "UpdatedAt"=CURRENT_TIMESTAMP
  `, [request.EmployeeId, status, `${request.RequestCode} approved: ${request.Reason}`, request.ProjectId, request.DepartmentId, start, end]);
}

export default router;
