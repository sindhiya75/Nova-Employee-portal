import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { upload, toRelativeUploadPath } from '../utils/upload.js';
import { logAudit } from '../utils/audit.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';

const router = express.Router();
const refUpload = upload.fields([
  { name: 'referenceImages', maxCount: 10 },
  { name: 'referenceDrawings', maxCount: 10 },
  { name: 'referencePdfs', maxCount: 5 },
]);

function taskCode(taskId, projectId, departmentId) {
  return `TSK-PRJ${projectId || 'X'}-DEPT${departmentId || 'X'}-${String(taskId).padStart(5, '0')}`;
}

// Purpose: freeze the selected work identity on the task so later work-master corrections never rewrite history.
async function getWorkSnapshot(workItemId, projectId, departmentId) {
  if (!workItemId) return null;
  const result = await query(`
    WITH RECURSIVE work_paths AS (
      SELECT root."WorkItemId", root."WorkName"::text AS "WorkPath"
      FROM "WorkItems" root WHERE root."ParentWorkItemId" IS NULL
      UNION ALL
      SELECT child."WorkItemId", parent."WorkPath" || ' / ' || child."WorkName"
      FROM "WorkItems" child JOIN work_paths parent ON parent."WorkItemId"=child."ParentWorkItemId"
    )
    SELECT work.*, path."WorkPath" FROM "WorkItems" work
    LEFT JOIN work_paths path ON path."WorkItemId"=work."WorkItemId"
    WHERE work."WorkItemId"=$1 AND work."ProjectId"=$2 AND work."DepartmentId"=$3 AND work."IsArchived"=FALSE
  `, [workItemId, projectId, departmentId]);
  return result.rows[0] || null;
}

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  const params = [];
  const filters = [];
  if (ids !== null) { params.push(ids); filters.push(`t."ProjectId" = ANY($${params.length}::int[])`); }
  if (actor.role === 'Employee' && actor.employeeId) { params.push(actor.employeeId); filters.push(`t."AssignedEmployeeId"=$${params.length}`); }
  if (req.query.projectId) { params.push(req.query.projectId); filters.push(`t."ProjectId"=$${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    SELECT t.*, p."ProjectName", sw."SubWorkName", e."EmployeeName", d."DepartmentName", COALESCE(t."WorkItemNameSnapshot", wi."WorkName") AS "WorkName", COALESCE(t."WorkItemCodeSnapshot", wi."WorkItemCode") AS "WorkItemCode",
      rr."RequestId" AS "ReopenRequestId", rr."Status" AS "ReopenStatus", rr."Reason" AS "ReopenReason", rr."ManagerRemarks" AS "ReopenManagerRemarks"
    FROM "Tasks" t
    JOIN "Projects" p ON p."ProjectId" = t."ProjectId"
    LEFT JOIN "SubWorks" sw ON sw."SubWorkId" = t."SubWorkId"
    LEFT JOIN "Employees" e ON e."EmployeeId" = t."AssignedEmployeeId"
    LEFT JOIN "Departments" d ON d."DepartmentId" = t."DepartmentId"
    LEFT JOIN "WorkItems" wi ON wi."WorkItemId" = t."WorkItemId"
    LEFT JOIN LATERAL (SELECT * FROM "TaskReopenRequests" r WHERE r."TaskId"=t."TaskId" ORDER BY r."CreatedAt" DESC LIMIT 1) rr ON TRUE
    ${where}
    ORDER BY t."CreatedAt" DESC
  `, params);
  res.json(result.rows);
}));


router.get('/reopen-requests', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  const params = [];
  const filters = [];
  if (ids !== null) { params.push(ids); filters.push(`t."ProjectId" = ANY($${params.length}::int[])`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`rr."Status"=$${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    SELECT rr.*, t."TaskCode", t."TaskName", t."ProjectId", p."ProjectName", e."EmployeeName"
    FROM "TaskReopenRequests" rr
    JOIN "Tasks" t ON t."TaskId"=rr."TaskId"
    JOIN "Projects" p ON p."ProjectId"=t."ProjectId"
    JOIN "Employees" e ON e."EmployeeId"=rr."EmployeeId"
    ${where}
    ORDER BY rr."CreatedAt" DESC
  `, params);
  res.json(result.rows);
}));

router.post('/:id/reopen-request', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { reason } = req.body;
  const employeeId = actor.employeeId || req.body.employeeId;
  if (!employeeId) return res.status(400).json({ message: 'Employee is required.' });
  if (!reason) return res.status(400).json({ message: 'Reason is required.' });
  const task = await query('SELECT * FROM "Tasks" WHERE "TaskId"=$1 AND "AssignedEmployeeId"=$2', [req.params.id, employeeId]);
  if (!task.rows[0]) return res.status(403).json({ message: 'This task is not allotted to this employee.' });
  const result = await query(`
    INSERT INTO "TaskReopenRequests" ("TaskId", "EmployeeId", "RequestedByUserId", "Reason")
    VALUES ($1,$2,$3,$4) RETURNING *
  `, [req.params.id, employeeId, actor.userId || null, reason]);
  await logAudit(req, { userId: actor.userId, employeeId, userRole: actor.role, actionType: 'Reopen Requested', moduleName: 'Tasks', recordType: 'TaskReopenRequests', recordId: result.rows[0].RequestId, taskId: req.params.id, projectId: task.rows[0].ProjectId, newValue: result.rows[0], description: `Reopen requested for ${task.rows[0].TaskName}` });
  res.status(201).json(result.rows[0]);
}));

router.post('/reopen-requests/:requestId/decision', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (!['Admin', 'Manager'].includes(actor.role)) return res.status(403).json({ message: 'Only manager/admin can approve reopen requests.' });
  const { decision, managerRemarks } = req.body;
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
  const request = await query(`SELECT rr.*, t."TaskName", t."ProjectId" FROM "TaskReopenRequests" rr JOIN "Tasks" t ON t."TaskId"=rr."TaskId" WHERE rr."RequestId"=$1`, [req.params.requestId]);
  if (!request.rows[0]) return res.status(404).json({ message: 'Request not found.' });
  if (actor.role === 'Manager') {
    const ids = await accessibleProjectIds(actor);
    if (!ids.includes(Number(request.rows[0].ProjectId))) return res.status(403).json({ message: 'This request is outside your assigned project.' });
  }
  const result = await query(`UPDATE "TaskReopenRequests" SET "Status"=$1, "ManagerRemarks"=$2, "ApprovedByUserId"=$3, "ApprovedAt"=CURRENT_TIMESTAMP, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "RequestId"=$4 RETURNING *`, [decision, managerRemarks || null, actor.userId || null, req.params.requestId]);
  if (decision === 'Approved') await query(`UPDATE "Tasks" SET "Status"='Open', "ProgressPercent"=LEAST("ProgressPercent", 99), "UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$1`, [request.rows[0].TaskId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: `Reopen ${decision}`, moduleName: 'Tasks', recordType: 'TaskReopenRequests', recordId: req.params.requestId, taskId: request.rows[0].TaskId, projectId: request.rows[0].ProjectId, newValue: result.rows[0], description: `Reopen request ${decision.toLowerCase()}: ${request.rows[0].TaskName}` });
  res.json(result.rows[0]);
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role === 'Unauthenticated') return res.status(401).json({ message: 'Valid session token required.' });
  const task = await query(`
    SELECT t.*, p."ProjectName", sw."SubWorkName", e."EmployeeName", d."DepartmentName", COALESCE(t."WorkItemNameSnapshot", wi."WorkName") AS "WorkName", COALESCE(t."WorkItemCodeSnapshot", wi."WorkItemCode") AS "WorkItemCode"
    FROM "Tasks" t
    JOIN "Projects" p ON p."ProjectId" = t."ProjectId"
    LEFT JOIN "SubWorks" sw ON sw."SubWorkId" = t."SubWorkId"
    LEFT JOIN "Employees" e ON e."EmployeeId" = t."AssignedEmployeeId"
    LEFT JOIN "Departments" d ON d."DepartmentId" = t."DepartmentId"
    LEFT JOIN "WorkItems" wi ON wi."WorkItemId" = t."WorkItemId"
    WHERE t."TaskId" = $1 AND ($2::text <> 'Employee' OR t."AssignedEmployeeId"=$3::int)
  `, [req.params.id, actor.role, actor.employeeId || 0]);
  if (!task.rows[0]) return res.status(404).json({ message: 'Task not found for this employee.' });
  const progress = await query(`
    SELECT tp.*, e."EmployeeName" FROM "TaskProgress" tp
    LEFT JOIN "Employees" e ON e."EmployeeId" = tp."EmployeeId"
    WHERE tp."TaskId" = $1 ORDER BY tp."CreatedAt" DESC
  `, [req.params.id]);
  const images = await query('SELECT * FROM "TaskImages" WHERE "TaskId"=$1 ORDER BY "UploadedAt" DESC', [req.params.id]);
  res.json({ ...task.rows[0], progress: progress.rows, images: images.rows });
}));

router.post('/', refUpload, asyncHandler(async (req, res) => {
  const body = req.body;
  const work = await getWorkSnapshot(body.workItemId, body.projectId, body.departmentId);
  if (body.workItemId && !work) return res.status(400).json({ message: 'Selected work must be active and belong to the selected project and department.' });
  const result = await query(`
    INSERT INTO "Tasks" ("TaskName", "Description", "ProjectId", "DepartmentId", "WorkItemId", "SubWorkId", "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity", "Unit", "Remarks", "Status", "WorkPathSnapshot", "WorkItemCodeSnapshot", "WorkItemNameSnapshot", "WorkItemLevelSnapshot")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Open', $14, $15, $16, $17) RETURNING *
  `, [body.taskName, body.description, body.projectId, body.departmentId || null, body.workItemId || null, body.subWorkId || null, body.assignedEmployeeId || null, body.priority || 'Medium', body.startDate || null, body.finishDate || null, body.plannedQuantity || null, body.unit, body.remarks, work?.WorkPath || null, work?.WorkItemCode || null, work?.WorkName || null, work?.LevelType || null]);
  const task = result.rows[0];
  const actor = actorFromRequest(req);
  await query(`UPDATE "Tasks" SET "BaselineStartDate"="StartDate", "BaselineFinishDate"="FinishDate", "BaselineQuantity"="PlannedQuantity", "CreatedByUserId"=$1 WHERE "TaskId"=$2`, [actor.userId || null, task.TaskId]);
  const code = taskCode(task.TaskId, task.ProjectId, task.DepartmentId);
  await query('UPDATE "Tasks" SET "TaskCode"=$1 WHERE "TaskId"=$2', [code, task.TaskId]);
  task.TaskCode = code;

  const fileGroups = [['referenceImages', 'ReferenceImage'], ['referenceDrawings', 'ReferenceDrawing'], ['referencePdfs', 'ReferencePdf']];
  for (const [field, type] of fileGroups) {
    for (const file of req.files?.[field] || []) {
      await query(`
        INSERT INTO "TaskImages" ("TaskId", "ImageType", "FilePath", "OriginalName", "MimeType")
        VALUES ($1, $2, $3, $4, $5)
      `, [task.TaskId, type, toRelativeUploadPath(file.path), file.originalname, file.mimetype]);
    }
  }
  await logAudit(req, { actionType: 'Create', moduleName: 'Tasks', recordType: 'Tasks', recordId: task.TaskId, recordCode: code, projectId: task.ProjectId, departmentId: task.DepartmentId, workItemId: task.WorkItemId, taskId: task.TaskId, newValue: task, description: `Task created: ${task.TaskName}` });
  res.status(201).json(task);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const body = req.body;
  const old = await query('SELECT * FROM "Tasks" WHERE "TaskId"=$1', [req.params.id]);
  const status = Number(body.progressPercent) >= 100 ? 'Closed' : body.status || 'Open';
  const result = await query(`
    UPDATE "Tasks" SET "TaskName"=$1, "Description"=$2, "ProjectId"=$3, "DepartmentId"=$4, "WorkItemId"=$5, "SubWorkId"=$6, "AssignedEmployeeId"=$7, "Priority"=$8, "StartDate"=$9, "FinishDate"=$10, "PlannedQuantity"=$11, "Unit"=$12, "Remarks"=$13, "Status"=$14, "ProgressPercent"=$15, "UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "TaskId"=$16 RETURNING *
  `, [body.taskName, body.description, body.projectId, body.departmentId || null, body.workItemId || null, body.subWorkId || null, body.assignedEmployeeId || null, body.priority || 'Medium', body.startDate || null, body.finishDate || null, body.plannedQuantity || null, body.unit, body.remarks, status, body.progressPercent || 0, req.params.id]);
  await logAudit(req, { actionType: 'Update', moduleName: 'Tasks', recordType: 'Tasks', recordId: req.params.id, recordCode: result.rows[0]?.TaskCode, projectId: result.rows[0]?.ProjectId, departmentId: result.rows[0]?.DepartmentId, workItemId: result.rows[0]?.WorkItemId, taskId: req.params.id, oldValue: old.rows[0], newValue: result.rows[0], description: `Task updated: ${result.rows[0]?.TaskName}` });
  res.json(result.rows[0]);
}));

router.post('/:id/close', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { employeeId: bodyEmployeeId, remarks } = req.body;
  const employeeId = actor.role === 'Employee' ? actor.employeeId : bodyEmployeeId;
  const assigned = await query(`
    SELECT "TaskId", "TaskName", "AssignedEmployeeId", "TaskCode", "ProjectId", "DepartmentId", "WorkItemId" FROM "Tasks"
    WHERE "TaskId"=$1 AND ($2::int IS NULL OR "AssignedEmployeeId"=$2::int)
  `, [req.params.id, employeeId || null]);
  if (!assigned.rows[0]) return res.status(403).json({ message: 'This task is not allotted to the selected employee.' });
  const old = assigned.rows[0];
  const updated = await query(`UPDATE "Tasks" SET "Status"='Closed', "ProgressPercent"=100, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$1 RETURNING *`, [req.params.id]);
  await query(`INSERT INTO "TaskProgress" ("TaskId", "EmployeeId", "WorkDate", "TodayQuantity", "TodayProgressPercent", "Remarks") VALUES ($1, $2, CURRENT_DATE, NULL, 100, $3)`, [req.params.id, employeeId || null, remarks || 'Task closed from employee portal']);
  await logAudit(req, { employeeId: employeeId || null, actionType: 'Task Closed', moduleName: 'Tasks', recordType: 'Tasks', recordId: req.params.id, recordCode: old.TaskCode, projectId: old.ProjectId, departmentId: old.DepartmentId, workItemId: old.WorkItemId, taskId: req.params.id, oldValue: old, newValue: updated.rows[0], description: `Task closed: ${old.TaskName}` });
  res.json(updated.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const old = await query('SELECT * FROM "Tasks" WHERE "TaskId"=$1', [req.params.id]);
  await query('DELETE FROM "Tasks" WHERE "TaskId"=$1', [req.params.id]);
  await logAudit(req, { actionType: 'Delete', moduleName: 'Tasks', recordType: 'Tasks', recordId: req.params.id, recordCode: old.rows[0]?.TaskCode, oldValue: old.rows[0], description: 'Task deleted' });
  res.status(204).send();
}));

export default router;


