import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const [taskReport, projectSummary, departmentSummary, attendanceSummary] = await Promise.all([
    query(`
      SELECT t."TaskId", t."TaskCode", t."TaskName", t."Status", t."Priority", t."ProgressPercent",
             p."ProjectName", d."DepartmentName", wi."WorkName", e."EmployeeName", t."StartDate", t."FinishDate"
      FROM "Tasks" t
      JOIN "Projects" p ON p."ProjectId" = t."ProjectId"
      LEFT JOIN "Departments" d ON d."DepartmentId" = t."DepartmentId"
      LEFT JOIN "WorkItems" wi ON wi."WorkItemId" = t."WorkItemId"
      LEFT JOIN "Employees" e ON e."EmployeeId" = t."AssignedEmployeeId"
      ORDER BY p."ProjectName", t."TaskName"
    `),
    query(`
      SELECT p."ProjectId", p."ProjectName", COUNT(t."TaskId")::int AS "TotalTasks",
             COUNT(*) FILTER (WHERE t."Status"='Closed')::int AS "ClosedTasks",
             COUNT(*) FILTER (WHERE t."Status"<>'Closed')::int AS "OpenTasks",
             ROUND(COALESCE(AVG(t."ProgressPercent"::float), 0)::numeric, 1)::float AS "Progress"
      FROM "Projects" p
      LEFT JOIN "Tasks" t ON t."ProjectId" = p."ProjectId"
      GROUP BY p."ProjectId", p."ProjectName"
      ORDER BY p."ProjectName"
    `),
    query(`
      SELECT COALESCE(d."DepartmentName", 'Unassigned') AS "DepartmentName", COUNT(t."TaskId")::int AS "TotalTasks",
             ROUND(COALESCE(AVG(t."ProgressPercent"::float), 0)::numeric, 1)::float AS "Progress"
      FROM "Tasks" t
      LEFT JOIN "Departments" d ON d."DepartmentId" = t."DepartmentId"
      GROUP BY d."DepartmentName"
      ORDER BY "DepartmentName"
    `),
    query(`
      SELECT al."AttendanceDate", al."Status", COUNT(*)::int AS "Count"
      FROM "AttendanceLogs" al
      WHERE al."AttendanceDate" >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY al."AttendanceDate", al."Status"
      ORDER BY al."AttendanceDate" DESC, al."Status"
    `)
  ]);

  res.json({
    taskReport: taskReport.rows,
    projectSummary: projectSummary.rows,
    departmentSummary: departmentSummary.rows,
    attendanceSummary: attendanceSummary.rows,
  });
}));

export default router;
