import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();

// Purpose: build parameterized filters once for the register and its live summary.
async function registerFilter(req) {
  const actor = actorFromRequest(req);
  const allowed = await accessibleProjectIds(actor);
  const values = []; const clauses = [];
  const add = (value, sql) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (allowed !== null) add(allowed, 't."ProjectId" = ANY(?::int[])');
  if (actor.role === 'Employee' && actor.employeeId) add(actor.employeeId, 't."AssignedEmployeeId"=?');
  if (req.query.search) add(`%${req.query.search}%`, '(t."TaskName" ILIKE ? OR t."TaskCode" ILIKE ? OR t."WorkPathSnapshot" ILIKE ?)'.replaceAll('?', `$${values.length + 1}`));
  if (req.query.projectId) add(req.query.projectId, 't."ProjectId"=?');
  if (req.query.departmentId) add(req.query.departmentId, 't."DepartmentId"=?');
  if (req.query.employeeId) add(req.query.employeeId, 't."AssignedEmployeeId"=?');
  if (req.query.priority) add(req.query.priority, 't."Priority"=?');
  if (req.query.status) add(req.query.status, 't."Status"=?');
  if (req.query.fromDate) add(req.query.fromDate, 't."FinishDate">=?::date');
  if (req.query.toDate) add(req.query.toDate, 't."FinishDate"<=?::date');
  if (req.query.quick === 'delayed') clauses.push('t."FinishDate" < CURRENT_DATE AND t."Status" <> \'Closed\'');
  if (req.query.quick === 'dueToday') clauses.push('t."FinishDate" = CURRENT_DATE AND t."Status" <> \'Closed\'');
  if (req.query.quick === 'unassigned') clauses.push('t."AssignedEmployeeId" IS NULL');
  if (req.query.quick === 'approval') clauses.push('t."CompletionStatus" = \'Pending\'');
  return { actor, values, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '' };
}

router.get('/register', asyncHandler(async (req, res) => {
  const { values, where } = await registerFilter(req);
  const page = Math.max(Number(req.query.page || 1), 1); const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 1), 200);
  const count = await query(`SELECT COUNT(*)::int AS total FROM "Tasks" t ${where}`, values);
  const rows = await query(`SELECT t.*, p."ProjectName", p."ProjectCode", c."ClientName", d."DepartmentName", d."DepartmentCode", e."EmployeeName", e."EmployeeCode",
    u."Name" AS "CreatedByName", GREATEST(CURRENT_DATE-COALESCE(t."FinishDate",CURRENT_DATE),0)::int AS "DelayDays",
    CASE WHEN t."Status"='Closed' THEN 'Completed' WHEN t."CompletionStatus"='Pending' THEN 'Awaiting Verification' WHEN t."AssignedEmployeeId" IS NULL THEN 'Unassigned' WHEN t."FinishDate"<CURRENT_DATE THEN 'Delayed' WHEN t."FinishDate"<=CURRENT_DATE+3 THEN 'At Risk' ELSE 'On Track' END AS "Health"
    FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" LEFT JOIN "Clients" c ON c."ClientId"=p."ClientId"
    LEFT JOIN "Departments" d ON d."DepartmentId"=t."DepartmentId" LEFT JOIN "Employees" e ON e."EmployeeId"=t."AssignedEmployeeId" LEFT JOIN "Users" u ON u."UserId"=t."CreatedByUserId"
    ${where} ORDER BY t."CreatedAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
  const summary = await query(`SELECT COUNT(*)::int AS "Total", COUNT(*) FILTER(WHERE t."Status"='Open')::int AS "Open", COUNT(*) FILTER(WHERE t."Status"='Running')::int AS "Running", COUNT(*) FILTER(WHERE t."Status"='Closed')::int AS "Closed", COUNT(*) FILTER(WHERE t."FinishDate"<CURRENT_DATE AND t."Status"<>'Closed')::int AS "Delayed", COUNT(*) FILTER(WHERE t."FinishDate"=CURRENT_DATE AND t."Status"<>'Closed')::int AS "DueToday", COUNT(*) FILTER(WHERE t."AssignedEmployeeId" IS NULL)::int AS "Unassigned", COUNT(*) FILTER(WHERE t."CompletionStatus"='Pending')::int AS "Approval" FROM "Tasks" t ${where}`, values);
  res.json({ rows: rows.rows, total: count.rows[0].total, summary: summary.rows[0] });
}));

router.post('/:id/start', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req); const result = await query(`UPDATE "Tasks" SET "Status"='Running',"StartedAt"=COALESCE("StartedAt",CURRENT_TIMESTAMP),"PausedAt"=NULL,"PauseReason"=NULL,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$1 AND ($2::int IS NULL OR "AssignedEmployeeId"=$2) RETURNING *`, [req.params.id, actor.role === 'Employee' ? actor.employeeId : null]);
  if (!result.rows[0]) return res.status(403).json({ message: 'Task is not assigned to this employee.' });
  await logAudit(req, { actionType: 'Task Started', moduleName: 'Tasks', recordId: req.params.id, taskId: req.params.id, projectId: result.rows[0].ProjectId, description: `Task started: ${result.rows[0].TaskName}` }); res.json(result.rows[0]);
}));

router.post('/:id/pause', asyncHandler(async (req, res) => {
  if (!req.body.reason) return res.status(400).json({ message: 'Pause reason is required.' });
  const actor = actorFromRequest(req); const result = await query(`UPDATE "Tasks" SET "Status"='Paused',"PausedAt"=CURRENT_TIMESTAMP,"PauseReason"=$1,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$2 AND ($3::int IS NULL OR "AssignedEmployeeId"=$3) RETURNING *`, [req.body.reason, req.params.id, actor.role === 'Employee' ? actor.employeeId : null]);
  if (!result.rows[0]) return res.status(403).json({ message: 'Task is not assigned to this employee.' }); res.json(result.rows[0]);
}));

router.post('/:id/submit-completion', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req); const employeeId = actor.role === 'Employee' ? actor.employeeId : req.body.employeeId;
  const blocked = await query(`SELECT COUNT(*)::int AS count FROM "TaskCheckpoints" WHERE "TaskId"=$1 AND "IsMandatory"=TRUE AND "Status"<>'Approved'`, [req.params.id]);
  if (blocked.rows[0].count) return res.status(409).json({ message: 'Approve all mandatory quality and safety checkpoints first.' });
  const task = await query(`UPDATE "Tasks" SET "Status"='Awaiting Approval',"CompletionStatus"='Pending',"CompletionSubmittedAt"=CURRENT_TIMESTAMP,"CompletionSubmittedByEmployeeId"=$1,"CompletionRemarks"=$2,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$3 AND ($1::int IS NULL OR "AssignedEmployeeId"=$1) RETURNING *`, [employeeId || null, req.body.remarks || null, req.params.id]);
  if (!task.rows[0]) return res.status(403).json({ message: 'Task is not assigned to this employee.' });
  await query(`INSERT INTO "TaskCompletionReviews" ("TaskId","SubmittedByEmployeeId","SubmissionRemarks") VALUES ($1,$2,$3)`, [req.params.id, employeeId || null, req.body.remarks || null]); res.json(task.rows[0]);
}));

router.post('/:id/completion-decision', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req); if (!['Admin','Manager'].includes(actor.role)) return res.status(403).json({ message: 'Manager or admin approval required.' });
  const decision = req.body.decision; if (!['Approved','Rejected'].includes(decision)) return res.status(400).json({ message: 'Invalid decision.' });
  const result = await query(`UPDATE "Tasks" SET "Status"=$1,"CompletionStatus"=$2,"ProgressPercent"=CASE WHEN $2='Approved' THEN 100 ELSE LEAST("ProgressPercent",99) END,"CompletionReviewedAt"=CURRENT_TIMESTAMP,"CompletionReviewedByUserId"=$3,"CompletionRemarks"=$4,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$5 RETURNING *`, [decision === 'Approved' ? 'Closed' : 'Running', decision, actor.userId || null, req.body.remarks || null, req.params.id]);
  await query(`UPDATE "TaskCompletionReviews" SET "Decision"=$1,"ReviewedByUserId"=$2,"ReviewedAt"=CURRENT_TIMESTAMP,"ReviewRemarks"=$3 WHERE "ReviewId"=(SELECT "ReviewId" FROM "TaskCompletionReviews" WHERE "TaskId"=$4 AND "Decision"='Pending' ORDER BY "SubmittedAt" DESC LIMIT 1)`, [decision, actor.userId || null, req.body.remarks || null, req.params.id]); res.json(result.rows[0]);
}));

router.post('/:id/reassign', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req); if (!['Admin','Manager'].includes(actor.role)) return res.status(403).json({ message: 'Manager or admin access required.' });
  if (!req.body.reason) return res.status(400).json({ message: 'Reassignment reason is required.' });
  const old = await query(`SELECT * FROM "Tasks" WHERE "TaskId"=$1`, [req.params.id]); if (!old.rows[0]) return res.status(404).json({ message: 'Task not found.' });
  await query(`INSERT INTO "TaskAssignmentHistory" ("TaskId","PreviousEmployeeId","NewEmployeeId","ChangedByUserId","ChangeReason","ProgressAtTransfer") VALUES ($1,$2,$3,$4,$5,$6)`, [req.params.id, old.rows[0].AssignedEmployeeId, req.body.employeeId || null, actor.userId || null, req.body.reason, old.rows[0].ProgressPercent]);
  const result = await query(`UPDATE "Tasks" SET "AssignedEmployeeId"=$1,"UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$2 RETURNING *`, [req.body.employeeId || null, req.params.id]); res.json(result.rows[0]);
}));

router.get('/:id/workspace', asyncHandler(async (req, res) => {
  const [task, assignments, revisions, dependencies, checkpoints, comments, reviews] = await Promise.all([
    query(`SELECT t.*,p."ProjectName",d."DepartmentName",e."EmployeeName" FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" LEFT JOIN "Departments" d ON d."DepartmentId"=t."DepartmentId" LEFT JOIN "Employees" e ON e."EmployeeId"=t."AssignedEmployeeId" WHERE t."TaskId"=$1`, [req.params.id]),
    query(`SELECT h.*,a."EmployeeName" AS "PreviousEmployeeName",b."EmployeeName" AS "NewEmployeeName",u."Name" AS "ChangedByName" FROM "TaskAssignmentHistory" h LEFT JOIN "Employees" a ON a."EmployeeId"=h."PreviousEmployeeId" LEFT JOIN "Employees" b ON b."EmployeeId"=h."NewEmployeeId" LEFT JOIN "Users" u ON u."UserId"=h."ChangedByUserId" WHERE h."TaskId"=$1 ORDER BY h."ChangedAt" DESC`, [req.params.id]),
    query(`SELECT * FROM "TaskBaselineRevisions" WHERE "TaskId"=$1 ORDER BY "CreatedAt" DESC`, [req.params.id]), query(`SELECT x.*,t."TaskCode",t."TaskName" FROM "TaskDependencies" x JOIN "Tasks" t ON t."TaskId"=x."DependsOnTaskId" WHERE x."TaskId"=$1`, [req.params.id]),
    query(`SELECT * FROM "TaskCheckpoints" WHERE "TaskId"=$1 ORDER BY "CreatedAt"`, [req.params.id]), query(`SELECT c.*,u."Name",e."EmployeeName" FROM "TaskComments" c LEFT JOIN "Users" u ON u."UserId"=c."UserId" LEFT JOIN "Employees" e ON e."EmployeeId"=c."EmployeeId" WHERE c."TaskId"=$1 ORDER BY c."CreatedAt" DESC`, [req.params.id]), query(`SELECT * FROM "TaskCompletionReviews" WHERE "TaskId"=$1 ORDER BY "SubmittedAt" DESC`, [req.params.id])
  ]); res.json({ task: task.rows[0], assignments: assignments.rows, revisions: revisions.rows, dependencies: dependencies.rows, checkpoints: checkpoints.rows, comments: comments.rows, reviews: reviews.rows });
}));

router.post('/:id/comments', asyncHandler(async (req, res) => { const actor=actorFromRequest(req); const result=await query(`INSERT INTO "TaskComments" ("TaskId","UserId","EmployeeId","CommentText","IsInstruction") VALUES ($1,$2,$3,$4,$5) RETURNING *`,[req.params.id,actor.userId||null,actor.employeeId||null,req.body.commentText,Boolean(req.body.isInstruction)]); res.status(201).json(result.rows[0]); }));
router.post('/:id/checkpoints', asyncHandler(async (req,res)=>{ const result=await query(`INSERT INTO "TaskCheckpoints" ("TaskId","CheckpointType","Title","IsMandatory") VALUES ($1,$2,$3,$4) RETURNING *`,[req.params.id,req.body.checkpointType||'Quality',req.body.title,req.body.isMandatory!==false]); res.status(201).json(result.rows[0]); }));
router.put('/checkpoints/:checkpointId', asyncHandler(async (req,res)=>{ const actor=actorFromRequest(req); const result=await query(`UPDATE "TaskCheckpoints" SET "Status"=$1,"Remarks"=$2,"ReviewedByUserId"=$3,"ReviewedAt"=CURRENT_TIMESTAMP WHERE "CheckpointId"=$4 RETURNING *`,[req.body.status,req.body.remarks||null,actor.userId||null,req.params.checkpointId]); res.json(result.rows[0]); }));

export default router;
