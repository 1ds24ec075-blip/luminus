import os
import sqlite3
import json
import base64
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import OpenAI
import uvicorn
from db import init_db as init_unified_db
from auth import hash_password

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend-ui"
ROLE_DB_PATHS = {
    "patient": BASE_DIR / "patients.db",
    "doctor": BASE_DIR / "doctors.db",
    "admin": BASE_DIR / "admins.db",
    "lab": BASE_DIR / "labs.db",
}

app = FastAPI(title="Luminus API")


@app.on_event("startup")
def on_startup() -> None:
    init_role_dbs()
    init_unified_db()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")

# In-memory conversation state keyed by patient session.
SESSIONS: Dict[str, Dict[str, Any]] = {}
MAX_HISTORY_MESSAGES = 16


def init_role_db(role: str, seed_user: tuple[str, str, str]) -> None:
    db_path = ROLE_DB_PATHS[role]
    table_name = f"{role}s"
    conn = sqlite3.connect(db_path)
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL
        )
        """
    )
    # Keep default account available without deleting user-created records.
    conn.execute(
        f"""
        INSERT OR IGNORE INTO {table_name} (name, email, phone)
        VALUES (?, ?, ?)
        """,
        seed_user,
    )
    conn.commit()
    conn.close()


def init_role_dbs() -> None:
    init_role_db("patient", ("Arjun Mehta", "patient@luminus.health", "9663731604"))
    init_role_db(
        "doctor", ("Dr. Priya Sharma", "doctor.doc@luminus.health", "9988776655")
    )
    init_role_db("admin", ("Ravi Kapoor", "admin.admin@luminus.health", "9123456780"))
    init_role_db("lab", ("Sneha Iyer", "lab.team@luminus.health", "9876501234"))


def get_user_by_role_email_phone(
    role: str, email: str, phone: str
) -> Dict[str, Any] | None:
    if role not in ROLE_DB_PATHS:
        return None

    db_path = ROLE_DB_PATHS[role]
    table_name = f"{role}s"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        f"SELECT id, name, email FROM {table_name} WHERE lower(email) = lower(?) AND phone = ?",
        (email, phone),
    ).fetchone()
    conn.close()

    if row is None:
        return None

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": role,
    }


def get_unified_user_by_email_role(email: str, role: str) -> Dict[str, Any] | None:
    """Fetch user from unified luminus.db for clinical identifiers and metadata."""
    from db import get_db

    conn = get_db()
    row = conn.execute(
        """
        SELECT id, name, email, role, specialty
        FROM users
        WHERE lower(email) = lower(?) AND role = ?
        """,
        (email, role),
    ).fetchone()
    conn.close()

    if row is None:
        return None

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "specialty": row["specialty"],
    }


def get_unified_user_by_name_role(name: str, role: str) -> Dict[str, Any] | None:
    """Fallback resolver when role-db email differs from unified-db email."""
    from db import get_db

    conn = get_db()
    row = conn.execute(
        """
        SELECT id, name, email, role, specialty
        FROM users
        WHERE lower(name) = lower(?) AND role = ?
        LIMIT 1
        """,
        (name, role),
    ).fetchone()
    conn.close()

    if row is None:
        return None

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "specialty": row["specialty"],
    }


def get_patient_profile_by_user_id(user_id: int) -> Dict[str, Any] | None:
    """Fetch patient profile row from unified DB by user_id."""
    from db import get_db

    conn = get_db()
    row = conn.execute(
        """
        SELECT id, user_id, blood_group, assigned_doctor_id, conditions
        FROM patients
        WHERE user_id = ?
        LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    conn.close()

    if row is None:
        return None

    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "blood_group": row["blood_group"],
        "assigned_doctor_id": row["assigned_doctor_id"],
        "conditions": json.loads(row["conditions"] or "[]"),
    }


def _ensure_role_db_patient(email: str, phone: str, name: str) -> Dict[str, Any]:
    """Ensure patient exists in role-specific login DB."""
    db_path = ROLE_DB_PATHS["patient"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    row = conn.execute(
        "SELECT id, name, email FROM patients WHERE lower(email)=lower(?)",
        (email,),
    ).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO patients (name, email, phone) VALUES (?, ?, ?)",
            (name, email, phone),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, name, email FROM patients WHERE lower(email)=lower(?)",
            (email,),
        ).fetchone()
    conn.close()

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": "patient",
    }


def _analyze_uploaded_report_with_ai(
    image_data_url: str, file_name: str, file_type: str | None = None
) -> Dict[str, Any]:
    """Use OpenAI to summarize report and detect anomalies from image or PDF."""

    def _decode_data_url(data_url: str) -> tuple[str | None, bytes]:
        if not data_url:
            return None, b""

        match = re.match(r"^data:([^;]+);base64,(.*)$", data_url, re.DOTALL)
        if not match:
            return None, b""

        mime_type = match.group(1)
        encoded = match.group(2)
        try:
            return mime_type, base64.b64decode(encoded)
        except Exception:
            return mime_type, b""

    def _extract_text_from_pdf(pdf_bytes: bytes) -> tuple[str, str | None]:
        if not pdf_bytes:
            return "", "PDF payload is empty."
        try:
            from pypdf import PdfReader
        except Exception:
            return "", "PDF parser not installed. Run: pip install pypdf"

        try:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            pages = []
            for page in reader.pages:
                pages.append(page.extract_text() or "")
            text = "\n".join(pages).strip()
            if not text:
                return "", "No readable text found in PDF (possibly scanned image PDF)."
            return text, None
        except Exception as exc:
            return "", f"Failed to parse PDF: {exc}"

    def _rule_based_anomalies(text_blob: str) -> List[Dict[str, str]]:
        text = (text_blob or "").lower()
        issues: List[Dict[str, str]] = []

        has_diabetes = any(token in text for token in ["diabetes", "hba1c", "glucose"])
        has_diabetes_med = any(
            token in text
            for token in [
                "metformin",
                "insulin",
                "glibenclamide",
                "pioglitazone",
                "sitagliptin",
            ]
        )

        if has_diabetes and not has_diabetes_med:
            issues.append(
                {
                    "type": "prescription_mismatch",
                    "severity": "critical",
                    "message": "Possible diabetes evidence detected but no diabetes medication mention found.",
                }
            )

        return issues

    if not os.getenv("OPENAI_API_KEY"):
        return {
            "summary": "Report uploaded. AI summary unavailable because OPENAI_API_KEY is not configured.",
            "anomalies": _rule_based_anomalies(file_name),
            "extracted_text": "",
            "source_hospital": None,
        }

    mime_type, binary_payload = _decode_data_url(image_data_url)
    is_pdf = (
        (file_type or "").lower().find("pdf") != -1
        or (mime_type or "") == "application/pdf"
        or file_name.lower().endswith(".pdf")
    )

    if is_pdf:
        extracted_pdf_text, pdf_error = _extract_text_from_pdf(binary_payload)
        if pdf_error:
            return {
                "summary": "PDF uploaded but text extraction failed for AI analysis.",
                "anomalies": _rule_based_anomalies(file_name),
                "extracted_text": "",
                "source_hospital": None,
                "analysis_error": pdf_error,
            }

        text_prompt = (
            "You are a clinical report reviewer. Analyze the medical report text and return JSON with keys: "
            "summary (string), extracted_text (string), source_hospital (string|null), anomalies (array). "
            "Each anomaly object must include type, severity (critical|warning|info), and message. "
            "Flag critical if there is evidence of diabetes but no medication guidance.\n\n"
            f"File name: {file_name}\n"
            f"Report text:\n{extracted_pdf_text[:12000]}"
        )

        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": text_prompt}],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            content = response.choices[0].message.content if response.choices else "{}"
            parsed = json.loads(content or "{}")

            anomalies = parsed.get("anomalies")
            if not isinstance(anomalies, list):
                anomalies = []

            merged_text = (
                f"{file_name}\n{extracted_pdf_text}\n"
                f"{parsed.get('extracted_text') or ''}\n{parsed.get('summary') or ''}"
            )
            anomalies.extend(_rule_based_anomalies(merged_text))

            return {
                "summary": parsed.get("summary")
                or "AI extracted report details from PDF.",
                "anomalies": anomalies,
                "extracted_text": parsed.get("extracted_text") or extracted_pdf_text,
                "source_hospital": parsed.get("source_hospital"),
            }
        except Exception as exc:
            return {
                "summary": "PDF uploaded successfully. AI text analysis is temporarily unavailable.",
                "anomalies": _rule_based_anomalies(extracted_pdf_text),
                "extracted_text": extracted_pdf_text,
                "source_hospital": None,
                "analysis_error": str(exc)[:240],
            }

    prompt = (
        "You are a clinical report reviewer. Analyze this medical report image and return JSON with keys: "
        "summary (string), extracted_text (string), source_hospital (string|null), anomalies (array). "
        "Each anomaly object must include type, severity (critical|warning|info), and message. "
        "Flag critical if there is a condition like diabetes but no medication guidance in the prescription. "
        f"File name: {file_name}."
    )

    # Very small image data URLs are usually placeholders (for example 1x1 pixels).
    if (mime_type or "").startswith("image/") and len(image_data_url or "") < 500:
        return {
            "summary": "Uploaded image appears too small or empty for AI report analysis.",
            "anomalies": _rule_based_anomalies(file_name),
            "extracted_text": "",
            "source_hospital": None,
            "analysis_error": "Image payload too small. Upload a clear report photo or scan.",
        }

    last_error: Exception | None = None
    for vision_model in [VISION_MODEL, MODEL]:
        try:
            response = client.chat.completions.create(
                model=vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_data_url}},
                        ],
                    }
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            content = response.choices[0].message.content if response.choices else "{}"
            parsed = json.loads(content or "{}")

            anomalies = parsed.get("anomalies")
            if not isinstance(anomalies, list):
                anomalies = []

            merged_text = f"{file_name}\n{parsed.get('extracted_text') or ''}\n{parsed.get('summary') or ''}"
            anomalies.extend(_rule_based_anomalies(merged_text))

            return {
                "summary": parsed.get("summary")
                or "AI could not extract a full summary from this image.",
                "anomalies": anomalies,
                "extracted_text": parsed.get("extracted_text") or "",
                "source_hospital": parsed.get("source_hospital"),
            }
        except Exception as exc:
            last_error = exc
            continue

    # Safe fallback to avoid blocking upload flow.
    fallback = {
        "summary": "Report uploaded successfully. AI analysis is temporarily unavailable.",
        "anomalies": _rule_based_anomalies(file_name),
        "extracted_text": "",
        "source_hospital": None,
    }
    if last_error is not None:
        # Keep diagnostics short for client visibility.
        fallback["analysis_error"] = str(last_error)[:240]
    return fallback


def _ensure_session(session_id: str, patient: Dict[str, Any]) -> Dict[str, Any]:
    session = SESSIONS.get(session_id)
    if session is None:
        session = {
            "patient_name": patient.get("name", "Patient"),
            "history": [],
        }
        SESSIONS[session_id] = session
    else:
        # Keep name current in case profile updates.
        session["patient_name"] = patient.get(
            "name", session.get("patient_name", "Patient")
        )
    return session


def _format_patient_context(patient: Dict[str, Any]) -> str:
    reports = patient.get("reports", [])
    appointments = patient.get("upcoming_appointments", [])
    medications = patient.get("medications", [])
    vitals = patient.get("vitals", {})

    report_lines = [
        f"- {r.get('date', 'unknown date')}: {r.get('title', 'Report')} -> {r.get('summary', '')}"
        for r in reports
    ]
    appt_lines = [
        f"- {a.get('date', 'unknown date')}: {a.get('doctor', 'Unknown')} ({a.get('type', 'General')})"
        for a in appointments
    ]
    med_lines = [
        f"- {m.get('name', 'Medication')} | {m.get('schedule', 'No schedule')} | taken={m.get('taken', False)}"
        for m in medications
    ]

    return (
        f"Patient Name: {patient.get('name', 'Patient')}\n"
        f"Username: {patient.get('username', '')}\n"
        f"Role: {patient.get('role', '')}\n\n"
        "Vitals:\n"
        f"- Heart Rate: {vitals.get('heart_rate', 'n/a')}\n"
        f"- Blood Pressure: {vitals.get('blood_pressure', 'n/a')}\n"
        f"- Sleep: {vitals.get('sleep', 'n/a')}\n\n"
        "Reports:\n"
        + ("\n".join(report_lines) if report_lines else "- No reports available")
        + "\n\nUpcoming Appointments:\n"
        + ("\n".join(appt_lines) if appt_lines else "- No upcoming appointments")
        + "\n\nMedications:\n"
        + ("\n".join(med_lines) if med_lines else "- No medications listed")
    )


def _build_messages(
    session: Dict[str, Any], patient_context: str, user_message: str
) -> List[Dict[str, str]]:
    system_prompt = (
        "You are Lumi, a healthcare support assistant for a patient portal. "
        "Use the patient context to answer questions about reports, medications, and appointments. "
        "Always address the patient by name when appropriate. "
        "If asked for medical diagnosis, provide safe guidance and suggest consulting a clinician. "
        "Do not invent data not present in context."
    )

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {
            "role": "system",
            "content": "Current patient context:\n" + patient_context,
        },
    ]

    history = session.get("history", [])[-MAX_HISTORY_MESSAGES:]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    return messages


@app.get("/health")
def health() -> Any:
    return {"ok": True, "model": MODEL}


@app.post("/api/chat")
async def chat(request: Request) -> Any:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    payload = await request.json()
    session_id = payload.get("session_id", "default-session")
    user_message = (payload.get("message") or "").strip()
    patient = payload.get("patient") or {}

    if not user_message:
        raise HTTPException(status_code=400, detail="message is required")

    session = _ensure_session(session_id, patient)
    patient_context = _format_patient_context(patient)
    messages = _build_messages(session, patient_context, user_message)

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.3,
        )
        reply = response.choices[0].message.content if response.choices else ""
        reply = (reply or "I could not generate a response right now.").strip()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"OpenAI request failed: {exc}"
        ) from exc

    session.setdefault("history", []).append({"role": "user", "content": user_message})
    session["history"].append({"role": "assistant", "content": reply})
    session["history"] = session["history"][-MAX_HISTORY_MESSAGES:]

    return {
        "reply": reply,
        "patient_name": session.get("patient_name"),
        "session_id": session_id,
    }


@app.post("/api/login")
async def login(request: Request) -> Any:
    payload = await request.json()
    role = (payload.get("role") or "patient").strip().lower()
    email = (payload.get("email") or "").strip().lower()
    phone = (payload.get("phone") or "").strip()

    if not email or not phone:
        raise HTTPException(status_code=400, detail="email and phone are required")

    if role not in ROLE_DB_PATHS:
        raise HTTPException(status_code=400, detail="Invalid role")

    user = get_user_by_role_email_phone(role, email, phone)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or phone number")

    unified_user = get_unified_user_by_email_role(email, role)
    if unified_user is None:
        unified_user = get_unified_user_by_name_role(user["name"], role)
    if unified_user:
        user["clinical_id"] = unified_user["id"]
        if unified_user.get("specialty"):
            user["specialty"] = unified_user["specialty"]
        if role == "patient":
            patient_profile = get_patient_profile_by_user_id(unified_user["id"])
            if patient_profile:
                user["patient_id"] = patient_profile["id"]

    return {"ok": True, "user": user}


@app.post("/api/patient/register")
async def register_patient(request: Request) -> Any:
    """Create a new patient user without hardcoded credentials."""
    payload = await request.json()
    email = (payload.get("email") or "").strip().lower()
    phone = (payload.get("phone") or "").strip()
    name = (payload.get("name") or "").strip()

    if not email or not phone:
        raise HTTPException(status_code=400, detail="email and phone are required")

    if "@" not in email:
        raise HTTPException(status_code=400, detail="email format is invalid")

    if not name:
        base = email.split("@")[0].replace(".", " ").replace("_", " ").strip()
        name = " ".join([part.capitalize() for part in base.split()]) or "New Patient"

    role_user = _ensure_role_db_patient(email, phone, name)

    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    existing = cur.execute(
        "SELECT id, name, email FROM users WHERE lower(email)=lower(?) AND role='patient'",
        (email,),
    ).fetchone()

    if existing is None:
        cur.execute(
            """
            INSERT INTO users (name, email, phone, password_hash, role, specialty)
            VALUES (?, ?, ?, ?, 'patient', NULL)
            """,
            (name, email, phone, hash_password(phone)),
        )
        user_id = cur.lastrowid

        # Assign default doctor (Dr. Priya Sharma) if available.
        doctor_row = cur.execute(
            "SELECT id FROM users WHERE role='doctor' ORDER BY id ASC LIMIT 1"
        ).fetchone()
        assigned_doctor_id = doctor_row["id"] if doctor_row else None

        cur.execute(
            """
            INSERT INTO patients (user_id, blood_group, assigned_doctor_id, conditions)
            VALUES (?, NULL, ?, '[]')
            """,
            (user_id, assigned_doctor_id),
        )
        patient_id = cur.lastrowid
    else:
        user_id = existing["id"]
        patient_row = cur.execute(
            "SELECT id FROM patients WHERE user_id = ? LIMIT 1", (user_id,)
        ).fetchone()
        if patient_row is None:
            doctor_row = cur.execute(
                "SELECT id FROM users WHERE role='doctor' ORDER BY id ASC LIMIT 1"
            ).fetchone()
            assigned_doctor_id = doctor_row["id"] if doctor_row else None
            cur.execute(
                """
                INSERT INTO patients (user_id, blood_group, assigned_doctor_id, conditions)
                VALUES (?, NULL, ?, '[]')
                """,
                (user_id, assigned_doctor_id),
            )
            patient_id = cur.lastrowid
        else:
            patient_id = patient_row["id"]

    conn.commit()
    conn.close()

    return {
        "ok": True,
        "user": {
            "id": role_user["id"],
            "name": name,
            "email": email,
            "role": "patient",
            "clinical_id": user_id,
            "patient_id": patient_id,
        },
    }


@app.get("/api/patient/onboarding/{patient_id}")
def get_patient_onboarding_status(patient_id: int) -> Any:
    """Return whether patient should upload previous reports on first login."""
    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    report_count_row = cur.execute(
        "SELECT COUNT(*) AS count FROM reports WHERE patient_id = ?", (patient_id,)
    ).fetchone()
    report_count = report_count_row["count"] if report_count_row else 0

    conn.close()

    return {
        "patient_id": patient_id,
        "report_count": report_count,
        "requires_upload": report_count == 0,
    }


@app.get("/api/patient/reports/{patient_id}")
def get_patient_reports(patient_id: int) -> Any:
    """List patient reports for dashboard and upload history."""
    from db import get_db

    conn = get_db()
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT id, file_path, file_type, ai_summary, anomalies_json, created_at
        FROM reports
        WHERE patient_id = ?
        ORDER BY created_at DESC
        """,
        (patient_id,),
    ).fetchall()
    conn.close()

    reports = []
    for r in rows:
        anomalies = json.loads(r["anomalies_json"] or "[]")
        is_critical = any(a.get("severity") == "critical" for a in anomalies)
        reports.append(
            {
                "id": r["id"],
                "name": r["file_path"] or f"Report #{r['id']}",
                "type": (r["file_type"] or "report").upper(),
                "date": r["created_at"],
                "summary": r["ai_summary"] or "AI summary unavailable.",
                "anomaly_count": len(anomalies),
                "has_critical": is_critical,
            }
        )

    return {"patient_id": patient_id, "reports": reports}


@app.post("/api/patient/upload-report")
async def upload_patient_report(request: Request) -> Any:
    """Upload previous hospital report, ask consent on hospital details, run AI summary/anomaly scan."""
    payload = await request.json()
    patient_id = payload.get("patient_id")
    uploaded_by = payload.get("uploaded_by")
    file_name = (payload.get("file_name") or "uploaded_report").strip()
    file_type = (payload.get("file_type") or "image").strip()
    image_data_url = payload.get("image_data_url") or ""
    share_hospital_details = bool(payload.get("share_hospital_details", False))

    if not patient_id:
        raise HTTPException(status_code=400, detail="patient_id is required")

    if not image_data_url:
        raise HTTPException(status_code=400, detail="image_data_url is required")

    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    patient = cur.execute(
        "SELECT id, user_id, assigned_doctor_id FROM patients WHERE id = ?",
        (patient_id,),
    ).fetchone()
    if patient is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Patient not found")

    uploader_id = uploaded_by or patient["user_id"]
    analysis = _analyze_uploaded_report_with_ai(image_data_url, file_name, file_type)

    anomalies = analysis.get("anomalies") or []
    source_hospital = (
        analysis.get("source_hospital") if share_hospital_details else None
    )

    cur.execute(
        """
        INSERT INTO reports (
            patient_id, uploaded_by, file_path, file_type, ocr_text,
            anomalies_json, ai_summary, source_hospital, is_old_report
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        """,
        (
            patient_id,
            uploader_id,
            file_name,
            file_type,
            analysis.get("extracted_text", ""),
            json.dumps(anomalies),
            analysis.get("summary", ""),
            source_hospital,
        ),
    )
    report_id = cur.lastrowid

    if patient["assigned_doctor_id"]:
        cur.execute(
            """
            INSERT INTO report_consent (report_id, patient_id, doctor_id, share_hospital_details)
            VALUES (?, ?, ?, ?)
            """,
            (
                report_id,
                patient_id,
                patient["assigned_doctor_id"],
                1 if share_hospital_details else 0,
            ),
        )

    for issue in anomalies:
        severity = issue.get("severity", "info")
        if severity == "critical":
            cur.execute(
                """
                INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
                VALUES (?, ?, 'report_anomaly', ?, 'critical', 'doctor')
                """,
                (
                    patient_id,
                    report_id,
                    issue.get(
                        "message", "Critical anomaly detected in uploaded report."
                    ),
                ),
            )

    conn.commit()
    conn.close()

    return {
        "ok": True,
        "report_id": report_id,
        "summary": analysis.get("summary", ""),
        "anomalies": anomalies,
        "has_critical": any(a.get("severity") == "critical" for a in anomalies),
        "analysis_error": analysis.get("analysis_error"),
    }


@app.get("/")
def serve_frontend() -> Any:
    return FileResponse(FRONTEND_DIR / "index.html")


# ─────────────────────────────────────────────────────────────────
# DOCTOR PORTAL ENDPOINTS (MCP Integration)
# ─────────────────────────────────────────────────────────────────


@app.get("/api/doctor/queue/{doctor_id}")
def get_doctor_queue(doctor_id: int) -> Any:
    """Get today's patient queue for a doctor."""
    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Include upcoming appointments to keep doctor queue useful in demo and testing.
    thirty_days_later = now.replace(microsecond=0)
    from datetime import timedelta as _td

    thirty_days_later = thirty_days_later + _td(days=30)

    appointments = cur.execute(
        """
        SELECT 
            a.id, a.patient_id, a.scheduled_at, a.esi_priority, a.status, a.notes,
            u.name as patient_name, p.conditions
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON p.user_id = u.id
                WHERE a.doctor_id = ?
                    AND datetime(a.scheduled_at) BETWEEN datetime(?) AND datetime(?)
                    AND a.status IN ('scheduled','in_progress')
        ORDER BY a.scheduled_at ASC
    """,
        (
            doctor_id,
            today_start.strftime("%Y-%m-%d %H:%M:%S"),
            thirty_days_later.strftime("%Y-%m-%d %H:%M:%S"),
        ),
    ).fetchall()

    queue = []
    for appt in appointments:
        queue.append(
            {
                "appointment_id": appt["id"],
                "patient_id": appt["patient_id"],
                "patient_name": appt["patient_name"],
                "scheduled_at": appt["scheduled_at"],
                "esi_priority": appt["esi_priority"],
                "status": appt["status"],
                "conditions": json.loads(appt["conditions"] or "[]"),
                "notes": appt["notes"],
            }
        )

    conn.close()

    return {
        "doctor_id": doctor_id,
        "queue_length": len(queue),
        "average_wait": 15 if queue else 0,
        "appointments": queue,
    }


@app.get("/api/doctor/alerts/{doctor_id}")
def get_doctor_alerts(doctor_id: int) -> Any:
    """Get unresolved critical/warning alerts for doctor dashboard."""
    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    rows = cur.execute(
        """
        SELECT id, patient_id, alert_type, message, severity, created_at
        FROM alerts
        WHERE target_role = 'doctor' AND resolved = 0
        ORDER BY
            CASE severity
                WHEN 'critical' THEN 1
                WHEN 'warning' THEN 2
                ELSE 3
            END,
            created_at DESC
        LIMIT 20
        """
    ).fetchall()
    conn.close()

    alerts = [
        {
            "id": r["id"],
            "patient_id": r["patient_id"],
            "alert_type": r["alert_type"],
            "message": r["message"],
            "severity": r["severity"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    critical_count = len([a for a in alerts if a["severity"] == "critical"])

    return {
        "doctor_id": doctor_id,
        "critical_count": critical_count,
        "alerts": alerts,
    }


@app.post("/api/visit/start")
async def start_visit(request: Request) -> Any:
    """Start a new visit session for doctor-patient consultation."""
    from mcp_server import allocate_time_slot

    payload = await request.json()
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    appointment_id = payload.get("appointment_id")

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="patient_id and doctor_id required")

    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    try:
        # Create visit session in DB
        now = datetime.now().isoformat()
        cur.execute(
            """
            INSERT INTO visit_sessions (patient_id, doctor_id, appointment_id, start_time, voice_to_text_enabled)
            VALUES (?, ?, ?, ?, 0)
        """,
            (patient_id, doctor_id, appointment_id, now),
        )

        visit_session_id = cur.lastrowid
        conn.commit()

        # Allocate time slot based on ESI priority
        esi_priority = 3  # Default to urgent
        if appointment_id:
            appt = cur.execute(
                """
                SELECT esi_priority FROM appointments WHERE id = ?
            """,
                (appointment_id,),
            ).fetchone()
            if appt:
                esi_priority = appt["esi_priority"]

        slot_info = allocate_time_slot(patient_id, doctor_id, esi_priority)

        conn.close()

        return {
            "visit_session_id": visit_session_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "voice_to_text_enabled": False,
            "estimated_wait": slot_info.get("estimated_wait_minutes"),
            "status": "visit_started",
        }

    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/visit/save")
async def save_visit(request: Request) -> Any:
    """Save completed visit session with transcript."""
    from mcp_server import (
        save_visit_session,
        check_prescription_against_history,
        create_medication_alert,
    )

    payload = await request.json()
    visit_session_id = payload.get("visit_session_id")
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    transcript_lines = payload.get("transcript", [])
    urgency = payload.get("urgency_level", "routine")

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="patient_id and doctor_id required")

    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    try:
        # Update visit session as confirmed
        cur.execute(
            """
            UPDATE visit_sessions SET is_confirmed = 1, end_time = ? WHERE id = ?
        """,
            (datetime.now().isoformat(), visit_session_id),
        )

        # Insert transcript lines
        for line in transcript_lines:
            speaker = line.get("speaker", "system").lower()
            if speaker not in ["doctor", "patient", "system"]:
                speaker = "system"

            cur.execute(
                """
                INSERT INTO visit_transcripts (visit_session_id, speaker_role, transcript_text)
                VALUES (?, ?, ?)
            """,
                (visit_session_id, speaker, line.get("text", "")),
            )

        conn.commit()
        conn.close()

        return {
            "visit_session_id": visit_session_id,
            "status": "visit_saved",
            "transcripts_saved": len(transcript_lines),
            "patient_id": patient_id,
        }

    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prescription/upload")
async def upload_prescription(request: Request) -> Any:
    """Upload prescription image and create prescription record."""
    payload = await request.json()
    visit_session_id = payload.get("visit_session_id")
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    medications_json = payload.get("medications", [])
    dosage_instructions = payload.get("dosage", "")
    notes = payload.get("notes", "")

    if not all([visit_session_id, patient_id, doctor_id]):
        raise HTTPException(
            status_code=400, detail="visit_session_id, patient_id, doctor_id required"
        )

    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    try:
        # Create prescription record
        medications_str = (
            json.dumps(medications_json)
            if isinstance(medications_json, list)
            else medications_json
        )
        cur.execute(
            """
            INSERT INTO prescriptions (visit_session_id, patient_id, doctor_id, medications_json, dosage_instructions, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            (
                visit_session_id,
                patient_id,
                doctor_id,
                medications_str,
                dosage_instructions,
                notes,
            ),
        )

        prescription_id = cur.lastrowid
        conn.commit()
        conn.close()

        return {
            "prescription_id": prescription_id,
            "patient_id": patient_id,
            "status": "prescription_uploaded",
            "medications_count": (
                len(medications_json) if isinstance(medications_json, list) else 0
            ),
        }

    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prescription/validate")
async def validate_prescription(request: Request) -> Any:
    """Validate prescription against patient medical history using MCP."""
    from mcp_server import check_prescription_against_history, create_medication_alert

    payload = await request.json()
    prescription_id = payload.get("prescription_id")
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    medications_json = payload.get("medications", [])

    if not all([patient_id, doctor_id]):
        raise HTTPException(status_code=400, detail="patient_id, doctor_id required")

    # Call MCP tool to validate
    medications_str = json.dumps(medications_json)
    validation_result = check_prescription_against_history(
        patient_id, medications_str, doctor_id
    )

    # If discrepancies found, create alerts
    if validation_result.get("has_discrepancies") and validation_result.get("issues"):
        from db import get_db

        conn = get_db()
        cur = conn.cursor()

        for issue in validation_result["issues"]:
            if issue.get("severity") == "critical":
                # Create alert for doctor
                cur.execute(
                    """
                    INSERT INTO alerts (patient_id, alert_type, message, severity, target_role)
                    VALUES (?, ?, ?, ?, 'doctor')
                """,
                    (
                        patient_id,
                        "prescription_validation",
                        issue.get("message"),
                        "critical",
                    ),
                )

        conn.commit()
        conn.close()

    return {
        "prescription_id": prescription_id,
        "validation_complete": True,
        "has_discrepancies": validation_result.get("has_discrepancies"),
        "severity": validation_result.get("severity"),
        "issues": validation_result.get("issues", []),
        "confidence_score": validation_result.get("confidence_score"),
    }


@app.get("/api/patient/history-summary/{patient_id}")
def get_patient_history_summary(patient_id: int) -> Any:
    """Get patient's medical history for doctor review with OpenAI 8-10 point summary."""
    from mcp_server import get_patient_history_for_doctor

    history = get_patient_history_for_doctor(patient_id)
    if "error" in history:
        return history

    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    prompt = (
        "You are a clinical summarization assistant. "
        "Create exactly 8 to 10 concise bullet points for the current doctor. "
        "Use only the provided patient history. "
        "Do not mention source hospital names or previous doctor names. "
        "Include risk flags and follow-up focus where relevant.\n\n"
        f"Patient history JSON:\n{json.dumps(history)}"
    )

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Return plain text bullets, one per line, each starting with '- '.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        summary_text = response.choices[0].message.content if response.choices else ""
        summary_text = (summary_text or "").strip()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"OpenAI request failed: {exc}"
        ) from exc

    raw_lines = [line.strip() for line in summary_text.splitlines() if line.strip()]
    bullet_points: List[str] = []
    for line in raw_lines:
        if line.startswith("- "):
            bullet_points.append(line[2:].strip())
        elif line[:2].isdigit() and "." in line:
            bullet_points.append(line.split(".", 1)[1].strip())
        elif line[0].isdigit() and "." in line:
            bullet_points.append(line.split(".", 1)[1].strip())

    if len(bullet_points) < 8:
        # Fallback: preserve at least the available lines as bullets.
        bullet_points = [line.lstrip("- ").strip() for line in raw_lines[:10]]

    bullet_points = bullet_points[:10]

    return {
        **history,
        "summary_points": bullet_points,
        "summary_count": len(bullet_points),
        "summary_generated_by": MODEL,
    }


@app.get("/{full_path:path}")
def serve_frontend_assets(full_path: str) -> Any:
    # Keep API routes handled by FastAPI endpoints only.
    if full_path.startswith("api/") or full_path == "health":
        raise HTTPException(status_code=404, detail="Not Found")

    target = FRONTEND_DIR / full_path
    if target.is_file():
        return FileResponse(target)
    return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    init_role_dbs()
    init_unified_db()
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
