"""
Luminus — Unified Database Layer
Single luminus.db with all tables + demo seed data.
"""

import sqlite3
import json
from pathlib import Path
from datetime import datetime, timedelta

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "luminus.db"


def get_db():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def _ensure_column(
    conn: sqlite3.Connection, table_name: str, column_name: str, column_sql: str
) -> None:
    columns = _table_columns(conn, table_name)
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}")


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply additive schema migrations for backward compatibility."""
    _ensure_column(conn, "reports", "ai_summary_patient", "TEXT")
    _ensure_column(conn, "reports", "ai_summary_admin", "TEXT")
    _ensure_column(
        conn,
        "reports",
        "risk_level",
        "TEXT DEFAULT 'routine' CHECK(risk_level IN ('routine','urgent','critical'))",
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS report_escalations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL UNIQUE,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER,
            risk_level TEXT DEFAULT 'urgent' CHECK(risk_level IN ('routine','urgent','critical')),
            admin_summary TEXT,
            patient_safe_summary TEXT,
            triage_json TEXT DEFAULT '{}',
            status TEXT DEFAULT 'pending_admin' CHECK(status IN ('pending_admin','released_to_doctor','closed')),
            reviewed_by_admin_id INTEGER,
            released_to_doctor_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES users(id),
            FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id)
        )
    """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ambulance_dispatches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ambulance_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            report_id INTEGER,
            requested_by_role TEXT,
            requested_by_id INTEGER,
            request_lat REAL NOT NULL,
            request_lng REAL NOT NULL,
            distance_km REAL,
            eta_minutes INTEGER,
            severity TEXT DEFAULT 'urgent' CHECK(severity IN ('routine','urgent','critical')),
            status TEXT DEFAULT 'dispatched' CHECK(status IN ('dispatched','arrived','cancelled','completed')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ambulance_id) REFERENCES ambulances(id),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (report_id) REFERENCES reports(id)
        )
    """
    )

    # Backfill patient-safe/admin-safe summaries for existing rows.
    conn.execute(
        """
        UPDATE reports
        SET ai_summary_patient = COALESCE(ai_summary_patient, ai_summary),
            ai_summary_admin = COALESCE(ai_summary_admin, ai_summary),
            risk_level = COALESCE(risk_level, 'routine')
        """
    )


def init_db():
    """Create all tables and seed demo data."""
    conn = get_db()
    cur = conn.cursor()

    # ── Users ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('patient','doctor','admin','lab','nurse')),
            specialty TEXT,
            shift_start TEXT,
            shift_end TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

    # ── Patients ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            dob TEXT,
            blood_group TEXT,
            assigned_doctor_id INTEGER,
            emergency_contact TEXT,
            conditions TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (assigned_doctor_id) REFERENCES users(id)
        )
    """
    )

    # ── Reports ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            uploaded_by INTEGER NOT NULL,
            file_path TEXT,
            file_type TEXT,
            ocr_text TEXT,
            anomalies_json TEXT DEFAULT '[]',
            ai_summary TEXT,
            ai_summary_patient TEXT,
            ai_summary_admin TEXT,
            risk_level TEXT DEFAULT 'routine' CHECK(risk_level IN ('routine','urgent','critical')),
            source_hospital TEXT,
            is_old_report INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (uploaded_by) REFERENCES users(id)
        )
    """
    )

    # ── Report Consent ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS report_consent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            share_hospital_details INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES users(id)
        )
    """
    )

    # ── Appointments ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            scheduled_at TIMESTAMP NOT NULL,
            esi_priority INTEGER DEFAULT 5,
            status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','in_progress')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES users(id)
        )
    """
    )

    # ── Alerts ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            report_id INTEGER,
            alert_type TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT DEFAULT 'info' CHECK(severity IN ('critical','warning','info')),
            target_role TEXT,
            resolved INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (report_id) REFERENCES reports(id)
        )
    """
    )

    # ── Ambulances ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS ambulances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unit_name TEXT NOT NULL,
            vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('basic','advanced','cardiac')),
            status TEXT DEFAULT 'available' CHECK(status IN ('available','dispatched','returning','maintenance')),
            current_lat REAL DEFAULT 12.9716,
            current_lng REAL DEFAULT 77.5946,
            assigned_patient_id INTEGER,
            crew_info TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_patient_id) REFERENCES patients(id)
        )
    """
    )

    # ── Nurse Notes ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS nurse_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            nurse_id INTEGER NOT NULL,
            vitals_json TEXT,
            note_text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (nurse_id) REFERENCES users(id)
        )
    """
    )

    # ── Visit Sessions (Doctor-Patient Consultations) ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS visit_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            appointment_id INTEGER,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP,
            voice_to_text_enabled INTEGER DEFAULT 0,
            is_confirmed INTEGER DEFAULT 0,
            urgency_level TEXT DEFAULT 'routine' CHECK(urgency_level IN ('critical','urgent','routine')),
            estimated_wait INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES users(id),
            FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        )
    """
    )

    # ── Visit Transcripts (Voice-to-Text Conversations) ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS visit_transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visit_session_id INTEGER NOT NULL,
            speaker_role TEXT NOT NULL CHECK(speaker_role IN ('doctor','patient','system')),
            transcript_text TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (visit_session_id) REFERENCES visit_sessions(id)
        )
    """
    )

    # ── Prescriptions ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS prescriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visit_session_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            medications_json TEXT,
            dosage_instructions TEXT,
            image_path TEXT,
            notes TEXT,
            is_approved INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (visit_session_id) REFERENCES visit_sessions(id),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES users(id)
        )
    """
    )

    # ── Prescription Validations (AI Cross-Check Results) ──
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS prescription_validations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prescription_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            validation_report_json TEXT,
            has_discrepancies INTEGER DEFAULT 0,
            severity TEXT DEFAULT 'info' CHECK(severity IN ('critical','warning','info')),
            reviewed_by_doctor INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (prescription_id) REFERENCES prescriptions(id),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES users(id)
        )
    """
    )

    # Additive migrations for environments with older DB files.
    _apply_migrations(conn)

    conn.commit()

    # ── Seed demo data only if users table is empty ──
    count = cur.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        _seed_demo_data(conn)

    conn.close()


def _seed_demo_data(conn):
    """Insert realistic demo data for hackathon judges."""
    cur = conn.cursor()

    # bcrypt hash for "demo123" — pre-computed to avoid bcrypt dependency on seed
    # In production, auth.py hashes properly. This is just for demo seed.
    from auth import hash_password

    demo_hash = hash_password("demo123")

    # ── Users ──
    users = [
        (
            "Arjun Mehta",
            "patient@luminus.health",
            "9663731604",
            demo_hash,
            "patient",
            None,
            None,
            None,
        ),
        (
            "Priya Raj",
            "patient2@luminus.health",
            "9876543210",
            demo_hash,
            "patient",
            None,
            None,
            None,
        ),
        (
            "Dr. Priya Sharma",
            "doctor@luminus.health",
            "9988776655",
            demo_hash,
            "doctor",
            "Cardiology",
            "08:00",
            "16:00",
        ),
        (
            "Dr. Vikram Patel",
            "doctor2@luminus.health",
            "9871234560",
            demo_hash,
            "doctor",
            "General Medicine",
            "09:00",
            "17:00",
        ),
        (
            "Ravi Kapoor",
            "admin@luminus.health",
            "9123456780",
            demo_hash,
            "admin",
            None,
            None,
            None,
        ),
        (
            "Sneha Iyer",
            "lab@luminus.health",
            "9876501234",
            demo_hash,
            "lab",
            None,
            None,
            None,
        ),
        (
            "Anjali Das",
            "nurse@luminus.health",
            "9012345678",
            demo_hash,
            "nurse",
            None,
            "06:00",
            "14:00",
        ),
    ]

    for u in users:
        cur.execute(
            """
            INSERT INTO users (name, email, phone, password_hash, role, specialty, shift_start, shift_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            u,
        )

    # ── Patients ──
    patients = [
        (
            1,
            "1992-03-15",
            "B+",
            3,
            "9876000001",
            json.dumps(["diabetes", "hypertension"]),
        ),
        (
            2,
            "1988-07-22",
            "A+",
            4,
            "9876000002",
            json.dumps(["cardiac_history", "asthma"]),
        ),
    ]
    for p in patients:
        cur.execute(
            """
            INSERT INTO patients (user_id, dob, blood_group, assigned_doctor_id, emergency_contact, conditions)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            p,
        )

    # ── Reports (with anomalies) ──
    now = datetime.now()
    reports = [
        # Patient 1: Old report with anomaly — diabetic but no insulin in prescription
        (
            1,
            1,
            None,
            "image",
            "Patient: Arjun Mehta\nDiagnosis: Type 2 Diabetes Mellitus\nHbA1c: 8.2% (High)\nFasting Glucose: 156 mg/dL\nPrescription:\n- Atorvastatin 20mg\n- Lisinopril 10mg\n- Aspirin 75mg\nFollow-up: 3 months",
            json.dumps(
                [
                    {
                        "type": "prescription_mismatch",
                        "severity": "critical",
                        "message": "Diabetic diagnosis (HbA1c 8.2%) but NO diabetes medication (metformin/insulin) in prescription",
                    },
                    {
                        "type": "abnormal_value",
                        "severity": "warning",
                        "message": "HbA1c 8.2% is above normal range (< 5.7%)",
                    },
                    {
                        "type": "abnormal_value",
                        "severity": "warning",
                        "message": "Fasting glucose 156 mg/dL is above normal (70-99 mg/dL)",
                    },
                ]
            ),
            "Diabetic patient with significant prescription gap. HbA1c at 8.2% indicates poor glycemic control, yet no diabetes-specific medication is prescribed. Immediate review recommended — consider adding Metformin 500mg or insulin therapy.",
            "City General Hospital",
            1,
        ),
        # Patient 1: Recent CBC report — normal
        (
            1,
            1,
            None,
            "pdf",
            "Complete Blood Count\nHemoglobin: 14.2 g/dL\nWBC: 6400/uL\nPlatelets: 284000/uL\nRBC: 4.8 mil/uL\nMCV: 88.5 fL",
            json.dumps([]),
            "CBC results are within normal limits. Hemoglobin, WBC, platelets, and RBC all within reference ranges. No concerning findings.",
            "Luminus Health",
            0,
        ),
        # Patient 2: Cardiac report
        (
            2,
            2,
            None,
            "pdf",
            "ECG Report\nPatient: Priya Raj\nHeart Rate: 92 bpm\nRhythm: Sinus tachycardia\nST segment: Normal\nPR interval: 0.18s\nQRS duration: 0.09s\nImpression: Mild sinus tachycardia, no acute ischemic changes",
            json.dumps(
                [
                    {
                        "type": "abnormal_value",
                        "severity": "info",
                        "message": "Heart rate 92 bpm — mild tachycardia. Monitor if persistent.",
                    }
                ]
            ),
            "ECG shows sinus tachycardia (HR 92). No ST changes or ischemic patterns. May be anxiety-related. Recommend follow-up if symptoms persist.",
            "Apollo Hospital",
            1,
        ),
    ]

    for r in reports:
        risk_level = "routine"
        anomalies_blob = r[5] or "[]"
        if '"severity": "critical"' in anomalies_blob:
            risk_level = "critical"
        elif '"severity": "warning"' in anomalies_blob:
            risk_level = "urgent"

        cur.execute(
            """
            INSERT INTO reports (
                patient_id, uploaded_by, file_path, file_type, ocr_text,
                anomalies_json, ai_summary, ai_summary_patient, ai_summary_admin,
                risk_level, source_hospital, is_old_report
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                r[0],
                r[1],
                r[2],
                r[3],
                r[4],
                r[5],
                r[6],
                r[6],
                r[6],
                risk_level,
                r[7],
                r[8],
            ),
        )

    # ── Report Consent ──
    cur.execute(
        """
        INSERT INTO report_consent (report_id, patient_id, doctor_id, share_hospital_details)
        VALUES (1, 1, 3, 0), (3, 2, 4, 1)
    """
    )

    # ── Appointments ──
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d 10:00:00")
    next_week = (now + timedelta(days=7)).strftime("%Y-%m-%d 14:30:00")
    appointments = [
        (1, 3, tomorrow, 3, "scheduled", "Follow-up for diabetes management"),
        (2, 4, next_week, 4, "scheduled", "Cardiac follow-up — review ECG"),
    ]
    for a in appointments:
        cur.execute(
            """
            INSERT INTO appointments (patient_id, doctor_id, scheduled_at, esi_priority, status, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            a,
        )

    # ── Alerts ──
    alerts = [
        (
            1,
            1,
            "prescription_mismatch",
            "CRITICAL: Patient Arjun Mehta — Diabetic diagnosis but no diabetes medication in prescription from City General Hospital",
            "critical",
            "doctor",
        ),
        (
            1,
            None,
            "new_patient",
            "New patient registration: Arjun Mehta assigned to Dr. Priya Sharma",
            "info",
            "admin",
        ),
        (
            2,
            3,
            "anomaly",
            "Patient Priya Raj — Mild sinus tachycardia detected in ECG (HR 92 bpm)",
            "warning",
            "doctor",
        ),
        (
            None,
            None,
            "system",
            "ICU bed occupancy at 94% — consider early discharge planning",
            "warning",
            "admin",
        ),
    ]
    for a in alerts:
        cur.execute(
            """
            INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            a,
        )

    # Seed one escalation for hackathon demo admin workflow.
    cur.execute(
        """
        INSERT INTO report_escalations (
            report_id, patient_id, doctor_id, risk_level,
            admin_summary, patient_safe_summary, triage_json, status
        )
        VALUES (?, ?, ?, 'critical', ?, ?, ?, 'pending_admin')
    """,
        (
            1,
            1,
            3,
            "Critical prescription mismatch detected. Immediate doctor review recommended.",
            "Your report has been received and is under urgent care-team review.",
            json.dumps(
                {
                    "suggested_esi": 2,
                    "doctor_actions": [
                        "Review diabetic treatment plan immediately",
                        "Arrange urgent follow-up consultation",
                    ],
                    "ambulance_recommended": False,
                }
            ),
        ),
    )

    # ── Ambulances ──
    ambulances = [
        (
            "AMB-01",
            "basic",
            "available",
            12.9716,
            77.5946,
            None,
            "Driver: Ramesh K, Paramedic: Suresh M",
        ),
        (
            "AMB-02",
            "advanced",
            "available",
            12.9796,
            77.5906,
            None,
            "Driver: Kiran P, Paramedic: Meera S, EMT: Raj N",
        ),
        (
            "AMB-03",
            "cardiac",
            "available",
            12.9656,
            77.6046,
            None,
            "Driver: Anil R, Paramedic: Deepa K, Cardiologist on-call",
        ),
    ]
    for a in ambulances:
        cur.execute(
            """
            INSERT INTO ambulances (unit_name, vehicle_type, status, current_lat, current_lng, assigned_patient_id, crew_info)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            a,
        )

    # ── Nurse Notes ──
    cur.execute(
        """
        INSERT INTO nurse_notes (patient_id, nurse_id, vitals_json, note_text)
        VALUES (1, 7, ?, 'Patient stable. Morning vitals recorded. Reported mild headache.')
    """,
        (json.dumps({"hr": 78, "bp": "128/82", "spo2": 98, "temp": 98.4}),),
    )

    cur.execute(
        """
        INSERT INTO nurse_notes (patient_id, nurse_id, vitals_json, note_text)
        VALUES (2, 7, ?, 'Patient alert and responsive. Slight elevation in heart rate noted.')
    """,
        (json.dumps({"hr": 92, "bp": "118/76", "spo2": 97, "temp": 98.6}),),
    )

    conn.commit()


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at {DB_PATH}")
