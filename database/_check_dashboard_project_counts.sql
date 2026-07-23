SELECT
  COUNT(*) AS total_projects
FROM "Projects";

SELECT
  COUNT(DISTINCT "ProjectId") FILTER (WHERE "ProgressPercent" > 0 AND "ProgressPercent" < 100) AS current_running_projects_logic,
  COUNT(DISTINCT "ProjectId") FILTER (WHERE "Status" = 'Closed') AS current_completed_projects_logic
FROM "Tasks";

SELECT p."ProjectId", p."ProjectCode", p."ProjectName",
  COUNT(t."TaskId") AS total_tasks,
  COUNT(*) FILTER (WHERE t."Status"='Closed') AS closed_tasks,
  COUNT(*) FILTER (WHERE t."Status" IN ('Open','Running','Paused','Awaiting Approval')) AS active_tasks,
  ROUND(COALESCE(AVG(t."ProgressPercent"),0),2) AS avg_progress,
  CASE
    WHEN COUNT(t."TaskId") = 0 THEN 'No Tasks'
    WHEN COUNT(*) FILTER (WHERE t."Status"='Closed') = COUNT(t."TaskId") THEN 'Completed'
    ELSE 'Running'
  END AS concept_status
FROM "Projects" p
LEFT JOIN "Tasks" t ON t."ProjectId"=p."ProjectId"
GROUP BY p."ProjectId", p."ProjectCode", p."ProjectName"
ORDER BY p."ProjectId";
