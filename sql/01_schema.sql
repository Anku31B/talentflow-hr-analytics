-- =====================================================================
-- Talent Acquisition Analytics — Schema (MySQL 8.0+)
-- Models the hiring funnel: posting → application → interview → offer
-- =====================================================================

DROP DATABASE IF EXISTS talent_acquisition;
CREATE DATABASE talent_acquisition CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE talent_acquisition;

-- ---------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------
CREATE TABLE departments (
    dept_id     INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(60)  NOT NULL UNIQUE,
    location    VARCHAR(60)  NOT NULL
);

CREATE TABLE recruiters (
    recruiter_id INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(80) NOT NULL,
    email        VARCHAR(120) NOT NULL UNIQUE,
    dept_id      INT NOT NULL,
    hired_on     DATE NOT NULL,
    CONSTRAINT fk_recruiter_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id)
);

CREATE TABLE sources (
    source_id     INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(40) NOT NULL UNIQUE,
    cost_per_hire DECIMAL(10,2) NOT NULL DEFAULT 0   -- avg spend (INR) attributed per hire
);

-- ---------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------
CREATE TABLE job_postings (
    job_id        INT AUTO_INCREMENT PRIMARY KEY,
    title         VARCHAR(100) NOT NULL,
    dept_id       INT NOT NULL,
    recruiter_id  INT NOT NULL,
    seniority     ENUM('Junior','Mid','Senior','Lead') NOT NULL,
    employment    ENUM('Full-time','Contract','Intern') NOT NULL DEFAULT 'Full-time',
    posted_date   DATE NOT NULL,
    closed_date   DATE NULL,
    salary_min    INT NOT NULL,
    salary_max    INT NOT NULL,
    openings      TINYINT NOT NULL DEFAULT 1,
    status        ENUM('Open','Filled','Closed','On Hold') NOT NULL DEFAULT 'Open',
    CONSTRAINT fk_job_dept      FOREIGN KEY (dept_id)      REFERENCES departments(dept_id),
    CONSTRAINT fk_job_recruiter FOREIGN KEY (recruiter_id) REFERENCES recruiters(recruiter_id),
    CONSTRAINT chk_salary CHECK (salary_max >= salary_min),
    CONSTRAINT chk_dates  CHECK (closed_date IS NULL OR closed_date >= posted_date),
    INDEX idx_job_status (status),
    INDEX idx_job_posted (posted_date)
);

CREATE TABLE candidates (
    candidate_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name   VARCHAR(40) NOT NULL,
    last_name    VARCHAR(40) NOT NULL,
    email        VARCHAR(120) NOT NULL UNIQUE,
    phone        VARCHAR(20),
    city         VARCHAR(60),
    years_exp    TINYINT NOT NULL DEFAULT 0,
    education    ENUM('High School','Bachelor','Master','PhD') NOT NULL,
    created_at   DATE NOT NULL
);

-- One row per candidate per job. current_stage is the furthest stage reached.
CREATE TABLE applications (
    app_id        INT AUTO_INCREMENT PRIMARY KEY,
    candidate_id  INT NOT NULL,
    job_id        INT NOT NULL,
    source_id     INT NOT NULL,
    applied_date  DATE NOT NULL,
    current_stage ENUM('Applied','Screening','Interview','Offer','Hired','Rejected','Withdrawn') NOT NULL DEFAULT 'Applied',
    rejected_at_stage ENUM('Applied','Screening','Interview','Offer') NULL,
    CONSTRAINT fk_app_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    CONSTRAINT fk_app_job       FOREIGN KEY (job_id)       REFERENCES job_postings(job_id)     ON DELETE CASCADE,
    CONSTRAINT fk_app_source    FOREIGN KEY (source_id)    REFERENCES sources(source_id),
    CONSTRAINT uq_candidate_job UNIQUE (candidate_id, job_id),
    INDEX idx_app_stage (current_stage),
    INDEX idx_app_date  (applied_date)
);

CREATE TABLE interviews (
    interview_id   INT AUTO_INCREMENT PRIMARY KEY,
    app_id         INT NOT NULL,
    round_no       TINYINT NOT NULL,
    interview_type ENUM('Phone Screen','Technical','Managerial','HR') NOT NULL,
    interviewer    VARCHAR(80) NOT NULL,
    interview_date DATE NOT NULL,
    score          TINYINT NULL,                     -- 1..5
    outcome        ENUM('Pass','Fail','No Show') NOT NULL,
    CONSTRAINT fk_int_app FOREIGN KEY (app_id) REFERENCES applications(app_id) ON DELETE CASCADE,
    CONSTRAINT chk_score CHECK (score IS NULL OR score BETWEEN 1 AND 5),
    CONSTRAINT uq_app_round UNIQUE (app_id, round_no)
);

CREATE TABLE offers (
    offer_id       INT AUTO_INCREMENT PRIMARY KEY,
    app_id         INT NOT NULL UNIQUE,
    offer_date     DATE NOT NULL,
    salary_offered INT NOT NULL,
    status         ENUM('Pending','Accepted','Declined') NOT NULL DEFAULT 'Pending',
    decision_date  DATE NULL,
    join_date      DATE NULL,
    decline_reason VARCHAR(80) NULL,
    CONSTRAINT fk_offer_app FOREIGN KEY (app_id) REFERENCES applications(app_id) ON DELETE CASCADE
);
