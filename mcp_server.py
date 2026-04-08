"""
Luminus MCP Server — Urgency Analysis, Patient History, Prescription Validation
Exposes tools for the doctor portal to process data with medical intelligence.
"""

import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any
import re

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "luminus.db"


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ─────────────────────────────────────────────────────────────────
# Tool 1: Analyze Report Urgency (Critical Keywords & Anomaly Score)
# ─────────────────────────────────────────────────────────────────

CRITICAL_KEYWORDS = [
    "myocardial infarction",
    "mi",
    "stroke",
    "hemorrhage",
    "sepsis",
    "shock",
    "cardiac arrest",
    "acute coronary",
    "pulmonary embolism",
    "anaphylaxis",
    "cardiopulmonary",
    "respiratory distress",
    "hypotension",
    "arrhythmia",
    "life-threatening",
    "emergency",
    "critical",
    "severe",
    "unstable",
]


def analyze_report_urgency(report_id: int) -> Dict[str, Any]:
    """
    Analyze a patient report for urgency level based on:
    - Critical keywords in OCR text or AI summary
    - Anomaly severity scores
    - Rule-based logic for medical conditions
    Returns: {urgency_level, score, key_findings}
    """
    conn = get_db()
    cur = conn.cursor()

    report = cur.execute(
        """
        SELECT ocr_text, ai_summary, anomalies_json, created_at
        FROM reports WHERE id = ?
    """,
        (report_id,),
    ).fetchone()

    if not report:
        return {"error": "Report not found", "urgency_level": "unknown"}

    ocr_lower = (report["ocr_text"] or "").lower()
    summary_lower = (report["ai_summary"] or "").lower()
    anomalies = json.loads(report["anomalies_json"] or "[]")

    # Score based on anomalies
    max_severity_score = 0
    critical_anomalies = []

    for anom in anomalies:
        severity = anom.get("severity", "info")
        if severity == "critical":
            max_severity_score = max(max_severity_score, 8)
            critical_anomalies.append(anom)
        elif severity == "warning":
            max_severity_score = max(max_severity_score, 5)

    # Score based on critical keywords
    keyword_score = 0
    found_keywords = []
    for keyword in CRITICAL_KEYWORDS:
        if keyword in ocr_lower or keyword in summary_lower:
            keyword_score = 9
            found_keywords.append(keyword)
            break

    # Combine scores
    final_score = max(max_severity_score, keyword_score)

    # Determine urgency level
    if final_score >= 8:
        urgency = "critical"
    elif final_score >= 5:
        urgency = "urgent"
    else:
        urgency = "routine"

    conn.close()

    return {
        "report_id": report_id,
        "urgency_level": urgency,
        "score": final_score,
        "critical_anomalies": critical_anomalies,
        "found_keywords": found_keywords,
    }


# ─────────────────────────────────────────────────────────────────
# Tool 2: Get Patient History (Without Hospital/Doctor Names)
# ─────────────────────────────────────────────────────────────────


def get_patient_history_for_doctor(patient_id: int) -> Dict[str, Any]:
    """
    Retrieve patient's medical history for doctor's review.
    Privacy: Returns reports WITHOUT source_hospital or previous doctor names.
    Returns: {conditions, medication_history, previous_diagnoses, reports_summary}
    """
    conn = get_db()
    cur = conn.cursor()

    # Get patient conditions
    patient = cur.execute(
        """
        SELECT conditions, blood_group, dob FROM patients WHERE id = ?
    """,
        (patient_id,),
    ).fetchone()

    if not patient:
        conn.close()
        return {"error": "Patient not found"}

    conditions = json.loads(patient["conditions"] or "[]")

    # Get all reports (with anomalies but WITHOUT hospital/doctor names)
    reports = cur.execute(
        """
        SELECT id, file_type, ocr_text, anomalies_json, ai_summary, created_at
        FROM reports WHERE patient_id = ?
        ORDER BY created_at DESC
    """,
        (patient_id,),
    ).fetchall()

    # Extract medication history from reports
    medication_history = set()
    diagnoses_history = []

    for report in reports:
        ocr = report["ocr_text"] or ""

        # Simple regex to find medication patterns (Name <number>mg, etc.)
        med_pattern = r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(\d+)\s*mg"
        medications = re.findall(med_pattern, ocr)
        for med, dose in medications:
            medication_history.add(f"{med} {dose}mg")

        # Extract diagnoses from OCR
        if "diagnosis" in ocr.lower():
            lines = ocr.split("\n")
            for line in lines:
                if "diagnosis" in line.lower():
                    diagnosis_text = (
                        line.replace("Diagnosis:", "").replace("diagnosis:", "").strip()
                    )
                    if diagnosis_text:
                        diagnoses_history.append(diagnosis_text)

    # Summarize reports
    reports_summary = []
    for report in reports:
        anomalies = json.loads(report["anomalies_json"] or "[]")
        reports_summary.append(
            {
                "id": report["id"],
                "type": report["file_type"],
                "date": report["created_at"],
                "summary": (
                    report["ai_summary"][:200] if report["ai_summary"] else "No summary"
                ),
                "anomaly_count": len(anomalies),
            }
        )

    conn.close()

    return {
        "patient_id": patient_id,
        "blood_group": patient["blood_group"],
        "known_conditions": conditions,
        "medication_history": list(medication_history),
        "diagnoses_history": diagnoses_history,
        "previous_reports": reports_summary,
    }


# ─────────────────────────────────────────────────────────────────
# Tool 3: Check Prescription Against Medical History
# ─────────────────────────────────────────────────────────────────

CONDITION_MEDICATIONS = {
    "diabetes": [
        "metformin",
        "glibenclamide",
        "insulin",
        "pioglitazone",
        "sitagliptin",
    ],
    "hypertension": [
        "lisinopril",
        "enalapril",
        "amlodipine",
        "atenolol",
        "hydrochlorothiazide",
    ],
    "cardiac": [
        "aspirin",
        "clopidogrel",
        "atorvastatin",
        "beta_blockers",
        "ace_inhibitors",
        "nitrates",
    ],
    "asthma": ["salbutamol", "albuterol", "fluticasone", "montelukast", "theophylline"],
    "cardiac_history": ["aspirin", "atorvastatin", "lisinopril", "metoprolol"],
}


def check_prescription_against_history(
    patient_id: int, prescription_medications_json: str, doctor_id: int
) -> Dict[str, Any]:
    """
    Cross-check prescription medications against patient's medical history.
    Flags: Missing medications for known conditions, drug interactions, contradictions.
    Returns: {has_discrepancies, issues, confidence_score}
    """

    history = get_patient_history_for_doctor(patient_id)
    if "error" in history:
        return history

    try:
        prescribed_meds = json.loads(prescription_medications_json)
    except:
        prescribed_meds = []

    prescribed_meds_lower = [m.lower() for m in prescribed_meds]

    issues = []

    # Check 1: Missing medications for known conditions
    for condition in history["known_conditions"]:
        condition_lower = condition.lower()
        expected_meds = CONDITION_MEDICATIONS.get(condition_lower, [])

        if expected_meds:
            found_any = False
            for exp_med in expected_meds:
                if any(exp_med.lower() in pm for pm in prescribed_meds_lower):
                    found_any = True
                    break

            if not found_any:
                issues.append(
                    {
                        "type": "missing_medication_for_condition",
                        "severity": "critical",
                        "message": f"Patient has condition '{condition}' but NO medication from expected list ({', '.join(expected_meds[:3])}) is prescribed.",
                        "condition": condition,
                        "expected_medications": expected_meds,
                    }
                )

    # Check 2: Contraindications (simple checks)
    if any("warfarin" in m for m in prescribed_meds_lower) and any(
        "aspirin" in m for m in prescribed_meds_lower
    ):
        issues.append(
            {
                "type": "drug_interaction",
                "severity": "warning",
                "message": "Warfarin + Aspirin — increased bleeding risk. Verify indication.",
            }
        )

    # Check 3: Duplicate medication classes
    med_classes = {}
    for med in prescribed_meds:
        med_lower = med.lower()
        if "statin" in med_lower:
            med_classes["statin"] = med_classes.get("statin", 0) + 1
        if "ace" in med_lower or "lisinopril" in med_lower or "enalapril" in med_lower:
            med_classes["ace_inhibitor"] = med_classes.get("ace_inhibitor", 0) + 1

    for med_class, count in med_classes.items():
        if count > 1:
            issues.append(
                {
                    "type": "duplicate_drug_class",
                    "severity": "warning",
                    "message": f"Multiple {med_class} medications in prescription. Verify necessity.",
                }
            )

    # Check 4: Medications not in history but appropriately prescribed (info level)
    high_confidence_condition_meds = []
    for condition, meds in CONDITION_MEDICATIONS.items():
        high_confidence_condition_meds.extend(meds)

    new_medications = [
        m
        for m in prescribed_meds_lower
        if not any(hc in m for hc in high_confidence_condition_meds)
    ]
    if new_medications:
        issues.append(
            {
                "type": "new_medication_class",
                "severity": "info",
                "message": f"New medication(s): {', '.join(new_medications)}. Ensure clinical indication documented.",
            }
        )

    # Score
    critical_count = len([i for i in issues if i.get("severity") == "critical"])
    warning_count = len([i for i in issues if i.get("severity") == "warning"])

    severity = (
        "critical"
        if critical_count > 0
        else ("warning" if warning_count > 0 else "info")
    )
    confidence = max(0, 100 - (critical_count * 40 + warning_count * 15))

    return {
        "patient_id": patient_id,
        "prescription_review_complete": True,
        "has_discrepancies": len(issues) > 0,
        "issues": issues,
        "severity": severity,
        "confidence_score": confidence,
    }


# ─────────────────────────────────────────────────────────────────
# Tool 4: Save Visit Session & Transcript
# ─────────────────────────────────────────────────────────────────


def save_visit_session(
    patient_id: int,
    doctor_id: int,
    transcript_lines: List[Dict[str, str]],
    urgency_level: str = "routine",
) -> Dict[str, Any]:
    """
    Save a completed visit session with transcript.
    transcript_lines format: [{"speaker": "doctor"|"patient", "text": "..."}, ...]
    Returns: {visit_session_id, status, message}
    """
    conn = get_db()
    cur = conn.cursor()

    try:
        # Create visit session
        now = datetime.now().isoformat()
        cur.execute(
            """
            INSERT INTO visit_sessions (patient_id, doctor_id, start_time, urgency_level, is_confirmed)
            VALUES (?, ?, ?, ?, 1)
        """,
            (patient_id, doctor_id, now, urgency_level),
        )

        visit_session_id = cur.lastrowid

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
            "status": "saved",
            "message": f"Visit session with {len(transcript_lines)} transcript lines saved.",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
        }

    except Exception as e:
        conn.close()
        return {"status": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────
# Tool 5: Create Medication Alert
# ─────────────────────────────────────────────────────────────────


def create_medication_alert(
    patient_id: int,
    doctor_id: int,
    alert_type: str,
    message: str,
    severity: str = "warning",
) -> Dict[str, Any]:
    """
    Create an alert for the doctor regarding prescription discrepancy.
    Returns: {alert_id, status}
    """
    conn = get_db()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            INSERT INTO alerts (patient_id, alert_type, message, severity, target_role)
            VALUES (?, ?, ?, ?, 'doctor')
        """,
            (patient_id, alert_type, message, severity),
        )

        alert_id = cur.lastrowid
        conn.commit()
        conn.close()

        return {"alert_id": alert_id, "status": "created", "message": message}

    except Exception as e:
        conn.close()
        return {"status": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────
# Tool 6: Allocate Time Slot (ESI Priority Mapping)
# ─────────────────────────────────────────────────────────────────

ESI_WAIT_TIMES = {
    1: 0,  # Immediate - resuscitation
    2: 10,  # Emergent - very urgent
    3: 30,  # Urgent - urgent
    4: 60,  # Less urgent - semi-urgent
    5: 120,  # Non-urgent - routine
}


def allocate_time_slot(
    patient_id: int, doctor_id: int, esi_priority: int = 3
) -> Dict[str, Any]:
    """
    Allocate appointment time slot based on ESI (Emergency Severity Index) priority.
    Returns: {estimated_wait_minutes, recommended_slot_time, reason}
    """
    conn = get_db()
    cur = conn.cursor()

    # Get doctor's current appointments to estimate load
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = datetime.now().replace(
        hour=23, minute=59, second=59, microsecond=999999
    )

    appointments_today = cur.execute(
        """
        SELECT COUNT(*) as count FROM appointments
        WHERE doctor_id = ? AND scheduled_at BETWEEN ? AND ?
    """,
        (doctor_id, today_start.isoformat(), today_end.isoformat()),
    ).fetchone()

    appointment_count = appointments_today["count"] if appointments_today else 0

    # ESI-based wait time
    base_wait = ESI_WAIT_TIMES.get(esi_priority, 120)

    # Adjust based on current load (rough estimate)
    load_factor = 1 + (appointment_count * 0.1)
    estimated_wait = int(base_wait * load_factor)

    # Suggest slot time
    now = datetime.now()
    slot_time = now + timedelta(minutes=estimated_wait)

    conn.close()

    return {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "esi_priority": esi_priority,
        "estimated_wait_minutes": estimated_wait,
        "current_queue_length": appointment_count,
        "recommended_slot_time": slot_time.isoformat(),
        "priority_level": {
            1: "Resuscitation (Immediate)",
            2: "Emergent (10 min)",
            3: "Urgent (30 min)",
            4: "Less Urgent (60 min)",
            5: "Non-Urgent (120 min)",
        }.get(esi_priority, f"Unknown (ESI {esi_priority})"),
    }


# ─────────────────────────────────────────────────────────────────
# MCP Tool Definitions (for Claude via MCP bridge)
# ─────────────────────────────────────────────────────────────────

AVAILABLE_TOOLS = {
    "analyze_report_urgency": {
        "description": "Analyze a medical report for urgency (critical/urgent/routine) based on keywords and anomalies.",
        "parameters": {"report_id": "ID of the report to analyze"},
    },
    "get_patient_history_for_doctor": {
        "description": "Get patient's medical history without source hospital/doctor names (privacy-preserving).",
        "parameters": {"patient_id": "ID of the patient"},
    },
    "check_prescription_against_history": {
        "description": "Cross-check prescription medications against patient's medical history for discrepancies.",
        "parameters": {
            "patient_id": "ID of the patient",
            "prescription_medications_json": "JSON array of medication names",
            "doctor_id": "ID of prescribing doctor",
        },
    },
    "save_visit_session": {
        "description": "Save a completed doctor-patient visit session with voice-to-text transcript.",
        "parameters": {
            "patient_id": "ID of the patient",
            "doctor_id": "ID of the doctor",
            "transcript_lines": "List of {speaker, text} objects",
            "urgency_level": "critical|urgent|routine",
        },
    },
    "create_medication_alert": {
        "description": "Create an alert for prescription discrepancies.",
        "parameters": {
            "patient_id": "ID of the patient",
            "doctor_id": "ID of the doctor",
            "alert_type": "Type of alert (e.g., prescription_mismatch)",
            "message": "Alert message for doctor",
            "severity": "critical|warning|info",
        },
    },
    "allocate_time_slot": {
        "description": "Allocate appointment time based on ESI priority and current queue.",
        "parameters": {
            "patient_id": "ID of the patient",
            "doctor_id": "ID of the doctor",
            "esi_priority": "1-5 (1=resuscitation, 5=routine)",
        },
    },
}


def handle_tool_call(tool_name: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """Route MCP tool calls to the appropriate function."""

    if tool_name == "analyze_report_urgency":
        return analyze_report_urgency(tool_input.get("report_id"))

    elif tool_name == "get_patient_history_for_doctor":
        return get_patient_history_for_doctor(tool_input.get("patient_id"))

    elif tool_name == "check_prescription_against_history":
        return check_prescription_against_history(
            tool_input.get("patient_id"),
            tool_input.get("prescription_medications_json"),
            tool_input.get("doctor_id"),
        )

    elif tool_name == "save_visit_session":
        return save_visit_session(
            tool_input.get("patient_id"),
            tool_input.get("doctor_id"),
            tool_input.get("transcript_lines", []),
            tool_input.get("urgency_level", "routine"),
        )

    elif tool_name == "create_medication_alert":
        return create_medication_alert(
            tool_input.get("patient_id"),
            tool_input.get("doctor_id"),
            tool_input.get("alert_type"),
            tool_input.get("message"),
            tool_input.get("severity", "warning"),
        )

    elif tool_name == "allocate_time_slot":
        return allocate_time_slot(
            tool_input.get("patient_id"),
            tool_input.get("doctor_id"),
            tool_input.get("esi_priority", 3),
        )

    else:
        return {"error": f"Unknown tool: {tool_name}"}


if __name__ == "__main__":
    # Quick test
    print("Testing MCP Server Tools...")
    print("\n1. Analyze Report Urgency:")
    print(json.dumps(analyze_report_urgency(1), indent=2))

    print("\n2. Get Patient History:")
    print(json.dumps(get_patient_history_for_doctor(1), indent=2))

    print("\n3. Check Prescription Against History:")
    result = check_prescription_against_history(
        1, json.dumps(["Atorvastatin 20mg", "Lisinopril 10mg", "Aspirin 75mg"]), 3
    )
    print(json.dumps(result, indent=2))

    print("\n4. Allocate Time Slot:")
    print(json.dumps(allocate_time_slot(1, 3, esi_priority=3), indent=2))
