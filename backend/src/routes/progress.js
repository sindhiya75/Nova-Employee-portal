import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { upload, toRelativeUploadPath } from '../utils/upload.js';
import { actorFromRequest } from '../utils/access.js';

const router = express.Router();
const progressUpload = upload.fields([
  { name: 'beforeImages', maxCount: 10 },
  { name: 'progressImages', maxCount: 10 },
  { name: 'completionImages', maxCount: 10 },
]);

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role === 'Unauthenticated') return res.status(401).json({ message: 'Valid session token required.' });
  const result = await query(`
    SELECT tp.*, t."TaskName", e."EmployeeName" FROM "TaskProgress" tp
    JOIN "Tasks" t ON t."TaskId" = tp."TaskId"
    LEFT JOIN "Employees" e ON e."EmployeeId" = tp."EmployeeId"
    WHERE ($1::text <> 'Employee' OR tp."EmployeeId"=$2::int)
    ORDER BY tp."CreatedAt" DESC
  `, [actor.role, actor.employeeId || 0]);
  res.json(result.rows);
}));

router.post('/', progressUpload, asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (actor.role === 'Unauthenticated') return res.status(401).json({ message: 'Valid session token required.' });
  const { taskId, employeeId, workDate, todayQuantity, todayProgressPercent, remarks } = req.body;
  const scopedEmployeeId = actor.role === 'Employee' ? actor.employeeId : employeeId;
  if (!scopedEmployeeId) return res.status(401).json({ message: 'Authenticated employee is required.' });
  const assigned = await query('SELECT "TaskId" FROM "Tasks" WHERE "TaskId"=$1::int AND "AssignedEmployeeId"=$2::int', [taskId, scopedEmployeeId]);
  if (!assigned.rows[0]) return res.status(403).json({ message: 'This task is not assigned to the logged-in employee.' });
  const rawMachinery = typeof req.body.machineryUsage === 'string' ? JSON.parse(req.body.machineryUsage || '[]') : (req.body.machineryUsage || []);
  const machineryUsage = rawMachinery.map((item) => ({
    machineryId: Number(item.machineryId),
    machineryName: String(item.machineryName || ''),
    quantityUsed: Math.max(0, Math.trunc(Number(item.quantityUsed || 0))),
  }));
  // Purpose: quantity updates calculate cumulative progress consistently; completion still requires manager verification.
  const taskState = await query(`SELECT "PlannedQuantity" FROM "Tasks" WHERE "TaskId"=$1::int`, [taskId]);
  const prior = await query(`SELECT COALESCE(SUM("TodayQuantity"),0) AS total FROM "TaskProgress" WHERE "TaskId"=$1::int`, [taskId]);
  const completedQuantity = Number(prior.rows[0].total || 0) + Number(todayQuantity || 0);
  const plannedQuantity = Number(taskState.rows[0]?.PlannedQuantity || 0);
  const progressPercent = plannedQuantity > 0 ? Math.min((completedQuantity / plannedQuantity) * 100, 100) : Math.min(Number(todayProgressPercent || 0), 100);
  const status = progressPercent >= 100 ? 'Awaiting Approval' : progressPercent > 0 ? 'Running' : 'Open';
  const progressResult = await query(`
    INSERT INTO "TaskProgress" ("TaskId", "EmployeeId", "WorkDate", "TodayQuantity", "TodayProgressPercent", "Remarks", "MachineryUsage")
    VALUES ($1::int, $2::int, COALESCE($3::date, CURRENT_DATE), $4::numeric, $5::numeric, $6::text, $7::jsonb) RETURNING *
  `, [taskId, scopedEmployeeId, workDate || null, todayQuantity || null, progressPercent, remarks, JSON.stringify(machineryUsage)]);
  const progress = progressResult.rows[0];
  await query(`
    UPDATE "Tasks" SET "ProgressPercent"=$1::numeric, "CompletedQuantity"=$2::numeric, "Status"=$3::text, "CompletionStatus"=CASE WHEN $1::numeric>=100 THEN 'Pending' ELSE "CompletionStatus" END, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$4::int
  `, [progressPercent, completedQuantity, status, taskId]);

  const fileGroups = [['beforeImages', 'Before'], ['progressImages', 'Progress'], ['completionImages', 'Completion']];
  for (const [field, type] of fileGroups) {
    for (const file of req.files?.[field] || []) {
      await query(`
        INSERT INTO "TaskImages" ("TaskId", "ProgressId", "ImageType", "FilePath", "OriginalName", "MimeType")
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [taskId, progress.ProgressId, type, toRelativeUploadPath(file.path), file.originalname, file.mimetype]);
    }
  }
  res.status(201).json(progress);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM "TaskProgress" WHERE "ProgressId"=$1', [req.params.id]);
  res.status(204).send();
}));

export default router;
