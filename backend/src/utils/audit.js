import { query } from '../db.js';

export async function logAudit(req, details) {
  try {
    const user = req.body?.actor || req.headers['x-user-email'] || null;
    const userResult = user ? await query('SELECT "UserId", "EmployeeId", "Role" FROM "Users" WHERE "Email"=$1 LIMIT 1', [user]) : { rows: [] };
    const found = userResult.rows[0] || {};
    const result = await query(`
      INSERT INTO "AuditLogs" ("UserId", "EmployeeId", "UserRole", "ActionType", "ModuleName", "RecordType", "RecordId", "RecordCode", "ProjectId", "DepartmentId", "WorkItemId", "TaskId", "OldValue", "NewValue", "Description", "IpAddress", "UserAgent")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING "AuditId"
    `, [
      details.userId || found.UserId || null,
      details.employeeId || found.EmployeeId || null,
      details.userRole || found.Role || null,
      details.actionType,
      details.moduleName,
      details.recordType || null,
      details.recordId || null,
      details.recordCode || null,
      details.projectId || null,
      details.departmentId || null,
      details.workItemId || null,
      details.taskId || null,
      details.oldValue ? JSON.stringify(details.oldValue) : null,
      details.newValue ? JSON.stringify(details.newValue) : null,
      details.description || null,
      req.ip,
      req.headers['user-agent'] || null,
    ]);
    const auditId = result.rows[0]?.AuditId;
    if (auditId) {
      await query('UPDATE "AuditLogs" SET "AuditCode"=$1 WHERE "AuditId"=$2', [`AUD-${String(auditId).padStart(6, '0')}`, auditId]);
    }
  } catch (error) {
    console.warn('Audit log failed:', error.message);
  }
}
