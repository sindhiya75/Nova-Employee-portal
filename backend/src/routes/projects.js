import express from 'express';
import { query, pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';
import { nextBusinessCode } from '../utils/codes.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();

async function requireAdmin(req, res) {
  const actor = actorFromRequest(req);
  if (actor.role !== 'Admin') {
    res.status(403).json({ message: 'Only Admin can maintain project master data.' });
    return null;
  }
  return actor;
}

router.get('/', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  const params = [];
  const filters = [];
  if (ids !== null) { params.push(ids); filters.push('p."ProjectId" = ANY($' + params.length + '::int[])'); }
  if (req.query.projectId) { params.push(req.query.projectId); filters.push('p."ProjectId"=$' + params.length); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`
    SELECT p.*, c."ClientName", head."Name" AS "ProjectHeadName", head."Email" AS "ProjectHeadEmail", head."UserCode" AS "ProjectHeadCode", COALESCE(AVG(t."ProgressPercent"::float), 0) AS "Progress"
    FROM "Projects" p
    JOIN "Clients" c ON c."ClientId" = p."ClientId"
    LEFT JOIN "Users" head ON head."UserId" = p."ProjectHeadUserId"
    LEFT JOIN "Tasks" t ON t."ProjectId" = p."ProjectId"
    ${where}
    GROUP BY p."ProjectId", c."ClientName", head."Name", head."Email", head."UserCode"
    ORDER BY p."CreatedAt" DESC
  `, params);
  res.json(result.rows);
}));

router.get('/:id/head-history', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT h.*, old_u."Name" AS "OldHeadName", old_u."UserCode" AS "OldHeadCode", new_u."Name" AS "NewHeadName", new_u."UserCode" AS "NewHeadCode", changed_u."Name" AS "ChangedByName"
    FROM "ProjectHeadHistory" h
    LEFT JOIN "Users" old_u ON old_u."UserId"=h."OldHeadUserId"
    LEFT JOIN "Users" new_u ON new_u."UserId"=h."NewHeadUserId"
    LEFT JOIN "Users" changed_u ON changed_u."UserId"=h."ChangedByUserId"
    WHERE h."ProjectId"=$1
    ORDER BY h."EffectiveAt" DESC
    LIMIT 20
  `, [req.params.id]);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const { projectName, clientId, packageName, location, startDate, endDate, description, projectHeadUserId } = req.body;
  // Purpose: project codes are generated at creation so dashboards, tasks, and audits can reference the same project ID.
  const projectCode = await nextBusinessCode('Projects', 'ProjectCode');
  const result = await query(`
    INSERT INTO "Projects" ("ProjectCode", "ProjectName", "ClientId", "Package", "Location", "StartDate", "EndDate", "Description", "ProjectHeadUserId")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
  `, [projectCode, projectName, clientId, packageName, location, startDate || null, endDate || null, description, projectHeadUserId || null]);
  if (projectHeadUserId) await query(`INSERT INTO "UserProjectAccess" ("UserId", "ProjectId", "AccessLevel") VALUES ($1,$2,'Project Head') ON CONFLICT DO NOTHING`, [projectHeadUserId, result.rows[0].ProjectId]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Create', moduleName: 'Projects', recordType: 'Projects', recordId: result.rows[0].ProjectId, recordCode: projectCode, projectId: result.rows[0].ProjectId, newValue: result.rows[0], description: `Project created: ${projectName}` });
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const old = await query('SELECT * FROM "Projects" WHERE "ProjectId"=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ message: 'Project not found.' });
  const { projectName, clientId, packageName, location, startDate, endDate, description } = req.body;
  const result = await query(`
    UPDATE "Projects" SET "ProjectName"=$1, "ClientId"=$2, "Package"=$3, "Location"=$4, "StartDate"=$5, "EndDate"=$6, "Description"=$7, "UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "ProjectId"=$8 RETURNING *
  `, [projectName, clientId, packageName, location, startDate || null, endDate || null, description, req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Update', moduleName: 'Projects', recordType: 'Projects', recordId: req.params.id, recordCode: result.rows[0].ProjectCode, projectId: req.params.id, oldValue: old.rows[0], newValue: result.rows[0], description: `Project updated: ${projectName}` });
  res.json(result.rows[0]);
}));

router.put('/:id/project-head', asyncHandler(async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const projectId = Number(req.params.id);
  const { projectHeadUserId, transferMode = 'access_only', remarks } = req.body;
  if (!projectHeadUserId) return res.status(400).json({ message: 'Project head is required.' });
  if (!['access_only', 'access_and_employees', 'keep_old_secondary'].includes(transferMode)) return res.status(400).json({ message: 'Invalid transfer mode.' });

  const projectResult = await query('SELECT * FROM "Projects" WHERE "ProjectId"=$1', [projectId]);
  const project = projectResult.rows[0];
  if (!project) return res.status(404).json({ message: 'Project not found.' });

  const managerResult = await query('SELECT "UserId", "UserCode", "Name", "Email", "Role" FROM "Users" WHERE "UserId"=$1 AND "Role"=$2 AND "IsActive"=TRUE', [projectHeadUserId, 'Manager']);
  const manager = managerResult.rows[0];
  if (!manager) return res.status(400).json({ message: 'Selected user must be an active Manager.' });

  const oldHeadUserId = project.ProjectHeadUserId || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE "Projects" SET "ProjectHeadUserId"=$1, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "ProjectId"=$2', [projectHeadUserId, projectId]);
    await client.query(`INSERT INTO "UserProjectAccess" ("UserId", "ProjectId", "AccessLevel") VALUES ($1,$2,'Project Head') ON CONFLICT DO NOTHING`, [projectHeadUserId, projectId]);

    if (oldHeadUserId && oldHeadUserId !== Number(projectHeadUserId) && transferMode !== 'keep_old_secondary') {
      await client.query('DELETE FROM "UserProjectAccess" WHERE "UserId"=$1 AND "ProjectId"=$2', [oldHeadUserId, projectId]);
    }

    if (transferMode === 'access_and_employees') {
      await client.query(`
        UPDATE "Employees" e SET "ReportingManagerUserId"=$1
        WHERE e."EmployeeId" IN (SELECT DISTINCT "AssignedEmployeeId" FROM "Tasks" WHERE "ProjectId"=$2 AND "AssignedEmployeeId" IS NOT NULL)
      `, [projectHeadUserId, projectId]);
    }

    await client.query(`
      INSERT INTO "ProjectHeadHistory" ("ProjectId", "OldHeadUserId", "NewHeadUserId", "TransferMode", "ChangedByUserId", "Remarks")
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [projectId, oldHeadUserId, projectHeadUserId, transferMode, actor.userId, remarks || null]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const updated = await query(`
    SELECT p.*, head."Name" AS "ProjectHeadName", head."Email" AS "ProjectHeadEmail", head."UserCode" AS "ProjectHeadCode"
    FROM "Projects" p LEFT JOIN "Users" head ON head."UserId"=p."ProjectHeadUserId"
    WHERE p."ProjectId"=$1
  `, [projectId]);

  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Project Head Changed', moduleName: 'Projects', recordType: 'Projects', recordId: projectId, recordCode: project.ProjectCode, projectId, oldValue: project, newValue: { ...updated.rows[0], transferMode }, description: `Project head changed for ${project.ProjectName} to ${manager.Name}` });
  res.json(updated.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const old = await query('SELECT * FROM "Projects" WHERE "ProjectId"=$1', [req.params.id]);
  await query('DELETE FROM "Projects" WHERE "ProjectId"=$1', [req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Delete', moduleName: 'Projects', recordType: 'Projects', recordId: req.params.id, recordCode: old.rows[0]?.ProjectCode, projectId: req.params.id, oldValue: old.rows[0], description: `Project deleted: ${old.rows[0]?.ProjectName || req.params.id}` });
  res.status(204).send();
}));

export default router;

