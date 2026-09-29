// ─────────────────────────── helpers ───────────────────────────
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const lpa = (n) => (n == null ? '—' : `₹${(n / 100000).toFixed(1)}L`);
const badge = (s) => (s ? `<span class="badge b-${esc(s)}">${esc(s)}</span>` : '—');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function api(url, opts = {}) {
  if (SNAP) return snapshotApi(url, opts);
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ─────────────────────────── snapshot mode ───────────────────────────
// When no database is reachable (static hosting), the dashboard serves the same
// API from data/snapshot.json (built by `npm run snapshot`). Edits apply in this
// browser only and reset on reload.
let SNAP = null;
const STAGE_KEY = { Applied: 'in_applied', Screening: 'in_screening', Interview: 'in_interview', Offer: 'in_offer', Hired: 'hired' };

async function snapshotApi(url, { method = 'GET', body } = {}) {
  const u = new URL(url, location.origin);
  const p = u.searchParams;
  const parts = u.pathname.replace(/^\/api\//, '').split('/');
  const fail = (msg) => { throw new Error(msg); };

  if (method === 'GET' && parts.length === 1 && ['kpis', 'funnel', 'trend', 'sources', 'departments', 'meta', 'recruiters', 'queries'].includes(parts[0])) {
    return SNAP[parts[0]];
  }
  if (parts[0] === 'jobs' && parts.length === 1 && method === 'GET') {
    return SNAP.jobs.filter((j) => (!p.get('status') || j.status === p.get('status')) && (!p.get('department') || j.department === p.get('department')));
  }
  if (parts[0] === 'jobs' && parts[2] === 'applicants') return SNAP.applicants[parts[1]] || [];
  if (parts[0] === 'jobs' && method === 'POST') {
    if (!body.title || !body.dept_id || !body.recruiter_id || !body.salary_min || !body.salary_max) fail('title, department, recruiter and salary band are required');
    if (Number(body.salary_max) < Number(body.salary_min)) fail('Max salary must be at least min salary');
    const job_id = Math.max(...SNAP.jobs.map((j) => j.job_id)) + 1;
    SNAP.jobs.unshift({
      job_id, title: body.title, status: 'Open', seniority: body.seniority || 'Mid', openings: Number(body.openings) || 1,
      department: META.departments.find((d) => d.dept_id === Number(body.dept_id))?.name,
      recruiter: META.recruiters.find((r) => r.recruiter_id === Number(body.recruiter_id))?.name,
      posted_date: new Date().toISOString().slice(0, 10), closed_date: null, days_open: 0,
      total_applicants: 0, in_applied: 0, in_screening: 0, in_interview: 0, in_offer: 0, hired: 0,
    });
    return { job_id };
  }
  if (parts[0] === 'candidates') {
    const q = (p.get('q') || '').toLowerCase();
    const rows = SNAP.candidates.filter((c) =>
      (!q || [c.candidate_name, c.job_title, c.city].some((v) => String(v).toLowerCase().includes(q))) &&
      (!p.get('stage') || c.current_stage === p.get('stage')) &&
      (!p.get('source') || c.source === p.get('source')));
    const offset = Number(p.get('offset')) || 0;
    return { total: rows.length, rows: rows.slice(offset, offset + (Number(p.get('limit')) || 50)) };
  }
  if (parts[0] === 'applications' && method === 'PATCH') {
    const id = Number(parts[1]);
    const cand = SNAP.candidates.find((c) => c.app_id === id) || fail('Application not found');
    const from = cand.current_stage;
    const job = SNAP.jobs.find((j) => j.job_id === cand.job_id);
    if (job && STAGE_KEY[from]) job[STAGE_KEY[from]]--;
    if (job && STAGE_KEY[body.stage]) job[STAGE_KEY[body.stage]]++;
    cand.current_stage = body.stage;
    const appRow = (SNAP.applicants[cand.job_id] || []).find((a) => a.app_id === id);
    if (appRow) appRow.current_stage = body.stage;
    return { app_id: id, from, to: body.stage };
  }
  if (parts[0] === 'queries' && parts[2] === 'run') return SNAP.queryResults[parts[1]] || fail('Unknown query');
  fail(`Not available in snapshot mode: ${url}`);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

// Renders an array of objects as a table. cols: [{key, label, num, render}]
function renderTable(el, cols, rows, { onRow } = {}) {
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="empty" colspan="${cols.length}">No results</td></tr></tbody>`;
    return;
  }
  el.innerHTML =
    `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r, i) =>
      `<tr data-i="${i}" class="${onRow ? 'clickable' : ''}">${cols.map((c) =>
        `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r[c.key], r) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  if (onRow) {
    el.querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('select')) return;
        onRow(rows[tr.dataset.i]);
      }));
  }
}

const charts = {};
function chart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}
function chartDefaults() {
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--border');
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.maintainAspectRatio = false;
}

let META = null;

// ─────────────────────────── routing ───────────────────────────
const loaders = { overview: loadOverview, jobs: loadJobs, candidates: loadCandidates, recruiters: loadRecruiters, sql: loadSql };

function show(view) {
  if (!loaders[view]) view = 'overview';
  closeDrawer();
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  loaders[view]().catch((e) => toast(e.message));
}
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

// ─────────────────────────── overview ───────────────────────────
async function loadOverview() {
  const [k, funnel, trend, sources, depts] = await Promise.all([
    api('/api/kpis'), api('/api/funnel'), api('/api/trend'), api('/api/sources'), api('/api/departments'),
  ]);

  const kpis = [
    ['Open requisitions', fmt(k.open_jobs), `${fmt(k.open_seats)} seats to fill`],
    ['Active pipeline', fmt(k.active_pipeline), `of ${fmt(k.applications)} total applications`],
    ['Total hires', fmt(k.hires), `${k.offer_accept_pct}% offer acceptance`],
    ['Avg. time to hire', `${k.avg_days_to_hire} days`, `avg. cost per hire ₹${fmt(k.avg_cost_per_hire)}`],
  ];
  $('#kpis').innerHTML = kpis.map(([l, v, s]) =>
    `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');

  const top = funnel[0].reached;
  const shades = ['#4f46e5', '#5b5bf0', '#6875f5', '#0ea5c6', '#12976a'];
  $('#funnel').innerHTML = funnel.map((f, i) => {
    const pct = (100 * f.reached) / top;
    const conv = i ? ((100 * f.reached) / funnel[i - 1].reached).toFixed(0) : null;
    return `<div class="f-row">
      <div class="f-label">${f.stage}</div>
      <div class="f-track"><div class="f-bar" style="width:${pct}%;background:${shades[i]}">${fmt(f.reached)}</div></div>
      <div class="f-pct"><b>${pct.toFixed(1)}%</b>${conv ? ` · ${conv}% step` : ''}</div>
    </div>`;
  }).join('');

  const accent = css('--accent');
  const good = css('--good');
  chart('chart-trend', {
    data: {
      labels: trend.map((t) => t.month),
      datasets: [
        { type: 'bar', label: 'Applications', data: trend.map((t) => t.applications), backgroundColor: accent + '55', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Hires', data: trend.map((t) => t.hires), borderColor: good, backgroundColor: good, tension: .35, pointRadius: 2, yAxisID: 'y1' },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: true, title: { display: true, text: 'Applications' } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Hires' } },
      },
    },
  });

  chart('chart-sources', {
    data: {
      labels: sources.map((s) => s.source),
      datasets: [
        { type: 'bar', label: 'App → hire %', data: sources.map((s) => s.app_to_hire_pct), backgroundColor: accent, borderRadius: 4, xAxisID: 'x' },
        { type: 'bar', label: 'Cost per hire (₹)', data: sources.map((s) => s.cost_per_hire), backgroundColor: css('--warn') + 'aa', borderRadius: 4, xAxisID: 'x1' },
      ],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: { beginAtZero: true, position: 'bottom', title: { display: true, text: 'Conversion %' } },
        x1: { beginAtZero: true, position: 'top', grid: { display: false }, title: { display: true, text: 'Cost per hire (₹)' } },
        y: { grid: { display: false } },
      },
    },
  });

  chart('chart-depts', {
    data: {
      labels: depts.map((d) => d.department),
      datasets: [
        { type: 'bar', label: 'Hires', data: depts.map((d) => d.hires), backgroundColor: accent, borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Avg. days to hire', data: depts.map((d) => d.avg_days_to_hire), borderColor: css('--warn'), backgroundColor: css('--warn'), pointRadius: 4, showLine: false, yAxisID: 'y1' },
      ],
    },
    options: {
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: 'Hires' } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Days' } },
      },
    },
  });
}

// ─────────────────────────── jobs ───────────────────────────
function miniPipe(r) {
  const parts = [['in_applied', '#94a3b8'], ['in_screening', '#06b6d4'], ['in_interview', '#6366f1'], ['in_offer', '#f59e0b'], ['hired', '#10b981']];
  const total = Number(r.total_applicants) || 1;
  const closed = total - parts.reduce((s, [k]) => s + Number(r[k] || 0), 0);
  return `<div class="mini-pipe" title="Applied ${r.in_applied} · Screening ${r.in_screening} · Interview ${r.in_interview} · Offer ${r.in_offer} · Hired ${r.hired} · Rejected/withdrawn ${closed}">${
    parts.map(([k, c]) => `<span style="width:${(100 * r[k]) / total}%;background:${c}"></span>`).join('')
  }<span style="width:${(100 * closed) / total}%;background:var(--border)"></span></div>`;
}

let lastJobs = [];
async function loadJobs() {
  const params = new URLSearchParams();
  if ($('#job-status').value) params.set('status', $('#job-status').value);
  if ($('#job-dept').value) params.set('department', $('#job-dept').value);
  const jobs = await api(`/api/jobs?${params}`);
  lastJobs = jobs;
  $('#job-count').textContent = `${jobs.length} postings`;
  renderTable($('#jobs-table'), [
    { key: 'job_id', label: '#', num: true },
    { key: 'title', label: 'Title', render: (v, r) => `<strong>${esc(v)}</strong><div class="muted small">${esc(r.seniority)} · ${r.openings} opening${r.openings > 1 ? 's' : ''}</div>` },
    { key: 'department', label: 'Department' },
    { key: 'recruiter', label: 'Recruiter' },
    { key: 'status', label: 'Status', render: badge },
    { key: 'posted_date', label: 'Posted' },
    { key: 'days_open', label: 'Days open', num: true },
    { key: 'total_applicants', label: 'Applicants', num: true },
    { key: 'in_applied', label: 'Pipeline', render: (_, r) => miniPipe(r) },
    { key: 'hired', label: 'Hired', num: true },
  ], jobs, { onRow: openJob });
}

async function openJob(job) {
  $('#drawer-title').textContent = job.title;
  $('#drawer-sub').innerHTML = `${esc(job.department)} · ${esc(job.recruiter)} · ${badge(job.status)} · ${job.total_applicants} applicants`;
  $('#drawer').hidden = $('#drawer-bg').hidden = false;
  const apps = await api(`/api/jobs/${job.job_id}/applicants`);
  renderTable($('#drawer-table'), [
    { key: 'candidate_name', label: 'Candidate', render: (v, r) => `<strong>${esc(v)}</strong><div class="muted small">${esc(r.city)} · ${r.years_exp} yrs · ${esc(r.education)}</div>` },
    { key: 'source', label: 'Source' },
    { key: 'applied_date', label: 'Applied' },
    { key: 'avg_score', label: 'Avg. score', num: true },
    { key: 'salary_offered', label: 'Offer', num: true, render: lpa },
    { key: 'current_stage', label: 'Stage', render: (v, r) => stageSelect(r.app_id, v, async () => {
      await loadJobs();
      openJob(lastJobs.find((j) => j.job_id === job.job_id) || job);
    }) },
  ], apps);
}
function closeDrawer() { $('#drawer').hidden = $('#drawer-bg').hidden = true; }
$('#drawer-close').onclick = closeDrawer;
$('#drawer-bg').onclick = closeDrawer;
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

// Stage dropdowns are wired via delegation (see below); callbacks keyed by app_id.
const stageCallbacks = new Map();
function stageSelect(appId, current, after) {
  stageCallbacks.set(String(appId), after);
  return `<select class="stage-select" data-app="${appId}" data-current="${esc(current)}">${
    META.stages.map((s) => `<option ${s === current ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
}
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('.stage-select');
  if (!sel) return;
  const { app, current } = sel.dataset;
  try {
    const r = await api(`/api/applications/${app}`, { method: 'PATCH', body: { stage: sel.value } });
    toast(`Moved application #${r.app_id}: ${r.from} → ${r.to}${SNAP ? ' (this browser only)' : ''}`);
    stageCallbacks.get(app)?.();
  } catch (err) {
    sel.value = current;
    toast(err.message);
  }
});

$('#job-status').onchange = loadJobs;
$('#job-dept').onchange = loadJobs;

// New posting dialog
const dlg = $('#job-dialog');
$('#btn-new-job').onclick = () => { $('#job-error').textContent = ''; $('#job-form').reset(); syncRecruiters(); dlg.showModal(); };
$('#job-cancel').onclick = () => dlg.close();
$('#f-dept').onchange = syncRecruiters;
function syncRecruiters() {
  const dept = Number($('#f-dept').value);
  const recs = META.recruiters.filter((r) => r.dept_id === dept);
  $('#f-rec').innerHTML = (recs.length ? recs : META.recruiters).map((r) => `<option value="${r.recruiter_id}">${esc(r.name)}</option>`).join('');
}
$('#job-form').onsubmit = async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('/api/jobs', { method: 'POST', body });
    dlg.close();
    toast(`Created job #${r.job_id}${SNAP ? ' (this browser only)' : ''}`);
    $('#job-status').value = 'Open';
    loadJobs();
  } catch (err) {
    $('#job-error').textContent = err.message;
  }
};

// ─────────────────────────── candidates ───────────────────────────
const PAGE = 50;
let candOffset = 0;
async function loadCandidates() {
  const params = new URLSearchParams({ limit: PAGE, offset: candOffset });
  if ($('#cand-q').value.trim()) params.set('q', $('#cand-q').value.trim());
  if ($('#cand-stage').value) params.set('stage', $('#cand-stage').value);
  if ($('#cand-source').value) params.set('source', $('#cand-source').value);
  const { total, rows } = await api(`/api/candidates?${params}`);
  $('#cand-count').textContent = `${fmt(total)} applications`;
  $('#cand-page').textContent = total ? `${candOffset + 1}–${Math.min(candOffset + PAGE, total)} of ${fmt(total)}` : '';
  $('#cand-prev').disabled = candOffset === 0;
  $('#cand-next').disabled = candOffset + PAGE >= total;
  renderTable($('#cand-table'), [
    { key: 'app_id', label: '#', num: true },
    { key: 'candidate_name', label: 'Candidate', render: (v, r) => `<strong>${esc(v)}</strong><div class="muted small">${esc(r.city)} · ${r.years_exp} yrs · ${esc(r.education)}</div>` },
    { key: 'job_title', label: 'Applied for', render: (v, r) => `${esc(v)}<div class="muted small">${esc(r.department)}</div>` },
    { key: 'source', label: 'Source' },
    { key: 'applied_date', label: 'Applied' },
    { key: 'current_stage', label: 'Stage', render: (v, r) => stageSelect(r.app_id, v, loadCandidates) },
  ], rows);
}
let searchTimer;
$('#cand-q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { candOffset = 0; loadCandidates(); }, 250); };
$('#cand-stage').onchange = $('#cand-source').onchange = () => { candOffset = 0; loadCandidates(); };
$('#cand-prev').onclick = () => { candOffset = Math.max(0, candOffset - PAGE); loadCandidates(); };
$('#cand-next').onclick = () => { candOffset += PAGE; loadCandidates(); };

// ─────────────────────────── recruiters ───────────────────────────
async function loadRecruiters() {
  const recs = await api('/api/recruiters');
  renderTable($('#rec-table'), [
    { key: 'recruiter', label: 'Recruiter', render: (v, r) => `<strong>${esc(v)}</strong><div class="muted small">${esc(r.department)}</div>` },
    { key: 'jobs_owned', label: 'Jobs', num: true },
    { key: 'applications', label: 'Apps', num: true },
    { key: 'offers_made', label: 'Offers', num: true },
    { key: 'hires', label: 'Hires', num: true },
    { key: 'offer_accept_pct', label: 'Accept %', num: true, render: (v) => (v == null ? '—' : `${v}%`) },
    { key: 'avg_days_to_hire', label: 'Days to hire', num: true },
  ], recs);
  const sorted = [...recs].sort((a, b) => (b.offer_accept_pct ?? 0) - (a.offer_accept_pct ?? 0));
  const avg = recs.reduce((s, r) => s + (r.offer_accept_pct ?? 0), 0) / recs.length;
  chart('chart-rec', {
    type: 'bar',
    data: {
      labels: sorted.map((r) => r.recruiter),
      datasets: [{
        label: 'Offer acceptance %',
        data: sorted.map((r) => r.offer_accept_pct),
        backgroundColor: sorted.map((r) => (r.offer_accept_pct >= avg ? css('--good') : css('--warn'))),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, subtitle: { display: true, text: `Green = above team average (${avg.toFixed(1)}%)`, align: 'start', padding: { bottom: 10 } } },
      scales: { x: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } },
    },
  });
}

// ─────────────────────────── SQL explorer ───────────────────────────
let QUERIES = [];
let currentQ = null;

const KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|GROUP|BY|ORDER|HAVING|AS|AND|OR|NOT|IN|IS|NULL|CASE|WHEN|THEN|ELSE|END|WITH|OVER|PARTITION|ROWS|BETWEEN|PRECEDING|CURRENT|ROW|DESC|ASC|DISTINCT|EXISTS|LIMIT|UNION|ALL|SEPARATOR)\b/g;
const FN = /\b(COUNT|SUM|AVG|MIN|MAX|ROUND|CONCAT|RANK|LAG|FIRST_VALUE|DATEDIFF|DATE_FORMAT|YEAR|QUARTER|COALESCE|NULLIF|GROUP_CONCAT|FIELD)\b(?=\s*\()/g;
function highlight(sql) {
  // Tokenise comments and strings first so keywords inside them aren't coloured.
  return sql.split(/(--[^\n]*|'[^']*')/g).map((part) => {
    if (part.startsWith('--')) return `<span class="cm">${esc(part)}</span>`;
    if (part.startsWith("'")) return `<span class="str">${esc(part)}</span>`;
    return esc(part)
      .replace(FN, '<span class="fn">$1</span>')
      .replace(KW, '<span class="kw">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="num">$1</span>');
  }).join('');
}

async function loadSql() {
  if (!QUERIES.length) {
    QUERIES = await api('/api/queries');
    const groups = ['Beginner', 'Intermediate', 'Advanced'];
    $('#q-list').innerHTML = groups.map((g) =>
      `<div class="q-group">${g}</div>` + QUERIES.filter((q) => q.level === g).map((q) =>
        `<div class="q-item" data-id="${q.id}"><span class="qid">${q.id}</span><span>${esc(q.title)}</span></div>`).join('')).join('');
    $('#q-list').addEventListener('click', (e) => {
      const item = e.target.closest('.q-item');
      if (item) selectQuery(item.dataset.id);
    });
    selectQuery(QUERIES[0].id);
  }
}

function selectQuery(id) {
  currentQ = QUERIES.find((q) => q.id === id);
  document.querySelectorAll('.q-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  $('#q-level').textContent = `${currentQ.id} · ${currentQ.level}`;
  $('#q-title').textContent = currentQ.title;
  $('#q-desc').textContent = currentQ.description;
  $('#q-sql').innerHTML = highlight(currentQ.sql);
  runQuery();
}

async function runQuery() {
  $('#q-meta').textContent = 'Running…';
  try {
    const { columns, rows, ms } = await api(`/api/queries/${currentQ.id}/run`, { method: 'POST' });
    $('#q-meta').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${ms} ms`;
    renderTable($('#q-result'), columns.map((c) => ({
      key: c, label: c, num: rows.some((r) => typeof r[c] === 'number'),
      render: (v) => (typeof v === 'number' ? fmt(v) : esc(v ?? 'NULL')),
    })), rows);
  } catch (err) {
    $('#q-meta').textContent = err.message;
  }
}
$('#q-run').onclick = runQuery;

// ─────────────────────────── boot ───────────────────────────
(async function init() {
  chartDefaults();
  try {
    META = await api('/api/meta');
    $('#db-dot').className = 'dot ok';
    $('#db-status').textContent = 'Connected to MySQL';
  } catch (e) {
    try {
      const res = await fetch('data/snapshot.json');
      if (!res.ok) throw new Error();
      SNAP = await res.json();
      META = SNAP.meta;
      $('#db-dot').className = 'dot';
      $('#db-status').textContent = `MySQL snapshot · ${SNAP.generated_at.slice(0, 10)}`;
      $('#db-status').title = 'Static demo: results were exported from MySQL. Edits stay in this browser and reset on reload.';
    } catch {
      $('#db-dot').className = 'dot err';
      $('#db-status').textContent = 'Database unreachable';
      toast(e.message);
      return;
    }
  }
  const deptOpts = META.departments.map((d) => `<option>${esc(d.name)}</option>`).join('');
  $('#job-dept').insertAdjacentHTML('beforeend', deptOpts);
  $('#f-dept').innerHTML = META.departments.map((d) => `<option value="${d.dept_id}">${esc(d.name)}</option>`).join('');
  $('#cand-stage').insertAdjacentHTML('beforeend', META.stages.map((s) => `<option>${s}</option>`).join(''));
  $('#cand-source').insertAdjacentHTML('beforeend', META.sources.map((s) => `<option>${esc(s.name)}</option>`).join(''));
  show(location.hash.slice(1) || 'overview');
})();
