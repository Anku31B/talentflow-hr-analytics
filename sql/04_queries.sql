-- =====================================================================
-- Talent Acquisition Analytics — Business questions
-- Each query is tagged "-- @Qn: title" so the dashboard's SQL Explorer
-- can load and run them directly from this file.
-- =====================================================================
USE talent_acquisition;

-- ─────────────────────────── BEGINNER ───────────────────────────

-- @Q1: Open positions by department
-- Where is hiring demand right now? Counts open reqs and seats.
SELECT d.name              AS department,
       COUNT(*)            AS open_jobs,
       SUM(j.openings)     AS open_seats
FROM job_postings j
JOIN departments d ON d.dept_id = j.dept_id
WHERE j.status = 'Open'
GROUP BY d.name
ORDER BY open_seats DESC;

-- @Q2: Applicant volume by source
-- Which channels bring in the most candidates?
SELECT s.name                                        AS source,
       COUNT(a.app_id)                               AS applications,
       ROUND(100 * COUNT(a.app_id) / SUM(COUNT(a.app_id)) OVER (), 1) AS share_pct
FROM sources s
LEFT JOIN applications a ON a.source_id = s.source_id
GROUP BY s.name
ORDER BY applications DESC;

-- @Q3: Average offered salary by role
-- Compares what we actually offer against the posted band (in LPA).
SELECT j.title,
       COUNT(o.offer_id)                          AS offers,
       ROUND(AVG(o.salary_offered) / 100000, 1)   AS avg_offer_lpa,
       ROUND(AVG(j.salary_min) / 100000, 1)       AS band_min_lpa,
       ROUND(AVG(j.salary_max) / 100000, 1)       AS band_max_lpa
FROM offers o
JOIN applications a ON a.app_id = o.app_id
JOIN job_postings j ON j.job_id = a.job_id
GROUP BY j.title
ORDER BY avg_offer_lpa DESC;

-- ─────────────────────────── INTERMEDIATE ───────────────────────────

-- @Q4: Time-to-hire by department
-- Days from application to offer acceptance, for hired candidates only.
SELECT department,
       COUNT(*)                              AS hires,
       ROUND(AVG(days_to_decision), 1)       AS avg_days_to_hire,
       MIN(days_to_decision)                 AS fastest,
       MAX(days_to_decision)                 AS slowest
FROM vw_application_detail
WHERE offer_status = 'Accepted'
GROUP BY department
ORDER BY avg_days_to_hire;

-- @Q5: Funnel conversion rates
-- Stage-to-stage and overall conversion through the hiring funnel.
SELECT stage,
       reached,
       ROUND(100 * reached / LAG(reached) OVER (ORDER BY step), 1)         AS pct_of_prev_stage,
       ROUND(100 * reached / FIRST_VALUE(reached) OVER (ORDER BY step), 1) AS pct_of_applicants
FROM vw_hiring_funnel
ORDER BY step;

-- @Q6: Offer acceptance rate by recruiter
-- Decided offers only (pending offers excluded).
SELECT recruiter,
       offers_made,
       hires,
       offer_accept_pct,
       avg_days_to_hire
FROM vw_recruiter_kpis
ORDER BY offer_accept_pct DESC, hires DESC;

-- @Q7: Cost per hire & ROI by source
-- Which channel converts best for the money?
SELECT source,
       applications,
       hires,
       app_to_hire_pct,
       cost_per_hire,
       total_spend,
       RANK() OVER (ORDER BY app_to_hire_pct DESC) AS quality_rank,
       RANK() OVER (ORDER BY cost_per_hire ASC)    AS cost_rank
FROM vw_source_performance
ORDER BY app_to_hire_pct DESC;

-- ─────────────────────────── ADVANCED ───────────────────────────

-- @Q8: Recruiter leaderboard by quarter
-- RANK() recruiters on hires within each quarter; shows the top 3.
WITH quarterly AS (
    SELECT CONCAT(YEAR(decision_date), '-Q', QUARTER(decision_date)) AS quarter,
           recruiter,
           COUNT(*) AS hires
    FROM vw_application_detail
    WHERE offer_status = 'Accepted'
    GROUP BY quarter, recruiter
), ranked AS (
    SELECT *, RANK() OVER (PARTITION BY quarter ORDER BY hires DESC) AS rnk
    FROM quarterly
)
SELECT quarter, rnk AS `rank`, recruiter, hires
FROM ranked
WHERE rnk <= 3
ORDER BY quarter, rnk, recruiter;

-- @Q9: Month-over-month application trend
-- LAG() compares each month with the previous one.
WITH monthly AS (
    SELECT DATE_FORMAT(applied_date, '%Y-%m') AS month,
           COUNT(*)                           AS applications
    FROM applications
    GROUP BY month
)
SELECT month,
       applications,
       LAG(applications) OVER (ORDER BY month)                          AS prev_month,
       ROUND(100 * (applications - LAG(applications) OVER (ORDER BY month))
                 / LAG(applications) OVER (ORDER BY month), 1)          AS mom_change_pct,
       ROUND(AVG(applications) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1)
                                                                        AS rolling_3m_avg
FROM monthly
ORDER BY month;

-- @Q10: Stale requisitions
-- Open jobs that have been open longer than their department's average.
WITH dept_avg AS (
    SELECT dept_id,
           AVG(DATEDIFF(COALESCE(closed_date, CURRENT_DATE), posted_date)) AS avg_days_open
    FROM job_postings
    GROUP BY dept_id
)
SELECT j.job_id,
       j.title,
       d.name                                         AS department,
       r.name                                         AS recruiter,
       DATEDIFF(CURRENT_DATE, j.posted_date)          AS days_open,
       ROUND(da.avg_days_open)                        AS dept_avg_days,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.job_id) AS applicants
FROM job_postings j
JOIN dept_avg    da ON da.dept_id = j.dept_id
JOIN departments d  ON d.dept_id  = j.dept_id
JOIN recruiters  r  ON r.recruiter_id = j.recruiter_id
WHERE j.status = 'Open'
  AND DATEDIFF(CURRENT_DATE, j.posted_date) > da.avg_days_open
ORDER BY days_open DESC;

-- @Q11: Repeat applicants never interviewed
-- Candidates with 3+ applications who never reached the interview stage.
SELECT c.candidate_id,
       CONCAT(c.first_name, ' ', c.last_name)  AS candidate,
       c.years_exp,
       COUNT(*)                                AS applications,
       GROUP_CONCAT(DISTINCT j.title ORDER BY j.title SEPARATOR ', ') AS roles_applied
FROM candidates c
JOIN applications a ON a.candidate_id = c.candidate_id
JOIN job_postings j ON j.job_id = a.job_id
WHERE NOT EXISTS (
    SELECT 1 FROM interviews i
    JOIN applications a2 ON a2.app_id = i.app_id
    WHERE a2.candidate_id = c.candidate_id
)
GROUP BY c.candidate_id, candidate, c.years_exp
HAVING COUNT(*) >= 3
ORDER BY applications DESC, candidate;

-- @Q12: Do interview scores predict hires?
-- Average interview score for hired vs. not-hired candidates, by interview type.
SELECT i.interview_type,
       ROUND(AVG(CASE WHEN a.current_stage = 'Hired' THEN i.score END), 2)  AS avg_score_hired,
       ROUND(AVG(CASE WHEN a.current_stage <> 'Hired' THEN i.score END), 2) AS avg_score_not_hired,
       ROUND(AVG(CASE WHEN a.current_stage = 'Hired' THEN i.score END)
           - AVG(CASE WHEN a.current_stage <> 'Hired' THEN i.score END), 2) AS score_gap,
       COUNT(*)                                                             AS interviews
FROM interviews i
JOIN applications a ON a.app_id = i.app_id
WHERE i.score IS NOT NULL
GROUP BY i.interview_type
ORDER BY FIELD(i.interview_type, 'Phone Screen', 'Technical', 'Managerial', 'HR');
