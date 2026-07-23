import express from 'express';
import { query, pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';
import { logAudit } from '../utils/audit.js';

const router = express.Router();

function firstDay(month) { return month ? `${month}-01` : null; }
function numeric(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function nullableInt(value) { return value === undefined || value === null || value === '' ? null : Number(value); }

// Purpose: all site-monitoring screens use the same date/project access rules so dashboard and registers stay consistent.
async function monitoringFilter(req, alias = 'dwl') {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  const values = [];
  const clauses = [];
  if (ids !== null) {
    if (!ids.length) clauses.push('1=0');
    else { values.push(ids); clauses.push(`${alias}."ProjectId" = ANY($${values.length}::int[])`); }
  }
  if (req.query.projectId && req.query.projectId !== 'overall') { values.push(req.query.projectId); clauses.push(`${alias}."ProjectId"=$${values.length}`); }
  if (req.query.departmentId) { values.push(req.query.departmentId); clauses.push(`${alias}."DepartmentId"=$${values.length}`); }
  if (req.query.taskId) { values.push(req.query.taskId); clauses.push(`${alias}."TaskId"=$${values.length}`); }
  if (req.query.mode === 'month' || req.query.month) {
    values.push(firstDay(req.query.month || new Date().toISOString().slice(0, 7)));
    clauses.push(`${alias}."LogDate" >= $${values.length}::date AND ${alias}."LogDate" < ($${values.length}::date + interval '1 month')`);
  } else if (req.query.date) {
    values.push(req.query.date);
    clauses.push(`${alias}."LogDate"=$${values.length}::date`);
  }
  return { actor, values, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '' };
}

async function ensureWriteAccess(req, res, projectId) {
  const actor = actorFromRequest(req);
  if (!['Admin', 'Manager'].includes(actor.role)) {
    res.status(403).json({ message: 'Only Admin or Manager can maintain site monitoring logs.' });
    return null;
  }
  const ids = await accessibleProjectIds(actor);
  if (ids !== null && !ids.includes(Number(projectId))) {
    res.status(403).json({ message: 'Selected project is outside your assigned access.' });
    return null;
  }
  return actor;
}

async function nextCode(prefix, tableName, columnName, dateValue = new Date()) {
  const date = new Date(dateValue);
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  const like = `${prefix}-${stamp}-%`;
  const result = await query(`SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "${columnName}" LIKE $1`, [like]);
  return `${prefix}-${stamp}-${String(Number(result.rows[0]?.count || 0) + 1).padStart(4, '0')}`;
}

async function nextMasterCode(prefix, tableName, columnName) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const result = await query(`SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "${columnName}" LIKE $1`, [like]);
  return `${prefix}-${year}-${String(Number(result.rows[0]?.count || 0) + 1).padStart(4, '0')}`;
}

router.get('/materials', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM "Materials" WHERE ($1::text IS NULL OR "MaterialName" ILIKE $1 OR "MaterialCode" ILIKE $1) ORDER BY "MaterialName"', [req.query.search ? `%${req.query.search}%` : null]);
  res.json(result.rows);
}));

router.post('/materials', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (!['Admin', 'Manager'].includes(actor.role)) return res.status(403).json({ message: 'Admin or Manager access required.' });
  const { materialName, unit = 'nos', minimumStock = 0 } = req.body;
  if (!materialName) return res.status(400).json({ message: 'Material name is required.' });
  const code = await nextMasterCode('MAT', 'Materials', 'MaterialCode');
  const result = await query('INSERT INTO "Materials" ("MaterialCode","MaterialName","Unit","MinimumStock") VALUES ($1,$2,$3,$4) RETURNING *', [code, materialName, unit, minimumStock]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Create', moduleName: 'Site Monitoring', recordType: 'Materials', recordId: result.rows[0].MaterialId, recordCode: code, newValue: result.rows[0], description: `Material created: ${materialName}` });
  res.status(201).json(result.rows[0]);
}));

router.get('/machinery', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM "Machinery" WHERE ($1::text IS NULL OR "MachineryName" ILIKE $1 OR "MachineryCode" ILIKE $1 OR "MachineryType" ILIKE $1) ORDER BY "MachineryName"', [req.query.search ? `%${req.query.search}%` : null]);
  res.json(result.rows);
}));

router.post('/machinery', asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  if (!['Admin', 'Manager'].includes(actor.role)) return res.status(403).json({ message: 'Admin or Manager access required.' });
  const { machineryName, machineryType, registrationNo } = req.body;
  if (!machineryName) return res.status(400).json({ message: 'Machinery name is required.' });
  const code = await nextMasterCode('MCY', 'Machinery', 'MachineryCode');
  const result = await query('INSERT INTO "Machinery" ("MachineryCode","MachineryName","MachineryType","RegistrationNo") VALUES ($1,$2,$3,$4) RETURNING *', [code, machineryName, machineryType || null, registrationNo || null]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Create', moduleName: 'Site Monitoring', recordType: 'Machinery', recordId: result.rows[0].MachineryId, recordCode: code, newValue: result.rows[0], description: `Machinery created: ${machineryName}` });
  res.status(201).json(result.rows[0]);
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const scoped = await monitoringFilter(req);
  const params = scoped.values;
  const [kpi, labour, material, machinery, hindrance, trend] = await Promise.all([
    query(`SELECT COUNT(*)::int AS "Logs", COALESCE(SUM("CompletedQuantity"),0)::float AS "CompletedQuantity", COALESCE(AVG(NULLIF("ProgressPercent",0)),0)::float AS "AvgProgress" FROM "DailyWorkLogs" dwl ${scoped.where}`, params),
    query(`SELECT COALESCE(SUM(l."TotalLabour"),0)::int AS "TotalLabour", COALESCE(SUM(l."Mandays"),0)::float AS "Mandays", COALESCE(SUM(l."OvertimeHours"),0)::float AS "OvertimeHours", COALESCE(SUM(dwl."CompletedQuantity") / NULLIF(SUM(l."Mandays"),0),0)::float AS "OutputPerManday" FROM "DailyWorkLogs" dwl LEFT JOIN "DailyLabourUsage" l ON l."DailyWorkLogId"=dwl."DailyWorkLogId" ${scoped.where}`, params),
    query(`SELECT COALESCE(SUM(m."ConsumedQuantity"),0)::float AS "ConsumedQuantity", COALESCE(SUM(m."WastageQuantity"),0)::float AS "WastageQuantity", COALESCE(SUM(m."ReceivedQuantity"),0)::float AS "ReceivedQuantity", COALESCE(SUM(m."ConsumedQuantity") / NULLIF(SUM(dwl."CompletedQuantity"),0),0)::float AS "ConsumptionPerUnit" FROM "DailyWorkLogs" dwl LEFT JOIN "DailyMaterialUsage" m ON m."DailyWorkLogId"=dwl."DailyWorkLogId" ${scoped.where}`, params),
    query(`SELECT COALESCE(SUM(mu."WorkingHours"),0)::float AS "WorkingHours", COALESCE(SUM(mu."IdleHours"),0)::float AS "IdleHours", COALESCE(SUM(mu."BreakdownHours"),0)::float AS "BreakdownHours", COALESCE(SUM(mu."FuelConsumed"),0)::float AS "FuelConsumed", COALESCE(SUM(mu."OutputQuantity") / NULLIF(SUM(mu."WorkingHours"),0),0)::float AS "OutputPerHour" FROM "DailyWorkLogs" dwl LEFT JOIN "DailyMachineryUsage" mu ON mu."DailyWorkLogId"=dwl."DailyWorkLogId" ${scoped.where}`, params),
    query(`SELECT COUNT(*)::int AS "Total", COUNT(*) FILTER (WHERE h."Status" IN ('Open','In Review'))::int AS "Open", COALESCE(SUM(h."ImpactHours"),0)::float AS "ImpactHours", COALESCE(SUM(h."ImpactQuantity"),0)::float AS "ImpactQuantity" FROM "DailyWorkLogs" dwl LEFT JOIN "HindranceLogs" h ON h."DailyWorkLogId"=dwl."DailyWorkLogId" ${scoped.where}`, params),
    query(`SELECT dwl."LogDate" AS "Period", COALESCE(SUM(dwl."CompletedQuantity"),0)::float AS "Output", COALESCE(SUM(l."Mandays"),0)::float AS "Mandays", COALESCE(SUM(m."Material"),0)::float AS "Material", COALESCE(SUM(mu."MachineHours"),0)::float AS "MachineHours" FROM "DailyWorkLogs" dwl LEFT JOIN LATERAL (SELECT SUM("Mandays") AS "Mandays" FROM "DailyLabourUsage" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId") l ON TRUE LEFT JOIN LATERAL (SELECT SUM("ConsumedQuantity") AS "Material" FROM "DailyMaterialUsage" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId") m ON TRUE LEFT JOIN LATERAL (SELECT SUM("WorkingHours") AS "MachineHours" FROM "DailyMachineryUsage" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId") mu ON TRUE ${scoped.where} GROUP BY dwl."LogDate" ORDER BY dwl."LogDate"`, params),
  ]);
  res.json({ kpi: kpi.rows[0], labour: labour.rows[0], material: material.rows[0], machinery: machinery.rows[0], hindrance: hindrance.rows[0], trend: trend.rows });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  const scoped = await monitoringFilter(req);
  const result = await query(`
    SELECT dwl.*, p."ProjectCode", p."ProjectName", d."DepartmentCode", d."DepartmentName", wi."WorkItemCode", wi."WorkName", t."TaskCode", t."TaskName", u."Name" AS "SubmittedByName",
      COALESCE(l."TotalLabour",0) AS "TotalLabour", COALESCE(l."Mandays",0)::float AS "Mandays",
      COALESCE(ms."ConsumedQuantity",0)::float AS "MaterialConsumed", COALESCE(mu."WorkingHours",0)::float AS "MachineHours",
      COALESCE(hs."OpenHindrances",0)::int AS "OpenHindrances"
    FROM "DailyWorkLogs" dwl
    JOIN "Projects" p ON p."ProjectId"=dwl."ProjectId"
    LEFT JOIN "Departments" d ON d."DepartmentId"=dwl."DepartmentId"
    LEFT JOIN "WorkItems" wi ON wi."WorkItemId"=dwl."WorkItemId"
    LEFT JOIN "Tasks" t ON t."TaskId"=dwl."TaskId"
    LEFT JOIN "Users" u ON u."UserId"=dwl."SubmittedByUserId"
    LEFT JOIN LATERAL (SELECT SUM("TotalLabour")::int AS "TotalLabour", SUM("Mandays") AS "Mandays" FROM "DailyLabourUsage" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId") l ON TRUE
    LEFT JOIN LATERAL (SELECT SUM("ConsumedQuantity") AS "ConsumedQuantity" FROM "DailyMaterialUsage" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId") ms ON TRUE
    LEFT JOIN LATERAL (SELECT SUM("WorkingHours") AS "WorkingHours" FROM "DailyMachineryUsage" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId") mu ON TRUE
    LEFT JOIN LATERAL (SELECT COUNT(*) AS "OpenHindrances" FROM "HindranceLogs" WHERE "DailyWorkLogId"=dwl."DailyWorkLogId" AND "Status" IN ('Open','In Review')) hs ON TRUE
    ${scoped.where}
    ORDER BY dwl."LogDate" DESC, dwl."CreatedAt" DESC
    LIMIT 100
  `, scoped.values);
  res.json(result.rows);
}));

router.get('/logs/:id', asyncHandler(async (req, res) => {
  const [log, labour, materials, machinery, hindrances] = await Promise.all([
    query('SELECT * FROM "DailyWorkLogs" WHERE "DailyWorkLogId"=$1', [req.params.id]),
    query('SELECT * FROM "DailyLabourUsage" WHERE "DailyWorkLogId"=$1', [req.params.id]),
    query('SELECT * FROM "DailyMaterialUsage" WHERE "DailyWorkLogId"=$1', [req.params.id]),
    query('SELECT * FROM "DailyMachineryUsage" WHERE "DailyWorkLogId"=$1', [req.params.id]),
    query('SELECT * FROM "HindranceLogs" WHERE "DailyWorkLogId"=$1', [req.params.id]),
  ]);
  if (!log.rows[0]) return res.status(404).json({ message: 'Daily work log not found.' });
  res.json({ log: log.rows[0], labour: labour.rows, materials: materials.rows, machinery: machinery.rows, hindrances: hindrances.rows });
}));

router.post('/logs', asyncHandler(async (req, res) => {
  const actor = await ensureWriteAccess(req, res, req.body.projectId);
  if (!actor) return;
  const client = await pool.connect();
  try {
    const logDate = req.body.logDate || new Date().toISOString().slice(0, 10);
    const code = await nextCode('DWL', 'DailyWorkLogs', 'DailyWorkLogCode', logDate);
    const plannedQuantity = numeric(req.body.plannedQuantity);
    const previousCumulativeQuantity = numeric(req.body.previousCumulativeQuantity);
    const completedQuantity = numeric(req.body.completedQuantity);
    const cumulativeQuantity = req.body.cumulativeQuantity === undefined || req.body.cumulativeQuantity === '' ? previousCumulativeQuantity + completedQuantity : numeric(req.body.cumulativeQuantity);
    const balanceQuantity = req.body.balanceQuantity === undefined || req.body.balanceQuantity === '' ? Math.max(plannedQuantity - cumulativeQuantity, 0) : numeric(req.body.balanceQuantity);
    const progressPercent = plannedQuantity > 0 ? Math.min(100, (cumulativeQuantity / plannedQuantity) * 100) : numeric(req.body.progressPercent);

    await client.query('BEGIN');
    const inserted = await client.query(`
      INSERT INTO "DailyWorkLogs" ("DailyWorkLogCode","ProjectId","DepartmentId","WorkItemId","TaskId","LogDate","Shift","LocationName","ChainageFrom","ChainageTo","Weather","PlannedQuantity","PreviousCumulativeQuantity","CompletedQuantity","CumulativeQuantity","BalanceQuantity","Unit","ProgressPercent","Status","Remarks","SubmittedByUserId")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *
    `, [code, req.body.projectId, nullableInt(req.body.departmentId), nullableInt(req.body.workItemId), nullableInt(req.body.taskId), logDate, req.body.shift || 'Day', req.body.locationName || null, req.body.chainageFrom || null, req.body.chainageTo || null, req.body.weather || null, plannedQuantity, previousCumulativeQuantity, completedQuantity, cumulativeQuantity, balanceQuantity, req.body.unit || 'm', progressPercent, req.body.status || 'Submitted', req.body.remarks || null, actor.userId || null]);
    const log = inserted.rows[0];

    const labour = req.body.labour || {};
    const totalLabour = ['supervisorCount','engineerCount','skilledCount','unskilledCount','operatorCount','helperCount'].reduce((sum, key) => sum + numeric(labour[key]), 0);
    const workingHours = numeric(labour.workingHours, 8);
    const mandays = labour.mandays === undefined || labour.mandays === '' ? totalLabour * (workingHours / 8) : numeric(labour.mandays);
    await client.query(`INSERT INTO "DailyLabourUsage" ("DailyWorkLogId","SupervisorCount","EngineerCount","SkilledCount","UnskilledCount","OperatorCount","HelperCount","TotalLabour","WorkingHours","OvertimeHours","Mandays","ContractorName","Remarks") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [log.DailyWorkLogId, numeric(labour.supervisorCount), numeric(labour.engineerCount), numeric(labour.skilledCount), numeric(labour.unskilledCount), numeric(labour.operatorCount), numeric(labour.helperCount), totalLabour, workingHours, numeric(labour.overtimeHours), mandays, labour.contractorName || null, labour.remarks || null]);

    for (const item of req.body.materials || []) {
      if (!item.materialId && !item.materialName) continue;
      const material = item.materialId ? await client.query('SELECT * FROM "Materials" WHERE "MaterialId"=$1', [item.materialId]) : { rows: [] };
      const row = material.rows[0] || {};
      const opening = numeric(item.openingStock);
      const received = numeric(item.receivedQuantity);
      const issued = numeric(item.issuedQuantity);
      const consumed = numeric(item.consumedQuantity);
      const wastage = numeric(item.wastageQuantity);
      const balance = item.balanceStock === undefined || item.balanceStock === '' ? opening + received - issued - consumed - wastage : numeric(item.balanceStock);
      await client.query(`INSERT INTO "DailyMaterialUsage" ("DailyWorkLogId","MaterialId","MaterialNameSnapshot","Unit","OpeningStock","ReceivedQuantity","IssuedQuantity","ConsumedQuantity","WastageQuantity","BalanceStock","SupplierName","InvoiceNo","Remarks") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [log.DailyWorkLogId, nullableInt(item.materialId), row.MaterialName || item.materialName, item.unit || row.Unit || 'nos', opening, received, issued, consumed, wastage, balance, item.supplierName || null, item.invoiceNo || null, item.remarks || null]);
    }

    for (const item of req.body.machinery || []) {
      if (!item.machineryId && !item.machineryName) continue;
      const machine = item.machineryId ? await client.query('SELECT * FROM "Machinery" WHERE "MachineryId"=$1', [item.machineryId]) : { rows: [] };
      const row = machine.rows[0] || {};
      await client.query(`INSERT INTO "DailyMachineryUsage" ("DailyWorkLogId","MachineryId","MachineryNameSnapshot","OperatorName","WorkingHours","IdleHours","BreakdownHours","FuelConsumed","OutputQuantity","Status","Remarks") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [log.DailyWorkLogId, nullableInt(item.machineryId), row.MachineryName || item.machineryName, item.operatorName || null, numeric(item.workingHours), numeric(item.idleHours), numeric(item.breakdownHours), numeric(item.fuelConsumed), numeric(item.outputQuantity, completedQuantity), item.status || 'Working', item.remarks || null]);
    }

    for (const item of req.body.hindrances || []) {
      if (!item.description) continue;
      const hindranceCode = await nextCode('HIN', 'HindranceLogs', 'HindranceCode', logDate);
      await client.query(`INSERT INTO "HindranceLogs" ("HindranceCode","DailyWorkLogId","ProjectId","DepartmentId","TaskId","HindranceType","Description","ImpactHours","ImpactQuantity","ResponsibleDepartment","Priority","ExpectedResolutionDate","Status","RaisedByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [hindranceCode, log.DailyWorkLogId, req.body.projectId, nullableInt(req.body.departmentId), nullableInt(req.body.taskId), item.hindranceType || 'General', item.description, numeric(item.impactHours), numeric(item.impactQuantity), item.responsibleDepartment || null, item.priority || 'Medium', item.expectedResolutionDate || null, item.status || 'Open', actor.userId || null]);
    }

    if (req.body.taskId) {
      await client.query(`UPDATE "Tasks" SET "CompletedQuantity"=GREATEST(COALESCE("CompletedQuantity",0), $1), "ProgressPercent"=GREATEST(COALESCE("ProgressPercent",0), $2), "Status"=CASE WHEN $2>=100 THEN 'Closed' WHEN "Status"='Open' THEN 'Running' ELSE "Status" END, "UpdatedAt"=CURRENT_TIMESTAMP WHERE "TaskId"=$3`, [cumulativeQuantity, progressPercent, req.body.taskId]);
    }

    await client.query('COMMIT');
    await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Create', moduleName: 'Site Monitoring', recordType: 'DailyWorkLogs', recordId: log.DailyWorkLogId, recordCode: code, projectId: log.ProjectId, departmentId: log.DepartmentId, workItemId: log.WorkItemId, taskId: log.TaskId, newValue: { log, labour: req.body.labour, materials: req.body.materials, machinery: req.body.machinery, hindrances: req.body.hindrances }, description: `Daily site monitoring saved: ${code}` });
    res.status(201).json(log);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.delete('/logs/:id', asyncHandler(async (req, res) => {
  const current = await query('SELECT * FROM "DailyWorkLogs" WHERE "DailyWorkLogId"=$1', [req.params.id]);
  const old = current.rows[0];
  if (!old) return res.status(404).json({ message: 'Daily work log not found.' });
  const actor = await ensureWriteAccess(req, res, old.ProjectId);
  if (!actor) return;
  await query('DELETE FROM "DailyWorkLogs" WHERE "DailyWorkLogId"=$1', [req.params.id]);
  await logAudit(req, { userId: actor.userId, userRole: actor.role, actionType: 'Delete', moduleName: 'Site Monitoring', recordType: 'DailyWorkLogs', recordId: req.params.id, recordCode: old.DailyWorkLogCode, projectId: old.ProjectId, oldValue: old, description: `Daily site monitoring deleted: ${old.DailyWorkLogCode}` });
  res.status(204).send();
}));

export default router;

