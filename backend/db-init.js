import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.resolve(__dirname, '../database/schema.sql');
const seedPath = path.resolve(__dirname, '../database/seed.sql');

const { Pool } = pg;
const targetDatabase = process.env.PGDATABASE || 'construction_monitoring';
const adminDatabase = process.env.PGDEFAULT_DB || 'postgres';

const adminPool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: adminDatabase,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  max: 1,
  idleTimeoutMillis: 30000,
});

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: targetDatabase,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
});

async function loadSqlFile(filePath) {
  return fs.promises.readFile(filePath, { encoding: 'utf8' });
}

async function runSql(poolInstance, sql) {
  const client = await poolInstance.connect();
  try {
    console.log('Executing SQL...');
    await client.query(sql);
  } finally {
    client.release();
  }
}

async function ensureDatabaseExists() {
  const sql = `SELECT 1 FROM pg_database WHERE datname = $1`;
  const client = await adminPool.connect();
  try {
    const result = await client.query(sql, [targetDatabase]);
    if (result.rowCount === 0) {
      console.log(`Database ${targetDatabase} does not exist. Creating...`);
      await client.query(`CREATE DATABASE "${targetDatabase}"`);
      console.log(`Created database ${targetDatabase}.`);
    } else {
      console.log(`Database ${targetDatabase} already exists.`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('Ensuring target database exists:', targetDatabase);
    await ensureDatabaseExists();

    console.log('Loading schema from', schemaPath);
    const schemaSql = await loadSqlFile(schemaPath);

    console.log('Applying schema...');
    await runSql(pool, schemaSql);
    console.log('Schema applied successfully.');

    console.log('Loading seed data from', seedPath);
    const seedSql = await loadSqlFile(seedPath);

    console.log('Applying seed data...');
    await runSql(pool, seedSql);
    console.log('Seed data applied successfully.');

    console.log('Database initialization completed.');
  } catch (error) {
    console.error('Database initialization failed:', error.message || error);
    process.exit(1);
  } finally {
    await adminPool.end();
    await pool.end();
  }
}

main();
