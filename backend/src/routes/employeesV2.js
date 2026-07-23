import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../utils/audit.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';

const router = express.Router();

async function validateLinks({ primaryProjectId, departmentId, reportingManagerUserId }) {
  if (departmentId) {
    const department = await query('SELECT "ProjectId" FROM "Departments" WHERE "DepartmentId"=$1', [departmentId]);
    if (!department.rows[0]) return 'Selected department was not found.';
    if (primaryProjectId && Number(department.rows[0].ProjectId) !== Number(primaryProjectId)) return 'Department must belong to the selected primary project.';
  }
  if (reportingManagerUserId) {
    const manager = await query('SELECT "UserId" FROM "Users" WHERE "UserId"=$1 AND "Role"=$2 AND "IsActive"=TRUE', [reportingManagerUserId, 'Manager']);
    if (!manager.rows[0]) return 'Reporting manager must be an active Manager user.';
  }
  return null;
}

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const params = [];
  const filters = [];
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(e."EmployeeName" ILIKE $${params.length} OR e."EmployeeCode" ILIKE $${params.length} OR e."Email" ILIKE $${params.length} OR e."Phone" ILIKE $${params.length})`);
  }
  if (req.query.projectId) { params.push(req.query.projectId); filters.push(`e."PrimaryProjectId"=$${params.length}`); }
  if (req.query.departmentId) { params.push(req.query.departmentId); filters.push(`e."DepartmentId"=$${params.length}`); }
  if (req.query.reportingManagerUserId) { params.push(req.query.reportingManagerUserId); filters.push(`e."ReportingManagerUserId"=$${params.length}`); }
  if (req.query.gender) { params.push(req.query.gender); filters.push(`e."Gender"=$${params.length}`); }
  if (req.query.activeOnly !== 'false') filters.push('e."IsActive"=TRUE');
  const projectIds = await accessibleProjectIds(actor);
  if (actor.role === 'Manager' && projectIds !== null) {
    if (!projectIds.length) filters.push('1=0');
    else {
      params.push(projectIds);
      filters.push(`(e."PrimaryProjectId"=ANY($${params.length}::int[]) OR EXISTS (SELECT 1 FROM "Tasks" scoped_task WHERE scoped_task."AssignedEmployeeId"=e."EmployeeId" AND scoped_task."ProjectId"=ANY($${params.length}::int[])))`);
    }
  }
  const result = await query(`
    SELECT e.*, department."DepartmentName", department."DepartmentCode",
      project."ProjectCode", project."ProjectName",
      manager."UserCode" AS "ReportingManagerCode", manager."Name" AS "ReportingManagerName",
      credential."UserCode" AS "CredentialUserCode", credential."Email" AS "CredentialEmail",
      COALESCE(SUM(CASE WHEN task."Status"='Open' THEN 1 ELSE 0 END),0)::int AS "AssignedTasks",
      COALESCE(SUM(CASE WHEN task."Status"='Running' THEN 1 ELSE 0 END),0)::int AS "RunningTasks",
      COALESCE(SUM(CASE WHEN task."Status"='Closed' THEN 1 ELSE 0 END),0)::int AS "CompletedTasks"
    FROM "Employees" e
    LEFT JOIN "Departments" department ON department."DepartmentId"=e."DepartmentId"
    LEFT JOIN "Projects" project ON project."ProjectId"=e."PrimaryProjectId"
    LEFT JOIN "Users" manager ON manager."UserId"=e."ReportingManagerUserId"
    LEFT JOIN LATERAL (
      SELECT user_account."UserCode", user_account."Email"
      FROM "Users" user_account
      WHERE user_account."EmployeeId"=e."EmployeeId"
      ORDER BY user_account."IsActive" DESC, user_account."UserId"
      LIMIT 1
    ) credential ON TRUE
    LEFT JOIN "Tasks" task ON task."AssignedEmployeeId"=e."EmployeeId"
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    GROUP BY e."EmployeeId", department."DepartmentName", department."DepartmentCode", project."ProjectCode", project."ProjectName",
      manager."UserCode", manager."Name", credential."UserCode", credential."Email"
    ORDER BY department."DepartmentName", e."EmployeeName"
  `, params);
  res.json(result.rows);
}));

router.get('/:id/tasks', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT task.*, project."ProjectCode", project."ProjectName", department."DepartmentName",
      COALESCE(task."WorkItemNameSnapshot", work."WorkName") AS "WorkName",
      task."WorkPathSnapshot"
    FROM "Tasks" task
    JOIN "Projects" project ON project."ProjectId"=task."ProjectId"
    LEFT JOIN "Departments" department ON department."DepartmentId"=task."DepartmentId"
    LEFT JOIN "WorkItems" work ON work."WorkItemId"=task."WorkItemId"
    WHERE task."AssignedEmployeeId"=$1
    ORDER BY task."Status", task."FinishDate"
  `, [req.params.id]);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { employeeName, email, phone, alternatePhone, designation, primaryProjectId, departmentId, dateOfJoining, birthDate, reportingManagerUserId, gender, allergy, isActive = true } = req.body;
  if (!employeeName) return res.status(400).json({ message: 'Employee name is required.' });
  const linkError = await validateLinks({ primaryProjectId, departmentId, reportingManagerUserId });
  if (linkError) return res.status(400).json({ message: linkError });
  if (email) {
    const duplicate = await query('SELECT "EmployeeId" FROM "Employees" WHERE lower("Email")=lower($1)', [email]);
    if (duplicate.rows[0]) return res.status(409).json({ message: 'Employee email already exists.' });
  }
  const department = departmentId ? await query('SELECT "DepartmentName" FROM "Departments" WHERE "DepartmentId"=$1', [departmentId]) : { rows: [] };
  const result = await query(`
    INSERT INTO "Employees" ("EmployeeName","Email","Phone","AlternatePhone","Designation","Department","DepartmentId","PrimaryProjectId","DateOfJoining","BirthDate","ReportingManagerUserId","Gender","Allergy","IsActive")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
  `, [employeeName, email || null, phone || null, alternatePhone || null, designation || null, department.rows[0]?.DepartmentName || null, departmentId || null, primaryProjectId || null, dateOfJoining || null, birthDate || null, reportingManagerUserId || null, gender || null, allergy || null, isActive]);
  const code = `EMP-${new Date().getFullYear()}-${String(result.rows[0].EmployeeId).padStart(5, '0')}`;
  const updated = await query('UPDATE "Employees" SET "EmployeeCode"=$1 WHERE "EmployeeId"=$2 RETURNING *', [code, result.rows[0].EmployeeId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, employeeId: result.rows[0].EmployeeId, actionType: 'Create', moduleName: 'Employees', recordType: 'Employees', recordId: result.rows[0].EmployeeId, recordCode: code, projectId: primaryProjectId, departmentId, newValue: updated.rows[0], description: `Employee created: ${employeeName}` });
  res.status(201).json(updated.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const current = await query('SELECT * FROM "Employees" WHERE "EmployeeId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Employee not found.' });
  const { employeeName, email, phone, alternatePhone, designation, primaryProjectId, departmentId, dateOfJoining, birthDate, reportingManagerUserId, gender, allergy, isActive = true } = req.body;
  const linkError = await validateLinks({ primaryProjectId, departmentId, reportingManagerUserId });
  if (linkError) return res.status(400).json({ message: linkError });
  if (email) {
    const duplicate = await query('SELECT "EmployeeId" FROM "Employees" WHERE lower("Email")=lower($1) AND "EmployeeId"<>$2', [email, req.params.id]);
    if (duplicate.rows[0]) return res.status(409).json({ message: 'Employee email already exists.' });
  }
  const department = departmentId ? await query('SELECT "DepartmentName" FROM "Departments" WHERE "DepartmentId"=$1', [departmentId]) : { rows: [] };
  const result = await query(`
    UPDATE "Employees" SET "EmployeeName"=$1,"Email"=$2,"Phone"=$3,"AlternatePhone"=$4,"Designation"=$5,
      "Department"=$6,"DepartmentId"=$7,"PrimaryProjectId"=$8,"DateOfJoining"=$9,"BirthDate"=$10,
      "ReportingManagerUserId"=$11,"Gender"=$12,"Allergy"=$13,"IsActive"=$14,"UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "EmployeeId"=$15 RETURNING *
  `, [employeeName, email || null, phone || null, alternatePhone || null, designation || null, department.rows[0]?.DepartmentName || null, departmentId || null, primaryProjectId || null, dateOfJoining || null, birthDate || null, reportingManagerUserId || null, gender || null, allergy || null, isActive, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, employeeId: Number(req.params.id), actionType: 'Update', moduleName: 'Employees', recordType: 'Employees', recordId: req.params.id, recordCode: old.EmployeeCode, projectId: primaryProjectId, departmentId, oldValue: old, newValue: result.rows[0], description: `Employee updated: ${employeeName}` });
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const current = await query('SELECT * FROM "Employees" WHERE "EmployeeId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Employee not found.' });
  const usage = await query('SELECT (SELECT COUNT(*) FROM "Tasks" WHERE "AssignedEmployeeId"=$1) + (SELECT COUNT(*) FROM "Users" WHERE "EmployeeId"=$1) AS count', [req.params.id]);
  if (Number(usage.rows[0]?.count || 0) > 0) return res.status(409).json({ message: 'Employee has tasks or login credentials. Mark the employee inactive instead of deleting.' });
  await query('DELETE FROM "Employees" WHERE "EmployeeId"=$1', [req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Delete', moduleName: 'Employees', recordType: 'Employees', recordId: req.params.id, recordCode: old.EmployeeCode, oldValue: old, description: `Employee deleted: ${old.EmployeeName}` });
  res.status(204).send();
}));

export default router;
