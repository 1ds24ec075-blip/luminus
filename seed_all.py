#!/usr/bin/env python3
"""
seed_all.py — DataGod Health Complete Dataset Seeder
One command to build a fully working demo hospital intelligence platform.

Usage:
    python seed_all.py                            # full run
    python seed_all.py --patients 200 --days 30  # custom size
    python seed_all.py --skip-kaggle --skip-synthea  # fastest (60 sec)
    python seed_all.py --city mumbai              # different city

What it builds:
    clinical.db      — 200 Indian patients, vitals, labs, diagnoses, encounters
    scheduling.db    — Doctors, slots, appointments, ambulances, beds
    operations.db    — Alerts, chat history, drug inventory, audit log
    mental_health/   — 25 synthetic therapy session transcripts + Chroma vectors
"""

import sqlite3
import json
import os
import random
import argparse
import math
from datetime import datetime, timedelta
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

CITIES = {
    "bengaluru": {"lat": 12.9716, "lng": 77.5946, "state": "Karnataka"},
    "mumbai":    {"lat": 19.0760, "lng": 72.8777, "state": "Maharashtra"},
    "delhi":     {"lat": 28.6139, "lng": 77.2090, "state": "Delhi"},
    "hyderabad": {"lat": 17.3850, "lng": 78.4867, "state": "Telangana"},
    "chennai":   {"lat": 13.0827, "lng": 80.2707, "state": "Tamil Nadu"},
}

DISEASES = [
    ("E11",   "Type 2 Diabetes Mellitus",     0.18),
    ("I10",   "Hypertension",                 0.15),
    ("J18.9", "Pneumonia",                    0.10),
    ("A15",   "Pulmonary Tuberculosis",       0.08),
    ("I21",   "Acute Myocardial Infarction",  0.07),
    ("J45",   "Asthma",                       0.07),
    ("A90",   "Dengue Fever",                 0.06),
    ("K74",   "Hepatic Cirrhosis",            0.05),
    ("N18",   "Chronic Kidney Disease",       0.05),
    ("F32",   "Depressive Episode",           0.05),
    ("M54",   "Back Pain",                    0.04),
    ("A09",   "Gastroenteritis",              0.04),
    ("I63",   "Cerebral Infarction",          0.03),
    ("C34",   "Malignant Neoplasm Bronchus",  0.02),
    ("O80",   "Normal Delivery",              0.01),
]

SPECIALTIES = [
    "Cardiology", "General Medicine", "Pulmonology", "Neurology",
    "Orthopedics", "Gastroenterology", "Nephrology", "Psychiatry",
    "Endocrinology", "Emergency Medicine"
]

INDIAN_FIRST_NAMES = [
    "Ravi","Priya","Suresh","Anitha","Rajesh","Deepa","Vikram","Lakshmi",
    "Arun","Meena","Kiran","Sunita","Mohan","Geeta","Prakash","Usha",
    "Santosh","Kavitha","Ramesh","Saritha","Harish","Pooja","Dinesh",
    "Rekha","Vinod","Leela","Mahesh","Shobha","Ganesh","Padma",
    "Naresh","Savitha","Sunil","Asha","Ajay","Nirmala","Srinivas","Radha"
]

INDIAN_LAST_NAMES = [
    "Sharma","Reddy","Nair","Patel","Singh","Kumar","Rao","Iyer",
    "Pillai","Krishnan","Verma","Gupta","Joshi","Shah","Gowda",
    "Naidu","Hegde","Shetty","Menon","Bhat"
]

MENTAL_HEALTH_THEMES = [
    ["work stress","anxiety","sleep issues"],
    ["family conflict","depression","isolation"],
    ["grief","loss","coping"],
    ["relationship problems","self-esteem","communication"],
    ["panic attacks","phobia","avoidance"],
    ["trauma","ptsd","hypervigilance"],
    ["chronic illness adjustment","pain","hopelessness"],
]

DRUGS = [
    ("Metformin 500mg",    "Diabetes",      500,  50),
    ("Amlodipine 5mg",     "Hypertension",  300,  30),
    ("Atorvastatin 10mg",  "Dyslipidemia",  400,  40),
    ("Aspirin 75mg",       "Antiplatelet",  600,  60),
    ("Pantoprazole 40mg",  "GERD",          350,  35),
    ("Azithromycin 500mg", "Infection",     200,  20),
    ("Paracetamol 500mg",  "Pain/Fever",   1000, 100),
    ("Salbutamol Inhaler", "Asthma",        150,  15),
    ("Ramipril 5mg",       "Hypertension",  250,  25),
    ("Insulin Glargine",   "Diabetes",       80,   8),
    ("Losartan 50mg",      "Hypertension",  200,  20),
    ("Ciprofloxacin 500mg","Infection",     180,  18),
]

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def rng_name():
    return f"{random.choice(INDIAN_FIRST_NAMES)} {random.choice(INDIAN_LAST_NAMES)}"

def rng_phone():
    return f"+91{random.randint(7000000000, 9999999999)}"

def weighted_disease():
    diseases, weights = zip(*[(d[:2], d[2]) for d in DISEASES])
    return random.choices(diseases, weights=weights, k=1)[0]

def rng_vitals(age, disease_code):
    hr    = random.gauss(78, 12)
    bps   = random.gauss(120, 18)
    bpd   = random.gauss(78, 10)
    spo2  = random.gauss(97.5, 1.2)
    temp  = random.gauss(37.0, 0.4)
    rr    = random.gauss(16, 3)

    if disease_code == "I10":
        bps = random.gauss(150, 20); bpd = random.gauss(95, 12)
    elif disease_code == "I21":
        hr = random.gauss(95, 15); spo2 = random.gauss(94, 2); bps = random.gauss(100, 25)
    elif disease_code in ("J18.9", "A15"):
        temp = random.gauss(38.5, 0.6); spo2 = random.gauss(93, 2); rr = random.gauss(22, 4)
    elif disease_code == "J45":
        spo2 = random.gauss(95, 2); rr = random.gauss(20, 4)

    if age > 65:
        bps += 15; hr += 5

    return {
        "heart_rate":       round(max(40,  min(180, hr))),
        "bp_systolic":      round(max(70,  min(220, bps))),
        "bp_diastolic":     round(max(40,  min(130, bpd))),
        "spo2":             round(max(80,  min(100, spo2)), 1),
        "temperature":      round(max(35.0,min(41.5, temp)), 1),
        "respiratory_rate": round(max(8,   min(40,  rr))),
    }

def rng_haversine_point(clat, clng, radius_km=15):
    r = radius_km / 111.32
    u, v = random.uniform(0,1), random.uniform(0,1)
    w = r * math.sqrt(u)
    t = 2 * math.pi * v
    x = w * math.cos(t) / math.cos(math.radians(clng))
    y = w * math.sin(t)
    return clat + y, clng + x

def readmission_risk(age, num_adm, has_dm, has_ckd):
    s = 0.0
    if age > 65: s += 0.2
    if num_adm > 2: s += 0.25
    if has_dm: s += 0.15
    if has_ckd: s += 0.2
    s += random.uniform(0, 0.2)
    return round(min(1.0, s), 3)

# ─────────────────────────────────────────────────────────────────────────────
# DB INIT
# ─────────────────────────────────────────────────────────────────────────────

def init_clinical_db(path):
    conn = sqlite3.connect(path)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY, name TEXT, age INTEGER, gender TEXT,
        phone TEXT, city TEXT, state TEXT, language TEXT,
        blood_group TEXT, emergency_contact TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS encounters (
        id TEXT PRIMARY KEY, patient_id TEXT,
        encounter_date TIMESTAMP, encounter_type TEXT,
        primary_diagnosis TEXT, icd10_code TEXT, cpt_code TEXT,
        discharge_date TIMESTAMP, length_of_stay_days INTEGER,
        readmission_risk_score REAL, attending_doctor TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    CREATE TABLE IF NOT EXISTS vitals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT, encounter_id TEXT,
        heart_rate REAL, bp_systolic REAL, bp_diastolic REAL,
        spo2 REAL, temperature REAL, respiratory_rate REAL,
        recorded_at TIMESTAMP, is_critical INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS lab_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT, encounter_id TEXT,
        test_name TEXT, value REAL, unit TEXT,
        reference_low REAL, reference_high REAL,
        is_abnormal INTEGER DEFAULT 0, recorded_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT, encounter_id TEXT,
        drug_name TEXT, dosage TEXT, frequency TEXT,
        icd10_indication TEXT, prescribed_at TIMESTAMP,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT, icd10_code TEXT,
        condition_name TEXT, onset_date TIMESTAMP, is_active INTEGER DEFAULT 1
    );
    """)
    conn.commit()
    return conn

def init_scheduling_db(path):
    conn = sqlite3.connect(path)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS doctors (
        id TEXT PRIMARY KEY, name TEXT, specialty TEXT,
        qualification TEXT, is_on_shift INTEGER DEFAULT 1,
        shift_end TIMESTAMP, languages TEXT, rating REAL
    );
    CREATE TABLE IF NOT EXISTS doctor_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id TEXT, slot_time TIMESTAMP, is_available INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY, patient_id TEXT, doctor_id TEXT,
        slot_time TIMESTAMP, specialty TEXT,
        status TEXT DEFAULT 'confirmed',
        esi_priority TEXT, notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ambulances (
        id TEXT PRIMARY KEY, unit_number TEXT,
        status TEXT DEFAULT 'available',
        lat REAL, lng REAL, crew_name TEXT,
        assigned_patient TEXT, last_updated TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS beds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ward TEXT, bed_number TEXT,
        is_occupied INTEGER DEFAULT 0,
        patient_id TEXT, admitted_at TIMESTAMP
    );
    """)
    conn.commit()
    return conn

def init_operations_db(path):
    conn = sqlite3.connect(path)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT, alert_type TEXT,
        message TEXT, severity TEXT DEFAULT 'medium',
        is_resolved INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS drug_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drug_name TEXT, indication TEXT,
        stock_count INTEGER, reorder_threshold INTEGER,
        unit_price REAL, last_restocked TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT, role TEXT, content TEXT,
        sql_generated TEXT, chart_type TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pinned_charts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, sql_query TEXT, chart_type TEXT,
        share_token TEXT UNIQUE, created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS shares (
        token TEXT PRIMARY KEY,
        pin_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pin_id) REFERENCES pinned_charts(id)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT, entity_type TEXT, entity_id TEXT,
        performed_by TEXT, details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()
    return conn

# ─────────────────────────────────────────────────────────────────────────────
# SEED FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def seed_patients(conn, n, city_info, days):
    print(f"  Seeding {n} patients...")
    pids = []
    langs = ["kannada","hindi","telugu","tamil","english"]
    blood_groups = ["A+","B+","O+","AB+","A-","B-","O-","AB-"]
    bg_weights = [28,29,38,3,1,0.5,1,0.5]
    cpt_codes = ["99213","99214","99215","99232","99233"]
    enc_types = ["inpatient","outpatient","emergency"]
    med_map = {
        "E11": ("Metformin 500mg","BD"),   "I10": ("Amlodipine 5mg","OD"),
        "I21": ("Aspirin 75mg","OD"),      "J45": ("Salbutamol Inhaler","SOS"),
        "N18": ("Ramipril 5mg","OD"),      "J18.9": ("Azithromycin 500mg","OD"),
    }

    for i in range(n):
        pid = f"PT{i+1:04d}"
        age = max(1, min(95, int(random.gauss(48, 18))))
        gender = random.choice(["Male","Female","Female"])
        disease_code, disease_name = weighted_disease()
        bg = random.choices(blood_groups, weights=bg_weights, k=1)[0]

        conn.execute("""
            INSERT OR IGNORE INTO patients
            (id,name,age,gender,phone,city,state,language,blood_group,emergency_contact)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (pid, rng_name(), age, gender, rng_phone(),
              city_info.get("city","bengaluru"), city_info.get("state","Karnataka"),
              random.choice(langs), bg, rng_phone()))

        conn.execute("""
            INSERT INTO conditions (patient_id,icd10_code,condition_name,onset_date)
            VALUES (?,?,?,?)
        """, (pid, disease_code, disease_name,
              (datetime.now()-timedelta(days=random.randint(30,730))).isoformat()))

        num_enc = random.choices([1,2,3,4], weights=[40,30,20,10])[0]
        has_ckd = disease_code == "N18"
        has_dm  = disease_code == "E11"

        for e in range(num_enc):
            eid = f"ENC{pid}{e+1}"
            enc_date = datetime.now() - timedelta(days=random.randint(1, days))
            stay_days = random.choices([1,2,3,5,7,14], weights=[20,25,25,15,10,5])[0]
            discharge = enc_date + timedelta(days=stay_days)

            conn.execute("""
                INSERT INTO encounters
                (id,patient_id,encounter_date,encounter_type,primary_diagnosis,
                 icd10_code,cpt_code,discharge_date,length_of_stay_days,
                 readmission_risk_score,attending_doctor)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """, (eid, pid, enc_date.isoformat(),
                  random.choice(enc_types), disease_name, disease_code,
                  random.choice(cpt_codes), discharge.isoformat(), stay_days,
                  readmission_risk(age, num_enc, has_dm, has_ckd),
                  f"Dr. {rng_name()}"))

            for _ in range(random.randint(3, 12)):
                v = rng_vitals(age, disease_code)
                is_crit = int(v["spo2"]<92 or v["heart_rate"]>130 or v["heart_rate"]<45
                              or v["bp_systolic"]>180 or v["bp_systolic"]<80)
                vtime = enc_date + timedelta(hours=random.randint(0, stay_days*24))
                conn.execute("""
                    INSERT INTO vitals
                    (patient_id,encounter_id,heart_rate,bp_systolic,bp_diastolic,
                     spo2,temperature,respiratory_rate,recorded_at,is_critical)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                """, (pid, eid, v["heart_rate"], v["bp_systolic"], v["bp_diastolic"],
                      v["spo2"], v["temperature"], v["respiratory_rate"],
                      vtime.isoformat(), is_crit))

            if has_dm:
                conn.execute("""
                    INSERT INTO lab_results
                    (patient_id,encounter_id,test_name,value,unit,
                     reference_low,reference_high,is_abnormal,recorded_at)
                    VALUES (?,?,'HbA1c',?,'%',4.0,5.7,?,?)
                """, (pid, eid, round(random.uniform(5.5,12.0),1), 1, enc_date.isoformat()))

            if has_ckd:
                cr = round(random.uniform(0.6, 8.0), 2)
                conn.execute("""
                    INSERT INTO lab_results
                    (patient_id,encounter_id,test_name,value,unit,
                     reference_low,reference_high,is_abnormal,recorded_at)
                    VALUES (?,?,'Creatinine',?,'mg/dL',0.6,1.2,?,?)
                """, (pid, eid, cr, int(cr>1.2), enc_date.isoformat()))

            if disease_code in med_map:
                drug, freq = med_map[disease_code]
                conn.execute("""
                    INSERT INTO medications
                    (patient_id,encounter_id,drug_name,dosage,frequency,
                     icd10_indication,prescribed_at)
                    VALUES (?,?,?,'1 tablet',?,?,?)
                """, (pid, eid, drug, freq, disease_code, enc_date.isoformat()))

        pids.append(pid)

    conn.commit()
    print(f"  ✓ {n} patients seeded")
    return pids


def seed_doctors(sc, n=40):
    print(f"  Seeding {n} doctors + slots...")
    doc_ids = []
    quals = ["MBBS, MD","MBBS, MS","MBBS, DNB","MBBS, DM"]
    now = datetime.now()

    for i in range(n):
        did = f"DOC{i+1:03d}"
        specialty = SPECIALTIES[i % len(SPECIALTIES)]
        shift_end = now + timedelta(hours=random.choice([4,6,8,12]))
        sc.execute("""
            INSERT OR IGNORE INTO doctors
            (id,name,specialty,qualification,is_on_shift,shift_end,languages,rating)
            VALUES (?,?,?,?,?,?,?,?)
        """, (did, f"Dr. {rng_name()}", specialty, random.choice(quals),
              random.choice([1,1,1,0]), shift_end.isoformat(),
              "english,kannada", round(random.uniform(4.0,5.0),1)))

        for day in range(7):
            for hour in [9,10,11,14,15,16,17]:
                slot_dt = now.replace(hour=hour, minute=0, second=0) + timedelta(days=day)
                sc.execute("""
                    INSERT INTO doctor_slots (doctor_id,slot_time,is_available)
                    VALUES (?,?,?)
                """, (did, slot_dt.isoformat(), random.choice([1,1,1,0])))

        doc_ids.append(did)

    sc.commit()
    print(f"  ✓ {n} doctors seeded")
    return doc_ids


def seed_appointments(sc, pids, dids, n=150):
    print(f"  Seeding {n} appointments...")
    esi_choices = ["P1","P2","P3","P4","P5"]
    esi_weights = [5,10,30,35,20]
    statuses    = ["confirmed","completed","cancelled","no_show"]
    sw          = [40,45,10,5]

    for i in range(n):
        aid = f"APT{i+1:04d}"
        slot = datetime.now() + timedelta(days=random.randint(-10,14), hours=random.randint(8,17))
        sc.execute("""
            INSERT OR IGNORE INTO appointments
            (id,patient_id,doctor_id,slot_time,specialty,status,esi_priority)
            VALUES (?,?,?,?,?,?,?)
        """, (aid, random.choice(pids), random.choice(dids), slot.isoformat(),
              random.choice(SPECIALTIES),
              random.choices(statuses, weights=sw)[0],
              random.choices(esi_choices, weights=esi_weights)[0]))

    sc.commit()
    print(f"  ✓ {n} appointments seeded")


def seed_ambulances(sc, city_info, n=10):
    print(f"  Seeding {n} ambulances...")
    statuses  = ["available","en_route","at_hospital"]
    sw        = [60,25,15]

    for i in range(n):
        uid = f"AMB{i+1:02d}"
        lat, lng = rng_haversine_point(city_info["lat"], city_info["lng"], 12)
        status   = random.choices(statuses, weights=sw)[0]
        sc.execute("""
            INSERT OR IGNORE INTO ambulances
            (id,unit_number,status,lat,lng,crew_name,last_updated)
            VALUES (?,?,?,?,?,?,?)
        """, (uid, f"KA-{30+i:02d}-AMB-{i+1:03d}", status,
              round(lat,6), round(lng,6), rng_name(),
              datetime.now().isoformat()))

    sc.commit()
    print(f"  ✓ {n} ambulances seeded")


def seed_beds(sc, pids, n_per_ward=20):
    print("  Seeding beds...")
    wards = ["ICU","General Ward","Emergency","Cardiac ICU","Neurology","Orthopedics","Maternity"]
    for ward in wards:
        for b in range(n_per_ward):
            bed_no  = f"{ward[:3].upper()}-{b+1:02d}"
            is_occ  = random.random() < 0.72
            patient = random.choice(pids) if is_occ else None
            admitted= (datetime.now()-timedelta(days=random.randint(1,10))).isoformat() if is_occ else None
            sc.execute("""
                INSERT INTO beds (ward,bed_number,is_occupied,patient_id,admitted_at)
                VALUES (?,?,?,?,?)
            """, (ward, bed_no, int(is_occ), patient, admitted))

    sc.commit()
    print(f"  ✓ {len(wards)*n_per_ward} beds seeded across {len(wards)} wards")


def seed_alerts(ops, pids, n=40):
    print(f"  Seeding {n} alerts...")
    templates = [
        ("CRITICAL_VITALS","critical","SpO2 dropped below 90% — immediate attention required"),
        ("HIGH_BP","high","BP reading 185/110 — hypertensive urgency"),
        ("LOW_GLUCOSE","high","Blood glucose 54 mg/dL — hypoglycemia risk"),
        ("DRUG_INTERACTION","medium","Potential interaction: Warfarin + Aspirin"),
        ("READMISSION_RISK","medium","Readmission risk score > 0.80"),
        ("LOW_STOCK","low","Metformin 500mg below reorder threshold"),
        ("MENTAL_HEALTH","high","Crisis flag raised by Mental Health Agent"),
        ("MISSED_FOLLOWUP","medium","Patient missed scheduled follow-up"),
    ]
    for _ in range(n):
        atype, sev, msg = random.choice(templates)
        pid     = random.choice(pids)
        created = datetime.now() - timedelta(hours=random.randint(0,72))
        ops.execute("""
            INSERT INTO alerts (patient_id,alert_type,message,severity,is_resolved,created_at)
            VALUES (?,?,?,?,?,?)
        """, (pid, atype, f"{msg} [Patient: {pid}]",
              sev, random.choice([0,0,1]), created.isoformat()))

    ops.commit()
    print(f"  ✓ {n} alerts seeded")


def seed_drug_inventory(ops):
    print("  Seeding drug inventory...")
    for drug, ind, stock, reorder in DRUGS:
        ops.execute("""
            INSERT INTO drug_inventory
            (drug_name,indication,stock_count,reorder_threshold,unit_price,last_restocked)
            VALUES (?,?,?,?,?,?)
        """, (drug, ind, stock, reorder,
              round(random.uniform(5,500),2),
              (datetime.now()-timedelta(days=random.randint(1,30))).isoformat()))
    ops.commit()
    print(f"  ✓ {len(DRUGS)} drugs seeded")


def seed_pinned_charts(ops):
    print("  Seeding pinned charts...")
    import hashlib
    charts = [
        ("ICU Occupancy",
         "SELECT ward,COUNT(*) as total,SUM(is_occupied) as occupied FROM beds WHERE ward='ICU' GROUP BY ward",
         "bar"),
        ("Patients by Disease",
         "SELECT icd10_code,COUNT(*) as count FROM conditions GROUP BY icd10_code ORDER BY count DESC LIMIT 10",
         "bar"),
        ("Critical Vitals 24h",
         "SELECT p.name,v.spo2,v.heart_rate,v.recorded_at FROM vitals v JOIN patients p ON p.id=v.patient_id WHERE v.is_critical=1 ORDER BY v.recorded_at DESC LIMIT 20",
         "table"),
        ("Admissions by Type",
         "SELECT encounter_type,COUNT(*) as count FROM encounters GROUP BY encounter_type",
         "pie"),
        ("Readmission Risk Top 20",
         "SELECT p.name,e.readmission_risk_score,e.primary_diagnosis FROM encounters e JOIN patients p ON p.id=e.patient_id WHERE e.readmission_risk_score > 0.7 ORDER BY e.readmission_risk_score DESC LIMIT 20",
         "table"),
    ]
    for title, sql, chart_type in charts:
        token = hashlib.md5(title.encode()).hexdigest()[:8]
        ops.execute("""
            INSERT INTO pinned_charts (title,sql_query,chart_type,share_token,created_by)
            VALUES (?,?,?,?,'system')
        """, (title, sql, chart_type, token))
    ops.commit()
    print(f"  ✓ {len(charts)} pinned charts seeded")


def seed_audit_log(ops, n=120):
    actions = [
        ("QUERY_EXECUTED","sql","NL query executed"),
        ("APPOINTMENT_BOOKED","appointment","Appointment confirmed"),
        ("AMBULANCE_DISPATCHED","ambulance","Unit dispatched"),
        ("ALERT_TRIGGERED","alert","Alert fired"),
        ("CHART_PINNED","dashboard","Insight pinned"),
        ("PATIENT_ADMITTED","encounter","New encounter opened"),
        ("DISCHARGE_PROCESSED","encounter","Patient discharged"),
    ]
    for _ in range(n):
        action, entity, detail = random.choice(actions)
        ops.execute("""
            INSERT INTO audit_log (action,entity_type,entity_id,performed_by,details,created_at)
            VALUES (?,?,?,?,?,?)
        """, (action, entity, f"ID{random.randint(1,999):03d}",
              f"staff_{random.randint(1,20)}", detail,
              (datetime.now()-timedelta(minutes=random.randint(0,10080))).isoformat()))
    ops.commit()


def seed_mental_health_sessions(output_dir, pids, n=25):
    print(f"  Seeding {n} mental health sessions...")
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    templates = [
        "Patient {name} presented with persistent {t1} and {t2}. Reported difficulty sleeping for {w} weeks. "
        "Mood score self-reported as {mood}/10. Expressed feelings of {feel}. "
        "Session focused on cognitive restructuring. Patient responded well to breathing exercises. "
        "Risk assessment: {risk}. Plan: weekly sessions, CBT workbook assigned.",

        "Follow-up with {name}. Reports {improve} since last session. {t1} remains primary concern. "
        "Discussed coping mechanisms around {t2}. Mentioned {stress} as significant trigger. "
        "Sleep has {sleep}. Mood: {mood}/10. No active suicidal ideation. Continuing current plan.",

        "Initial assessment for {name}. Chief complaint: {t1}. History reveals {t2} contributing to current state. "
        "PHQ-9: {phq9}. GAD-7: {gad7}. Diagnosis: {dx}. "
        "Treatment plan initiated: therapy + psychoeducation. Follow-up in 2 weeks.",
    ]

    feelings  = ["hopelessness","anxiety","numbness","overwhelm","disconnection"]
    improves  = ["slight improvement","no significant change","some worsening","marked improvement"]
    stressors = ["work deadlines","family conflict","financial stress","health concerns"]
    sleeps    = ["improved","worsened","remained the same"]
    dxs       = [
        "Moderate Depressive Episode (F32.1)",
        "Generalized Anxiety Disorder (F41.1)",
        "Adjustment Disorder (F43.2)",
        "PTSD (F43.1)"
    ]

    sessions = []
    for i in range(n):
        pid    = random.choice(pids[:50])
        themes = random.choice(MENTAL_HEALTH_THEMES)
        mood   = random.randint(2, 8)
        risk   = random.choices(["low","medium","high","crisis"], weights=[50,30,15,5])[0]
        date   = datetime.now() - timedelta(days=random.randint(0, 90))

        tmpl = random.choice(templates)
        text = tmpl.format(
            name=rng_name(), t1=themes[0], t2=themes[1] if len(themes)>1 else themes[0],
            w=random.randint(2,16), mood=mood, feel=random.choice(feelings),
            risk=risk, improve=random.choice(improves),
            stress=random.choice(stressors), sleep=random.choice(sleeps),
            phq9=random.randint(5,25), gad7=random.randint(4,21),
            dx=random.choice(dxs)
        )

        sessions.append({
            "session_id":     f"MHS{i+1:04d}",
            "patient_id":     pid,
            "date":           date.isoformat(),
            "session_text":   text,
            "mood_score":     mood,
            "risk_level":     risk,
            "themes":         themes,
            "anxiety_score":  round(random.uniform(0.1, 0.95), 2),
            "session_number": random.randint(1, 12)
        })

    out_path = os.path.join(output_dir, "sessions.json")
    with open(out_path, "w") as f:
        json.dump(sessions, f, indent=2)
    print(f"  ✓ {n} sessions → {out_path}")

    try:
        import chromadb
        chroma_path = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
        client = chromadb.PersistentClient(path=chroma_path)
        col = client.get_or_create_collection("mental_health_sessions")
        col.add(
            documents=[s["session_text"] for s in sessions],
            metadatas=[{
                "patient_id": s["patient_id"],
                "mood_score": str(s["mood_score"]),
                "risk_level": s["risk_level"],
                "date":       s["date"]
            } for s in sessions],
            ids=[s["session_id"] for s in sessions]
        )
        print(f"  ✓ {n} sessions indexed in Chroma")
    except ImportError:
        print("  ⚠ chromadb not installed — run: pip install chromadb --break-system-packages")
    except Exception as e:
        print(f"  ⚠ Chroma error: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="MediCore AI — Complete Data Seeder")
    parser.add_argument("--patients",     type=int, default=200)
    parser.add_argument("--days",         type=int, default=30)
    parser.add_argument("--city",         type=str, default="bengaluru",
                        choices=list(CITIES.keys()))
    parser.add_argument("--skip-kaggle",  action="store_true")
    parser.add_argument("--skip-synthea", action="store_true")
    args = parser.parse_args()

    city_info = {**CITIES[args.city], "city": args.city}

    Path("./data/mental_health").mkdir(parents=True, exist_ok=True)

    clinical_path   = os.getenv("CLINICAL_DB_PATH",   "./data/clinical.db")
    scheduling_path = os.getenv("SCHEDULING_DB_PATH", "./data/scheduling.db")
    operations_path = os.getenv("OPERATIONS_DB_PATH", "./data/operations.db")
    mh_dir          = os.path.dirname(
        os.getenv("MENTAL_HEALTH_SESSIONS_PATH", "./data/mental_health/sessions.json"))

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  DataGod Health — Dataset Seeder")
    print(f"  City: {args.city.title()} | Patients: {args.patients} | Days: {args.days}")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    print("📋 Building clinical.db...")
    clin = init_clinical_db(clinical_path)
    pids = seed_patients(clin, args.patients, city_info, args.days)
    clin.close()

    print("\n📅 Building scheduling.db...")
    sched = init_scheduling_db(scheduling_path)
    dids  = seed_doctors(sched, n=40)
    seed_appointments(sched, pids, dids, n=150)
    seed_ambulances(sched, city_info, n=10)
    seed_beds(sched, pids, n_per_ward=20)
    sched.close()

    print("\n⚙ Building operations.db...")
    ops = init_operations_db(operations_path)
    seed_alerts(ops, pids, n=40)
    seed_drug_inventory(ops)
    seed_pinned_charts(ops)
    seed_audit_log(ops, n=120)
    ops.close()

    print("\n🧠 Building mental health sessions...")
    seed_mental_health_sessions(mh_dir, pids, n=25)

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  ✅  All databases ready!")
    print(f"  clinical.db     → {args.patients} patients, vitals, labs, meds, encounters")
    print("  scheduling.db   → 40 doctors, 150 appts, 10 ambulances, 140 beds")
    print("  operations.db   → 40 alerts, 12 drugs, pinned charts, audit log")
    print("  mental_health/  → 25 therapy sessions + Chroma vectors")
    print("\n  Next steps:")
    print("  1.  docker run -d -p 6379:6379 redis:alpine")
    print("  2.  uvicorn main:app --reload --port 8000")
    print("  3.  cd frontend && npm run dev")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")


if __name__ == "__main__":
    main()
