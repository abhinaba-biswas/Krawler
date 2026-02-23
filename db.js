require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scrape_results (
      job_id     TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      xlsx_data  BYTEA,
      csv_data   TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function saveResult(jobId, url, xlsxBuffer, csvString) {
  await pool.query(
    `INSERT INTO scrape_results (job_id, url, xlsx_data, csv_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id) DO UPDATE SET xlsx_data = $3, csv_data = $4`,
    [jobId, url, xlsxBuffer, csvString]
  );
}

async function getXlsx(jobId) {
  const r = await pool.query('SELECT xlsx_data FROM scrape_results WHERE job_id = $1', [jobId]);
  return r.rows[0]?.xlsx_data || null;
}

async function getCsv(jobId) {
  const r = await pool.query('SELECT csv_data FROM scrape_results WHERE job_id = $1', [jobId]);
  return r.rows[0]?.csv_data || null;
}

async function deleteOldResults(cutoffDate) {
  await pool.query('DELETE FROM scrape_results WHERE created_at < $1', [cutoffDate]);
}

module.exports = { initDB, saveResult, getXlsx, getCsv, deleteOldResults };
