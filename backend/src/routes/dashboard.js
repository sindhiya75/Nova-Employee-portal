import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { actorFromRequest, accessibleProjectIds } from '../utils/access.js';

const router = express.Router();

function getRangeConfig(rangeInput, yearInput) {
  const rawRange = String(rangeInput || '2026').toLowerCase();
  const selectedYear = ['2024', '2025', '2026'].includes(String(yearInput || rangeInput)) ? Number(yearInput || rangeInput) : new Date().getFullYear();
  if (['2024', '2025', '2026'].includes(rawRange)) {
    const year = Number(rawRange);
    return { range: rawRange, chartMode: 'year', selectedYear: year, periodCte: 'SELECT generate_series(1, 12) AS sort_no', labelExpr: "TO_CHAR(TO_DATE(p.sort_no::text, 'MM'), 'Mon')", startExpr: `(DATE '${year}-01-01' + ((p.sort_no - 1) * interval '1 month'))::date`, endExpr: `(DATE '${year}-01-01' + (p.sort_no * interval '1 month') - interval '1 day')::date` };
  }
  if (rawRange === 'quarter') return { range: 'quarter', chartMode: 'quarter', selectedYear, periodCte: 'SELECT generate_series(1, 4) AS sort_no', labelExpr: "'Q' || p.sort_no", startExpr: `(DATE '${selectedYear}-01-01' + ((p.sort_no - 1) * interval '3 months'))::date`, endExpr: `(DATE '${selectedYear}-01-01' + (p.sort_no * interval '3 months') - interval '1 day')::date` };
  if (rawRange === 'day') return { range: 'day', chartMode: 'day', selectedYear, periodCte: "SELECT generate_series(1, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int) AS sort_no", labelExpr: 'p.sort_no::text', startExpr: "(date_trunc('month', CURRENT_DATE) + ((p.sort_no - 1) * interval '1 day'))::date", endExpr: "(date_trunc('month', CURRENT_DATE) + ((p.sort_no - 1) * interval '1 day'))::date" };
  return { range: 'month', chartMode: 'month', selectedYear, periodCte: 'SELECT generate_series(1, 12) AS sort_no', labelExpr: "TO_CHAR(TO_DATE(p.sort_no::text, 'MM'), 'Mon')", startExpr: `(DATE '${selectedYear}-01-01' + ((p.sort_no - 1) * interval '1 month'))::date`, endExpr: `(DATE '${selectedYear}-01-01' + (p.sort_no * interval '1 month') - interval '1 day')::date` };
}

async function dashboardScope(req) {
  const actor = actorFromRequest(req);
  const ids = await accessibleProjectIds(actor);
  if (actor.role === 'Employee') return { actor, ids: [], selectedProjectId: null };
  let selectedProjectId = req.query.projectId && req.query.projectId !== 'overall' ? Number(req.query.projectId) : null;
  if (ids !== null) {
    if (!ids.length) return { actor, ids: [], selectedProjectId: null };
    if (!selectedProjectId || !ids.includes(selectedProjectId)) selectedProjectId = ids[0];
    return { actor, ids: [selectedProjectId], selectedProjectId };
  }
  return { actor, ids: selectedProjectId ? [selectedProjectId] : null, selectedProjectId };
}

function projectWhere(ids, alias = 't', startIndex = 1) {
  if (ids === null) return { text: '', params: [] };
  if (!ids.length) return { text: ' AND 1=0', params: [] };
  return { text: ` AND ${alias}."ProjectId" = ANY($${startIndex}::int[])`, params: [ids] };
}

function lineChartSql(config, ids) {
  const projectPick = ids === null ? '' : 'WHERE "ProjectId" = ANY($1::int[])';
  return `
    WITH periods AS (${config.periodCte}), shaped_periods AS (
      SELECT p.sort_no, ${config.labelExpr} AS period_label, ${config.startExpr} AS period_start, ${config.endExpr} AS period_end FROM periods p
    ), selected_projects AS (SELECT "ProjectId", "ProjectName" FROM "Projects" ${projectPick} ORDER BY "ProjectId" LIMIT 2), task_period AS (
      SELECT sp.sort_no, sp.period_label, pr."ProjectId", pr."ProjectName", t."TaskId", COALESCE(MAX(tp."TodayProgressPercent"::float), CASE WHEN t."StartDate" <= sp.period_end THEN t."ProgressPercent"::float ELSE 0 END, 0) AS task_progress
      FROM shaped_periods sp CROSS JOIN selected_projects pr
      LEFT JOIN "Tasks" t ON t."ProjectId" = pr."ProjectId" AND (t."StartDate" IS NULL OR t."StartDate" <= sp.period_end)
      LEFT JOIN "TaskProgress" tp ON tp."TaskId" = t."TaskId" AND tp."WorkDate" <= sp.period_end
      GROUP BY sp.sort_no, sp.period_label, pr."ProjectId", pr."ProjectName", t."TaskId", t."StartDate", t."ProgressPercent", sp.period_end
    )
    SELECT period_label AS "PeriodLabel", sort_no AS "SortNo", "ProjectId", "ProjectName", ROUND(COALESCE(AVG(task_progress), 0)::numeric, 1)::float AS "Progress"
    FROM task_period GROUP BY sort_no, period_label, "ProjectId", "ProjectName" ORDER BY sort_no, "ProjectId"
  `;
}

function barChartSql(config, ids) {
  const where = ids === null ? '' : 'WHERE t."ProjectId" = ANY($1::int[])';
  return `
    WITH periods AS (${config.periodCte}), shaped_periods AS (
      SELECT p.sort_no, ${config.labelExpr} AS period_label, ${config.startExpr} AS period_start, ${config.endExpr} AS period_end FROM periods p
    ), task_period AS (
      SELECT sp.sort_no, sp.period_label, t."TaskId",
        CASE WHEN t."TaskId" IS NULL THEN 0 WHEN t."StartDate" IS NULL OR t."FinishDate" IS NULL THEN t."ProgressPercent"::float WHEN sp.period_end >= t."FinishDate" THEN 100 WHEN sp.period_end < t."StartDate" THEN 0 ELSE LEAST(100, GREATEST(0, ((sp.period_end - t."StartDate")::float / GREATEST((t."FinishDate" - t."StartDate"), 1)) * 100)) END AS planned_percent,
        COALESCE(MAX(tp."TodayProgressPercent"::float), CASE WHEN t."StartDate" <= sp.period_end THEN t."ProgressPercent"::float ELSE 0 END, 0) AS actual_percent
      FROM shaped_periods sp LEFT JOIN "Tasks" t ON (t."StartDate" IS NULL OR t."StartDate" <= sp.period_end) LEFT JOIN "TaskProgress" tp ON tp."TaskId" = t."TaskId" AND tp."WorkDate" <= sp.period_end ${where}
      GROUP BY sp.sort_no, sp.period_label, sp.period_end, t."TaskId", t."StartDate", t."FinishDate", t."ProgressPercent"
    )
    SELECT period_label AS "PeriodLabel", sort_no AS "SortNo", ROUND(COALESCE(AVG(planned_percent), 0)::numeric, 1)::float AS "Budget", ROUND(COALESCE(AVG(actual_percent), 0)::numeric, 1)::float AS "Progress"
    FROM task_period GROUP BY sort_no, period_label ORDER BY sort_no
  `;
}

router.get('/', asyncHandler(async (req, res) => {
  const config = getRangeConfig(req.query.range, req.query.year);
  const scope = await dashboardScope(req);
  const w = projectWhere(scope.ids, 't');
  const pwhere = scope.ids === null ? '' : scope.ids.length ? 'WHERE p."ProjectId" = ANY($1::int[])' : 'WHERE 1=0';
  const params = scope.ids === null ? [] : [scope.ids];
  const clientKpiSql = scope.ids === null ? '(SELECT COUNT(*)::int FROM "Clients")' : '(SELECT COUNT(DISTINCT "ClientId")::int FROM scoped_projects WHERE "ClientId" IS NOT NULL)';
  const [projects, kpis, recentActivity, latestTasks, completedTasks, projectProgress, taskStatus, lineChart, budgetProgress, alerts, milestones, attendance, attendanceRecent] = await Promise.all([
    query(`SELECT p."ProjectId", p."ProjectName" FROM "Projects" p ${pwhere} ORDER BY p."ProjectName"`, params),
    query(`WITH scoped_projects AS (SELECT p."ProjectId", p."ClientId" FROM "Projects" p ${pwhere}), project_status AS (SELECT sp."ProjectId", COUNT(t."TaskId")::int AS total_tasks, COUNT(*) FILTER (WHERE t."Status"='Closed')::int AS closed_tasks FROM scoped_projects sp LEFT JOIN "Tasks" t ON t."ProjectId"=sp."ProjectId" GROUP BY sp."ProjectId") SELECT (SELECT COUNT(*)::int FROM scoped_projects) AS "TotalProjects", ${clientKpiSql} AS "TotalClients", (SELECT COUNT(*)::int FROM "Employees" WHERE "IsActive"=TRUE) AS "TotalEmployees", (SELECT COUNT(*)::int FROM "Users") AS "TotalUsers", (SELECT COUNT(*)::int FROM "Tasks" t WHERE "Status"='Open' ${w.text}) AS "OpenTasks", (SELECT COUNT(*)::int FROM "Tasks" t WHERE "Status"='Closed' ${w.text}) AS "ClosedTasks", (SELECT COUNT(*)::int FROM "Tasks" t WHERE "Status"='Running' ${w.text}) AS "RunningTasks", (SELECT COUNT(*)::int FROM project_status WHERE total_tasks > 0 AND closed_tasks < total_tasks) AS "RunningProjects", (SELECT COUNT(*)::int FROM project_status WHERE total_tasks > 0 AND closed_tasks = total_tasks) AS "CompletedProjects", (SELECT COUNT(*)::int FROM "Tasks" t WHERE t."FinishDate" < CURRENT_DATE AND t."Status" <> 'Closed' ${w.text}) AS "DelayedActivities", COALESCE((SELECT AVG(t."ProgressPercent"::float) FROM "Tasks" t WHERE TRUE ${w.text}),0) AS "OverallProgress", 0 AS "AttendancePercent"`, params),
    query(`SELECT 'Progress Updated' AS "ActivityType", t."TaskId", t."TaskName" AS "Title", tp."Remarks" AS "Detail", tp."CreatedAt", e."EmployeeName" FROM "TaskProgress" tp JOIN "Tasks" t ON t."TaskId"=tp."TaskId" LEFT JOIN "Employees" e ON e."EmployeeId"=tp."EmployeeId" WHERE TRUE ${w.text} AND COALESCE(tp."Remarks",'') NOT ILIKE 'Historical dashboard progress seed%' ORDER BY tp."CreatedAt" DESC LIMIT 6`, params),
    query(`SELECT t."TaskId", t."TaskName", t."Status", t."Priority", t."ProgressPercent", p."ProjectName", e."EmployeeName", t."FinishDate" FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" LEFT JOIN "Employees" e ON e."EmployeeId"=t."AssignedEmployeeId" WHERE TRUE ${w.text} ORDER BY t."CreatedAt" DESC LIMIT 8`, params),
    query(`SELECT t."TaskId", t."TaskName", t."ProgressPercent", p."ProjectName", t."UpdatedAt", t."Status" FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" WHERE t."Status"='Closed' ${w.text} ORDER BY COALESCE(t."UpdatedAt", t."CreatedAt") DESC LIMIT 8`, params),
    query(`SELECT p."ProjectId", p."ProjectName", COALESCE(AVG(t."ProgressPercent"::float),0) AS "Progress" FROM "Projects" p LEFT JOIN "Tasks" t ON t."ProjectId"=p."ProjectId" ${pwhere} GROUP BY p."ProjectId", p."ProjectName" ORDER BY p."ProjectName"`, params),
    query(`SELECT t."Status", COUNT(*)::int AS "Count" FROM "Tasks" t WHERE TRUE ${w.text} GROUP BY t."Status"`, params),
    query(lineChartSql(config, scope.ids), params),
    query(barChartSql(config, scope.ids), params),
    query(`SELECT t."TaskId", t."TaskName", t."Priority", t."Status", t."FinishDate", p."ProjectName", CASE WHEN t."FinishDate" < CURRENT_DATE AND t."Status" <> 'Closed' THEN 'Delayed activity' ELSE 'Needs attention' END AS "AlertText" FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" WHERE (t."Priority" IN ('High','Critical') OR (t."FinishDate" < CURRENT_DATE AND t."Status" <> 'Closed')) ${w.text} ORDER BY t."FinishDate" NULLS LAST LIMIT 4`, params),
    query(`SELECT t."TaskId", t."TaskName", t."FinishDate", p."ProjectName", t."Status" FROM "Tasks" t JOIN "Projects" p ON p."ProjectId"=t."ProjectId" WHERE t."FinishDate" IS NOT NULL ${w.text} ORDER BY CASE WHEN t."FinishDate" >= CURRENT_DATE THEN 0 ELSE 1 END, t."FinishDate" LIMIT 4`, params),
    query(`WITH total AS (SELECT COUNT(DISTINCT e."EmployeeId")::int AS total FROM "Employees" e JOIN "Tasks" t ON t."AssignedEmployeeId"=e."EmployeeId" WHERE e."IsActive"=TRUE ${w.text}), logs AS (SELECT al."Status", COUNT(DISTINCT al."EmployeeId")::int AS count FROM "AttendanceLogs" al JOIN "Tasks" t ON t."AssignedEmployeeId"=al."EmployeeId" WHERE al."AttendanceDate"=CURRENT_DATE ${w.text} GROUP BY al."Status") SELECT (SELECT total FROM total) AS "Total", COALESCE((SELECT count FROM logs WHERE "Status"='Present'),0) AS "Present", COALESCE((SELECT count FROM logs WHERE "Status"='Late'),0) AS "Late", COALESCE((SELECT count FROM logs WHERE "Status"='Leave'),0) AS "Leave", GREATEST((SELECT total FROM total)-COALESCE((SELECT SUM(count) FROM logs),0),0)::int AS "Absent"`, params),
    query(`SELECT al.*, e."EmployeeName" FROM "AttendanceLogs" al JOIN "Employees" e ON e."EmployeeId"=al."EmployeeId" JOIN "Tasks" t ON t."AssignedEmployeeId"=e."EmployeeId" WHERE TRUE ${w.text} ORDER BY al."AttendanceDate" DESC, al."CheckInTime" DESC NULLS LAST LIMIT 6`, params),
  ]);
  const k = kpis.rows[0];
  k.AttendancePercent = Number(attendance.rows[0]?.Total || 0) ? Math.round(((Number(attendance.rows[0]?.Present || 0) + Number(attendance.rows[0]?.Late || 0)) / Number(attendance.rows[0]?.Total || 1)) * 100) : 0;
  res.json({ range: config.range, chartMode: config.chartMode, selectedYear: config.selectedYear, selectedProjectId: scope.selectedProjectId, availableProjects: projects.rows, kpis: k, recentActivity: recentActivity.rows, latestTasks: latestTasks.rows, completedTasks: completedTasks.rows, projectProgress: projectProgress.rows, taskStatus: taskStatus.rows, lineChart: lineChart.rows, budgetProgress: budgetProgress.rows, alerts: alerts.rows, milestones: milestones.rows, attendance: attendance.rows[0], attendanceRecent: attendanceRecent.rows });
}));

export default router;


