-- =====================================================================
-- Talent Acquisition Analytics — Reusable views
-- These power the dashboard and keep the analysis queries short.
-- =====================================================================
USE talent_acquisition;

-- ---------------------------------------------------------------------
-- One wide row per application, with the furthest funnel level reached:
--   1 Applied · 2 Screening · 3 Interview · 4 Offer · 5 Hired
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_application_detail AS
SELECT
    a.app_id,
    a.applied_date,
    a.current_stage,
    a.rejected_at_stage,
    CASE
        WHEN a.current_stage = 'Hired'     THEN 5
        WHEN a.current_stage = 'Offer'     THEN 4
        WHEN a.current_stage = 'Interview' THEN 3
        WHEN a.current_stage = 'Screening' THEN 2
        WHEN a.current_stage = 'Applied'   THEN 1
        WHEN a.current_stage = 'Withdrawn' AND o.offer_id IS NOT NULL THEN 4
        WHEN a.current_stage = 'Withdrawn' THEN 2
        ELSE FIELD(a.rejected_at_stage, 'Applied', 'Screening', 'Interview', 'Offer')
    END                                   AS stage_level,
    c.candidate_id,
    CONCAT(c.first_name, ' ', c.last_name) AS candidate_name,
    c.city, c.years_exp, c.education,
    j.job_id, j.title AS job_title, j.seniority, j.status AS job_status,
    d.dept_id, d.name AS department,
    r.recruiter_id, r.name AS recruiter,
    s.source_id, s.name AS source,
    o.offer_id, o.offer_date, o.salary_offered, o.status AS offer_status,
    o.decision_date, o.join_date,
    DATEDIFF(o.decision_date, a.applied_date) AS days_to_decision
FROM applications a
JOIN candidates   c ON c.candidate_id = a.candidate_id
JOIN job_postings j ON j.job_id       = a.job_id
JOIN departments  d ON d.dept_id      = j.dept_id
JOIN recruiters   r ON r.recruiter_id = j.recruiter_id
JOIN sources      s ON s.source_id    = a.source_id
LEFT JOIN offers  o ON o.app_id       = a.app_id;

-- ---------------------------------------------------------------------
-- Overall hiring funnel: how many applications reached each stage
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_hiring_funnel AS
SELECT 1 AS step, 'Applied'   AS stage, COUNT(*) AS reached FROM vw_application_detail
UNION ALL SELECT 2, 'Screening', SUM(stage_level >= 2) FROM vw_application_detail
UNION ALL SELECT 3, 'Interview', SUM(stage_level >= 3) FROM vw_application_detail
UNION ALL SELECT 4, 'Offer',     SUM(stage_level >= 4) FROM vw_application_detail
UNION ALL SELECT 5, 'Hired',     SUM(stage_level >= 5) FROM vw_application_detail;

-- ---------------------------------------------------------------------
-- Recruiter scorecard
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_recruiter_kpis AS
SELECT
    recruiter_id,
    recruiter,
    COUNT(DISTINCT job_id)                                   AS jobs_owned,
    COUNT(*)                                                 AS applications,
    SUM(offer_id IS NOT NULL)                                AS offers_made,
    SUM(offer_status = 'Accepted')                           AS hires,
    ROUND(100 * SUM(offer_status = 'Accepted')
              / NULLIF(SUM(offer_status IN ('Accepted','Declined')), 0), 1) AS offer_accept_pct,
    ROUND(AVG(CASE WHEN offer_status = 'Accepted' THEN days_to_decision END), 1) AS avg_days_to_hire
FROM vw_application_detail
GROUP BY recruiter_id, recruiter;

-- ---------------------------------------------------------------------
-- Source effectiveness & cost
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_source_performance AS
SELECT
    s.source_id,
    s.name                                               AS source,
    s.cost_per_hire,
    COUNT(v.app_id)                                      AS applications,
    SUM(v.stage_level >= 3)                              AS interviewed,
    SUM(v.stage_level >= 5)                              AS hires,
    ROUND(100 * SUM(v.stage_level >= 5) / COUNT(v.app_id), 2) AS app_to_hire_pct,
    s.cost_per_hire * SUM(v.stage_level >= 5)            AS total_spend
FROM sources s
LEFT JOIN vw_application_detail v ON v.source_id = s.source_id
GROUP BY s.source_id, s.name, s.cost_per_hire;

-- ---------------------------------------------------------------------
-- Per-job pipeline snapshot (what's in flight right now)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_job_pipeline AS
SELECT
    j.job_id,
    j.title,
    d.name                                              AS department,
    r.name                                              AS recruiter,
    j.seniority,
    j.status,
    j.openings,
    j.posted_date,
    j.closed_date,
    DATEDIFF(COALESCE(j.closed_date, CURRENT_DATE), j.posted_date) AS days_open,
    COUNT(a.app_id)                                     AS total_applicants,
    COALESCE(SUM(a.current_stage = 'Applied'), 0) AS in_applied,
    COALESCE(SUM(a.current_stage = 'Screening'), 0) AS in_screening,
    COALESCE(SUM(a.current_stage = 'Interview'), 0) AS in_interview,
    COALESCE(SUM(a.current_stage = 'Offer'), 0) AS in_offer,
    COALESCE(SUM(a.current_stage = 'Hired'), 0) AS hired
FROM job_postings j
JOIN departments d ON d.dept_id = j.dept_id
JOIN recruiters  r ON r.recruiter_id = j.recruiter_id
LEFT JOIN applications a ON a.job_id = j.job_id
GROUP BY j.job_id, j.title, d.name, r.name, j.seniority, j.status, j.openings, j.posted_date, j.closed_date;
