import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function buildTree(rows) {
  const map = new Map(rows.map((row) => [row.SubWorkId, { ...row, children: [] }]));
  const roots = [];
  map.forEach((node) => {
    if (node.ParentSubWorkId && map.has(node.ParentSubWorkId)) map.get(node.ParentSubWorkId).children.push(node);
    else roots.push(node);
  });
  return roots;
}

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.projectId) {
    params.push(req.query.projectId);
    where = 'WHERE sw."ProjectId" = $1';
  }
  const result = await query(`
    SELECT sw.*, p."ProjectName" FROM "SubWorks" sw
    JOIN "Projects" p ON p."ProjectId" = sw."ProjectId"
    ${where}
    ORDER BY sw."ProjectId", sw."ParentSubWorkId", sw."SubWorkName"
  `, params);
  res.json(result.rows);
}));

router.get('/tree', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.projectId) {
    params.push(req.query.projectId);
    where = 'WHERE "ProjectId" = $1';
  }
  const result = await query(`SELECT * FROM "SubWorks" ${where} ORDER BY "ProjectId", "ParentSubWorkId", "SubWorkName"`, params);
  res.json(buildTree(result.rows));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { projectId, parentSubWorkId, subWorkName, description } = req.body;
  const result = await query(`
    INSERT INTO "SubWorks" ("ProjectId", "ParentSubWorkId", "SubWorkName", "Description")
    VALUES ($1, $2, $3, $4) RETURNING *
  `, [projectId, parentSubWorkId || null, subWorkName, description]);
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { projectId, parentSubWorkId, subWorkName, description } = req.body;
  const result = await query(`
    UPDATE "SubWorks" SET "ProjectId"=$1, "ParentSubWorkId"=$2, "SubWorkName"=$3, "Description"=$4, "UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "SubWorkId"=$5 RETURNING *
  `, [projectId, parentSubWorkId || null, subWorkName, description, req.params.id]);
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM "SubWorks" WHERE "SubWorkId"=$1', [req.params.id]);
  res.status(204).send();
}));

export default router;
