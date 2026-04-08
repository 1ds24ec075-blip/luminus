import os
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import OpenAI
import uvicorn

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend-ui"

app = FastAPI(title="Luminus API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

# In-memory conversation state keyed by patient session.
SESSIONS: Dict[str, Dict[str, Any]] = {}
MAX_HISTORY_MESSAGES = 16


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


@app.get("/")
def serve_frontend() -> Any:
    return FileResponse(FRONTEND_DIR / "index.html")


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
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
