import { query } from '../db.js';
import { verifySessionToken } from './sessionToken.js';

export function actorFromRequest(req) {
  const authorization = req.headers.authorization || '';
  const tokenActor = verifySessionToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (tokenActor) return tokenActor;
  if (req.headers['x-user-role'] === 'Employee') return { userId: null, role: 'Unauthenticated', employeeId: null };
  return {
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    role: req.headers['x-user-role'] || null,
    employeeId: req.headers['x-employee-id'] ? Number(req.headers['x-employee-id']) : null,
  };
}

export async function accessibleProjectIds(actor) {
  if (!actor?.userId || actor.role === 'Admin') return null;
  if (actor.role === 'Manager') {
    const result = await query('SELECT "ProjectId" FROM "UserProjectAccess" WHERE "UserId"=$1', [actor.userId]);
    return result.rows.map((r) => Number(r.ProjectId));
  }
  if (actor.role === 'Client Viewer') {
    const result = await query(`
      SELECT project."ProjectId" FROM "Projects" project
      JOIN "Users" user_account ON user_account."ClientId"=project."ClientId"
      WHERE user_account."UserId"=$1
    `, [actor.userId]);
    return result.rows.map((row) => Number(row.ProjectId));
  }
  if (actor.role === 'Employee' && actor.employeeId) {
    const result = await query('SELECT DISTINCT "ProjectId" FROM "Tasks" WHERE "AssignedEmployeeId"=$1', [actor.employeeId]);
    return result.rows.map((r) => Number(r.ProjectId));
  }
  return [];
}

export async function projectAccessClause(req, alias = 't') {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  if (ids === null) return { actor, clause: '', params: [] };
  if (!ids.length) return { actor, clause: ' AND 1=0', params: [] };
  return { actor, clause: ` AND ${alias}."ProjectId" = ANY($ACCESS_PROJECTS::int[])`, params: [ids] };
}

export function bindAccessSql(sql, params, access) {
  if (!access?.params?.length) return { sql, params };
  const nextIndex = params.length + 1;
  return { sql: sql.replaceAll('$ACCESS_PROJECTS', `$${nextIndex}`), params: [...params, access.params[0]] };
}
