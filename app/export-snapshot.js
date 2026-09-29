// Exports every API response to public/data/snapshot.json so the dashboard can
// be hosted as a static site (e.g. Vercel, GitHub Pages) with no database.
//
//   npm run snapshot
//
// Spins up the same embedded MySQL as demo mode, loads the SQL files, runs the
// real API against it, and saves the results. Re-run it after changing the SQL.
import { createDB } from 'mysql-memory-server';
import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(__dirname, '..', 'sql');
const OUT = path.join(__dirname, 'public', 'data', 'snapshot.json');

console.log('Starting embedded MySQL…');
const db = await createDB({ version: '8.4.x', logLevel: 'ERROR' });
try {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: db.port, user: db.username, multipleStatements: true });
  for (const file of ['01_schema.sql', '02_seed_data.sql', '03_views.sql']) {
    await conn.query(readFileSync(path.join(SQL_DIR, file), 'utf8'));
  }
  await conn.end();

  const PORT = 4123;
  Object.assign(process.env, {
    DB_HOST: '127.0.0.1', DB_PORT: String(db.port), DB_USER: db.username,
    DB_PASSWORD: '', DB_NAME: 'talent_acquisition', PORT: String(PORT),
  });
  await import('./server.js');

  const get = async (url, opts) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
    if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const [kpis, funnel, trend, sources, departments, meta, jobs, candidates, recruiters, queries] = await Promise.all([
    get('/api/kpis'), get('/api/funnel'), get('/api/trend'), get('/api/sources'), get('/api/departments'),
    get('/api/meta'), get('/api/jobs'), get('/api/candidates?limit=200'), get('/api/recruiters'), get('/api/queries'),
  ]);

  // The candidates endpoint pages at 200 rows; collect them all.
  const allCandidates = [];
  for (let offset = 0; offset < candidates.total; offset += 200) {
    allCandidates.push(...(await get(`/api/candidates?limit=200&offset=${offset}`)).rows);
  }

  const applicants = {};
  for (const j of jobs) applicants[j.job_id] = await get(`/api/jobs/${j.job_id}/applicants`);

  const queryResults = {};
  for (const q of queries) queryResults[q.id] = await get(`/api/queries/${q.id}/run`, { method: 'POST' });

  const snapshot = {
    generated_at: new Date().toISOString(),
    kpis, funnel, trend, sources, departments, meta, jobs,
    candidates: allCandidates, applicants, recruiters, queries, queryResults,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot));
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${allCandidates.length} applications, ${jobs.length} jobs, ${queries.length} queries)`);
} finally {
  await db.stop();
  process.exit(0);
}
