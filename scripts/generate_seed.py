"""
Generates sql/02_seed_data.sql with realistic, reproducible hiring-funnel data.

Run:  python3 scripts/generate_seed.py
Data is deterministic (fixed random seed), so the queries in 03_queries.sql
always return the same results.
"""
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)
TODAY = date(2026, 9, 28)
START = date(2025, 1, 6)

OUT = Path(__file__).resolve().parent.parent / "sql" / "02_seed_data.sql"

# ---------------------------------------------------------------- reference
DEPARTMENTS = [
    ("Engineering", "Bengaluru"), ("Data & Analytics", "Hyderabad"),
    ("Product", "Bengaluru"), ("Sales", "Mumbai"),
    ("Marketing", "Mumbai"), ("Human Resources", "Pune"),
]

RECRUITERS = [  # name, dept index (1-based)
    ("Priya Sharma", 1), ("Rahul Verma", 1), ("Ananya Iyer", 2),
    ("Karan Mehta", 2), ("Sneha Reddy", 3), ("Vikram Nair", 4),
    ("Meera Pillai", 4), ("Arjun Das", 5), ("Divya Menon", 6),
    ("Rohit Kapoor", 1),
]

# name, cost_per_hire, quality multiplier (affects pass-through rates), volume weight
SOURCES = [  # cost_per_hire in INR
    ("LinkedIn", 45000, 1.00, 30), ("Employee Referral", 25000, 1.45, 12),
    ("Naukri", 18000, 0.85, 25), ("Company Career Site", 5000, 1.10, 15),
    ("Recruitment Agency", 150000, 1.25, 8), ("Campus Drive", 12000, 0.90, 10),
]

ROLES = {  # dept -> [(title, seniority, salary band in LPA)]
    1: [("Backend Engineer", "Mid", (14, 22)), ("Frontend Engineer", "Mid", (12, 20)),
        ("Senior Software Engineer", "Senior", (25, 40)), ("DevOps Engineer", "Mid", (15, 24)),
        ("Engineering Manager", "Lead", (45, 65)), ("SDE Intern", "Junior", (4, 6)),
        ("QA Engineer", "Junior", (6, 10))],
    2: [("Data Analyst", "Junior", (6, 10)), ("Data Scientist", "Mid", (16, 26)),
        ("Senior Data Engineer", "Senior", (28, 42)), ("BI Developer", "Mid", (10, 16))],
    3: [("Product Manager", "Senior", (30, 45)), ("Associate Product Manager", "Junior", (12, 18)),
        ("Product Designer", "Mid", (14, 22))],
    4: [("Sales Executive", "Junior", (5, 8)), ("Account Manager", "Mid", (10, 16)),
        ("Regional Sales Lead", "Lead", (25, 35))],
    5: [("Content Strategist", "Mid", (8, 14)), ("Performance Marketer", "Mid", (10, 18)),
        ("Brand Manager", "Senior", (20, 30))],
    6: [("HR Generalist", "Mid", (7, 12)), ("Talent Acquisition Specialist", "Mid", (8, 14))],
}
DEPT_WEIGHTS = {1: 30, 2: 18, 3: 10, 4: 18, 5: 12, 6: 6}

FIRST = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan",
         "Shaurya", "Ananya", "Diya", "Aadhya", "Saanvi", "Pari", "Myra", "Anika", "Navya",
         "Kavya", "Riya", "Rohan", "Nikhil", "Siddharth", "Aman", "Harsh", "Pooja", "Neha",
         "Shreya", "Tanvi", "Isha", "Manish", "Deepak", "Suresh", "Lakshmi", "Swati", "Varun",
         "Tarun", "Nisha", "Gaurav", "Kriti", "Yash", "Aditi", "Rakesh", "Sonal", "Farhan",
         "Zoya", "Imran", "Sara", "Daniel", "Maria"]
LAST = ["Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Reddy", "Nair", "Iyer", "Menon",
        "Rao", "Joshi", "Chopra", "Malhotra", "Bose", "Das", "Mukherjee", "Khan", "Shaikh",
        "Pillai", "Agarwal", "Bhat", "Kulkarni", "Deshmukh", "Jain", "Saxena", "Mishra",
        "Pandey", "Fernandes", "DSouza"]
CITIES = ["Bengaluru", "Hyderabad", "Pune", "Mumbai", "Chennai", "Delhi", "Noida", "Gurugram",
          "Kolkata", "Ahmedabad", "Kochi", "Jaipur"]
INTERVIEWERS = ["Amit Rao", "Sunita Joshi", "Ravi Kulkarni", "Fatima Shaikh", "George Thomas",
                "Lata Menon", "Nitin Bhat", "Pallavi Jain", "Sameer Khan", "Uma Iyer",
                "Kiran Desai", "Ashok Pandey"]
DECLINE_REASONS = ["Accepted counter-offer", "Compensation below expectation",
                   "Accepted another offer", "Relocation concerns", "Role scope mismatch"]


def rdate(a: date, b: date) -> date:
    if b <= a:
        return a
    return a + timedelta(days=random.randint(0, (b - a).days))


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def insert(table, cols, rows, chunk=200):
    out = []
    for i in range(0, len(rows), chunk):
        vals = ",\n".join("(" + ", ".join(q(v) for v in r) + ")" for r in rows[i:i + chunk])
        out.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n{vals};")
    return "\n\n".join(out)


# ---------------------------------------------------------------- recruiters
recruiters = []
for i, (name, d) in enumerate(RECRUITERS, 1):
    email = name.lower().replace(" ", ".") + "@talentco.example"
    recruiters.append((name, email, d, rdate(date(2020, 1, 1), date(2024, 6, 1)).isoformat()))
recruiters_by_dept = {}
for i, r in enumerate(recruiters, 1):
    recruiters_by_dept.setdefault(r[2], []).append(i)

# ---------------------------------------------------------------- jobs
jobs = []  # dicts, finalized later
for _ in range(64):
    d = random.choices(list(DEPT_WEIGHTS), weights=DEPT_WEIGHTS.values())[0]
    title, sen, (lo, hi) = random.choice(ROLES[d])
    posted = rdate(START, TODAY - timedelta(days=10))
    jobs.append(dict(
        title=title, dept=d, recruiter=random.choice(recruiters_by_dept[d]), seniority=sen,
        employment="Intern" if "Intern" in title else random.choices(["Full-time", "Contract"], [9, 1])[0],
        posted=posted, smin=lo * 100000, smax=hi * 100000,
        openings=random.choices([1, 2, 3], [7, 2, 1])[0],
        # some reqs are harder to fill -> lower pass rates
        difficulty={"Junior": 1.1, "Mid": 1.0, "Senior": 0.8, "Lead": 0.65}[sen] * random.uniform(0.8, 1.2),
    ))

# ---------------------------------------------------------------- candidates
candidates, used_emails = [], set()
for i in range(520):
    fn, ln = random.choice(FIRST), random.choice(LAST)
    base = f"{fn}.{ln}".lower()
    email = f"{base}{i}@mail.example"
    used_emails.add(email)
    yrs = max(0, int(random.gauss(5, 3.5)))
    edu = random.choices(["High School", "Bachelor", "Master", "PhD"], [3, 60, 33, 4])[0]
    candidates.append(dict(fn=fn, ln=ln, email=email, phone=f"9{random.randint(100000000, 999999999)}",
                           city=random.choice(CITIES), yrs=yrs, edu=edu, created=None))

# ---------------------------------------------------------------- applications / interviews / offers
applications, interviews, offers = [], [], []
seen_pairs = set()
src_names = [s[0] for s in SOURCES]
src_w = [s[3] for s in SOURCES]

for job_idx, job in enumerate(jobs, 1):
    n_apps = random.randint(8, 26) * (1 + (job["openings"] > 1))
    window_end = min(job["posted"] + timedelta(days=75), TODAY)
    for _ in range(n_apps):
        cand_idx = random.randint(1, len(candidates))
        if (cand_idx, job_idx) in seen_pairs:
            continue
        seen_pairs.add((cand_idx, job_idx))
        src_idx = random.choices(range(len(SOURCES)), weights=src_w)[0] + 1
        if job["employment"] == "Intern" and random.random() < 0.6:
            src_idx = 6  # interns mostly from campus
        quality = SOURCES[src_idx - 1][2] * job["difficulty"]
        applied = rdate(job["posted"], window_end)
        c = candidates[cand_idx - 1]
        if c["created"] is None or applied < c["created"]:
            c["created"] = applied

        app_id = len(applications) + 1
        stage, rejected_at = "Applied", None
        t = applied
        age = (TODAY - applied).days

        def advance(t, p, gap):
            """Moves the clock forward; returns (new_time, moved_to_next_stage)."""
            t = t + timedelta(days=random.randint(*gap))
            return t, t <= TODAY and random.random() < min(0.95, p * quality)

        # Applied -> Screening
        if age < 4:
            pass  # too fresh, still Applied
        elif (moved := advance(t, 0.55, (1, 6)))[1]:
            t = moved[0]
            stage = "Screening"
            t, ok = advance(t, 0.55, (2, 8))
            if ok:
                stage = "Interview"
                # interview rounds
                n_rounds = {"Junior": 2, "Mid": 3, "Senior": 3, "Lead": 4}[job["seniority"]]
                types = ["Phone Screen", "Technical", "Managerial", "HR"][:n_rounds]
                if n_rounds == 2:
                    types = ["Technical", "HR"]
                passed_all = True
                for rn, it in enumerate(types, 1):
                    t = t + timedelta(days=random.randint(2, 7))
                    if t > TODAY:
                        passed_all = None  # still in progress
                        break
                    ok = random.random() < min(0.95, 0.72 * quality)
                    if random.random() < 0.03:
                        interviews.append((app_id, rn, it, random.choice(INTERVIEWERS), t.isoformat(), None, "No Show"))
                        passed_all = False
                        break
                    score = random.choice([4, 4, 5, 5, 3]) if ok else random.choice([1, 2, 2, 3])
                    interviews.append((app_id, rn, it, random.choice(INTERVIEWERS), t.isoformat(), score,
                                       "Pass" if ok else "Fail"))
                    if not ok:
                        passed_all = False
                        break
                if passed_all is False:
                    stage, rejected_at = "Rejected", "Interview"
                elif passed_all:
                    # Offer
                    t = t + timedelta(days=random.randint(1, 5))
                    if t <= TODAY and random.random() < 0.85:
                        stage = "Offer"
                        mid = (job["smin"] + job["smax"]) / 2
                        sal = int(round(random.uniform(job["smin"] * 0.95, job["smax"] * 1.05) * 0.5 + mid * 0.5, -4))
                        decision = t + timedelta(days=random.randint(2, 10))
                        if decision > TODAY:
                            offers.append((app_id, t.isoformat(), sal, "Pending", None, None, None))
                        else:
                            p_accept = 0.78 if SOURCES[src_idx - 1][0] != "Employee Referral" else 0.9
                            if sal < mid:
                                p_accept -= 0.15
                            if random.random() < p_accept:
                                join = decision + timedelta(days=random.choice([15, 30, 30, 45, 60, 90]))
                                offers.append((app_id, t.isoformat(), sal, "Accepted", decision.isoformat(),
                                               join.isoformat(), None))
                                stage = "Hired"
                            else:
                                offers.append((app_id, t.isoformat(), sal, "Declined", decision.isoformat(), None,
                                               random.choice(DECLINE_REASONS)))
                                stage = "Withdrawn"
                    elif t <= TODAY:
                        stage, rejected_at = "Rejected", "Interview"
            elif t <= TODAY:
                stage, rejected_at = ("Withdrawn", None) if random.random() < 0.15 else ("Rejected", "Screening")
        elif (TODAY - applied).days > 10:
            stage, rejected_at = "Rejected", "Applied"

        applications.append((cand_idx, job_idx, src_idx, applied.isoformat(), stage, rejected_at))

# ---------------------------------------------------------------- finalize job status
offer_by_app = {o[0]: o for o in offers}
for job_idx, job in enumerate(jobs, 1):
    hires = [offer_by_app[a] for a, app in enumerate(applications, 1)
             if app[1] == job_idx and app[4] == "Hired"]
    apps = [app for app in applications if app[1] == job_idx]
    age = (TODAY - job["posted"]).days
    if len(hires) >= job["openings"]:
        job["status"] = "Filled"
        job["closed"] = max(date.fromisoformat(h[4]) for h in hires)
    elif hires and age > 150:
        job["status"] = "Closed"
        job["closed"] = max(date.fromisoformat(h[4]) for h in hires) + timedelta(days=random.randint(5, 20))
    elif age > 170:
        job["status"] = random.choice(["Closed", "On Hold"])
        job["closed"] = (job["posted"] + timedelta(days=random.randint(120, 160))) if job["status"] == "Closed" else None
    else:
        job["status"] = "Open"
        job["closed"] = None
    if job["closed"] and job["closed"] > TODAY:
        job["closed"] = TODAY

# ---------------------------------------------------------------- emit SQL
for c in candidates:
    if c["created"] is None:
        c["created"] = rdate(START, TODAY)

parts = [
    "-- =====================================================================",
    "-- Talent Acquisition Analytics — Seed data",
    "-- AUTO-GENERATED by scripts/generate_seed.py (random.seed(42)). Do not edit by hand.",
    f"-- {len(jobs)} jobs · {len(candidates)} candidates · {len(applications)} applications · "
    f"{len(interviews)} interviews · {len(offers)} offers",
    "-- =====================================================================",
    "USE talent_acquisition;",
    "SET FOREIGN_KEY_CHECKS = 0;",
    insert("departments", ["name", "location"], DEPARTMENTS),
    insert("recruiters", ["name", "email", "dept_id", "hired_on"], recruiters),
    insert("sources", ["name", "cost_per_hire"], [(s[0], s[1]) for s in SOURCES]),
    insert("job_postings",
           ["title", "dept_id", "recruiter_id", "seniority", "employment", "posted_date", "closed_date",
            "salary_min", "salary_max", "openings", "status"],
           [(j["title"], j["dept"], j["recruiter"], j["seniority"], j["employment"], j["posted"].isoformat(),
             j["closed"].isoformat() if j["closed"] else None, j["smin"], j["smax"], j["openings"], j["status"])
            for j in jobs]),
    insert("candidates", ["first_name", "last_name", "email", "phone", "city", "years_exp", "education", "created_at"],
           [(c["fn"], c["ln"], c["email"], c["phone"], c["city"], c["yrs"], c["edu"], c["created"].isoformat())
            for c in candidates]),
    insert("applications", ["candidate_id", "job_id", "source_id", "applied_date", "current_stage", "rejected_at_stage"],
           applications),
    insert("interviews", ["app_id", "round_no", "interview_type", "interviewer", "interview_date", "score", "outcome"],
           interviews),
    insert("offers", ["app_id", "offer_date", "salary_offered", "status", "decision_date", "join_date", "decline_reason"],
           offers),
    "SET FOREIGN_KEY_CHECKS = 1;",
]
OUT.write_text("\n\n".join(parts) + "\n")
print(f"Wrote {OUT}: {len(jobs)} jobs, {len(candidates)} candidates, {len(applications)} apps, "
      f"{len(interviews)} interviews, {len(offers)} offers "
      f"({sum(1 for a in applications if a[4] == 'Hired')} hires)")
