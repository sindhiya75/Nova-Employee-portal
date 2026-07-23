import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role === 'Unauthenticated') return res.status(401).json({ message: 'Valid session token required.' });
  const notifications = [];
  const ids = await accessibleProjectIds(actor);
  const projectFilter = ids === null ? { text: '', params: [] } : ids.length ? { text: ' AND t."ProjectId"=ANY($1::int[])', params: [ids] } : { text: ' AND 1=0', params: [] };

  if (['Admin', 'Manager'].includes(actor.role)) {
    const reopen = await query(`SELECT rr."RequestId", t."TaskName", e."EmployeeName" FROM "TaskReopenRequests" rr JOIN "Tasks" t ON t."TaskId"=rr."TaskId" JOIN "Employees" e ON e."EmployeeId"=rr."EmployeeId" WHERE rr."Status"='Pending' ${projectFilter.text} ORDER BY rr."CreatedAt" DESC LIMIT 10`, projectFilter.params);
    for (const row of reopen.rows) notifications.push({ id: `reopen-${row.RequestId}`, title: 'Task reopen approval', message: `${row.EmployeeName} requested reopen: ${row.TaskName}`, moduleName: 'Tasks', path: '/tasks', createdAt: new Date(), isRead: false });

    const leaveFilter = ids === null ? { text: '', params: [] } : ids.length ? { text: ' AND lpr."ProjectId"=ANY($1::int[])', params: [ids] } : { text: ' AND 1=0', params: [] };
    const leave = await query(`SELECT lpr."RequestId", lpr."RequestCode", lpr."RequestType", e."EmployeeName" FROM "LeavePermissionRequests" lpr JOIN "Employees" e ON e."EmployeeId"=lpr."EmployeeId" WHERE lpr."Status"='Pending' ${leaveFilter.text} ORDER BY lpr."CreatedAt" DESC LIMIT 10`, leaveFilter.params);
    for (const row of leave.rows) notifications.push({ id: `leave-${row.RequestId}`, title: 'Leave/permission approval', message: `${row.EmployeeName}: ${row.RequestType} (${row.RequestCode})`, moduleName: 'Leave Permission', path: '/attendance', createdAt: new Date(), isRead: false });

    const delayed = await query(`SELECT t."TaskId", t."TaskName", p."ProjectName" FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" WHERE t."FinishDate" < CURRENT_DATE AND t."Status" <> 'Closed' ${projectFilter.text} ORDER BY t."FinishDate" LIMIT 10`, projectFilter.params);
    for (const row of delayed.rows) notifications.push({ id: `delay-${row.TaskId}`, title: 'Delayed task', message: `${row.ProjectName}: ${row.TaskName}`, moduleName: 'Tasks', path: '/tasks', createdAt: new Date(), isRead: false });
  }

  if (actor.role === 'Employee' && actor.employeeId) {
    const decisions = await query(`SELECT "RequestId", "RequestCode", "RequestType", "Status", "ManagerRemarks", "UpdatedAt" FROM "LeavePermissionRequests" WHERE "EmployeeId"=$1 AND "Status" IN ('Approved','Rejected') ORDER BY COALESCE("UpdatedAt", "CreatedAt") DESC LIMIT 10`, [actor.employeeId]);
    for (const row of decisions.rows) notifications.push({ id: `decision-${row.RequestId}`, title: `${row.RequestType} ${row.Status}`, message: `${row.RequestCode}: ${row.ManagerRemarks || row.Status}`, moduleName: 'My Leave & Permission', path: '/my-attendance', createdAt: row.UpdatedAt, isRead: false });
  }

  const audit = actor.role === 'Employee'
    ? await query('SELECT "AuditId", "ActionType", "ModuleName", "Description", "CreatedAt" FROM "AuditLogs" WHERE "EmployeeId"=$1 ORDER BY "CreatedAt" DESC LIMIT 5', [actor.employeeId])
    : await query('SELECT "AuditId", "ActionType", "ModuleName", "Description", "CreatedAt" FROM "AuditLogs" ORDER BY "CreatedAt" DESC LIMIT 5');
  for (const row of audit.rows) notifications.push({ id: `audit-${row.AuditId}`, title: `${row.ModuleName}: ${row.ActionType}`, message: row.Description || 'Recent portal activity', moduleName: 'Audit', path: '/audit-trail', createdAt: row.CreatedAt, isRead: true });

  res.json({ unreadCount: notifications.filter((n) => !n.isRead).length, notifications: notifications.slice(0, 30) });
}));

export default router;

