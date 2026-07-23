import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../utils/audit.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';

const router = express.Router();
const levelPrefixes = { ParentWork: 'PARENT', MainWork: 'MAIN', SubTask: 'SUB', Task: 'TASK', LeastTask: 'LEAST' };
const levelOrder = ['ParentWork', 'MainWork', 'SubTask', 'Task', 'LeastTask'];

function makeCode(levelType, name) {
  const clean = String(name || 'WORK').replace(/[^a-z0-9 ]/gi, '').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 6).toUpperCase() || 'WORK';
  return `WRK-${levelPrefixes[levelType] || 'ITEM'}-${clean}-${Date.now().toString().slice(-5)}`;
}

async function ensureWriteAccess(req, res, projectId) {
  const actor = actorFromRequest(req);
  if (!['Admin', 'Manager'].includes(actor.role)) {
    res.status(403).json({ message: 'Only Admin or Manager can maintain work structures.' });
    return null;
  }
  const ids = await accessibleProjectIds(actor);
  if (ids !== null && !ids.includes(Number(projectId))) {
    res.status(403).json({ message: 'This project is outside your assigned access.' });
    return null;
  }
  return actor;
}

async function validateParent({ projectId, departmentId, parentWorkItemId, levelType }) {
  const levelIndex = levelOrder.indexOf(levelType);
  if (levelIndex < 0) return 'Invalid work level.';
  if (levelIndex === 0 && parentWorkItemId) return 'Parent Work cannot have a parent.';
  if (levelIndex > 0 && !parentWorkItemId) return `${levelType} requires its previous work level.`;
  if (!parentWorkItemId) return null;
  const parent = await query('SELECT * FROM "WorkItems" WHERE "WorkItemId"=$1', [parentWorkItemId]);
  const row = parent.rows[0];
  if (!row) return 'Selected parent work was not found.';
  if (Number(row.ProjectId) !== Number(projectId) || Number(row.DepartmentId) !== Number(departmentId)) return 'Parent work must belong to the same project and department.';
  if (row.LevelType !== levelOrder[levelIndex - 1]) return `${levelType} must be linked below ${levelOrder[levelIndex - 1]}.`;
  return null;
}

// Purpose: count tasks below a node so used work identities and their ancestors remain immutable.
async function descendantTaskCount(workItemId) {
  const result = await query(`
    WITH RECURSIVE descendants AS (
      SELECT "WorkItemId" FROM "WorkItems" WHERE "WorkItemId"=$1
      UNION ALL
      SELECT child."WorkItemId" FROM "WorkItems" child
      JOIN descendants parent ON child."ParentWorkItemId"=parent."WorkItemId"
    )
    SELECT COUNT(*)::int AS count FROM "Tasks" WHERE "WorkItemId" IN (SELECT "WorkItemId" FROM descendants)
  `, [workItemId]);
  return Number(result.rows[0]?.count || 0);
}

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  const params = [];
  const filters = [];
  if (ids !== null) { params.push(ids); filters.push(`wi."ProjectId"=ANY($${params.length}::int[])`); }
  if (req.query.projectId) { params.push(req.query.projectId); filters.push(`wi."ProjectId"=$${params.length}`); }
  if (req.query.departmentId) { params.push(req.query.departmentId); filters.push(`wi."DepartmentId"=$${params.length}`); }
  if (req.query.levelType) { params.push(req.query.levelType); filters.push(`wi."LevelType"=$${params.length}`); }
  if (req.query.parentWorkItemId === 'null') filters.push('wi."ParentWorkItemId" IS NULL');
  else if (req.query.parentWorkItemId) { params.push(req.query.parentWorkItemId); filters.push(`wi."ParentWorkItemId"=$${params.length}`); }
  if (req.query.search) { params.push(`%${req.query.search}%`); filters.push(`(wi."WorkName" ILIKE $${params.length} OR wi."WorkItemCode" ILIKE $${params.length})`); }
  if (req.query.createdBy) { params.push(req.query.createdBy); filters.push(`wi."CreatedBy"=$${params.length}`); }
  if (req.query.creatorSearch) { params.push(`%${req.query.creatorSearch}%`); filters.push(`(creator."Name" ILIKE $${params.length} OR creator."UserCode" ILIKE $${params.length} OR creator_employee."EmployeeCode" ILIKE $${params.length})`); }
  if (req.query.dateFrom) { params.push(req.query.dateFrom); filters.push(`wi."CreatedAt"::date >= $${params.length}::date`); }
  if (req.query.dateTo) { params.push(req.query.dateTo); filters.push(`wi."CreatedAt"::date <= $${params.length}::date`); }
  if (req.query.status === 'active') filters.push('wi."IsArchived"=FALSE');
  if (req.query.status === 'archived') filters.push('wi."IsArchived"=TRUE');
  if (req.query.used === 'used') filters.push('COALESCE(task_stats."TaskCount",0)>0');
  if (req.query.used === 'unused') filters.push('COALESCE(task_stats."TaskCount",0)=0');
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    WITH RECURSIVE work_paths AS (
      SELECT root."WorkItemId", root."WorkName"::text AS "WorkPath"
      FROM "WorkItems" root WHERE root."ParentWorkItemId" IS NULL
      UNION ALL
      SELECT child."WorkItemId", parent_path."WorkPath" || ' / ' || child."WorkName"
      FROM "WorkItems" child JOIN work_paths parent_path ON parent_path."WorkItemId"=child."ParentWorkItemId"
    ), task_stats AS (
      SELECT "WorkItemId", COUNT(*)::int AS "TaskCount" FROM "Tasks" WHERE "WorkItemId" IS NOT NULL GROUP BY "WorkItemId"
    )
    SELECT wi.*, project."ProjectCode", project."ProjectName", department."DepartmentCode", department."DepartmentName",
      parent."WorkName" AS "ParentWorkName", path."WorkPath", COALESCE(task_stats."TaskCount",0) AS "TaskCount",
      creator."UserCode" AS "CreatedByUserCode", creator."Name" AS "CreatedByName", creator."Role" AS "CreatedByRole",
      creator_employee."EmployeeCode" AS "CreatedByEmployeeCode",
      editor."UserCode" AS "UpdatedByUserCode", editor."Name" AS "UpdatedByName"
    FROM "WorkItems" wi
    JOIN "Projects" project ON project."ProjectId"=wi."ProjectId"
    LEFT JOIN "Departments" department ON department."DepartmentId"=wi."DepartmentId"
    LEFT JOIN "WorkItems" parent ON parent."WorkItemId"=wi."ParentWorkItemId"
    LEFT JOIN work_paths path ON path."WorkItemId"=wi."WorkItemId"
    LEFT JOIN task_stats ON task_stats."WorkItemId"=wi."WorkItemId"
    LEFT JOIN "Users" creator ON creator."UserId"=wi."CreatedBy"
    LEFT JOIN "Employees" creator_employee ON creator_employee."EmployeeId"=creator."EmployeeId"
    LEFT JOIN "Users" editor ON editor."UserId"=wi."UpdatedBy"
    ${where}
    ORDER BY project."ProjectName", department."DepartmentName",
      CASE wi."LevelType" WHEN 'ParentWork' THEN 1 WHEN 'MainWork' THEN 2 WHEN 'SubTask' THEN 3 WHEN 'Task' THEN 4 ELSE 5 END,
      wi."SortOrder", wi."WorkName"
  `, params);
  res.json(result.rows);
}));

router.get('/tree', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  const params = [];
  const filters = [];
  if (ids !== null) { params.push(ids); filters.push(`wi."ProjectId"=ANY($${params.length}::int[])`); }
  if (req.query.projectId) { params.push(req.query.projectId); filters.push(`wi."ProjectId"=$${params.length}`); }
  if (req.query.departmentId) { params.push(req.query.departmentId); filters.push(`wi."DepartmentId"=$${params.length}`); }
  if (req.query.includeArchived !== 'true') filters.push('wi."IsArchived"=FALSE');
  const result = await query(`
    SELECT wi.*, COALESCE(task_stats."TaskCount",0) AS "TaskCount"
    FROM "WorkItems" wi
    LEFT JOIN (SELECT "WorkItemId", COUNT(*)::int AS "TaskCount" FROM "Tasks" GROUP BY "WorkItemId") task_stats ON task_stats."WorkItemId"=wi."WorkItemId"
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY wi."ParentWorkItemId" NULLS FIRST, wi."SortOrder", wi."WorkName"
  `, params);
  const map = new Map(result.rows.map((row) => [row.WorkItemId, { ...row, children: [] }]));
  const roots = [];
  map.forEach((node) => {
    if (node.ParentWorkItemId && map.has(node.ParentWorkItemId)) map.get(node.ParentWorkItemId).children.push(node);
    else roots.push(node);
  });
  res.json(roots);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { projectId, departmentId, parentWorkItemId, levelType, workName, description, status = 'Active' } = req.body;
  const actor = await ensureWriteAccess(req, res, projectId);
  if (!actor) return;
  if (!projectId || !departmentId || !workName) return res.status(400).json({ message: 'Project, department, and work name are required.' });
  const parentError = await validateParent({ projectId, departmentId, parentWorkItemId, levelType });
  if (parentError) return res.status(400).json({ message: parentError });
  const existing = await query(`
    SELECT * FROM "WorkItems"
    WHERE "ProjectId"=$1 AND "DepartmentId"=$2 AND COALESCE("ParentWorkItemId",0)=COALESCE($3::int,0)
      AND "LevelType"=$4 AND lower("WorkName")=lower($5) LIMIT 1
  `, [projectId, departmentId, parentWorkItemId || null, levelType, workName.trim()]);
  if (existing.rows[0]) return res.status(409).json({ message: 'This work already exists under the selected department and parent.' });
  const code = makeCode(levelType, workName);
  const result = await query(`
    INSERT INTO "WorkItems" ("WorkItemCode","ProjectId","DepartmentId","ParentWorkItemId","LevelType","WorkName","Description","Status","CreatedBy")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, [code, projectId, departmentId, parentWorkItemId || null, levelType, workName.trim(), description, status, actor.userId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Create', moduleName: 'Create Works', recordType: 'WorkItems', recordId: result.rows[0].WorkItemId, recordCode: code, projectId, departmentId, workItemId: result.rows[0].WorkItemId, newValue: result.rows[0], description: `${levelType} created: ${workName}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const current = await query('SELECT * FROM "WorkItems" WHERE "WorkItemId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Work item not found.' });
  const actor = await ensureWriteAccess(req, res, old.ProjectId);
  if (!actor) return;
  const next = {
    projectId: req.body.projectId ?? old.ProjectId,
    departmentId: req.body.departmentId ?? old.DepartmentId,
    parentWorkItemId: req.body.parentWorkItemId === undefined ? old.ParentWorkItemId : req.body.parentWorkItemId || null,
    levelType: req.body.levelType || old.LevelType,
    workName: String(req.body.workName || old.WorkName).trim(),
    description: req.body.description ?? old.Description,
    status: req.body.status || old.Status,
    isArchived: req.body.isArchived ?? old.IsArchived,
  };
  const usedCount = await descendantTaskCount(old.WorkItemId);
  const identityChanged = Number(next.projectId) !== Number(old.ProjectId)
    || Number(next.departmentId) !== Number(old.DepartmentId)
    || Number(next.parentWorkItemId || 0) !== Number(old.ParentWorkItemId || 0)
    || next.levelType !== old.LevelType || next.workName !== old.WorkName;
  if (usedCount > 0 && identityChanged) {
    return res.status(409).json({ message: 'This work or one of its child works is used by an allocated task. Its name, level, project, department, and parent are locked.' });
  }
  const parentError = await validateParent(next);
  if (parentError) return res.status(400).json({ message: parentError });
  const result = await query(`
    UPDATE "WorkItems" SET "ProjectId"=$1,"DepartmentId"=$2,"ParentWorkItemId"=$3,"LevelType"=$4,
      "WorkName"=$5,"Description"=$6,"Status"=$7,"IsArchived"=$8,
      "ArchivedAt"=CASE WHEN $8 THEN COALESCE("ArchivedAt",CURRENT_TIMESTAMP) ELSE NULL END,
      "ArchivedBy"=CASE WHEN $8 THEN $9 ELSE NULL END,
      "UpdatedBy"=$9,"VersionNumber"="VersionNumber"+1,"UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "WorkItemId"=$10 RETURNING *
  `, [next.projectId, next.departmentId, next.parentWorkItemId, next.levelType, next.workName, next.description, next.status, next.isArchived, actor.userId, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: next.isArchived ? 'Archive' : 'Update', moduleName: 'Create Works', recordType: 'WorkItems', recordId: old.WorkItemId, recordCode: old.WorkItemCode, projectId: old.ProjectId, departmentId: old.DepartmentId, workItemId: old.WorkItemId, oldValue: old, newValue: result.rows[0], description: `Work updated: ${old.WorkName}` });
  res.json({ ...result.rows[0], UsedTaskCount: usedCount });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const current = await query('SELECT * FROM "WorkItems" WHERE "WorkItemId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Work item not found.' });
  const actor = await ensureWriteAccess(req, res, old.ProjectId);
  if (!actor) return;
  const usedCount = await descendantTaskCount(old.WorkItemId);
  const children = await query('SELECT COUNT(*)::int AS count FROM "WorkItems" WHERE "ParentWorkItemId"=$1', [req.params.id]);
  if (usedCount > 0 || Number(children.rows[0]?.count || 0) > 0) return res.status(409).json({ message: 'Used work or work with child levels cannot be deleted. Archive it instead.' });
  await query('DELETE FROM "WorkItems" WHERE "WorkItemId"=$1', [req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Delete', moduleName: 'Create Works', recordType: 'WorkItems', recordId: old.WorkItemId, recordCode: old.WorkItemCode, projectId: old.ProjectId, departmentId: old.DepartmentId, oldValue: old, description: `Work deleted: ${old.WorkName}` });
  res.status(204).send();
}));

export default router;