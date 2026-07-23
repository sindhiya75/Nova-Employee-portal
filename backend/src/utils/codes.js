import { query } from '../db.js';

const prefixMap = {
  Clients: 'CLT',
  Projects: 'PRJ',
  Employees: 'EMP',
  Tasks: 'TSK',
  AttendanceLogs: 'ATT',
  LeavePermissionRequests: 'LEV',
  AuditLogs: 'AUD',
};

export async function nextBusinessCode(tableName, columnName, options = {}) {
  const year = options.year || new Date().getFullYear();
  const prefix = options.prefix || prefixMap[tableName] || 'ID';
  const middle = options.middle ? `-${options.middle}` : '';
  const like = `${prefix}-${year}${middle}-%`;
  const result = await query(`SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "${columnName}" LIKE $1`, [like]);
  return `${prefix}-${year}${middle}-${String(Number(result.rows[0]?.count || 0) + 1).padStart(options.width || 4, '0')}`;
}

export async function nextAttendanceCode(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  const like = `ATT-${stamp}-%`;
  const result = await query('SELECT COUNT(*)::int AS count FROM "AttendanceLogs" WHERE "AttendanceCode" LIKE $1', [like]);
  return `ATT-${stamp}-${String(Number(result.rows[0]?.count || 0) + 1).padStart(4, '0')}`;
}
