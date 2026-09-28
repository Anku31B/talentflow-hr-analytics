import dotenv from 'dotenv';
import express from 'express';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'talent_acquisition',
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 10,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// Wraps async handlers so errors become JSON 500s instead of crashing.
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  });

const query = async (sql, params = []) => (await pool.query(sql, params))[0];

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected', 'Withdrawn'];

// ───────────────────────────── Overview ─────────────────────────────

app.get('/api/kpis', route(async (_req, res) => {
  const [row] = await query(`
    SELECT
      (SELECT COUNT(*) FROM job_postings WHERE status = 'Open')                     AS open_jobs,
      (SELECT COALESCE(SUM(openings),0) FROM job_postings WHERE status = 'Open')    AS open_seats,
      (SELECT COUNT(*) FROM applications)                                           AS applications,
      (SELECT COUNT(*) FROM applications
        WHERE current_stage IN ('Applied','Screening','Interview','Offer'))         AS active_pipeline,
      (SELECT COUNT(*) FROM offers WHERE status = 'Accepted')                       AS hires,
      (SELECT ROUND(AVG(days_to_decision),1) FROM vw_application_detail
        WHERE offer_status = 'Accepted')                                            AS avg_days_to_hire,
      (SELECT ROUND(100 * SUM(status='Accepted') / NULLIF(SUM(status IN ('Accepted','Declined')),0),1)
         FROM offers)                                                               AS offer_accept_pct,
      (SELECT ROUND(SUM(total_spend) / NULLIF(SUM(hires),0)) FROM vw_source_performance) AS avg_cost_per_hire
  `);
  res.json(row);
}));

app.get('/api/funnel', route(async (_req, res) => {
  res.json(await query('SELECT stage, reached FROM vw_hiring_funnel ORDER BY step'));
}));

app.get('/api/trend', route(async (_req, res) => {
  res.json(await query(`
    SELECT m.month, m.applications, COALESCE(h.hires, 0) AS hires
    FROM (SELECT DATE_FORMAT(applied_date,'%Y-%m') AS month, COUNT(*) AS applications
          FROM applications GROUP BY month) m
    LEFT JOIN (SELECT DATE_FORMAT(decision_date,'%Y-%m') AS month, COUNT(*) AS hires
               FROM offers WHERE status = 'Accepted' GROUP BY month) h USING (month)
    ORDER BY m.month`));
}));

app.get('/api/sources', route(async (_req, res) => {
  res.json(await query('SELECT * FROM vw_source_performance ORDER BY app_to_hire_pct DESC'));
}));

app.get('/api/departments', route(async (_req, res) => {
  res.json(await query(`
    SELECT d.name AS department,
           (SELECT COUNT(*) FROM job_postings j WHERE j.dept_id = d.dept_id AND j.status = 'Open') AS open_jobs,
           COALESCE(SUM(v.offer_status = 'Accepted'), 0)                                     AS hires,
           ROUND(AVG(CASE WHEN v.offer_status = 'Accepted' THEN v.days_to_decision END), 1) AS avg_days_to_hire
    FROM departments d
    LEFT JOIN vw_application_detail v ON v.dept_id = d.dept_id
    GROUP BY d.dept_id, d.name
    ORDER BY hires DESC`));
}));

// ───────────────────────────── Jobs ─────────────────────────────

app.get('/api/meta', route(async (_req, res) => {
  const [departments, recruiters, sources] = await Promise.all([
    query('SELECT dept_id, name FROM departments ORDER BY name'),
    query('SELECT recruiter_id, name, dept_id FROM recruiters ORDER BY name'),
    query('SELECT source_id, name FROM sources ORDER BY name'),
  ]);
  res.json({ departments, recruiters, sources, stages: STAGES });
}));

app.get('/api/jobs', route(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.department) { where.push('department = ?'); params.push(req.query.department); }
  res.json(await query(
    `SELECT * FROM vw_job_pipeline ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY FIELD(status,'Open','On Hold','Filled','Closed'), posted_date DESC`, params));
}));

app.get('/api/jobs/:id/applicants', route(async (req, res) => {
  res.json(await query(`
    SELECT app_id, candidate_id, candidate_name, years_exp, education, city, source,
           applied_date, current_stage, offer_status, salary_offered,
           (SELECT ROUND(AVG(score),1) FROM interviews i WHERE i.app_id = v.app_id) AS avg_score
    FROM vw_application_detail v
    WHERE job_id = ?
    ORDER BY stage_level DESC, applied_date`, [req.params.id]));
}));

app.post('/api/jobs', route(async (req, res) => {
  const { title, dept_id, recruiter_id, seniority, employment, salary_min, salary_max, openings } = req.body;
  if (!title || !dept_id || !recruiter_id || !salary_min || !salary_max) {
    return res.status(400).json({ error: 'title, department, recruiter and salary band are required' });
  }
  if (Number(salary_max) < Number(salary_min)) {
    return res.status(400).json({ error: 'Max salary must be at least min salary' });
  }
  const [r] = await pool.query(
    `INSERT INTO job_postings (title, dept_id, recruiter_id, seniority, employment, posted_date,
                               salary_min, salary_max, openings, status)
     VALUES (?, ?, ?, ?, ?, CURRENT_DATE, ?, ?, ?, 'Open')`,
    [title, dept_id, recruiter_id, seniority || 'Mid', employment || 'Full-time',
     salary_min, salary_max, openings || 1]);
  res.status(201).json({ job_id: r.insertId });
}));

// Moving a candidate through the pipeline keeps offers & job status consistent.
app.patch('/api/applications/:id', route(async (req, res) => {
  const { stage } = req.body;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[appRow]] = await conn.query(
      `SELECT a.app_id, a.current_stage, a.job_id, j.salary_min, j.salary_max, j.openings
       FROM applications a JOIN job_postings j ON j.job_id = a.job_id
       WHERE a.app_id = ? FOR UPDATE`, [req.params.id]);
    if (!appRow) { await conn.rollback(); return res.status(404).json({ error: 'Application not found' }); }

    const prev = appRow.current_stage;
    const rejectedAt = stage === 'Rejected' && ['Applied', 'Screening', 'Interview', 'Offer'].includes(prev) ? prev : null;
    await conn.query('UPDATE applications SET current_stage = ?, rejected_at_stage = ? WHERE app_id = ?',
      [stage, rejectedAt, appRow.app_id]);

    if (stage === 'Offer' || stage === 'Hired') {
      const mid = Math.round((appRow.salary_min + appRow.salary_max) / 2 / 10000) * 10000;
      await conn.query(
        `INSERT INTO offers (app_id, offer_date, salary_offered, status)
         VALUES (?, CURRENT_DATE, ?, 'Pending')
         ON DUPLICATE KEY UPDATE app_id = app_id`, [appRow.app_id, mid]);
    }
    if (stage === 'Hired') {
      await conn.query(
        `UPDATE offers SET status = 'Accepted', decision_date = CURRENT_DATE,
                join_date = DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY), decline_reason = NULL
         WHERE app_id = ?`, [appRow.app_id]);
      // Close the requisition once every seat is filled
      await conn.query(
        `UPDATE job_postings SET status = 'Filled', closed_date = CURRENT_DATE
         WHERE job_id = ? AND status = 'Open'
           AND (SELECT COUNT(*) FROM applications WHERE job_id = ? AND current_stage = 'Hired') >= openings`,
        [appRow.job_id, appRow.job_id]);
    }
    if ((stage === 'Rejected' || stage === 'Withdrawn') && prev === 'Offer') {
      await conn.query(
        `UPDATE offers SET status = 'Declined', decision_date = CURRENT_DATE,
                decline_reason = COALESCE(decline_reason, 'Updated from dashboard')
         WHERE app_id = ? AND status = 'Pending'`, [appRow.app_id]);
    }
    await conn.commit();
    res.json({ app_id: appRow.app_id, from: prev, to: stage });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// ───────────────────────────── Candidates ─────────────────────────────

app.get('/api/candidates', route(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(candidate_name LIKE ? OR job_title LIKE ? OR city LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  if (req.query.stage) { where.push('current_stage = ?'); params.push(req.query.stage); }
  if (req.query.source) { where.push('source = ?'); params.push(req.query.source); }
  const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [rows, [{ total }]] = await Promise.all([
    query(`SELECT app_id, candidate_name, city, years_exp, education, job_id, job_title, department,
                  source, applied_date, current_stage
           FROM vw_application_detail ${filter}
           ORDER BY applied_date DESC, app_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    query(`SELECT COUNT(*) AS total FROM vw_application_detail ${filter}`, params),
  ]);
  res.json({ total, rows });
}));

// ───────────────────────────── Recruiters ─────────────────────────────

app.get('/api/recruiters', route(async (_req, res) => {
  res.json(await query(`
    SELECT k.*, d.name AS department
    FROM vw_recruiter_kpis k
    JOIN recruiters r ON r.recruiter_id = k.recruiter_id
    JOIN departments d ON d.dept_id = r.dept_id
    ORDER BY k.hires DESC`));
}));

// ───────────────────────────── SQL Explorer ─────────────────────────────
// Only the named queries from sql/04_queries.sql can be run — never arbitrary SQL.

function loadQueries() {
  const text = readFileSync(path.join(__dirname, '..', 'sql', '04_queries.sql'), 'utf8');
  const blocks = text.split(/^-- @/m).slice(1);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const [, id, title] = lines[0].match(/^(Q\d+):\s*(.+)$/);
    const descLines = [];
    let i = 1;
    while (lines[i]?.startsWith('--')) descLines.push(lines[i++].replace(/^--\s?/, ''));
    const sql = lines.slice(i).join('\n')
      .replace(/\n-- ─+.*$/gm, '')
      .trim();
    const level = Number(id.slice(1)) <= 3 ? 'Beginner' : Number(id.slice(1)) <= 7 ? 'Intermediate' : 'Advanced';
    return { id, title, description: descLines.join(' '), level, sql };
  });
}
const QUERIES = loadQueries();

app.get('/api/queries', (_req, res) => {
  res.json(QUERIES);
});

app.post('/api/queries/:id/run', route(async (req, res) => {
  const q = QUERIES.find((x) => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Unknown query' });
  const started = performance.now();
  const [rows, fields] = await pool.query(q.sql);
  res.json({
    columns: fields.map((f) => f.name),
    rows,
    ms: Math.round(performance.now() - started),
  });
}));

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`Talent Acquisition dashboard → http://localhost:${PORT}`));
