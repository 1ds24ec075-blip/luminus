/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         MediCore AI — Complete Frontend (App.jsx)            ║
 * ║   React + Vite + TailwindCSS Hospital Intelligence Platform  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SETUP:
 *   npm create vite@latest medicore-frontend -- --template react
 *   cd medicore-frontend
 *   npm install axios recharts lucide-react react-router-dom
 *   npm install -D tailwindcss postcss autoprefixer
 *   npx tailwindcss init -p
 *
 * Replace src/App.jsx with this file.
 * Add to tailwind.config.js content: ["./src/**\/*.{js,jsx}"]
 * Replace index.css with: @tailwind base; @tailwind components; @tailwind utilities;
 *
 * Set VITE_API_URL=http://localhost:8000 in .env
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : "http://localhost:8000");
const WS_URL = API.replace("http", "ws") + "/ws";

// ─────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────
const api = {
  get: (path) => fetch(`${API}${path}`).then(r => r.json()),
  post: (path, body) => fetch(`${API}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json()),
  patch: (path) => fetch(`${API}${path}`, { method: "PATCH" }).then(r => r.json()),
};

// ─────────────────────────────────────────────────────────────
// COLOR / STYLE HELPERS
// ─────────────────────────────────────────────────────────────
const severityColor = (s) => ({
  critical: "bg-red-100 text-red-800 border-red-300",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-300",
  info: "bg-blue-100 text-blue-800 border-blue-300",
  normal: "bg-green-100 text-green-800 border-green-300",
}[s] || "bg-gray-100 text-gray-800 border-gray-300");

const esiColor = (e) => ({
  1: "bg-red-600 text-white", 2: "bg-orange-500 text-white",
  3: "bg-yellow-500 text-white", 4: "bg-green-500 text-white",
  5: "bg-blue-500 text-white"
}[e] || "bg-gray-400 text-white");

const esiLabel = (e) => ({
  1: "Immediate", 2: "Emergent", 3: "Urgent", 4: "Less Urgent", 5: "Non-Urgent"
}[e] || "Unknown");

// ─────────────────────────────────────────────────────────────
// ICONS (inline SVG — no dependency needed)
// ─────────────────────────────────────────────────────────────
const Icon = ({ name, className = "w-5 h-5" }) => {
  const icons = {
    dashboard: <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
    patients: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
    chat: <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>,
    heart: <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>,
    brain: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    ambulance: <><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    alert: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    pill: <><path d="M10.5 20H4a2 2 0 01-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H20a2 2 0 012 2v2.5"/><circle cx="17" cy="17" r="5"/><path d="M14 17h6"/></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
    mic: <><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>,
    send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    bed: <><path d="M2 4v16"/><path d="M2 8h18a2 2 0 012 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></>,
    star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    demo: <><polygon points="5 3 19 12 5 21 5 3"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></>,
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      {icons[name]}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────

// Stat Card
const StatCard = ({ label, value, sub, color = "blue", icon }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-start gap-4`}>
    <div className={`p-3 rounded-lg bg-${color}-50 text-${color}-600`}>
      <Icon name={icon} className="w-6 h-6" />
    </div>
    <div>
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value ?? "—"}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

// Badge
const Badge = ({ text, color = "gray" }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold bg-${color}-100 text-${color}-700`}>
    {text}
  </span>
);

// Loading spinner
const Spinner = () => (
  <div className="flex items-center justify-center p-8">
    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
  </div>
);

// Section header
const SectionHeader = ({ title, sub, action }) => (
  <div className="flex items-center justify-between mb-4">
    <div>
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      {sub && <p className="text-sm text-gray-500">{sub}</p>}
    </div>
    {action}
  </div>
);

// ─────────────────────────────────────────────────────────────
// DASHBOARD VIEW
// ─────────────────────────────────────────────────────────────
const DashboardView = ({ ws }) => {
  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState([]);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api.get("/dashboard/summary"),
        api.get("/dashboard/alerts?limit=10")
      ]);
      setSummary(s);
      setAlerts(Array.isArray(a) ? a : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ws) return;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event !== "ack" && msg.event !== "connected") {
          setLiveEvents(prev => [{ ...msg, id: Date.now() }, ...prev.slice(0, 4)]);
        }
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws]);

  const ackAlert = async (id) => {
    await api.patch(`/dashboard/alerts/${id}/acknowledge`);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: 1 } : a));
  };

  if (loading) return <Spinner />;

  const beds = summary?.bed_status || {};
  const ambulances = summary?.ambulance_status || {};

  return (
    <div className="space-y-6">
      {/* Live event ticker */}
      {liveEvents.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-blue-700 mb-1">🔴 LIVE EVENTS</p>
          {liveEvents.map(e => (
            <p key={e.id} className="text-xs text-blue-600 font-mono">
              [{new Date().toLocaleTimeString()}] {e.event}: {JSON.stringify(e.data).slice(0, 80)}...
            </p>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Patients" value={summary?.total_patients} icon="patients" color="blue" sub="All time" />
        <StatCard label="Admitted" value={summary?.admitted} icon="bed" color="green" sub="Currently admitted" />
        <StatCard label="Today's Appointments" value={summary?.today_appointments} icon="calendar" color="purple" />
        <StatCard label="Critical Alerts" value={summary?.critical_alerts} icon="alert" color="red" sub="Unacknowledged" />
      </div>

      {/* Beds + Ambulances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bed status */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader title="🛏️ Bed Occupancy" sub="Live ward status" />
          <div className="space-y-3">
            {Object.entries(beds).map(([ward, data]) => {
              const pct = data.occupancy_pct || 0;
              const barColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-yellow-500" : "bg-green-500";
              return (
                <div key={ward}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{ward}</span>
                    <span className="text-gray-500">{data.occupied}/{data.total} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ambulance status */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader title="🚑 Ambulance Fleet" sub="Real-time status" />
          <div className="grid grid-cols-3 gap-3 mb-4">
            {Object.entries(ambulances).map(([status, count]) => (
              <div key={status} className={`text-center p-3 rounded-lg ${
                status === "available" ? "bg-green-50" :
                status === "en_route" ? "bg-yellow-50" : "bg-gray-50"}`}>
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="text-xs text-gray-500 capitalize">{status.replace("_", " ")}</p>
              </div>
            ))}
          </div>
          <AmbulanceDispatch />
        </div>
      </div>

      {/* Alerts feed */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <SectionHeader title="🚨 Active Alerts"
          action={<button onClick={load} className="text-blue-500 hover:text-blue-700 text-sm flex items-center gap-1"><Icon name="refresh" className="w-4 h-4" />Refresh</button>} />
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {alerts.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No alerts</p>}
          {alerts.map(alert => (
            <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${severityColor(alert.severity)} ${alert.acknowledged ? "opacity-50" : ""}`}>
              <div className="flex-1">
                <p className="text-sm font-medium">{alert.message}</p>
                <p className="text-xs opacity-70 mt-0.5">{alert.type} · {alert.patient_id} · {new Date(alert.timestamp).toLocaleString()}</p>
              </div>
              {!alert.acknowledged && (
                <button onClick={() => ackAlert(alert.id)}
                  className="text-xs px-2 py-1 bg-white bg-opacity-60 rounded hover:bg-opacity-100 transition-all font-medium">
                  ACK
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// AMBULANCE QUICK DISPATCH
// ─────────────────────────────────────────────────────────────
const AmbulanceDispatch = () => {
  const [patientId, setPatientId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const dispatch = async () => {
    if (!patientId) return;
    setLoading(true);
    const r = await api.post("/agents/scheduler/dispatch-ambulance", {
      patient_id: patientId, lat: 12.9716, lng: 77.5946, esi_score: 1
    });
    setResult(r);
    setLoading(false);
  };

  return (
    <div className="border-t pt-3 mt-3">
      <p className="text-xs font-semibold text-gray-600 mb-2">Quick Dispatch</p>
      <div className="flex gap-2">
        <input value={patientId} onChange={e => setPatientId(e.target.value)}
          placeholder="Patient ID" className="flex-1 text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <button onClick={dispatch} disabled={loading}
          className="bg-red-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1">
          <Icon name="ambulance" className="w-4 h-4" />
          {loading ? "..." : "Dispatch"}
        </button>
      </div>
      {result && !result.error && (
        <div className="mt-2 bg-green-50 text-green-800 text-xs p-2 rounded-lg">
          🚑 {result.ambulance_id} dispatched — ETA {result.eta_mins} mins ({result.distance_km} km)
        </div>
      )}
      {result?.error && <p className="mt-2 text-red-500 text-xs">{result.error}</p>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// PATIENTS VIEW
// ─────────────────────────────────────────────────────────────
const PatientsView = () => {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [vitalsForm, setVitalsForm] = useState({});
  const [vitalsResult, setVitalsResult] = useState(null);
  const [soapText, setSoapText] = useState("");
  const [soapResult, setSoapResult] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const load = async (q = "") => {
    setLoading(true);
    const r = await api.get(`/agents/clinical/patients?limit=50${q ? `&search=${q}` : ""}`);
    setPatients(Array.isArray(r) ? r : []);
    setLoading(false);
  };

  const loadPatient = async (id) => {
    const r = await api.get(`/agents/clinical/patient/${id}`);
    setSelected(r);
    setActiveTab("overview");
  };

  useEffect(() => { load(); }, []);

  const analyzeVitals = async () => {
    const r = await api.post("/agents/vitals/analyze", { patient_id: selected.id, ...vitalsForm });
    setVitalsResult(r);
  };

  const generateSOAP = async () => {
    const r = await api.post("/agents/clinical/soap", { patient_id: selected.id, text: soapText });
    setSoapResult(r);
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Patient list */}
      <div className="w-72 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
        <div className="p-4 border-b">
          <input value={search} onChange={e => { setSearch(e.target.value); load(e.target.value); }}
            placeholder="Search patients..."
            className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <Spinner /> : patients.map(p => (
            <button key={p.id} onClick={() => loadPatient(p.id)}
              className={`w-full text-left p-3 border-b hover:bg-blue-50 transition-colors ${selected?.id === p.id ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}`}>
              <p className="font-medium text-sm text-gray-900 truncate">{p.name}</p>
              <p className="text-xs text-gray-400">{p.age}y · {p.gender} · {p.status}</p>
              <p className="text-xs text-gray-500 truncate mt-0.5">{p.primary_diagnosis}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Patient detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <div className="text-center">
              <Icon name="patients" className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>Select a patient</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
                  <p className="text-sm text-gray-500">{selected.id} · {selected.age}y · {selected.gender} · {selected.blood_group}</p>
                  <p className="text-sm text-gray-600 mt-1">{selected.primary_diagnosis}</p>
                  <p className="text-xs text-gray-400">{selected.address}, {selected.city}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    selected.status === "admitted" ? "bg-red-100 text-red-700" :
                    selected.status === "outpatient" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-700"}`}>{selected.status}</span>
                  {selected.bpl_card ? <Badge text="BPL Card" color="orange" /> : null}
                  {selected.ward && <Badge text={`Ward: ${selected.ward}`} color="purple" />}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {["overview", "vitals", "soap", "mental-health", "risk"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize ${activeTab === tab ? "bg-white shadow text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>
                  {tab.replace("-", " ")}
                </button>
              ))}
            </div>

            {/* Tab: Overview */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h3 className="font-semibold text-gray-800 mb-3">Medications</h3>
                  {(selected.context?.medications || []).map((m, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                      <Icon name="pill" className="w-4 h-4 text-blue-400" />
                      <p className="text-sm text-gray-700">{m.drug_name} — {m.dosage}</p>
                    </div>
                  ))}
                  {!selected.context?.medications?.length && <p className="text-gray-400 text-sm">No medications on record</p>}
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h3 className="font-semibold text-gray-800 mb-3">Active Alerts</h3>
                  {(selected.context?.alerts || []).slice(0, 5).map((a, i) => (
                    <div key={i} className={`p-2 rounded-lg mb-2 text-xs ${severityColor(a.severity)}`}>
                      <p className="font-semibold">{a.type}</p>
                      <p>{a.message?.slice(0, 80)}</p>
                    </div>
                  ))}
                  {!selected.context?.alerts?.length && <p className="text-gray-400 text-sm">No active alerts</p>}
                </div>
              </div>
            )}

            {/* Tab: Vitals */}
            {activeTab === "vitals" && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Record & Analyze Vitals</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[["Heart Rate", "heart_rate", "bpm"], ["BP Systolic", "bp_systolic", "mmHg"],
                    ["BP Diastolic", "bp_diastolic", "mmHg"], ["SpO2", "spo2", "%"],
                    ["Temperature", "temperature", "°C"], ["Resp. Rate", "respiratory_rate", "/min"],
                    ["Glucose", "glucose", "mg/dL"]].map(([label, key, unit]) => (
                    <div key={key}>
                      <label className="text-xs text-gray-500 font-medium">{label} ({unit})</label>
                      <input type="number" value={vitalsForm[key] || ""}
                        onChange={e => setVitalsForm(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                        className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    </div>
                  ))}
                </div>
                <button onClick={analyzeVitals}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2">
                  <Icon name="heart" className="w-4 h-4" />Analyze Vitals
                </button>
                {vitalsResult && (
                  <div className={`mt-4 p-4 rounded-xl border ${severityColor(vitalsResult.severity)}`}>
                    <p className="font-bold capitalize">{vitalsResult.severity} · {vitalsResult.trend}</p>
                    <p className="text-sm mt-1">Confidence: {vitalsResult.confidence}%</p>
                    {vitalsResult.anomalies?.map((a, i) => <p key={i} className="text-sm">⚠️ {a}</p>)}
                    {vitalsResult.recommendations?.map((r, i) => <p key={i} className="text-sm">→ {r}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* Tab: SOAP */}
            {activeTab === "soap" && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Clinical Co-Pilot — SOAP Note Generator</h3>
                <textarea value={soapText} onChange={e => setSoapText(e.target.value)}
                  placeholder="Type or paste consultation transcript / chief complaint here..."
                  className="w-full border rounded-xl p-3 text-sm h-32 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
                <button onClick={generateSOAP}
                  className="mt-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 flex items-center gap-2">
                  <Icon name="brain" className="w-4 h-4" />Generate SOAP Note
                </button>
                {soapResult && (
                  <div className="mt-4 space-y-3">
                    {soapResult.error ? <p className="text-red-500">{soapResult.error}</p> : (
                      <>
                        {[["Subjective", "subjective"], ["Objective", "objective"],
                          ["Assessment", "assessment"], ["Plan", "plan"]].map(([label, key]) => (
                          <div key={key} className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-1">{label}</p>
                            <p className="text-sm text-gray-700">{typeof soapResult[key] === "object" ? JSON.stringify(soapResult[key]) : soapResult[key]}</p>
                          </div>
                        ))}
                        {soapResult.icd10_codes?.length > 0 && (
                          <div className="bg-blue-50 rounded-xl p-3">
                            <p className="text-xs font-bold text-blue-600 mb-1">ICD-10 CODES</p>
                            {soapResult.icd10_codes.map((c, i) => (
                              <p key={i} className="text-sm text-blue-800">{c.code}: {c.description} ({c.confidence}%)</p>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-3">
                          {soapResult.billing_level && <Badge text={`Billing: ${soapResult.billing_level}`} color="purple" />}
                          {soapResult.referral_needed && <Badge text={`Refer: ${soapResult.referral_specialty}`} color="orange" />}
                          <Badge text={`Confidence: ${soapResult.confidence_overall}%`} color="blue" />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Mental Health */}
            {activeTab === "mental-health" && <MentalHealthTab patientId={selected.id} />}

            {/* Tab: Risk */}
            {activeTab === "risk" && <ReadmissionRiskTab patientId={selected.id} />}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MENTAL HEALTH TAB
// ─────────────────────────────────────────────────────────────
const MentalHealthTab = ({ patientId }) => {
  const [sessionText, setSessionText] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.get(`/agents/mental-health/history/${patientId}`).then(r => setHistory(r.sessions || []));
  }, [patientId]);

  const analyze = async () => {
    const r = await api.post("/agents/mental-health/analyze", { patient_id: patientId, session_text: sessionText });
    setResult(r);
  };

  const moodColor = (s) => s <= 3 ? "red" : s <= 6 ? "yellow" : "green";

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Analyze Session</h3>
        <textarea value={sessionText} onChange={e => setSessionText(e.target.value)}
          placeholder="Paste therapy session transcript..."
          className="w-full border rounded-xl p-3 text-sm h-32 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
        <button onClick={analyze}
          className="mt-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700">
          Analyze Session
        </button>
        {result && !result.error && (
          <div className="mt-4 bg-purple-50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-3 py-1 rounded-full text-sm font-bold bg-${moodColor(result.mood_score)}-100 text-${moodColor(result.mood_score)}-700`}>
                Mood: {result.mood_score}/10
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${severityColor(result.risk_level)}`}>
                Risk: {result.risk_level}
              </span>
              <span className="text-xs text-gray-500">{result.follow_up_urgency}</span>
            </div>
            <p className="text-sm"><strong>Themes:</strong> {result.themes?.join(", ")}</p>
            <p className="text-sm"><strong>Progress:</strong> {result.progress_vs_last}</p>
            {result.crisis_indicators?.length > 0 && (
              <div className="mt-2 bg-red-100 rounded-lg p-2">
                <p className="text-xs font-bold text-red-700">⚠️ Crisis Indicators:</p>
                {result.crisis_indicators.map((c, i) => <p key={i} className="text-xs text-red-600">{c}</p>)}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Session History</h3>
        {history.slice(-5).reverse().map((s, i) => (
          <div key={i} className="border-b pb-3 mb-3 last:border-0">
            <p className="text-xs text-gray-400">{new Date(s.timestamp).toLocaleDateString()}</p>
            <p className="text-sm text-gray-700 mt-1">{s.text_preview}</p>
            {s.analysis?.mood_score && (
              <p className="text-xs text-gray-500 mt-1">Mood: {s.analysis.mood_score}/10 · Risk: {s.analysis.risk_level}</p>
            )}
          </div>
        ))}
        {history.length === 0 && <p className="text-gray-400 text-sm">No sessions recorded yet</p>}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// READMISSION RISK TAB
// ─────────────────────────────────────────────────────────────
const ReadmissionRiskTab = ({ patientId }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const calculate = async () => {
    setLoading(true);
    const r = await api.post(`/agents/scheduler/readmission-risk/${patientId}`, {});
    setResult(r);
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">30-Day Readmission Risk Assessment</h3>
      <button onClick={calculate} disabled={loading}
        className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
        {loading ? "Calculating..." : "Calculate Risk"}
      </button>
      {result && !result.error && (
        <div className="mt-4 space-y-3">
          <div className={`p-4 rounded-xl border text-center ${
            result.risk_label === "high" ? "bg-red-50 border-red-200" :
            result.risk_label === "moderate" ? "bg-yellow-50 border-yellow-200" :
            "bg-green-50 border-green-200"}`}>
            <p className="text-4xl font-bold">{result.risk_score}%</p>
            <p className="text-lg font-semibold capitalize mt-1">{result.risk_label} Risk</p>
            <p className="text-sm text-gray-500">Recommended follow-up in {result.follow_up_days} days</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-bold text-gray-500 mb-2">TOP RISK FACTORS</p>
            {result.top_factors?.map((f, i) => <p key={i} className="text-sm text-gray-700">• {f}</p>)}
          </div>
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-xs font-bold text-blue-600 mb-2">RECOMMENDATIONS</p>
            {result.recommendations?.map((r, i) => <p key={i} className="text-sm text-blue-700">→ {r}</p>)}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// SCHEDULING VIEW
// ─────────────────────────────────────────────────────────────
const SchedulingView = () => {
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [specialty, setSpecialty] = useState("");
  const [bookForm, setBookForm] = useState({ patient_id: "", doctor_id: "", scheduled_at: "", reason: "", esi_score: 5 });
  const [booking, setBooking] = useState(null);
  const [triageForm, setTriageForm] = useState({ patient_id: "", symptoms: "", language: "english" });
  const [triageResult, setTriageResult] = useState(null);

  const SPECIALTIES = ["Cardiology", "General Medicine", "Orthopedics", "Neurology",
    "Pediatrics", "Gynecology", "Psychiatry", "Emergency Medicine", "Pulmonology"];

  useEffect(() => { loadDoctors(); loadAppts(); }, []);

  const loadDoctors = async (spec = "") => {
    const r = await api.get(`/agents/scheduler/doctors?specialty=${spec}&esi_score=5`);
    setDoctors(Array.isArray(r) ? r : []);
  };

  const loadAppts = async () => {
    const today = new Date().toISOString().split("T")[0];
    const r = await api.get(`/agents/scheduler/appointments?date=${today}&limit=50`);
    setAppointments(Array.isArray(r) ? r : []);
  };

  const bookAppointment = async () => {
    const r = await api.post("/agents/scheduler/book", bookForm);
    setBooking(r);
    if (!r.error) loadAppts();
  };

  const triage = async () => {
    const r = await api.post("/agents/rural/triage", triageForm);
    setTriageResult(r);
    if (r.recommended_specialty) loadDoctors(r.recommended_specialty);
  };

  return (
    <div className="space-y-4">
      {/* Triage */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <SectionHeader title="🚦 AI Triage — ESI Scoring" sub="Assess severity and route to correct specialty" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input value={triageForm.patient_id} onChange={e => setTriageForm(p => ({ ...p, patient_id: e.target.value }))}
            placeholder="Patient ID" className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <input value={triageForm.symptoms} onChange={e => setTriageForm(p => ({ ...p, symptoms: e.target.value }))}
            placeholder="Describe symptoms..." className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <select value={triageForm.language} onChange={e => setTriageForm(p => ({ ...p, language: e.target.value }))}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {["english", "kannada", "hindi", "tamil", "telugu"].map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
        <button onClick={triage}
          className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">
          Run Triage Assessment
        </button>
        {triageResult && (
          <div className="mt-4 bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className={`px-4 py-2 rounded-xl text-lg font-black ${esiColor(triageResult.esi_score)}`}>
                ESI {triageResult.esi_score}
              </span>
              <div>
                <p className="font-bold text-gray-900">{triageResult.esi_label}</p>
                <p className="text-sm text-gray-500">{triageResult.recommended_specialty}</p>
              </div>
              <div className="ml-auto flex gap-2">
                {triageResult.needs_ambulance && <Badge text="🚑 Ambulance" color="red" />}
                {triageResult.pmjay_likely_covered && <Badge text="PM-JAY Covered" color="green" />}
              </div>
            </div>
            {triageResult.suspected_conditions?.map((c, i) => (
              <p key={i} className="text-sm text-gray-700">• {typeof c === "object" ? JSON.stringify(c) : c}</p>
            ))}
            {triageResult.language_instructions && (
              <div className="mt-2 bg-blue-50 rounded-lg p-2">
                <p className="text-xs font-bold text-blue-600">Patient Instructions ({triageForm.language}):</p>
                <p className="text-sm text-blue-800">{triageResult.language_instructions}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Book appointment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader title="📅 Book Appointment" />
          <div className="space-y-3">
            {[["Patient ID", "patient_id", "text"], ["Doctor ID", "doctor_id", "text"],
              ["Date & Time", "scheduled_at", "datetime-local"], ["Reason", "reason", "text"]].map(([label, key, type]) => (
              <div key={key}>
                <label className="text-xs text-gray-500 font-medium">{label}</label>
                <input type={type} value={bookForm[key]}
                  onChange={e => setBookForm(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-500 font-medium">ESI Score</label>
              <select value={bookForm.esi_score} onChange={e => setBookForm(p => ({ ...p, esi_score: parseInt(e.target.value) }))}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} — {esiLabel(n)}</option>)}
              </select>
            </div>
            <button onClick={bookAppointment}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700">
              Confirm Booking
            </button>
          </div>
          {booking && !booking.error && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3">
              <p className="text-green-700 font-semibold text-sm flex items-center gap-2">
                <Icon name="check" className="w-4 h-4" />Appointment Confirmed
              </p>
              <p className="text-xs text-green-600">ID: {booking.appointment_id}</p>
            </div>
          )}
        </div>

        {/* Available doctors */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <SectionHeader title="👨‍⚕️ Available Doctors"
            action={
              <select value={specialty} onChange={e => { setSpecialty(e.target.value); loadDoctors(e.target.value); }}
                className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">All Specialties</option>
                {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
              </select>
            } />
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {doctors.slice(0, 10).map(d => (
              <div key={d.id} onClick={() => setBookForm(p => ({ ...p, doctor_id: d.id }))}
                className={`p-3 rounded-lg border cursor-pointer hover:border-blue-400 transition-all ${bookForm.doctor_id === d.id ? "border-blue-500 bg-blue-50" : "border-gray-100"}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{d.name}</p>
                    <p className="text-xs text-gray-500">{d.specialty} · {d.experience_years}y exp · {d.room_number}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.status === "available" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{d.status}</span>
                    {d.on_call ? <Badge text="On Call" color="purple" /> : null}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">Today: {d.today_count || 0} patients · Shift {d.shift_start}–{d.shift_end}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Today's appointments */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <SectionHeader title="📋 Today's Appointments" sub={`${appointments.length} scheduled`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-400">
              <th className="pb-2 pr-4">Patient</th><th className="pb-2 pr-4">Doctor</th>
              <th className="pb-2 pr-4">Time</th><th className="pb-2 pr-4">ESI</th>
              <th className="pb-2">Status</th>
            </tr></thead>
            <tbody>
              {appointments.slice(0, 20).map(a => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium">{a.patient_id}</td>
                  <td className="py-2 pr-4 text-gray-600">{a.doctor_name}</td>
                  <td className="py-2 pr-4 text-gray-500">{new Date(a.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="py-2 pr-4"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${esiColor(a.esi_score)}`}>ESI {a.esi_score}</span></td>
                  <td className="py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${a.status === "confirmed" ? "bg-blue-100 text-blue-700" : a.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// NL QUERY VIEW (DataGod Chat)
// ─────────────────────────────────────────────────────────────
const QueryView = () => {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Ask me anything about hospital data in plain English. I'll generate the SQL, run it, and visualize the results." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const SUGGESTIONS = [
    "Show admitted patients today",
    "Which ward has highest occupancy?",
    "Top 5 diagnoses this month",
    "Patients with critical vitals",
    "Average patient age by diagnosis",
  ];

  const send = async (q = input) => {
    if (!q.trim()) return;
    const userMsg = { role: "user", content: q };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setLoading(true);
    const r = await api.post("/agents/clinical/query", { question: q });
    const aiMsg = { role: "assistant", content: "", queryResult: r };
    setMessages(m => [...m, aiMsg]);
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-3xl rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-blue-600 text-white" : "bg-white shadow-sm border border-gray-100"}`}>
              {m.content && <p className="text-sm">{m.content}</p>}
              {m.queryResult && (
                <div className="mt-2 space-y-2">
                  {m.queryResult.error ? (
                    <p className="text-red-500 text-sm">❌ {m.queryResult.error}</p>
                  ) : (
                    <>
                      <div className="bg-gray-800 text-green-400 rounded-lg p-3 font-mono text-xs overflow-x-auto">
                        {m.queryResult.sql}
                      </div>
                      <p className="text-xs text-gray-500">{m.queryResult.explanation} · {m.queryResult.row_count} rows</p>
                      {m.queryResult.data?.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead><tr className="bg-gray-50">
                              {Object.keys(m.queryResult.data[0]).map(k => (
                                <th key={k} className="text-left px-2 py-1 border border-gray-200 font-semibold text-gray-600">{k}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {m.queryResult.data.slice(0, 10).map((row, ri) => (
                                <tr key={ri} className="hover:bg-gray-50">
                                  {Object.values(row).map((v, vi) => (
                                    <td key={vi} className="px-2 py-1 border border-gray-100 text-gray-700">{String(v).slice(0, 40)}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {m.queryResult.row_count > 10 && <p className="text-xs text-gray-400 mt-1">Showing 10 of {m.queryResult.row_count} rows</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => <div key={i} className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="flex gap-2 flex-wrap mb-3">
        {SUGGESTIONS.map(s => (
          <button key={s} onClick={() => send(s)}
            className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full hover:bg-blue-100 transition-colors">
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask in plain English: 'Show me all diabetic patients admitted this week'"
          className="flex-1 border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <button onClick={() => send()} disabled={loading}
          className="bg-blue-600 text-white px-4 py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50">
          <Icon name="send" className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// DEMO VIEW
// ─────────────────────────────────────────────────────────────
const DemoView = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [step, setStep] = useState(0);

  const STEPS = [
    { label: "Patient Arrival", icon: "patients", key: "arrival", color: "blue" },
    { label: "Vitals Analysis", icon: "heart", key: "vitals", color: "red" },
    { label: "SOAP Note Generated", icon: "brain", key: "soap", color: "green" },
    { label: "Mental Health Flag", icon: "alert", key: "mental_health", color: "purple" },
    { label: "Readmission Risk", icon: "chart", key: "readmission_risk", color: "orange" },
  ];

  const runDemo = async () => {
    setLoading(true); setResult(null); setStep(0);
    const r = await api.post("/orchestrator/demo?patient_id=DEMO-001");
    setResult(r);
    setLoading(false);
    // Animate steps
    for (let i = 0; i <= STEPS.length; i++) {
      await new Promise(res => setTimeout(res, 400));
      setStep(i);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl p-6 text-white">
        <h2 className="text-2xl font-black mb-2">🎬 Live Demo — Full Patient Journey</h2>
        <p className="text-blue-100 text-sm mb-4">
          Raju, 58, arrives with chest pain. Watch every agent fire in sequence — triage → ambulance dispatch → doctor booking → SOAP note → mental health flag — all powered by MCP shared context.
        </p>
        <button onClick={runDemo} disabled={loading}
          className="bg-white text-blue-700 font-bold px-6 py-3 rounded-xl hover:bg-blue-50 disabled:opacity-50 flex items-center gap-2">
          <Icon name="demo" className="w-5 h-5" />
          {loading ? "Running Demo..." : "Run Full Patient Journey"}
        </button>
      </div>

      {/* Step progress */}
      {(loading || result) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="font-semibold text-gray-800 mb-4">Agent Pipeline</p>
          <div className="flex items-center gap-2 flex-wrap">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-500 ${
                  step > i ? `bg-${s.color}-100 text-${s.color}-700` : "bg-gray-50 text-gray-400"}`}>
                  <Icon name={s.icon} className="w-4 h-4" />
                  <span className="text-sm font-medium">{s.label}</span>
                  {step > i && <Icon name="check" className="w-4 h-4" />}
                </div>
                {i < STEPS.length - 1 && <span className="text-gray-300">→</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {STEPS.map(s => result[s.key] && (
            <div key={s.key} className={`bg-white rounded-xl shadow-sm border border-${s.color}-100 p-5`}>
              <p className={`font-bold text-${s.color}-700 mb-2 flex items-center gap-2`}>
                <Icon name={s.icon} className="w-5 h-5" />{s.label}
              </p>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3 overflow-x-auto max-h-48">
                {JSON.stringify(result[s.key], null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("dashboard");
  const [ws, setWs] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");

  // WebSocket connection
  useEffect(() => {
    const connect = () => {
      try {
        const socket = new WebSocket(WS_URL);
        socket.onopen = () => setWsStatus("connected");
        socket.onclose = () => { setWsStatus("disconnected"); setTimeout(connect, 3000); };
        socket.onerror = () => setWsStatus("error");
        setWs(socket);
        return socket;
      } catch { setWsStatus("error"); }
    };
    const socket = connect();
    return () => socket?.close();
  }, []);

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "patients", label: "Patients", icon: "patients" },
    { id: "scheduling", label: "Scheduling", icon: "calendar" },
    { id: "query", label: "Query AI", icon: "chat" },
    { id: "demo", label: "Live Demo", icon: "demo" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white shadow-sm border-r border-gray-100 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="p-5 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Icon name="heart" className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-black text-gray-900 text-sm">MediCore AI</p>
              <p className="text-xs text-gray-400">MCP Platform</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(item => (
            <button key={item.id} onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                view === item.id ? "bg-blue-600 text-white shadow-md" : "text-gray-600 hover:bg-gray-50"}`}>
              <Icon name={item.icon} className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* WS status */}
        <div className="p-4 border-t">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${wsStatus === "connected" ? "bg-green-500 animate-pulse" : wsStatus === "connecting" ? "bg-yellow-500" : "bg-red-500"}`} />
            <p className="text-xs text-gray-400 capitalize">{wsStatus}</p>
          </div>
          <p className="text-xs text-gray-300 mt-1">Live updates {wsStatus === "connected" ? "active" : "offline"}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-bold text-gray-900 capitalize">{NAV.find(n => n.id === view)?.label}</h1>
            <p className="text-xs text-gray-400">{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-semibold">
              claude-sonnet-4
            </span>
            <span className="text-xs bg-green-50 text-green-600 px-3 py-1 rounded-full font-semibold">
              MCP Active
            </span>
          </div>
        </header>

        {/* View content */}
        <div className="flex-1 overflow-y-auto p-6">
          {view === "dashboard" && <DashboardView ws={ws} />}
          {view === "patients" && <PatientsView />}
          {view === "scheduling" && <SchedulingView />}
          {view === "query" && <QueryView />}
          {view === "demo" && <DemoView />}
        </div>
      </main>
    </div>
  );
}
