import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';
import { logAudit } from '../utils/audit.js';
import { nextAttendanceCode } from '../utils/codes.js';

const router = express.Router();

function monthStart(month) { return month ? `${month}-01` : null; }

async function defaultProjectForEmployee(employeeId) {
  const result = await query(`
    SELECT t."ProjectId", t."DepartmentId"
    FROM "Tasks" t
    WHERE t."AssignedEmployeeId"=$1
    ORDER BY COALESCE(t."UpdatedAt", t."CreatedAt") DESC NULLS LAST
    LIMIT 1
  `, [employeeId]);
  return result.rows[0] || { ProjectId: null, DepartmentId: null };
}

async function attendanceFilters(req, alias = 'al') {
  const actor = actorFromRequest(req);
  const params = [];
  const filters = [];
  if (req.query.month) {
    params.push(monthStart(req.query.month));
    filters.push(`${alias}."AttendanceDate" >= $${params.length}::date AND ${alias}."AttendanceDate" < ($${params.length}::date + interval '1 month')`);
  } else if (req.query.date) {
    params.push(req.query.date);
    filters.push(`${alias}."AttendanceDate" = $${params.length}::date`);
  } else {
    params.push(new Date().toISOString().slice(0, 10));
    filters.push(`${alias}."AttendanceDate" = $${params.length}::date`);
  }
  if (actor.role === 'Employee') {
    params.push(actor.employeeId || 0);
    filters.push(`${alias}."EmployeeId"=$${params.length}`);
  } else {
    const projectIds = await accessibleProjectIds(actor);
    if (projectIds !== null) {
      if (!projectIds.length) filters.push('1=0');
      else { params.push(projectIds); filters.push(`${alias}."ProjectId" = ANY($${params.length}::int[])`); }
    }
    if (req.query.projectId && req.query.projectId !== 'overall') { params.push(req.query.projectId); filters.push(`${alias}."ProjectId"=$${params.length}`); }
    if (req.query.departmentId) { params.push(req.query.departmentId); filters.push(`${alias}."DepartmentId"=$${params.length}`); }
    if (req.query.employeeId) { params.push(req.query.employeeId); filters.push(`${alias}."EmployeeId"=$${params.length}`); }
    if (req.query.status) { params.push(req.query.status); filters.push(`${alias}."Status"=$${params.length}`); }
  }
  return { actor, params, where: filters.length ? `WHERE ${filters.join(' AND ')}` : '' };
}

router.get('/', asyncHandler(async (req, res) => {
  const scoped = await attendanceFilters(req);
  const result = await query(`
    SELECT al.*, e."EmployeeCode", e."EmployeeName", e."Designation", e."Department", p."ProjectCode", p."ProjectName", d."DepartmentName"
    FROM "AttendanceLogs" al
    JOIN "Employees" e ON e."EmployeeId" = al."EmployeeId"
    LEFT JOIN "Projects" p ON p."ProjectId" = al."ProjectId"
    LEFT JOIN "Departments" d ON d."DepartmentId" = al."DepartmentId"
    ${scoped.where}
    ORDER BY al."AttendanceDate" DESC, al."CheckInTime" DESC NULLS LAST, e."EmployeeName"
  `, scoped.params);
  res.json(result.rows);
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const scoped = await attendanceFilters(req);
  const result = await query(`
    SELECT COUNT(*)::int AS "Total",
      COUNT(*) FILTER (WHERE "Status"='Present')::int AS "Present",
      COUNT(*) FILTER (WHERE "Status"='Late')::int AS "Late",
      COUNT(*) FILTER (WHERE "Status"='Leave' OR "Status"='Half Day Leave')::int AS "Leave",
      COUNT(*) FILTER (WHERE "Status"='On Duty')::int AS "OnDuty",
      COUNT(*) FILTER (WHERE "Status"='Absent')::int AS "Absent"
    FROM "AttendanceLogs" al
    ${scoped.where}
  `, scoped.params);
  res.json(result.rows[0]);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role === 'Employee') return res.status(403).json({ message: 'Employees can only check in/out from My Attendance.' });
  const { employeeId, attendanceDate, checkInTime, checkOutTime, status = 'Present', remarks, projectId, departmentId } = req.body;
  if (!employeeId) return res.status(400).json({ message: 'Employee is required.' });
  const fallback = await defaultProjectForEmployee(employeeId);
  const attendanceCode = await nextAttendanceCode(attendanceDate || new Date());
  const result = await query(`
    INSERT INTO "AttendanceLogs" ("AttendanceCode", "EmployeeId", "AttendanceDate", "CheckInTime", "CheckOutTime", "Status", "Remarks", "ProjectId", "DepartmentId")
    VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::timestamp, $5::timestamp, $6, $7, $8, $9)
    ON CONFLICT ("EmployeeId", "AttendanceDate") DO UPDATE SET "AttendanceCode"=COALESCE("AttendanceLogs"."AttendanceCode", EXCLUDED."AttendanceCode"), "CheckInTime"=EXCLUDED."CheckInTime", "CheckOutTime"=EXCLUDED."CheckOutTime", "Status"=EXCLUDED."Status", "Remarks"=EXCLUDED."Remarks", "ProjectId"=EXCLUDED."ProjectId", "DepartmentId"=EXCLUDED."DepartmentId", "UpdatedAt"=CURRENT_TIMESTAMP
    RETURNING *
  `, [attendanceCode, employeeId, attendanceDate || null, checkInTime || null, checkOutTime || null, status, remarks || 'Attendance maintained by portal', projectId || fallback.ProjectId, departmentId || fallback.DepartmentId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, employeeId, actionType: 'Attendance Saved', moduleName: 'Attendance', recordType: 'AttendanceLogs', recordId: result.rows[0].AttendanceId, projectId: result.rows[0].ProjectId, departmentId: result.rows[0].DepartmentId, newValue: result.rows[0], description: `Attendance saved for employee ${employeeId}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role === 'Employee') return res.status(403).json({ message: 'Employees cannot edit attendance logs.' });
  const old = await query('SELECT * FROM "AttendanceLogs" WHERE "AttendanceId"=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ message: 'Attendance log not found.' });
  const { attendanceDate, checkInTime, checkOutTime, status, remarks, projectId, departmentId } = req.body;
  const result = await query(`
    UPDATE "AttendanceLogs" SET "AttendanceDate"=COALESCE($1::date,"AttendanceDate"), "CheckInTime"=$2::timestamp, "CheckOutTime"=$3::timestamp, "Status"=$4, "Remarks"=$5, "ProjectId"=$6, "DepartmentId"=$7, "UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "AttendanceId"=$8 RETURNING *
  `, [attendanceDate || old.rows[0].AttendanceDate, checkInTime || old.rows[0].CheckInTime, checkOutTime || old.rows[0].CheckOutTime, status || old.rows[0].Status, remarks || old.rows[0].Remarks, projectId || old.rows[0].ProjectId, departmentId || old.rows[0].DepartmentId, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, employeeId: result.rows[0].EmployeeId, actionType: 'Attendance Updated', moduleName: 'Attendance', recordType: 'AttendanceLogs', recordId: req.params.id, oldValue: old.rows[0], newValue: result.rows[0], description: 'Attendance log updated' });
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role !== 'Admin') return res.status(403).json({ message: 'Only Admin can delete attendance logs.' });
  const old = await query('SELECT * FROM "AttendanceLogs" WHERE "AttendanceId"=$1', [req.params.id]);
  await query('DELETE FROM "AttendanceLogs" WHERE "AttendanceId"=$1', [req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, employeeId: old.rows[0]?.EmployeeId, actionType: 'Attendance Deleted', moduleName: 'Attendance', recordType: 'AttendanceLogs', recordId: req.params.id, oldValue: old.rows[0], description: 'Attendance log deleted' });
  res.status(204).send();
}));

router.post('/check-in', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const employeeId = actor.role === 'Employee' ? actor.employeeId : req.body.employeeId;
  const { attendanceDate, status = 'Present', remarks, projectId, departmentId } = req.body;
  if (!employeeId) return res.status(400).json({ message: 'Employee is required.' });
  const fallback = await defaultProjectForEmployee(employeeId);
  const attendanceCode = await nextAttendanceCode(attendanceDate || new Date());
  const result = await query(`
    INSERT INTO "AttendanceLogs" ("AttendanceCode", "EmployeeId", "AttendanceDate", "CheckInTime", "Status", "Remarks", "ProjectId", "DepartmentId")
    VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), CURRENT_TIMESTAMP, $4, $5, $6, $7)
    ON CONFLICT ("EmployeeId", "AttendanceDate") DO UPDATE SET "AttendanceCode"=COALESCE("AttendanceLogs"."AttendanceCode", EXCLUDED."AttendanceCode"), "CheckInTime"=COALESCE("AttendanceLogs"."CheckInTime", EXCLUDED."CheckInTime"), "Status"=EXCLUDED."Status", "Remarks"=EXCLUDED."Remarks", "ProjectId"=EXCLUDED."ProjectId", "DepartmentId"=EXCLUDED."DepartmentId", "UpdatedAt"=CURRENT_TIMESTAMP
    RETURNING *
  `, [attendanceCode, employeeId, attendanceDate || null, status, remarks || 'Checked in from My Attendance', projectId || fallback.ProjectId, departmentId || fallback.DepartmentId]);
  res.status(201).json(result.rows[0]);
}));

router.post('/check-out', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const employeeId = actor.role === 'Employee' ? actor.employeeId : req.body.employeeId;
  const { attendanceDate, remarks } = req.body;
  if (!employeeId) return res.status(400).json({ message: 'Employee is required.' });
  const result = await query(`UPDATE "AttendanceLogs" SET "CheckOutTime"=CURRENT_TIMESTAMP, "Remarks"=COALESCE($3,"Remarks"), "UpdatedAt"=CURRENT_TIMESTAMP WHERE "EmployeeId"=$1 AND "AttendanceDate"=COALESCE($2::date,CURRENT_DATE) RETURNING *`, [employeeId, attendanceDate || null, remarks || null]);
  if (!result.rows[0]) {
    const fallback = await defaultProjectForEmployee(employeeId);
    const attendanceCode = await nextAttendanceCode(attendanceDate || new Date());
    const created = await query(`INSERT INTO "AttendanceLogs" ("AttendanceCode", "EmployeeId", "AttendanceDate", "CheckInTime", "CheckOutTime", "Status", "Remarks", "ProjectId", "DepartmentId") VALUES ($1, $2, COALESCE($3::date,CURRENT_DATE), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Present', $4, $5, $6) ON CONFLICT ("EmployeeId", "AttendanceDate") DO UPDATE SET "AttendanceCode"=COALESCE("AttendanceLogs"."AttendanceCode", EXCLUDED."AttendanceCode"), "CheckOutTime"=CURRENT_TIMESTAMP, "UpdatedAt"=CURRENT_TIMESTAMP RETURNING *`, [attendanceCode, employeeId, attendanceDate || null, remarks || 'Checked out from My Attendance', fallback.ProjectId, fallback.DepartmentId]);
    return res.status(201).json(created.rows[0]);
  }
  res.json(result.rows[0]);
}));

export default router;


