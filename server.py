import os
import sqlite3
import json
import base64
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
import urllib.error
import urllib.request

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import OpenAI
import uvicorn
from db import init_db as init_unified_db
from auth import hash_password
from ai_router import SensitivityAwareRouter

load_dotenv()

router = SensitivityAwareRouter()

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
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
SYSTEM_PROMPT_PATH = BASE_DIR / "SYSTEM_PROMPT.md"

# In-memory conversation state keyed by patient session.
SESSIONS: Dict[str, Dict[str, Any]] = {}
MAX_HISTORY_MESSAGES = max(16, int(os.getenv("LUMINUS_SESSION_MEMORY_SIZE", "40")))


def _load_system_prompt() -> str:
    try:
        raw = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        return raw[:8000]
    except Exception:
        return ""


SYSTEM_PROMPT_TEXT = _load_system_prompt()


def _extract_json_from_text(text: str) -> Dict[str, Any]:
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return {}
    return {}


def _http_post_json(
    url: str,
    payload: Dict[str, Any],
    headers: Dict[str, str] | None = None,
    timeout: float = 25.0,
) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)

    request_obj = urllib.request.Request(
        url,
        data=body,
        headers=req_headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore") if exc.fp else ""
        return {
            "error": f"HTTP {exc.code}",
            "details": details[:240],
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:240]}


def _risk_level_from_anomalies(anomalies: List[Dict[str, Any]]) -> str:
    severities = {(a.get("severity") or "").lower() for a in anomalies}
    if "critical" in severities:
        return "critical"
    if "warning" in severities:
        return "urgent"
    return "routine"


def _patient_safe_summary(admin_summary: str, risk_level: str) -> str:
    if risk_level == "critical":
        return (
            "Your report has been received successfully. "
            "Our clinical team is reviewing it urgently and your doctor/admin will contact you shortly."
        )
    if risk_level == "urgent":
        return "Your report has been reviewed by AI and forwarded to the care team for priority follow-up."
    return admin_summary or "Your report has been uploaded and reviewed."


def _normalize_esi(value: Any) -> int:
    try:
        esi = int(value)
    except Exception:
        return 3
    return max(1, min(5, esi))


def _build_triage_bundle(
    patient_id: int,
    report_id: int,
    report_analysis: Dict[str, Any],
    assigned_doctor_id: int | None,
) -> Dict[str, Any]:
    from mcp_server import analyze_report_urgency, get_patient_history_for_doctor

    anomalies = report_analysis.get("anomalies") or []
    base_risk = _risk_level_from_anomalies(anomalies)

    mcp_urgency = analyze_report_urgency(report_id)
    history = get_patient_history_for_doctor(patient_id)
    mcp_risk = (mcp_urgency.get("urgency_level") or "").lower()
    if mcp_risk not in {"critical", "urgent", "routine"}:
        mcp_risk = base_risk

    gemini_prompt = (
        "You are a medical triage planner for a doctor dashboard. "
        "Return strict JSON with keys: risk_level (critical|urgent|routine), suggested_esi (1-5), "
        "urgent_requests (array of concise doctor tasks), doctor_notes (string), ambulance_recommended (boolean).\n\n"
        f"MCP urgency:\n{json.dumps(mcp_urgency)}\n\n"
        f"Patient history:\n{json.dumps(history)[:12000]}\n\n"
        f"Report analysis:\n{json.dumps(report_analysis)[:12000]}"
    )
    
    # Complex planning -> route to OPENAI
    gemini_payload = {"prompt": gemini_prompt, "json_mode": True}
    gemini_res = router.route_request("BATCH", "LOW", "HIGH", gemini_payload)
    gemini = json.loads(gemini_res.get("content", "{}"))

    groq_user_prompt = (
        "Generate a rapid action playbook from this case. "
        "Return strict JSON with keys: first_10_minutes (array), escalation_path (array), "
        "patient_communication (string), ambulance_recommended (boolean).\n\n"
        f"Case JSON:\n{json.dumps({'mcp_urgency': mcp_urgency, 'analysis': report_analysis, 'history': history})[:12000]}"
    )

    # Real-time action playbook -> route to GROQ
    groq_payload = {
        "system": "You are a concise emergency response co-pilot for clinicians.", 
        "prompt": groq_user_prompt, 
        "json_mode": True
    }
    groq_res = router.route_request("REALTIME", "LOW", "LOW", groq_payload)
    groq = json.loads(groq_res.get("content", "{}"))

    final_risk = base_risk
    if mcp_risk == "critical" or gemini.get("risk_level") == "critical":
        final_risk = "critical"
    elif (
        mcp_risk == "urgent"
        or gemini.get("risk_level") == "urgent"
        or final_risk == "urgent"
    ):
        final_risk = "urgent"

    suggested_esi = _normalize_esi(gemini.get("suggested_esi") or 3)
    doctor_actions = gemini.get("urgent_requests")
    if not isinstance(doctor_actions, list) or not doctor_actions:
        doctor_actions = [
            "Review report findings and medication context.",
            "Confirm follow-up timing and escalation path.",
        ]

    return {
        "risk_level": final_risk,
        "suggested_esi": suggested_esi,
        "doctor_actions": doctor_actions,
        "doctor_notes": gemini.get("doctor_notes")
        or "Prioritize according to risk level.",
        "ambulance_recommended": bool(
            gemini.get("ambulance_recommended") or groq.get("ambulance_recommended")
        ),
        "mcp_urgency": mcp_urgency,
        "gemini": gemini,
        "groq": groq,
        "assigned_doctor_id": assigned_doctor_id,
    }


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
    """Use the SensitivityAwareRouter to summarize report and detect anomalies from image or PDF."""
    
    def _decode_data_url(data_url: str) -> tuple[str | None, bytes]:
        if not data_url:
            return None, b""
        match = re.match(r"^data:([^;]+);base64,(.*)$", data_url, re.DOTALL)
        if not match:
            return None, b""
        return match.group(1), base64.b64decode(match.group(2))

    mime_type, binary_payload = _decode_data_url(image_data_url)
    
    # We will simulate the extraction part, and pass the text to the router
    extracted_text = f"Text extracted from {file_name}"
    
    payload = {
        "system": (
            "You are a clinical report reviewer. Analyze this medical report text and return JSON with keys: "
            "summary (string), extracted_text (string), source_hospital (string|null), anomalies (array). "
            "Each anomaly object must include type, severity (critical|warning|info), and message."
        ),
        "prompt": f"File name: {file_name}\nExtracted text/content placeholder: {extracted_text}",
        "json_mode": True
    }
    
    try:
        # Route to OPENAI for complex document reasoning
        res = router.route_request(task_type="BATCH", data_sensitivity="LOW", complexity="HIGH", payload=payload)
        
        # The router returns a string in content, we must parse it
        parsed = json.loads(res.get("content", "{}"))
        
        anomalies = parsed.get("anomalies")
        if not isinstance(anomalies, list):
            anomalies = []
            
        return {
            "summary": parsed.get("summary", "AI processed report."),
            "anomalies": anomalies,
            "extracted_text": parsed.get("extracted_text", extracted_text),
            "source_hospital": parsed.get("source_hospital", None)
        }
    except Exception as exc:
        return {
            "summary": "Report uploaded successfully. AI analysis is temporarily unavailable.",
            "anomalies": [],
            "extracted_text": "",
            "source_hospital": None,
            "analysis_error": str(exc)[:240],
        }


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
    if SYSTEM_PROMPT_TEXT:
        system_prompt += "\n\nProject guidance:\n" + SYSTEM_PROMPT_TEXT[:2000]

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
    return {
        "ok": True,
        "model": MODEL,
        "gemini_enabled": bool(GEMINI_API_KEY),
        "groq_enabled": bool(GROQ_API_KEY),
        "session_memory_messages": MAX_HISTORY_MESSAGES,
    }


@app.post("/api/ollama")
async def process_ollama_request(request: Request) -> Dict[str, Any]:
    print("Backend: Received POST request on /api/ollama")
    data = await request.json()
    prompt = data.get("prompt", "")
    
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
        
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": "qwen:7b",
        "prompt": prompt,
        "stream": False
    }
    
    try:
        # Send POST request to Ollama
        response_data = _http_post_json(url, payload, timeout=60.0)
        
        if "error" in response_data:
            print("Backend: Ollama connection error -", response_data)
            raise HTTPException(status_code=503, detail="Ollama server is not running or unreachable")
            
        print("Backend: Successfully received response from Ollama")
        return {"result": response_data.get("response", "")}
    except HTTPException:
        raise
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail="Ollama server is not running or unreachable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama failed: {str(e)}")

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
        SELECT id, file_path, file_type, ai_summary, ai_summary_patient, anomalies_json,
               risk_level, created_at
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
        row_risk = (r["risk_level"] or "").lower()
        anomaly_critical = any(
            (a.get("severity") or "").lower() == "critical" for a in anomalies
        )
        is_critical = row_risk == "critical" or anomaly_critical

        safe_summary = (
            r["ai_summary_patient"] or r["ai_summary"] or "AI summary unavailable."
        )
        if is_critical:
            safe_summary = _patient_safe_summary(safe_summary, "critical")

        reports.append(
            {
                "id": r["id"],
                "name": r["file_path"] or f"Report #{r['id']}",
                "type": (r["file_type"] or "report").upper(),
                "date": r["created_at"],
                "summary": safe_summary,
                "anomaly_count": len(anomalies),
                "has_critical": is_critical,
                "risk_level": row_risk or _risk_level_from_anomalies(anomalies),
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
    auto_dispatch_ambulance = bool(payload.get("auto_dispatch_ambulance", False))
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")

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
    admin_summary = analysis.get("summary", "")
    base_risk = _risk_level_from_anomalies(anomalies)
    patient_summary = _patient_safe_summary(admin_summary, base_risk)
    source_hospital = (
        analysis.get("source_hospital") if share_hospital_details else None
    )

    cur.execute(
        """
        INSERT INTO reports (
            patient_id, uploaded_by, file_path, file_type, ocr_text,
            anomalies_json, ai_summary, ai_summary_patient, ai_summary_admin,
            risk_level, source_hospital, is_old_report
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """,
        (
            patient_id,
            uploader_id,
            file_name,
            file_type,
            analysis.get("extracted_text", ""),
            json.dumps(anomalies),
            admin_summary,
            patient_summary,
            admin_summary,
            base_risk,
            source_hospital,
        ),
    )
    report_id = cur.lastrowid

    triage_bundle = _build_triage_bundle(
        patient_id,
        report_id,
        analysis,
        patient["assigned_doctor_id"],
    )
    final_risk = triage_bundle.get("risk_level") or base_risk
    patient_summary = _patient_safe_summary(admin_summary, final_risk)

    cur.execute(
        """
        UPDATE reports
        SET risk_level = ?,
            ai_summary_patient = ?,
            ai_summary_admin = ?,
            ai_summary = ?
        WHERE id = ?
        """,
        (final_risk, patient_summary, admin_summary, admin_summary, report_id),
    )

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

    if final_risk == "critical":
        cur.execute(
            """
            INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
            VALUES (?, ?, 'report_anomaly', ?, 'critical', 'admin')
            """,
            (
                patient_id,
                report_id,
                "Critical report flagged. Admin review required before doctor release.",
            ),
        )

        cur.execute(
            """
            INSERT INTO report_escalations (
                report_id, patient_id, doctor_id, risk_level,
                admin_summary, patient_safe_summary, triage_json, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_admin')
            ON CONFLICT(report_id) DO UPDATE SET
                doctor_id = excluded.doctor_id,
                risk_level = excluded.risk_level,
                admin_summary = excluded.admin_summary,
                patient_safe_summary = excluded.patient_safe_summary,
                triage_json = excluded.triage_json,
                status = 'pending_admin'
            """,
            (
                report_id,
                patient_id,
                patient["assigned_doctor_id"],
                final_risk,
                admin_summary,
                patient_summary,
                json.dumps(triage_bundle),
            ),
        )
    elif final_risk == "urgent":
        cur.execute(
            """
            INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
            VALUES (?, ?, 'report_anomaly', ?, 'warning', 'doctor')
            """,
            (
                patient_id,
                report_id,
                "Urgent report uploaded. Review recommended.",
            ),
        )

        cur.execute(
            """
            INSERT INTO report_escalations (
                report_id, patient_id, doctor_id, risk_level,
                admin_summary, patient_safe_summary, triage_json, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'released_to_doctor')
            ON CONFLICT(report_id) DO UPDATE SET
                doctor_id = excluded.doctor_id,
                risk_level = excluded.risk_level,
                admin_summary = excluded.admin_summary,
                patient_safe_summary = excluded.patient_safe_summary,
                triage_json = excluded.triage_json,
                status = 'released_to_doctor'
            """,
            (
                report_id,
                patient_id,
                patient["assigned_doctor_id"],
                final_risk,
                admin_summary,
                patient_summary,
                json.dumps(triage_bundle),
            ),
        )

    ambulance_dispatch: Dict[str, Any] | None = None
    if (
        auto_dispatch_ambulance
        and final_risk == "critical"
        and triage_bundle.get("ambulance_recommended")
        and latitude is not None
        and longitude is not None
    ):
        from mcp_server import create_ambulance_dispatch

        ambulance_dispatch = create_ambulance_dispatch(
            patient_id=patient_id,
            latitude=float(latitude),
            longitude=float(longitude),
            severity="critical",
            report_id=report_id,
            requested_by_role="patient",
            requested_by_id=uploader_id,
            notes="Auto-dispatch requested from patient upload flow.",
        )

        if ambulance_dispatch.get("status") == "dispatched":
            cur.execute(
                """
                INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
                VALUES (?, ?, 'ambulance_dispatch', ?, 'critical', 'admin')
                """,
                (
                    patient_id,
                    report_id,
                    f"Ambulance {ambulance_dispatch.get('ambulance', {}).get('unit_name', 'unit')} dispatched.",
                ),
            )

    conn.commit()
    conn.close()

    patient_visible_anomalies = anomalies if final_risk != "critical" else []

    return {
        "ok": True,
        "report_id": report_id,
        "summary": patient_summary,
        "anomalies": patient_visible_anomalies,
        "has_critical": final_risk == "critical",
        "risk_level": final_risk,
        "routed_to_admin": final_risk == "critical",
        "triage": {
            "suggested_esi": triage_bundle.get("suggested_esi"),
            "ambulance_recommended": triage_bundle.get("ambulance_recommended"),
        },
        "ambulance_dispatch": ambulance_dispatch,
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


@app.get("/api/admin/critical-queue")
def get_admin_critical_queue(status: str = "pending_admin") -> Any:
    """Admin-only queue for critical reports before release to doctor."""
    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    where_clause = ""
    params: List[Any] = []
    normalized_status = (status or "pending_admin").strip().lower()
    if normalized_status != "all":
        where_clause = "WHERE rs.status = ?"
        params.append(normalized_status)

    rows = cur.execute(
        f"""
        SELECT rs.id AS escalation_id,
               rs.report_id,
               rs.patient_id,
               rs.doctor_id,
               rs.risk_level,
               rs.admin_summary,
               rs.patient_safe_summary,
               rs.triage_json,
               rs.status,
               rs.created_at,
               r.file_path,
               pu.name AS patient_name,
               du.name AS doctor_name
        FROM report_escalations rs
        JOIN reports r ON r.id = rs.report_id
        JOIN patients p ON p.id = rs.patient_id
        JOIN users pu ON pu.id = p.user_id
        LEFT JOIN users du ON du.id = rs.doctor_id
        {where_clause}
        ORDER BY
            CASE rs.risk_level
                WHEN 'critical' THEN 1
                WHEN 'urgent' THEN 2
                ELSE 3
            END,
            rs.created_at DESC
        """,
        tuple(params),
    ).fetchall()
    conn.close()

    queue = []
    for row in rows:
        triage = _extract_json_from_text(row["triage_json"] or "{}")
        queue.append(
            {
                "escalation_id": row["escalation_id"],
                "report_id": row["report_id"],
                "patient_id": row["patient_id"],
                "patient_name": row["patient_name"],
                "doctor_id": row["doctor_id"],
                "doctor_name": row["doctor_name"],
                "risk_level": row["risk_level"],
                "status": row["status"],
                "report_name": row["file_path"],
                "admin_summary": row["admin_summary"],
                "patient_safe_summary": row["patient_safe_summary"],
                "suggested_esi": triage.get("suggested_esi"),
                "ambulance_recommended": triage.get("ambulance_recommended", False),
                "doctor_actions": triage.get("doctor_actions") or [],
                "created_at": row["created_at"],
            }
        )

    return {
        "status_filter": normalized_status,
        "total": len(queue),
        "critical_count": len([q for q in queue if q["risk_level"] == "critical"]),
        "queue": queue,
    }


@app.post("/api/admin/release-report/{report_id}")
async def admin_release_report(report_id: int, request: Request) -> Any:
    """Release an admin-reviewed critical report to the assigned doctor."""
    payload = await request.json()
    admin_id = payload.get("admin_id")
    message = (
        payload.get("message")
        or "Admin reviewed a critical report. Immediate doctor action required."
    )

    from db import get_db

    conn = get_db()
    cur = conn.cursor()

    escalation = cur.execute(
        """
        SELECT id, patient_id, doctor_id, status
        FROM report_escalations
        WHERE report_id = ?
        LIMIT 1
        """,
        (report_id,),
    ).fetchone()
    if escalation is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Escalation not found for report")

    cur.execute(
        """
        UPDATE report_escalations
        SET status = 'released_to_doctor',
            reviewed_by_admin_id = ?,
            released_to_doctor_at = ?
        WHERE report_id = ?
        """,
        (admin_id, datetime.now().isoformat(), report_id),
    )

    if escalation["doctor_id"]:
        cur.execute(
            """
            INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
            VALUES (?, ?, 'admin_release', ?, 'critical', 'doctor')
            """,
            (
                escalation["patient_id"],
                report_id,
                message,
            ),
        )

    conn.commit()
    conn.close()

    return {
        "ok": True,
        "report_id": report_id,
        "released": True,
        "doctor_id": escalation["doctor_id"],
    }


@app.get("/api/doctor/urgent-requests/{doctor_id}")
def get_doctor_urgent_requests(doctor_id: int) -> Any:
    """Doctor feed enriched by MCP + Gemini + Groq triage results."""
    from db import get_db

    conn = get_db()
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT rs.report_id,
               rs.patient_id,
               rs.risk_level,
               rs.triage_json,
               rs.created_at,
               r.file_path,
               pu.name AS patient_name
        FROM report_escalations rs
        JOIN reports r ON r.id = rs.report_id
        JOIN patients p ON p.id = rs.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE rs.doctor_id = ?
          AND rs.status = 'released_to_doctor'
        ORDER BY
            CASE rs.risk_level
                WHEN 'critical' THEN 1
                WHEN 'urgent' THEN 2
                ELSE 3
            END,
            rs.created_at DESC
        LIMIT 20
        """,
        (doctor_id,),
    ).fetchall()
    conn.close()

    requests: List[Dict[str, Any]] = []
    ai_suggestions: List[str] = []
    for row in rows:
        triage = _extract_json_from_text(row["triage_json"] or "{}")
        doctor_actions = triage.get("doctor_actions") or []
        groq_steps = (triage.get("groq") or {}).get("first_10_minutes") or []
        combined_actions = [
            str(x) for x in doctor_actions + groq_steps if str(x).strip()
        ]
        ai_suggestions.extend(combined_actions)

        requests.append(
            {
                "report_id": row["report_id"],
                "patient_id": row["patient_id"],
                "patient_name": row["patient_name"],
                "report_name": row["file_path"],
                "risk_level": row["risk_level"],
                "suggested_esi": triage.get("suggested_esi", 3),
                "ambulance_recommended": triage.get("ambulance_recommended", False),
                "doctor_actions": combined_actions[:5],
                "created_at": row["created_at"],
            }
        )

    # Deduplicate while preserving order.
    seen = set()
    compact_suggestions = []
    for suggestion in ai_suggestions:
        key = suggestion.lower().strip()
        if key and key not in seen:
            seen.add(key)
            compact_suggestions.append(suggestion)

    return {
        "doctor_id": doctor_id,
        "urgent_count": len(requests),
        "requests": requests,
        "ai_suggestions": compact_suggestions[:8],
        "providers": {
            "router": "SensitivityAwareRouter"
        },
    }


@app.get("/api/ambulance/nearby")
def get_nearby_ambulances(latitude: float, longitude: float, limit: int = 5) -> Any:
    """List nearest available ambulances for map/location use-cases."""
    from mcp_server import list_nearby_ambulances

    return list_nearby_ambulances(latitude, longitude, max(1, min(limit, 10)))


@app.post("/api/ambulance/dispatch")
async def dispatch_ambulance(request: Request) -> Any:
    """Dispatch nearest ambulance based on patient latitude/longitude."""
    payload = await request.json()
    patient_id = payload.get("patient_id")
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    severity = (payload.get("severity") or "urgent").strip().lower()
    report_id = payload.get("report_id")
    requested_by_role = (payload.get("requested_by_role") or "system").strip().lower()
    requested_by_id = payload.get("requested_by_id")
    notes = payload.get("notes") or ""

    if patient_id is None or latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail="patient_id, latitude, and longitude are required",
        )

    from mcp_server import create_ambulance_dispatch

    dispatch_result = create_ambulance_dispatch(
        patient_id=int(patient_id),
        latitude=float(latitude),
        longitude=float(longitude),
        severity=severity,
        report_id=report_id,
        requested_by_role=requested_by_role,
        requested_by_id=requested_by_id,
        notes=notes,
    )

    if dispatch_result.get("status") == "dispatched":
        from db import get_db

        conn = get_db()
        cur = conn.cursor()

        doctor_row = cur.execute(
            "SELECT assigned_doctor_id FROM patients WHERE id = ?",
            (patient_id,),
        ).fetchone()
        assigned_doctor_id = doctor_row["assigned_doctor_id"] if doctor_row else None

        admin_message = (
            f"Ambulance {dispatch_result.get('ambulance', {}).get('unit_name', 'unit')} "
            f"dispatched for patient #{patient_id}. ETA {dispatch_result.get('eta_minutes')} min."
        )
        cur.execute(
            """
            INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
            VALUES (?, ?, 'ambulance_dispatch', ?, ?, 'admin')
            """,
            (
                patient_id,
                report_id,
                admin_message,
                "critical" if severity == "critical" else "warning",
            ),
        )

        if assigned_doctor_id:
            cur.execute(
                """
                INSERT INTO alerts (patient_id, report_id, alert_type, message, severity, target_role)
                VALUES (?, ?, 'ambulance_dispatch', ?, ?, 'doctor')
                """,
                (
                    patient_id,
                    report_id,
                    admin_message,
                    "critical" if severity == "critical" else "warning",
                ),
            )

        conn.commit()
        conn.close()

    return dispatch_result


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
        # Route to OPENAI for complex document reasoning
        payload = {
            "system": "Return plain text bullets, one per line, each starting with '- '.",
            "prompt": prompt,
            "json_mode": False
        }
        res = router.route_request("BATCH", "LOW", "HIGH", payload)
        summary_text = (res.get("content", "") or "").strip()
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
