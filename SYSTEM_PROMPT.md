# LUMINUS: AI-Powered Healthcare Management System
## Complete System Prompt & Implementation Guide

---

## 1. PROJECT OVERVIEW

**LUMINUS** is an AI-driven healthcare platform that connects patients with doctors, analyzes medical reports using OpenAI, detects health anomalies, and enables secure consultations with smart alert propagation. The system has **three user roles**: Patient, Doctor, and Admin.

### Core Problem Solved
- Patients struggle to track medical history across hospitals
- Doctors lack automated anomaly detection in reports
- No central platform for patient-doctor assignment and consultation management
- Hospitals need admin oversight for patient-doctor matching

### Live Features (Currently Implemented & Tested)
✅ Dynamic patient registration (no hardcoded users)  
✅ AI-powered report analysis (images + PDFs)  
✅ Anomaly detection (diabetes+medication gaps, glucose levels, etc.)  
✅ Doctor queue with 30-day appointment scheduling  
✅ Real-time alert propagation to assigned doctors  
✅ Consultation sessions with transcript capture  
✅ Prescription upload & validation  
✅ Patient history AI summary (8-10 bullet points)  
✅ Consent-driven hospital details sharing  
✅ Critical alert banner on doctor dashboard  

### Missing: Admin Features (To Implement)
❌ Admin login & role management  
❌ Patient-doctor assignment/deassignment  
❌ Patient list management (create, update, suspend)  
❌ Doctor availability scheduling  
❌ Analytics dashboard (alerts, consultations, anomaly trends)  
❌ System configuration (AI model settings, alert thresholds, etc.)  

---

## 2. TECH STACK

### Backend
- **Framework**: FastAPI (Python)
- **Database**: SQLite (development) / PostgreSQL (production-ready)
- **AI Integration**: 
  - OpenAI API (`gpt-4.1-mini` for chat/text analysis)
  - OpenAI Vision (`gpt-4o-mini` for image analysis)
- **PDF Parsing**: `pypdf` for text extraction
- **Authentication**: JWT + role-based access control (RBAC)
- **Dependencies**: See `requirements.txt`

### Frontend
- **Framework**: Vanilla JavaScript (currently); **Recommended upgrade to React.js** for better state management
- **Styling**: CSS3 (currently); **Recommended: Tailwind CSS or Material-UI** for professional look
- **HTTP**: Fetch API
- **File Handling**: FileReader API (base64 encoding)

### Infrastructure
- **Server**: Uvicorn (development), Gunicorn + Nginx (production)
- **Deployment**: Docker-ready (Dockerfile not yet created)
- **Environment**: `.env` for API keys and configuration

---

## 3. DATA MODELS & DATABASE SCHEMA

### Current Tables (in `db.py`)
```
users
├── id, username, password_hash, role, created_at
├── Roles: patient, doctor, admin

patients
├── id, user_id, full_name, email, phone, dob, blood_group, medical_conditions
├── Links to users table via user_id

doctors
├── id, user_id, specialization, license_number, clinic_address, available_from, available_to
├── Links to users table via user_id

appointments
├── id, patient_id, doctor_id, appointment_date, status (scheduled, completed, cancel), notes

reports
├── id, patient_id, uploaded_by (doctor_id), file_name, file_type (pdf, image), 
├── ai_summary, created_at, updated_at

report_consent
├── id, report_id, share_hospital_details (true/false), created_at

alerts
├── id, doctor_id, patient_id, alert_type (report_anomaly, anomaly_critical, etc.)
├── severity (critical, warning, info), message, resolved (true/false), created_at

visit_sessions
├── id, appointment_id, start_time, transcript, prescription_notes, end_time, status

prescriptions
├── id, visit_id, medication_name, dosage, frequency, duration, notes

prescription_validations
├── id, prescription_id, validation_status, discrepancies, checked_by (doctor_id)
```

### New Tables Needed (Admin Features)
```
admin_users
├── id, user_id, created_at, last_login
  
doctor_availability
├── id, doctor_id, day_of_week (0-6), start_time, end_time, max_appointments_per_day

patient_assignments
├── id, patient_id, assigned_doctor_id, assigned_at, unassigned_at, reason
  
system_config
├── id, key (alert_threshold_critical, alert_threshold_warning, etc.), value, updated_by (admin_id)

audit_logs
├── id, admin_id, action, entity_type (patient, doctor, etc.), entity_id, details, created_at
```

---

## 4. USER ROLES & PERMISSION MATRIX

| Feature | Patient | Doctor | Admin |
|---------|---------|--------|-------|
| Login via email/phone | ✅ | ✅ | ✅ |
| Register (self-signup) | ✅ | Via Admin | ❌ |
| Upload medical reports | ✅ | View only | ❌ |
| View own history summary | ✅ | ❌ | ❌ |
| Schedule appointments | ✅ | Accept/Reject | ❌ |
| View assigned patients | ❌ | ✅ | ✅ |
| Consultation (visit session) | ✅ | ✅ | View only |
| Write prescriptions | ❌ | ✅ | ❌ |
| View alerts | ❌ | ✅ (assigned patients) | ✅ (system-wide) |
| Create doctor accounts | ❌ | ❌ | ✅ |
| Assign/deassign patients | ❌ | ❌ | ✅ |
| View analytics | ❌ | Limited (own) | ✅ (system-wide) |
| Manage system config | ❌ | ❌ | ✅ |

---

## 5. CURRENT API ENDPOINTS

### Authentication
```
POST /api/login
  Payload: { email, password, role }
  Response: { user_id, name, role, clinical_id [for doctors], token }

POST /api/logout
  Response: { ok: true }
```

### Patient APIs
```
POST /api/patient/register
  Payload: { email, phone, password }
  Response: { patient_id, user_id }

GET /api/patient/onboarding/{patient_id}
  Response: { requires_upload: bool }

POST /api/patient/upload-report
  Payload: { patient_id, image_data_url, file_name, file_type, share_hospital_details }
  Response: { report_id, summary, anomalies: [{ type, severity, message }], has_critical }

GET /api/patient/reports/{patient_id}
  Response: { reports: [{ id, file_name, summary, uploaded_at }] }

GET /api/patient/history-summary/{patient_id}
  Response: { summary_points: ["...", "...", ...], generated_at }
```

### Doctor APIs
```
GET /api/doctor/queue/{doctor_id}
  Response: { appointments: [{ id, patient_name, appointment_date, status }] }

GET /api/doctor/alerts/{doctor_id}
  Response: { critical_count, alerts: [{ id, patient_id, message, severity, created_at }] }

GET /api/doctor/patient/{patient_id}
  Response: { id, name, dob, medical_conditions, reports, last_alert_at }
```

### Consultation APIs
```
POST /api/visit/start
  Payload: { appointment_id }
  Response: { visit_id, transcript_initialized }

POST /api/visit/save
  Payload: { visit_id, transcript, prescription_notes }
  Response: { visit_id, saved_at }

POST /api/prescription/upload
  Payload: { visit_id, medication_name, dosage, frequency, duration, notes }
  Response: { prescription_id }

POST /api/prescription/validate
  Payload: { prescription_id }
  Response: { validation_status, discrepancies: ["..."] }
```

---

## 6. NEW ENDPOINTS TO BUILD (Admin System)

### Admin Authentication
```
POST /api/admin/login
  Payload: { email, password }
  Response: { admin_id, name, token, permissions: [...] }

POST /api/admin/logout
  Response: { ok: true }
```

### Admin: Patient Management
```
GET /api/admin/patients?page=1&limit=20&search=name
  Response: { total, patients: [{ id, name, email, assigned_doctor_id, created_at, status }] }

POST /api/admin/patients
  Payload: { name, email, phone, dob, blood_group, assign_to_doctor_id }
  Response: { patient_id, created: true }

PUT /api/admin/patients/{patient_id}
  Payload: { name, dob, blood_group, assign_to_doctor_id }
  Response: { updated: true }

DELETE /api/admin/patients/{patient_id}
  Response: { deleted: true, reason: "deactivated" }

GET /api/admin/patients/{patient_id}/reports
  Response: { reports: [{ id, file_name, summary, alerts_generated }] }

POST /api/admin/patients/{patient_id}/assign-doctor
  Payload: { doctor_id }
  Response: { assigned: true, doctor_name }

POST /api/admin/patients/{patient_id}/unassign-doctor
  Response: { unassigned: true }
```

### Admin: Doctor Management
```
GET /api/admin/doctors?page=1&limit=20&search=name
  Response: { total, doctors: [{ id, name, email, specialization, assigned_patients_count }] }

POST /api/admin/doctors
  Payload: { name, email, password, phone, specialization, license_number, clinic_address }
  Response: { doctor_id, created: true }

PUT /api/admin/doctors/{doctor_id}
  Payload: { name, specialization, clinic_address, available_from, available_to }
  Response: { updated: true }

DELETE /api/admin/doctors/{doctor_id}
  Response: { deleted: true }

GET /api/admin/doctors/{doctor_id}/patients
  Response: { assigned_patients: [{ id, name, last_alert_at, appointment_count }] }

GET /api/admin/doctors/{doctor_id}/availability
  Response: { schedule: [{ day_of_week, start_time, end_time, max_appointments }] }

POST /api/admin/doctors/{doctor_id}/availability
  Payload: { day_of_week, start_time, end_time, max_appointments_per_day }
  Response: { availability_id, created: true }
```

### Admin: Analytics & Monitoring
```
GET /api/admin/dashboard
  Response: { 
    total_patients, total_doctors, total_alerts, 
    critical_alerts_unresolved, consultations_today,
    anomaly_trends: [{ type, count_last_7_days }]
  }

GET /api/admin/alerts?severity=critical&resolved=false&days=30
  Response: { total, alerts: [{ id, patient_name, doctor_name, message, created_at }] }

GET /api/admin/analytics/anomalies
  Response: { 
    common_anomalies: [{ type, frequency, severity, recommendation }],
    by_patient: [{ patient_id, anomaly_count, critical_count }]
  }

GET /api/admin/audit-logs?action=patient_assignment&days=30
  Response: { logs: [{ admin_id, action, entity_type, entity_id, details, created_at }] }
```

### Admin: System Configuration
```
GET /api/admin/config
  Response: { alert_threshold_critical, alert_threshold_warning, openai_model, max_file_size_mb }

PUT /api/admin/config
  Payload: { alert_threshold_critical, openai_model, enable_voice_consultation }
  Response: { updated: true, config_id }
```

---

## 7. FRONTEND UI STRUCTURE (Recommended Redesign)

### Current State
- Simple vanilla JS with basic HTML forms
- Single `index.html` with inline CSS
- Minimal responsive design

### Recommended: React.js + Tailwind CSS Architecture
```
frontend/
├── src/
│   ├── components/
│   │   ├── Auth/
│   │   │   ├── LoginModal.jsx
│   │   │   ├── RegisterModal.jsx
│   │   │   └── RoleSelector.jsx
│   │   ├── Patient/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ReportUploader.jsx
│   │   │   ├── HistorySummary.jsx
│   │   │   └── AppointmentBooking.jsx
│   │   ├── Doctor/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── PatientQueue.jsx
│   │   │   ├── AlertBanner.jsx
│   │   │   ├── ConsultationSession.jsx
│   │   │   ├── PrescriptionWriter.jsx
│   │   │   └── PatientProfile.jsx
│   │   ├── Admin/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── PatientManagement.jsx
│   │   │   ├── DoctorManagement.jsx
│   │   │   ├── AlertMonitoring.jsx
│   │   │   ├── Analytics.jsx
│   │   │   └── SystemConfig.jsx
│   │   └── Shared/
│   │       ├── Header.jsx
│   │       ├── Sidebar.jsx
│   │       ├── Modal.jsx
│   │       └── Toast.jsx
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useApi.js
│   │   └── useLocalStorage.js
│   ├── utils/
│   │   ├── api.js
│   │   ├── validators.js
│   │   └── formatters.js
│   ├── state/ (Redux or Context API)
│   │   ├── authSlice.js
│   │   ├── patientSlice.js
│   │   └── alertsSlice.js
│   └── App.jsx
├── public/
│   ├── index.html
│   └── favicon.ico
├── package.json
└── tailwind.config.js
```

### Key UI Features
1. **Admin Dashboard**
   - Cards: Total Patients, Total Doctors, Unresolved Alerts, Consultations Today
   - Real-time alerts feed with severity color-coding
   - Line chart: Anomaly trends over 30 days
   - Patient/Doctor quick-search with filters

2. **Patient Management UI**
   - Sortable table with name, email, assigned doctor, created date, status
   - Inline "Assign Doctor" dropdown with search
   - Bulk actions: Export, Deactivate
   - Detail modal: View full patient history, reports, alerts

3. **Doctor Management UI**
   - Table with name, specialization, assigned patients, availability status
   - Quick "Add Doctor" modal with field validation
   - Availability schedule grid (7 days x time slots)
   - Doctor detail view: Assigned patients, performance metrics

4. **Alert Monitoring**
   - Filter by severity (critical/warning/info)
   - Filter by resolved status
   - Drill-down: Click alert → View patient profile + report + AI analysis
   - Bulk action: Mark resolved

5. **Analytics Dashboard**
   - Most common anomalies (bar chart)
   - Alert severity distribution (pie chart)
   - Doctor activity (completed consultations per doctor)
   - Report upload trends (time series)

---

## 8. AI SYSTEM ARCHITECTURE

### Current AI Capabilities
1. **Report Analysis** (OpenAI Vision + Text)
   - Image input: `gpt-4o-mini` (vision model)
   - PDF input: Extract text → `gpt-4.1-mini` (text model)
   - Output: Summary (3-5 sentences) + Anomalies list with severity

2. **Anomaly Detection** (Hybrid)
   - AI-first: Parse OpenAI response for Medical findings
   - Fallback: Rule-based engine
     - "diabetes" + no "medication" → Critical alert
     - Glucose > 140 mg/dL → Critical
     - TBL > 1.2 → Warning
     - etc.

3. **Patient History Summary** (OpenAI)
   - Analyze all reports for given patient
   - Generate 8-10 bullet points covering:
     - Chronic conditions
     - Recent lab values
     - Medication history
     - Risk factors
     - Recommendations

### Recommended Enhancements

**1. OCR for Scanned PDFs**
```python
# Add: Tesseract-OCR or DocumentAI
from pdf2image import convert_from_bytes
import pytesseract

def extract_text_from_scanned_pdf(pdf_bytes):
    images = convert_from_bytes(pdf_bytes)
    text = ""
    for image in images:
        text += pytesseract.image_to_string(image)
    return text
```

**2. Structured Data Extraction**
```python
# Use OpenAI function calling to extract structured fields
extraction_prompt = """
Extract the following fields:
- Patient name
- Test date
- Lab results (test_name: value: unit: reference_range)
- Diagnosis
Return as JSON.
"""
```

**3. Multi-Report Trend Analysis**
```python
def analyze_patient_trends(patient_id, lookback_days=180):
    reports = db.get_reports_since(patient_id, lookback_days)
    trends = {
        "glucose": [report.glucose_value for report in reports],
        "hba1c": [...],
        "risk_trajectory": "improving" | "stable" | "declining"
    }
    return trends
```

**4. Doctor-Specific Recommendations**
```python
# When doctor views patient + anomalies, suggest next steps
get_recommendations_for_anomaly(anomaly_type="elevated_glucose")
→ {
    "investigation_tests": ["HbA1c", "Fasting Glucose"],
    "referral_specialist": "Endocrinologist",
    "medication_classes": ["Metformin", "SGLT2 Inhibitors"],
    "lifestyle_changes": ["Reduce sugar intake", "30min daily exercise"]
  }
```

---

## 9. SECURITY REQUIREMENTS

### Authentication & Authorization
- [ ] **JWT Tokens**: 24-hour expiry; refresh token rotation
- [ ] **Password**: Min 12 chars, uppercase + lowercase + digits + special char
- [ ] **Role-Based Access Control (RBAC)**: Validate role on every endpoint
- [ ] **Audit Logging**: Every admin action logged to `audit_logs` table

### Data Protection
- [ ] **Encryption at Rest**: SQLite → SQLCipher (DB password)
- [ ] **Encryption in Transit**: HTTPS only (self-signed cert for dev, proper cert for prod)
- [ ] **PII Handling**: Sensitive fields (phone, DOB) encrypted separately
- [ ] **HIPAA Compliance** (if applicable):
  - Access logs all patient data access
  - Data retention policy (auto-purge at 7 years)
  - Breach notification plan

### API Security
- [ ] **Rate Limiting**: 100 requests/min per IP per role
- [ ] **CORS**: Whitelist frontend domain only
- [ ] **Input Validation**: All payloads validated against schema
- [ ] **SQL Injection Prevention**: Use parameterized queries (SQLAlchemy ORM)
- [ ] **File Upload**: Type check, size limit (5MB), virus scan (optional)

---

## 10. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Weeks 1-2)
- [ ] Upgrade frontend to React.js + Tailwind CSS
- [ ] Add Jest/React Testing Library for unit tests
- [ ] Implement JWT authentication with refresh tokens
- [ ] Add RBAC middleware to FastAPI

### Phase 2: Admin System (Weeks 3-5)
- [ ] Build all admin endpoints (patient/doctor/config management)
- [ ] Create admin dashboard UI with React components
- [ ] Implement patient-doctor assignment logic
- [ ] Add doctor availability scheduling

### Phase 3: AI Enhancements (Weeks 6-7)
- [ ] Add OCR for scanned documents (Tesseract)
- [ ] Implement structured data extraction (OpenAI function calling)
- [ ] Build trend analysis engine (glucose, HbA1c over time)
- [ ] Create recommendation engine

### Phase 4: Analytics & Monitoring (Weeks 8-9)
- [ ] Build admin analytics dashboard (charts, trends)
- [ ] Implement audit logging for all admin actions
- [ ] Create alert heatmap (which anomalies most common)
- [ ] Add data export (CSV, PDF reports)

### Phase 5: DevOps & Deployment (Weeks 10)
- [ ] Dockerize backend + frontend
- [ ] Set up GitHub Actions CI/CD pipeline
- [ ] Deploy to cloud (AWS/GCP/Azure)
- [ ] Configure SSL/TLS, monitoring, logging

---

## 11. ENVIRONMENT VARIABLES REQUIRED

```bash
# .env file (must be secured, NOT in git)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_VISION_MODEL=gpt-4o-mini

DATABASE_URL=sqlite:///luminus.db  # dev
# DATABASE_URL=postgresql://user:pass@host/db  # prod

JWT_SECRET=your-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRY_HOURS=24

EMAIL_PROVIDER=gmail  # for notifications
EMAIL_ADDRESS=noreply@luminus.health
EMAIL_PASSWORD=app-password-here

FRONTEND_URL=http://localhost:3000
API_BASE_URL=http://127.0.0.1:8000

DEBUG=true  # false in production
LOG_LEVEL=INFO
```

---

## 12. TESTING STRATEGY

### Unit Tests (Backend)
```python
# test_auth.py
def test_patient_login_valid_credentials():
    response = client.post("/api/login", json={...})
    assert response.status_code == 200
    assert "token" in response.json()

# test_anomaly_detection.py
def test_diabetes_without_medication_detection():
    result = detect_anomalies({"glucose": 180, "hba1c": 8.2})
    assert any(a["type"] == "Diabetes Management" for a in result)
```

### Integration Tests (Frontend)
```javascript
// __tests__/AdminDashboard.test.jsx
test('Admin can assign doctor to patient', async () => {
  const { getByText, getByPlaceholderText } = render(<AdminDashboard />);
  userEvent.click(getByText('Assign Doctor'));
  userEvent.selectOption(getByRole('combobox'), 'Dr. Smith');
  userEvent.click(getByText('Confirm'));
  await waitFor(() => expect(getByText('Doctor assigned')).toBeInTheDocument());
});
```

### E2E Tests (Selenium/Cypress)
```javascript
// cypress/e2e/patient-onboarding.cy.js
describe('Patient Onboarding Flow', () => {
  it('should upload report and trigger doctor alert', () => {
    cy.login('test@patient.com', 'password');
    cy.uploadFile('test.pdf');
    cy.contains('Report uploaded').should('be.visible');
    // Login as doctor, verify alert appears
    cy.logout();
    cy.login('doctor@clinic.com', 'password');
    cy.get('[data-testid=alert-banner]').should('contain', 'critical alert');
  });
});
```

---

## 13. DEPLOYMENT CHECKLIST

**Before Production:**
- [ ] All test suites pass (unit + integration + E2E)
- [ ] Code review completed
- [ ] Security audit: OWASP Top 10 check
- [ ] Load testing: 1000 concurrent users
- [ ] Database backup strategy in place
- [ ] SSL certificate configured
- [ ] Error monitoring configured (Sentry)
- [ ] Log aggregation configured (ELK/CloudWatch)
- [ ] Rate limiting configured
- [ ] CORS properly restricted
- [ ] Secrets (API keys, JWT) in secure vault (AWS Secrets Manager)

**Post-Deployment:**
- [ ] Health check monitoring
- [ ] Alert on error spikes
- [ ] Weekly data backups
- [ ] Monthly security patches
- [ ] Quarterly penetration testing

---

## 14. CURRENT PROJECT STATE SNAPSHOT

### Working Features
✅ Patient registration, login, report upload (PDF + images)  
✅ AI report analysis with anomaly detection  
✅ Doctor queue, alerts, consultations, prescriptions  
✅ Patient history 8-10 point summary  
✅ Real test data: Patient `test1@luminus.health` with `test.pdf` analyzed  
✅ Alert propagation: 6 anomalies (3 critical) extracted and stored  

### Tested with Real Data
- File: `C:\Users\hites\Downloads\test.pdf` (lab report)
- Analysis: "The laboratory report... HbA1c (7.10%), indicating diabetes with poor glycemic control... No medication or management guidance..."
- Anomalies: Elevated glucose (critical), Poor HbA1c (critical), Diabetes gap (critical), Elevated triglycerides (warning), Elevated LDL (warning), Platelet volume (info)

### Known Limitations
❌ No admin system yet  
❌ Frontend is vanilla JS (not React, hard to scale)  
❌ UI is basic (no modern styling, not mobile-friendly)  
❌ No OCR for scanned documents  
❌ No structured data extraction  
❌ No trend analysis across multiple reports  
❌ No doctor availability scheduling  
❌ No HIPAA audit logs  

---

## 15. QUICK START FOR NEW IMPLEMENTATION

### Backend Setup
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Update .env with your OpenAI API key
python -m pytest tests/  # Run all tests

# Start server
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

### Frontend Setup (New React Setup)
```bash
npx create-react-app frontend
cd frontend
npm install tailwindcss autoprefixer
npx tailwindcss init -p

# Copy components from design above
npm start
```

### Database Initialization
```bash
python
>>> from db import init_db
>>> init_db()  # Creates all tables + seed data
```

---

## 16. SUCCESS METRICS

Track these KPIs post-launch:
- **Patient Engagement**: % completing first report upload within 7 days
- **Doctor Efficiency**: Avg time to resolve critical alert
- **AI Accuracy**: % of AI-flagged anomalies confirmed by doctors
- **System Availability**: 99.9% uptime
- **Load Time**: < 2s for admin dashboard (1000 patients, 100 doctors)

---

**Version**: 1.0  
**Last Updated**: April 9, 2026  
**Author**: Luminus Dev Team  
**Status**: Ready for Full Implementation
