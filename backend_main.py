"""
╔══════════════════════════════════════════════════════════════╗
║         MediCore AI — Complete Backend (main.py)             ║
║   MCP-powered Hospital Intelligence Platform                 ║
║   FastAPI + LangGraph + SQLite + Redis + Chroma              ║
╚══════════════════════════════════════════════════════════════╝

INSTALL DEPENDENCIES:
pip install fastapi uvicorn sqlalchemy redis chromadb \
            anthropic langchain langgraph sentence-transformers \
            python-dotenv pydantic httpx openai faster-whisper \
            python-multipart websockets apscheduler

RUN:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

# ─────────────────────────────────────────────────────────────
# IMPORTS
# ─────────────────────────────────────────────────────────────
import os, json, time, math, uuid, asyncio, logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

import anthropic
import google.generativeai as genai
import sqlite3
import redis
import chromadb
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medicore")

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_API_KEY      = os.getenv("GOOGLE_API_KEY", "")
AI_PROVIDER         = os.getenv("AI_PROVIDER", "gemini") # "gemini" | "anthropic"

CLINICAL_DB         = os.getenv("CLINICAL_DB_PATH", "./data/clinical.db")
SCHEDULING_DB       = os.getenv("SCHEDULING_DB_PATH", "./data/scheduling.db")
OPERATIONS_DB       = os.getenv("OPERATIONS_DB_PATH", "./data/operations.db")
CHROMA_DIR          = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
CHROMA_COLLECTION   = os.getenv("CHROMA_COLLECTION_NAME", "mental_health_sessions")
REDIS_HOST          = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT          = int(os.getenv("REDIS_PORT", 6379))
DEFAULT_CITY        = os.getenv("DEFAULT_CITY", "bengaluru")

# Models
CLAUDE_MODEL        = "claude-sonnet-4-20250514"
GEMINI_MODEL        = "gemini-1.5-flash"

# ─────────────────────────────────────────────────────────────
# AI CLIENTS
# ─────────────────────────────────────────────────────────────
claude_client = None
if ANTHROPIC_API_KEY:
    claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)
    redis_client.ping()
    REDIS_AVAILABLE = True
    logger.info("✅ Redis connected")
except Exception:
    redis_client = None
    REDIS_AVAILABLE = False
    logger.warning("⚠️  Redis unavailable — using in-memory context store")

chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
mental_health_collection = chroma_client.get_or_create_collection(CHROMA_COLLECTION)

# In-memory fallback context store
_mem_context: Dict[str, str] = {}

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active.append(ws)
    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)
    async def broadcast(self, data: dict):
        for ws in self.active:
            try: await ws.send_json(data)
            except: pass

manager = ConnectionManager()
scheduler = AsyncIOScheduler()

# ─────────────────────────────────────────────────────────────
# DATABASE HELPERS
# ─────────────────────────────────────────────────────────────
def get_db(path: str):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn

def query_db(path: str, sql: str, params: tuple = ()) -> List[Dict]:
    with get_db(path) as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

def execute_db(path: str, sql: str, params: tuple = ()):
    with get_db(path) as conn:
        conn.execute(sql, params)
        conn.commit()

# ─────────────────────────────────────────────────────────────
# MCP CONTEXT BUS
# ─────────────────────────────────────────────────────────────
class MCPContextBus:
    """
    Central shared context store for all agents.
    Uses Redis when available, falls back to in-memory dict.
    """
    PREFIX = "mcp:patient:"

    def get(self, patient_id: str) -> dict:
        key = f"{self.PREFIX}{patient_id}"
        if REDIS_AVAILABLE:
            raw = redis_client.get(key)
            return json.loads(raw) if raw else self._default(patient_id)
        return json.loads(_mem_context.get(key, "null")) or self._default(patient_id)

    def set(self, patient_id: str, ctx: dict):
        key = f"{self.PREFIX}{patient_id}"
        raw = json.dumps(ctx)
        if REDIS_AVAILABLE:
            redis_client.setex(key, 86400, raw)
        else:
            _mem_context[key] = raw

    def update(self, patient_id: str, patch: dict):
        ctx = self.get(patient_id)
        ctx.update(patch)
        ctx["last_updated"] = datetime.utcnow().isoformat()
        self.set(patient_id, ctx)

    def _default(self, patient_id: str) -> dict:
        return {
            "patient_id": patient_id,
            "vitals_history": [],
            "lab_results": [],
            "consultation_notes": [],
            "mental_health_sessions": [],
            "medications": [],
            "diagnoses": [],
            "alerts": [],
            "appointments": [],
            "scheme_eligibility": {},
            "readmission_risk": None,
            "esi_score": None,
            "language_preference": "english",
            "last_updated": datetime.utcnow().isoformat(),
            "model_status": "cloud"   # "cloud" | "local" — shown in UI
        }

mcp = MCPContextBus()

# ─────────────────────────────────────────────────────────────
# AI AGENT BASE (Unified Multi-Provider)
# ─────────────────────────────────────────────────────────────
def call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    """Unified AI caller that routes to Gemini or Claude."""
    try:
        if AI_PROVIDER == "gemini":
            if not GOOGLE_API_KEY:
                return json.dumps({"error": "GOOGLE_API_KEY missing in .env"})
            model = genai.GenerativeModel(
                model_name=GEMINI_MODEL,
                system_instruction=system
            )
            response = model.generate_content(user)
            return response.text
        
        else: # Default to Anthropic
            if not ANTHROPIC_API_KEY:
                return json.dumps({"error": "ANTHROPIC_API_KEY missing in .env"})
            response = claude_client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}]
            )
            return response.content[0].text
            
    except Exception as e:
        logger.error(f"AI API error ({AI_PROVIDER}): {e}")
        return json.dumps({"error": str(e)})

def call_ai_json(system: str, user: str, max_tokens: int = 2000) -> dict:
    """Unified AI caller that returns structured JSON."""
    instr = system + "\n\nCRITICAL: Respond ONLY with valid JSON. No markdown, no backticks, no preamble."
    raw = call_ai(instr, user, max_tokens)
    try:
        # Robust JSON cleaning
        clean = raw.strip()
        if "```json" in clean:
            clean = clean.split("```json")[1].split("```")[0].strip()
        elif "```" in clean:
            clean = clean.split("```")[1].split("```")[0].strip()
        return json.loads(clean)
    except Exception:
        return {"error": "JSON parse failed", "raw": raw}

# Backward compatibility aliases for existing agents
call_claude = call_ai
call_claude_json = call_ai_json

# ─────────────────────────────────────────────────────────────
# AGENT 1: VITALS AGENT
# ─────────────────────────────────────────────────────────────
class VitalsAgent:
    SYSTEM = """You are a critical care vitals monitoring AI.
    Analyze patient vitals and return structured JSON with:
    - anomalies: list of detected issues
    - severity: "critical"|"warning"|"normal"
    - recommendations: list of immediate actions
    - trend: "improving"|"stable"|"deteriorating"
    - confidence: 0-100
    Include brief reasoning for each finding."""

    def analyze(self, patient_id: str, vitals: dict) -> dict:
        ctx = mcp.get(patient_id)
        history = ctx.get("vitals_history", [])[-10:]  # last 10 readings
        result = call_claude_json(
            self.SYSTEM,
            f"Current vitals: {json.dumps(vitals)}\nHistory: {json.dumps(history)}\nPatient: {patient_id}"
        )
        # Update context
        vitals["timestamp"] = datetime.utcnow().isoformat()
        vitals["analysis"] = result
        history.append(vitals)
        mcp.update(patient_id, {"vitals_history": history[-50:]})
        if result.get("severity") in ["critical", "warning"]:
            self._fire_alert(patient_id, result)
        return result

    def _fire_alert(self, patient_id: str, analysis: dict):
        ctx = mcp.get(patient_id)
        alerts = ctx.get("alerts", [])
        alerts.append({
            "id": str(uuid.uuid4()),
            "patient_id": patient_id,
            "type": "vitals",
            "severity": analysis.get("severity"),
            "message": str(analysis.get("anomalies", [])),
            "timestamp": datetime.utcnow().isoformat(),
            "acknowledged": False
        })
        mcp.update(patient_id, {"alerts": alerts[-20:]})
        execute_db(OPERATIONS_DB,
            "INSERT INTO alerts (id, patient_id, type, severity, message, timestamp) VALUES (?,?,?,?,?,?)",
            (alerts[-1]["id"], patient_id, "vitals", analysis.get("severity"),
             str(analysis.get("anomalies", [])), alerts[-1]["timestamp"]))

vitals_agent = VitalsAgent()

# ─────────────────────────────────────────────────────────────
# AGENT 2: CLINICAL CO-PILOT AGENT
# ─────────────────────────────────────────────────────────────
class ClinicalAgent:
    SOAP_SYSTEM = """You are a senior physician AI co-pilot for Indian hospitals.
    Generate a complete SOAP note and return JSON with:
    - subjective: patient's complaints in their own words
    - objective: vitals, exam findings
    - assessment: differential diagnoses (top 3) with confidence %
    - plan: immediate actions, medications, follow-up
    - icd10_codes: list of {code, description, confidence}
    - cpt_codes: list of {code, description}
    - billing_level: E/M level (99211-99215)
    - referral_needed: boolean
    - referral_specialty: if needed
    - confidence_overall: 0-100
    - reasoning: brief explanation"""

    NLP_SQL_SYSTEM = """You are a hospital database expert. Convert natural language to SQLite SQL.
    Available tables: patients, vitals, appointments, medications, diagnoses, lab_results, encounters.
    Return JSON: { "sql": "SELECT ...", "explanation": "...", "chart_type": "bar|line|pie|table" }
    Only SELECT statements. Never modify data."""

    def generate_soap(self, patient_id: str, consultation_text: str) -> dict:
        ctx = mcp.get(patient_id)
        result = call_claude_json(
            self.SOAP_SYSTEM,
            f"""Patient context: {json.dumps({
                'vitals': ctx.get('vitals_history', [])[-1:],
                'medications': ctx.get('medications', []),
                'diagnoses': ctx.get('diagnoses', []),
                'lab_results': ctx.get('lab_results', [])[-5:]
            })}
            Consultation transcript: {consultation_text}"""
        )
        notes = ctx.get("consultation_notes", [])
        notes.append({"timestamp": datetime.utcnow().isoformat(), "soap": result, "raw": consultation_text})
        mcp.update(patient_id, {"consultation_notes": notes[-20:]})
        # Save to DB
        execute_db(CLINICAL_DB,
            "INSERT OR REPLACE INTO consultation_notes (id, patient_id, soap_json, created_at) VALUES (?,?,?,?)",
            (str(uuid.uuid4()), patient_id, json.dumps(result), datetime.utcnow().isoformat()))
        return result

    def nl_to_sql(self, question: str) -> dict:
        return call_claude_json(self.NLP_SQL_SYSTEM, f"Question: {question}")

    def execute_nl_query(self, question: str, db_path: str = None) -> dict:
        sql_result = self.nl_to_sql(question)
        if "error" in sql_result:
            return sql_result
        sql = sql_result.get("sql", "")
        if not sql.strip().upper().startswith("SELECT"):
            return {"error": "Only SELECT queries allowed"}
        target_db = db_path or CLINICAL_DB
        try:
            rows = query_db(target_db, sql)
            return {
                "sql": sql,
                "explanation": sql_result.get("explanation"),
                "chart_type": sql_result.get("chart_type", "table"),
                "data": rows,
                "row_count": len(rows)
            }
        except Exception as e:
            return {"error": str(e), "sql": sql}

clinical_agent = ClinicalAgent()

# ─────────────────────────────────────────────────────────────
# AGENT 3: MENTAL HEALTH AGENT
# ─────────────────────────────────────────────────────────────
class MentalHealthAgent:
    SESSION_SYSTEM = """You are a compassionate mental health AI analyst.
    Analyze the therapy session and return JSON:
    - mood_score: 1-10 (1=crisis, 10=excellent)
    - primary_emotions: list
    - risk_level: "none"|"low"|"moderate"|"high"|"crisis"
    - themes: list of recurring themes
    - progress_vs_last: "regressed"|"same"|"improved"
    - crisis_indicators: list of specific phrases/signals
    - recommendations: list for therapist
    - follow_up_urgency: "routine"|"soon"|"urgent"|"immediate"
    - confidence: 0-100"""

    def analyze_session(self, patient_id: str, session_text: str, session_id: str = None) -> dict:
        sid = session_id or str(uuid.uuid4())
        ctx = mcp.get(patient_id)
        prev_sessions = ctx.get("mental_health_sessions", [])[-5:]

        result = call_claude_json(
            self.SESSION_SYSTEM,
            f"Previous sessions summary: {json.dumps([s.get('analysis', {}) for s in prev_sessions])}\n"
            f"Current session: {session_text}"
        )

        # Store in Chroma for semantic search
        mental_health_collection.upsert(
            documents=[session_text],
            metadatas=[{"patient_id": patient_id, "session_id": sid,
                        "timestamp": datetime.utcnow().isoformat(),
                        "risk_level": result.get("risk_level", "none"),
                        "mood_score": str(result.get("mood_score", 5))}],
            ids=[sid]
        )

        session_record = {"session_id": sid, "timestamp": datetime.utcnow().isoformat(),
                          "analysis": result, "text_preview": session_text[:200]}
        prev_sessions.append(session_record)
        mcp.update(patient_id, {"mental_health_sessions": prev_sessions[-20:]})

        if result.get("risk_level") in ["high", "crisis"]:
            self._escalate(patient_id, result)
        return result

    def search_similar_sessions(self, patient_id: str, query: str, n: int = 3) -> list:
        results = mental_health_collection.query(
            query_texts=[query],
            where={"patient_id": patient_id},
            n_results=min(n, mental_health_collection.count() or 1)
        )
        return results.get("documents", [[]])[0]

    def _escalate(self, patient_id: str, analysis: dict):
        ctx = mcp.get(patient_id)
        alerts = ctx.get("alerts", [])
        alerts.append({
            "id": str(uuid.uuid4()), "patient_id": patient_id,
            "type": "mental_health_crisis", "severity": "critical",
            "message": f"Crisis indicators: {analysis.get('crisis_indicators', [])}",
            "timestamp": datetime.utcnow().isoformat(), "acknowledged": False
        })
        mcp.update(patient_id, {"alerts": alerts})

mental_health_agent = MentalHealthAgent()

# ─────────────────────────────────────────────────────────────
# AGENT 4: RURAL ACCESS AGENT
# ─────────────────────────────────────────────────────────────
class RuralAccessAgent:
    TRIAGE_SYSTEM = """You are a rural healthcare triage AI for Indian patients.
    Return JSON:
    - esi_score: 1-5 (1=immediate, 5=non-urgent)
    - esi_label: "Immediate"|"Emergent"|"Urgent"|"Less Urgent"|"Non-Urgent"
    - suspected_conditions: list with confidence %
    - recommended_specialty: string
    - needs_ambulance: boolean
    - needs_hospitalization: boolean
    - pmjay_likely_covered: boolean
    - language_instructions: simple instructions in patient's language
    - facility_type_needed: "PHC"|"CHC"|"District Hospital"|"Tertiary"
    - confidence: 0-100"""

    SCHEME_SYSTEM = """You are an Indian government healthcare scheme expert.
    Based on the patient profile, return JSON:
    - eligible_schemes: list of {name, coverage, how_to_apply}
    - pmjay_eligible: boolean
    - annual_coverage_inr: number
    - nearest_empanelled_hospitals: list (mock data ok)
    - application_steps: list"""

    def triage(self, patient_id: str, symptoms: str, language: str = "english") -> dict:
        ctx = mcp.get(patient_id)
        result = call_claude_json(
            self.TRIAGE_SYSTEM,
            f"Symptoms: {symptoms}\nLanguage: {language}\n"
            f"Patient history: {json.dumps(ctx.get('diagnoses', []))}"
        )
        mcp.update(patient_id, {
            "esi_score": result.get("esi_score"),
            "language_preference": language
        })
        return result

    def check_scheme_eligibility(self, patient_profile: dict) -> dict:
        return call_claude_json(
            self.SCHEME_SYSTEM,
            f"Patient profile: {json.dumps(patient_profile)}\nCity: {DEFAULT_CITY}"
        )

    def find_facilities(self, lat: float, lng: float, specialty: str) -> list:
        # Mock facility data — replace with real API in production
        facilities = [
            {"name": "NIMHANS", "type": "Tertiary", "distance_km": 3.2, "specialty": specialty,
             "beds_available": 12, "wait_time_mins": 20, "pmjay_empanelled": True,
             "lat": 12.9427, "lng": 77.5966},
            {"name": "Bowring Hospital", "type": "District Hospital", "distance_km": 5.1,
             "specialty": specialty, "beds_available": 8, "wait_time_mins": 45,
             "pmjay_empanelled": True, "lat": 12.9780, "lng": 77.6038},
            {"name": "Victoria Hospital", "type": "Tertiary", "distance_km": 6.8,
             "specialty": specialty, "beds_available": 3, "wait_time_mins": 60,
             "pmjay_empanelled": True, "lat": 12.9706, "lng": 77.5731}
        ]
        return sorted(facilities, key=lambda x: x["distance_km"])

rural_agent = RuralAccessAgent()

# ─────────────────────────────────────────────────────────────
# AGENT 5: SCHEDULING AGENT
# ─────────────────────────────────────────────────────────────
class SchedulingAgent:
    def get_available_doctors(self, specialty: str, date: str = None, esi_score: int = 5) -> list:
        target_date = date or datetime.utcnow().strftime("%Y-%m-%d")
        doctors = query_db(SCHEDULING_DB,
            """SELECT d.*, 
               (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id AND DATE(a.scheduled_at) = ?) as today_count
               FROM doctors d WHERE d.specialty LIKE ? AND d.status = 'available'
               ORDER BY today_count ASC LIMIT 10""",
            (target_date, f"%{specialty}%"))
        # Filter by ESI — critical patients get on-call doctors too
        if esi_score <= 2:
            on_call = query_db(SCHEDULING_DB,
                "SELECT * FROM doctors WHERE on_call = 1 AND specialty LIKE ?",
                (f"%{specialty}%",))
            doctors = on_call + doctors
        return doctors

    def book_appointment(self, patient_id: str, doctor_id: str,
                          scheduled_at: str, reason: str, esi_score: int = 5) -> dict:
        appt_id = str(uuid.uuid4())
        execute_db(SCHEDULING_DB,
            "INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, reason, esi_score, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (appt_id, patient_id, doctor_id, scheduled_at, reason, esi_score, "confirmed", datetime.utcnow().isoformat()))
        ctx = mcp.get(patient_id)
        appts = ctx.get("appointments", [])
        appts.append({"id": appt_id, "doctor_id": doctor_id, "scheduled_at": scheduled_at,
                      "reason": reason, "status": "confirmed"})
        mcp.update(patient_id, {"appointments": appts})
        return {"appointment_id": appt_id, "status": "confirmed",
                "scheduled_at": scheduled_at, "doctor_id": doctor_id}

    def dispatch_ambulance(self, patient_id: str, lat: float, lng: float,
                            esi_score: int = 1, condition: str = "") -> dict:
        # Find nearest available ambulance
        ambulances = query_db(SCHEDULING_DB,
            "SELECT * FROM ambulances WHERE status = 'available' ORDER BY RANDOM() LIMIT 5")
        if not ambulances:
            return {"error": "No ambulances available", "eta_mins": None}

        # Mock distance calculation (replace with Maps API)
        def distance(a):
            dlat = (a.get("current_lat", 12.97) - lat)
            dlng = (a.get("current_lng", 77.59) - lng)
            return math.sqrt(dlat**2 + dlng**2) * 111  # rough km

        nearest = min(ambulances, key=distance)
        dist_km = round(distance(nearest), 1)
        eta = max(5, int(dist_km * 3))  # ~20 km/h urban speed

        execute_db(SCHEDULING_DB,
            "UPDATE ambulances SET status='en_route', current_patient_id=?, dispatch_time=? WHERE id=?",
            (patient_id, datetime.utcnow().isoformat(), nearest["id"]))

        dispatch_record = {
            "ambulance_id": nearest["id"],
            "crew": nearest.get("crew", "EMT Team"),
            "eta_mins": eta,
            "distance_km": dist_km,
            "status": "dispatched",
            "timestamp": datetime.utcnow().isoformat()
        }
        mcp.update(patient_id, {"ambulance_dispatch": dispatch_record,
                                 "alerts": mcp.get(patient_id).get("alerts", []) + [{
                                     "type": "ambulance_dispatched", "severity": "info",
                                     "message": f"Ambulance {nearest['id']} dispatched, ETA {eta} mins",
                                     "timestamp": datetime.utcnow().isoformat()}]})
        return dispatch_record

    def get_bed_status(self) -> dict:
        beds = query_db(SCHEDULING_DB,
            "SELECT ward, SUM(total) as total, SUM(occupied) as occupied FROM beds GROUP BY ward")
        return {b["ward"]: {"total": b["total"], "occupied": b["occupied"],
                            "available": b["total"] - b["occupied"],
                            "occupancy_pct": round(b["occupied"]/b["total"]*100, 1) if b["total"] > 0 else 0}
                for b in beds}

    def readmission_risk(self, patient_id: str) -> dict:
        ctx = mcp.get(patient_id)
        SYSTEM = """Assess 30-day readmission risk. Return JSON:
        { "risk_score": 0-100, "risk_label": "low|moderate|high",
          "top_factors": list, "recommendations": list,
          "follow_up_days": number }"""
        result = call_claude_json(SYSTEM,
            f"Patient context: {json.dumps({'diagnoses': ctx.get('diagnoses', []),
             'medications': ctx.get('medications', []),
             'vitals_trend': ctx.get('vitals_history', [])[-5:],
             'mental_health': [s.get('analysis', {}).get('mood_score') for s in ctx.get('mental_health_sessions', [])[-3:]]})}")
        mcp.update(patient_id, {"readmission_risk": result})
        return result

scheduling_agent = SchedulingAgent()

# ─────────────────────────────────────────────────────────────
# ORCHESTRATOR
# ─────────────────────────────────────────────────────────────
class OrchestratorAgent:
    """Routes patient events to the right agents and maintains unified context."""

    async def handle_patient_arrival(self, patient_id: str, symptoms: str,
                                      language: str = "english", lat: float = 12.97, lng: float = 77.59) -> dict:
        """Full arrival pipeline: triage → doctor match → dispatch if needed → bed pre-alloc"""
        logger.info(f"🏥 Patient arrival: {patient_id}")

        # Step 1: Triage
        triage = rural_agent.triage(patient_id, symptoms, language)
        esi = triage.get("esi_score", 5)

        result = {"patient_id": patient_id, "triage": triage, "actions": []}

        # Step 2: Dispatch ambulance for ESI 1-2
        if esi <= 2 or triage.get("needs_ambulance"):
            dispatch = scheduling_agent.dispatch_ambulance(patient_id, lat, lng, esi, symptoms)
            result["ambulance"] = dispatch
            result["actions"].append("ambulance_dispatched")

        # Step 3: Find and book doctor
        specialty = triage.get("recommended_specialty", "General Medicine")
        doctors = scheduling_agent.get_available_doctors(specialty, esi_score=esi)
        if doctors:
            doctor = doctors[0]
            slot_time = (datetime.utcnow() + timedelta(minutes=10 if esi <= 2 else 30)).isoformat()
            booking = scheduling_agent.book_appointment(patient_id, doctor["id"], slot_time, symptoms, esi)
            result["appointment"] = booking
            result["doctor"] = {"id": doctor["id"], "name": doctor.get("name"), "specialty": doctor.get("specialty")}
            result["actions"].append("appointment_booked")

        # Step 4: Check scheme eligibility
        patient_info = query_db(CLINICAL_DB, "SELECT * FROM patients WHERE id = ?", (patient_id,))
        if patient_info:
            eligibility = rural_agent.check_scheme_eligibility(patient_info[0])
            result["scheme_eligibility"] = eligibility
            mcp.update(patient_id, {"scheme_eligibility": eligibility})

        # Step 5: Recommend facilities
        result["nearby_facilities"] = rural_agent.find_facilities(lat, lng, specialty)

        # Broadcast to WebSocket
        await manager.broadcast({"event": "patient_arrival", "data": result})
        return result

    async def full_patient_journey_demo(self, patient_id: str = "DEMO-001") -> dict:
        """The hackathon demo: one patient, all agents firing in sequence"""
        journey = {}

        # 1. Arrival with chest pain
        journey["arrival"] = await self.handle_patient_arrival(
            patient_id, "chest pain and sweating, difficulty breathing", "english", 12.97, 77.59)

        # 2. Vitals spike
        journey["vitals"] = vitals_agent.analyze(patient_id, {
            "heart_rate": 118, "bp_systolic": 92, "bp_diastolic": 58,
            "spo2": 91, "temperature": 37.8, "respiratory_rate": 24})

        # 3. SOAP note
        journey["soap"] = clinical_agent.generate_soap(patient_id,
            "Patient presents with crushing chest pain radiating to left arm, "
            "diaphoresis, nausea for 45 minutes. History of hypertension.")

        # 4. Mental health flag
        journey["mental_health"] = mental_health_agent.analyze_session(patient_id,
            "Patient appears extremely anxious, keeps saying 'I think I'm dying', "
            "family members distressed, patient asking about will.")

        # 5. Readmission risk
        journey["readmission_risk"] = scheduling_agent.readmission_risk(patient_id)

        # 6. Final unified context
        journey["unified_context"] = mcp.get(patient_id)

        await manager.broadcast({"event": "demo_complete", "data": {"patient_id": patient_id}})
        return journey

orchestrator = OrchestratorAgent()

# ─────────────────────────────────────────────────────────────
# BACKGROUND JOBS
# ─────────────────────────────────────────────────────────────
async def background_alert_check():
    """Runs every 60s — checks for threshold breaches across all active patients"""
    try:
        active = query_db(CLINICAL_DB,
            "SELECT DISTINCT id FROM patients WHERE status='admitted' LIMIT 50")
        for p in active:
            pid = p["id"]
            ctx = mcp.get(pid)
            vitals = ctx.get("vitals_history", [])
            if vitals:
                last = vitals[-1]
                if (last.get("spo2", 100) < 90 or
                    last.get("heart_rate", 70) > 130 or
                    last.get("bp_systolic", 120) > 180):
                    await manager.broadcast({
                        "event": "vitals_alert",
                        "data": {"patient_id": pid, "vitals": last,
                                 "timestamp": datetime.utcnow().isoformat()}})
    except Exception as e:
        logger.error(f"Alert check error: {e}")

# ─────────────────────────────────────────────────────────────
# FASTAPI APP
# ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(background_alert_check, "interval", seconds=60)
    scheduler.start()
    logger.info("🚀 MediCore AI Backend started")
    yield
    scheduler.shutdown()

app = FastAPI(title="MediCore AI", version="1.0.0",
              description="MCP-powered Hospital Intelligence Platform", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ─────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────
class VitalsInput(BaseModel):
    patient_id: str
    heart_rate: Optional[float] = None
    bp_systolic: Optional[float] = None
    bp_diastolic: Optional[float] = None
    spo2: Optional[float] = None
    temperature: Optional[float] = None
    respiratory_rate: Optional[float] = None
    glucose: Optional[float] = None

class ConsultationInput(BaseModel):
    patient_id: str
    text: str

class NLQueryInput(BaseModel):
    question: str
    db: Optional[str] = "clinical"

class SessionInput(BaseModel):
    patient_id: str
    session_text: str
    session_id: Optional[str] = None

class TriageInput(BaseModel):
    patient_id: str
    symptoms: str
    language: Optional[str] = "english"
    lat: Optional[float] = 12.9716
    lng: Optional[float] = 77.5946

class AppointmentInput(BaseModel):
    patient_id: str
    doctor_id: str
    scheduled_at: str
    reason: str
    esi_score: Optional[int] = 5

class AmbulanceDispatchInput(BaseModel):
    patient_id: str
    lat: float
    lng: float
    esi_score: Optional[int] = 1
    condition: Optional[str] = ""

class SchemeInput(BaseModel):
    patient_id: str
    age: Optional[int] = None
    income_annual: Optional[int] = None
    state: Optional[str] = "Karnataka"
    bpl_card: Optional[bool] = False

# ─────────────────────────────────────────────────────────────
# ROUTES — HEALTH
# ─────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"name": "MediCore AI", "status": "running", "version": "1.0.0",
            "agents": ["vitals", "clinical", "mental_health", "rural_access", "scheduler", "orchestrator"]}

@app.get("/health")
def health():
    return {"status": "ok", "redis": REDIS_AVAILABLE,
            "chroma_docs": mental_health_collection.count(),
            "model": GEMINI_MODEL if AI_PROVIDER == "gemini" else CLAUDE_MODEL, "timestamp": datetime.utcnow().isoformat()}

# ─────────────────────────────────────────────────────────────
# STATIC FILES (Serve Frontend dist)
# ─────────────────────────────────────────────────────────────
# This serves the React build from frontend/dist
# We use a custom exception handler for 404s to support React Router (SPA)
if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If the path looks like an API call or websocket, don't serve index.html
        # (Though those should be caught by their specific routes first)
        if full_path.startswith(("agents", "orchestrator", "dashboard", "mcp", "voice")):
            raise HTTPException(status_code=404, detail="API route not found")
        
        index_path = os.path.join("frontend/dist", "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "Frontend build not found. Run 'npm run build' in frontend folder."}

# ─────────────────────────────────────────────────────────────
# ROUTES — MCP CONTEXT
# ─────────────────────────────────────────────────────────────
@app.get("/mcp/context/{patient_id}")
def get_context(patient_id: str):
    return mcp.get(patient_id)

@app.delete("/mcp/context/{patient_id}")
def reset_context(patient_id: str):
    mcp.set(patient_id, mcp._default(patient_id))
    return {"status": "reset", "patient_id": patient_id}

# ─────────────────────────────────────────────────────────────
# ROUTES — VITALS AGENT
# ─────────────────────────────────────────────────────────────
@app.post("/agents/vitals/analyze")
def analyze_vitals(data: VitalsInput):
    vitals_dict = {k: v for k, v in data.dict().items() if k != "patient_id" and v is not None}
    return vitals_agent.analyze(data.patient_id, vitals_dict)

@app.get("/agents/vitals/history/{patient_id}")
def vitals_history(patient_id: str):
    ctx = mcp.get(patient_id)
    return {"patient_id": patient_id, "history": ctx.get("vitals_history", [])}

# ─────────────────────────────────────────────────────────────
# ROUTES — CLINICAL AGENT
# ─────────────────────────────────────────────────────────────
@app.post("/agents/clinical/soap")
def generate_soap(data: ConsultationInput):
    return clinical_agent.generate_soap(data.patient_id, data.text)

@app.post("/agents/clinical/query")
def nl_query(data: NLQueryInput):
    db_path = CLINICAL_DB if data.db == "clinical" else OPERATIONS_DB
    return clinical_agent.execute_nl_query(data.question, db_path)

@app.get("/agents/clinical/notes/{patient_id}")
def get_notes(patient_id: str):
    ctx = mcp.get(patient_id)
    return {"patient_id": patient_id, "notes": ctx.get("consultation_notes", [])}

@app.get("/agents/clinical/patients")
def list_patients(limit: int = 50, search: str = ""):
    if search:
        return query_db(CLINICAL_DB,
            "SELECT * FROM patients WHERE name LIKE ? OR id LIKE ? LIMIT ?",
            (f"%{search}%", f"%{search}%", limit))
    return query_db(CLINICAL_DB, "SELECT * FROM patients ORDER BY created_at DESC LIMIT ?", (limit,))

@app.get("/agents/clinical/patient/{patient_id}")
def get_patient(patient_id: str):
    patients = query_db(CLINICAL_DB, "SELECT * FROM patients WHERE id = ?", (patient_id,))
    if not patients:
        raise HTTPException(status_code=404, detail="Patient not found")
    patient = patients[0]
    patient["context"] = mcp.get(patient_id)
    return patient

# ─────────────────────────────────────────────────────────────
# ROUTES — MENTAL HEALTH AGENT
# ─────────────────────────────────────────────────────────────
@app.post("/agents/mental-health/analyze")
def analyze_session(data: SessionInput):
    return mental_health_agent.analyze_session(data.patient_id, data.session_text, data.session_id)

@app.get("/agents/mental-health/history/{patient_id}")
def mental_health_history(patient_id: str):
    ctx = mcp.get(patient_id)
    return {"patient_id": patient_id, "sessions": ctx.get("mental_health_sessions", [])}

@app.get("/agents/mental-health/search/{patient_id}")
def search_sessions(patient_id: str, query: str):
    return {"results": mental_health_agent.search_similar_sessions(patient_id, query)}

# ─────────────────────────────────────────────────────────────
# ROUTES — RURAL ACCESS AGENT
# ─────────────────────────────────────────────────────────────
@app.post("/agents/rural/triage")
def triage_patient(data: TriageInput):
    return rural_agent.triage(data.patient_id, data.symptoms, data.language)

@app.post("/agents/rural/scheme-eligibility")
def scheme_eligibility(data: SchemeInput):
    ctx = mcp.get(data.patient_id)
    profile = {**data.dict(), **(ctx.get("diagnoses", [{}])[0] if ctx.get("diagnoses") else {})}
    return rural_agent.check_scheme_eligibility(profile)

@app.get("/agents/rural/facilities")
def find_facilities(lat: float = 12.9716, lng: float = 77.5946, specialty: str = "General Medicine"):
    return rural_agent.find_facilities(lat, lng, specialty)

# ─────────────────────────────────────────────────────────────
# ROUTES — SCHEDULING AGENT
# ─────────────────────────────────────────────────────────────
@app.get("/agents/scheduler/doctors")
def available_doctors(specialty: str = "", date: str = "", esi_score: int = 5):
    return scheduling_agent.get_available_doctors(specialty, date or None, esi_score)

@app.post("/agents/scheduler/book")
def book_appointment(data: AppointmentInput):
    return scheduling_agent.book_appointment(
        data.patient_id, data.doctor_id, data.scheduled_at, data.reason, data.esi_score)

@app.get("/agents/scheduler/appointments")
def list_appointments(patient_id: str = "", date: str = "", limit: int = 50):
    if patient_id:
        return query_db(SCHEDULING_DB,
            "SELECT a.*, d.name as doctor_name, d.specialty FROM appointments a "
            "JOIN doctors d ON a.doctor_id = d.id WHERE a.patient_id = ? ORDER BY a.scheduled_at DESC LIMIT ?",
            (patient_id, limit))
    if date:
        return query_db(SCHEDULING_DB,
            "SELECT a.*, d.name as doctor_name, d.specialty FROM appointments a "
            "JOIN doctors d ON a.doctor_id = d.id WHERE DATE(a.scheduled_at) = ? ORDER BY a.esi_score ASC LIMIT ?",
            (date, limit))
    return query_db(SCHEDULING_DB,
        "SELECT a.*, d.name as doctor_name, d.specialty FROM appointments a "
        "JOIN doctors d ON a.doctor_id = d.id ORDER BY a.scheduled_at DESC LIMIT ?", (limit,))

@app.post("/agents/scheduler/dispatch-ambulance")
def dispatch_ambulance(data: AmbulanceDispatchInput, background_tasks: BackgroundTasks):
    result = scheduling_agent.dispatch_ambulance(
        data.patient_id, data.lat, data.lng, data.esi_score, data.condition)
    return result

@app.get("/agents/scheduler/ambulances")
def list_ambulances():
    return query_db(SCHEDULING_DB, "SELECT * FROM ambulances ORDER BY status")

@app.get("/agents/scheduler/beds")
def bed_status():
    return scheduling_agent.get_bed_status()

@app.post("/agents/scheduler/readmission-risk/{patient_id}")
def readmission_risk(patient_id: str):
    return scheduling_agent.readmission_risk(patient_id)

# ─────────────────────────────────────────────────────────────
# ROUTES — ORCHESTRATOR
# ─────────────────────────────────────────────────────────────
@app.post("/orchestrator/patient-arrival")
async def patient_arrival(data: TriageInput):
    return await orchestrator.handle_patient_arrival(
        data.patient_id, data.symptoms, data.language, data.lat, data.lng)

@app.post("/orchestrator/demo")
async def run_demo(patient_id: str = "DEMO-001"):
    return await orchestrator.full_patient_journey_demo(patient_id)

# ─────────────────────────────────────────────────────────────
# ROUTES — DASHBOARD / ANALYTICS
# ─────────────────────────────────────────────────────────────
@app.get("/dashboard/summary")
def dashboard_summary():
    try:
        total_patients = query_db(CLINICAL_DB, "SELECT COUNT(*) as c FROM patients")[0]["c"]
        admitted = query_db(CLINICAL_DB, "SELECT COUNT(*) as c FROM patients WHERE status='admitted'")[0]["c"]
        today_appts = query_db(SCHEDULING_DB,
            "SELECT COUNT(*) as c FROM appointments WHERE DATE(scheduled_at) = DATE('now')",)[0]["c"]
        critical_alerts = query_db(OPERATIONS_DB,
            "SELECT COUNT(*) as c FROM alerts WHERE severity='critical' AND acknowledged=0")[0]["c"]
        beds = scheduling_agent.get_bed_status()
        ambulances = query_db(SCHEDULING_DB, "SELECT status, COUNT(*) as c FROM ambulances GROUP BY status")
        return {
            "total_patients": total_patients,
            "admitted": admitted,
            "today_appointments": today_appts,
            "critical_alerts": critical_alerts,
            "bed_status": beds,
            "ambulance_status": {a["status"]: a["c"] for a in ambulances},
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {"error": str(e), "timestamp": datetime.utcnow().isoformat()}

@app.get("/dashboard/alerts")
def get_alerts(severity: str = "", limit: int = 50):
    if severity:
        return query_db(OPERATIONS_DB,
            "SELECT * FROM alerts WHERE severity=? ORDER BY timestamp DESC LIMIT ?", (severity, limit))
    return query_db(OPERATIONS_DB, "SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?", (limit,))

@app.patch("/dashboard/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str):
    execute_db(OPERATIONS_DB, "UPDATE alerts SET acknowledged=1 WHERE id=?", (alert_id,))
    return {"status": "acknowledged", "id": alert_id}

@app.get("/dashboard/drug-interactions/{patient_id}")
def check_drug_interactions(patient_id: str):
    ctx = mcp.get(patient_id)
    meds = ctx.get("medications", [])
    if len(meds) < 2:
        return {"interactions": [], "safe": True}
    result = call_claude_json(
        "You are a pharmacist AI. Check drug interactions. Return JSON: "
        "{ 'interactions': [{drug1, drug2, severity, description}], 'safe': boolean, 'recommendations': list }",
        f"Current medications: {json.dumps(meds)}")
    return result

# ─────────────────────────────────────────────────────────────
# WEBSOCKET — LIVE UPDATES
# ─────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send initial state
        await websocket.send_json({"event": "connected",
                                   "data": {"model_status": "cloud", "redis": REDIS_AVAILABLE}})
        while True:
            data = await websocket.receive_json()
            # Echo back with server timestamp
            await websocket.send_json({"event": "ack", "data": data,
                                       "server_time": datetime.utcnow().isoformat()})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ─────────────────────────────────────────────────────────────
# VOICE INPUT (Whisper)
# ─────────────────────────────────────────────────────────────
@app.post("/voice/transcribe")
async def transcribe_voice(file: UploadFile = File(...)):
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("base", device="cpu", compute_type="int8")
        content = await file.read()
        tmp_path = f"/tmp/{uuid.uuid4()}.webm"
        with open(tmp_path, "wb") as f:
            f.write(content)
        segments, _ = model.transcribe(tmp_path)
        text = " ".join(s.text for s in segments)
        os.remove(tmp_path)
        return {"text": text, "success": True}
    except ImportError:
        return {"error": "faster-whisper not installed. Run: pip install faster-whisper", "success": False}
    except Exception as e:
        return {"error": str(e), "success": False}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend_main:app", host="0.0.0.0", port=8000, reload=True)
