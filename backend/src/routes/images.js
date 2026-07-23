import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.taskId) {
    params.push(req.query.taskId);
    where = 'WHERE "TaskId" = $1';
  }
  const result = await query(`SELECT * FROM "TaskImages" ${where} ORDER BY "UploadedAt" DESC`, params);
  res.json(result.rows);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM "TaskImages" WHERE "ImageId"=$1', [req.params.id]);
  res.status(204).send();
}));

export default router;
