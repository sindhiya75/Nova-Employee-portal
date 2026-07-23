import express from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextBusinessCode } from '../utils/codes.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const search = `%${req.query.search || ''}%`;
  const result = await query(`
    SELECT * FROM "Clients"
    WHERE "ClientName" ILIKE $1 OR COALESCE("ContactPerson", '') ILIKE $1 OR COALESCE("Email", '') ILIKE $1
    ORDER BY "CreatedAt" DESC
  `, [search]);
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { clientName, contactPerson, email, phone, address } = req.body;
  // Purpose: every new client receives a stable business ID for audit and document reference.
  const clientCode = await nextBusinessCode('Clients', 'ClientCode');
  const result = await query(`
    INSERT INTO "Clients" ("ClientCode", "ClientName", "ContactPerson", "Email", "Phone", "Address")
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [clientCode, clientName, contactPerson, email, phone, address]);
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { clientName, contactPerson, email, phone, address } = req.body;
  const result = await query(`
    UPDATE "Clients" SET "ClientName"=$1, "ContactPerson"=$2, "Email"=$3, "Phone"=$4, "Address"=$5, "UpdatedAt"=CURRENT_TIMESTAMP
    WHERE "ClientId"=$6 RETURNING *
  `, [clientName, contactPerson, email, phone, address, req.params.id]);
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query(`DELETE FROM "Clients" WHERE "ClientId"=$1`, [req.params.id]);
  res.status(204).send();
}));

export default router;

