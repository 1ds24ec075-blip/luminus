import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, Search, Play, Save, Share2, AlertCircle, 
  BarChart2, PieChart, Activity, MessageSquare, 
  History, Pin, Globe, User, Clock, CheckCircle, XCircle
} from 'lucide-react';
import axios from 'axios';
import { 
  BarChart, Bar, LineChart, Line, PieChart as RePieChart, Pie, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell 
} from 'recharts';

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : "http://localhost:8000");
const WS_URL = API.replace("http", "ws") + "/ws";

// ─────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────

const SQLPreview = ({ sql, onExecute, onCancel }) => (
  <div className="bg-slate-900 rounded-lg border border-slate-700 p-4 my-2 font-mono text-sm">
    <div className="flex justify-between items-center mb-2 border-b border-slate-700 pb-2">
      <span className="text-blue-400 flex items-center gap-2"><Database size={14} /> SQL PREVIEW</span>
      <div className="flex gap-2">
        <button onClick={onCancel} className="text-slate-400 hover:text-white px-2 py-1 rounded">Cancel</button>
        <button onClick={onExecute} className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-500 flex items-center gap-1">
          <Play size={14} /> Execute
        </button>
      </div>
    </div>
    <pre className="text-slate-300 overflow-x-auto p-2 bg-slate-950 rounded">{sql}</pre>
  </div>
);

const InsightCard = ({ title, chartType, data, onPin, onShare }) => {
  const renderChart = () => {
    if (!data || data.length === 0) return <div className="p-8 text-center text-slate-500">No data returned</div>;

    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey={Object.keys(data[0])[0]} stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
            <Bar dataKey={Object.keys(data[0])[1]} fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey={Object.keys(data[0])[0]} stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
            <Line type="monotone" dataKey={Object.keys(data[0])[1]} stroke="#3b82f6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'pie') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <RePieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey={Object.keys(data[0])[1]}
              nameKey={Object.keys(data[0])[0]}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'][index % 5]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </RePieChart>
        </ResponsiveContainer>
      );
    }

    // Table fallback
    return (
      <div className="overflow-x-auto max-h-[400px]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              {Object.keys(data[0]).map(key => (
                <th key={key} className="px-4 py-2 font-medium text-slate-300">{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20">
                {Object.values(row).map((val, j) => (
                  <td key={j} className="px-4 py-2 text-slate-400">{val}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800 bg-slate-800/30">
        <h3 className="font-semibold text-slate-100 flex items-center gap-2">
          {chartType === 'table' ? <History size={16} /> : <BarChart2 size={16} />}
          {title}
        </h3>
        <div className="flex gap-2">
          <button onClick={onPin} className="p-1.5 hover:bg-slate-700 rounded-md text-slate-400 hover:text-blue-400 transition-colors">
            <Pin size={16} />
          </button>
          <button onClick={onShare} className="p-1.5 hover:bg-slate-700 rounded-md text-slate-400 hover:text-green-400 transition-colors">
            <Share2 size={16} />
          </button>
        </div>
      </div>
      <div className="p-4 bg-slate-950/50">
        {renderChart()}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('chat'); // 'chat' | 'dashboard' | 'alerts'
  const [messages, setMessages] = useState([
    { role: 'ai', content: "Welcome to DataGod Health. I'm your AI Clinical Analyst. Ask me anything about your hospital operations, patients, or vitals trend." }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pinnedInsights, setPinnedInsights] = useState([]);
  const [stats, setStats] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchStats();
    fetchAlerts();
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.event === 'alert') fetchAlerts();
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API}/dashboard/summary`);
      setStats(res.data);
    } catch (e) { console.error(e); }
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API}/dashboard/alerts?limit=5`);
      setAlerts(res.data);
    } catch (e) { console.error(e); }
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    const userMsg = inputValue;
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsTyping(true);

    try {
      const res = await axios.post(`${API}/chat`, { question: userMsg });
      if (res.data.error) {
        setMessages(prev => [...prev, { role: 'ai', content: `Error: ${res.data.error}` }]);
      } else {
        setMessages(prev => [...prev, { 
          role: 'ai', 
          content: res.data.explanation,
          sql: res.data.sql,
          chartType: res.data.chart_type,
          data: res.data.data,
          title: userMsg
        }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', content: "Connection failed. Please ensure the backend is running." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const pinInsight = (insight) => {
    setPinnedInsights(prev => [insight, ...prev]);
    setView('dashboard');
    // Persistence would go to backend /dashboard/pin here
  };

  const shareInsight = (insight) => {
    alert(`Shareable link generated for: ${insight.title}\n(Check implementation plan for share token logic)`);
  };

  return (
    <div className="flex h-screen bg-black text-slate-200 font-sans selection:bg-blue-500/30 overflow-hidden">
      
      {/* ─────────────────────────────────────────────────────────────
          SIDEBAR
          ───────────────────────────────────────────────────────────── */}
      <aside className="w-72 bg-slate-950 border-r border-slate-900 flex flex-col z-20">
        <div className="p-6 border-b border-slate-900 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <Database className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">DataGod <span className="text-blue-500">Health</span></h1>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
              {wsStatus}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4">
          <button 
            onClick={() => setView('chat')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${view === 'chat' ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'hover:bg-slate-900 text-slate-400 hover:text-slate-200'}`}
          >
            <MessageSquare size={18} />
            <span className="font-medium">Conversational AI</span>
          </button>
          <button 
            onClick={() => setView('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${view === 'dashboard' ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'hover:bg-slate-900 text-slate-400 hover:text-slate-200'}`}
          >
            <BarChart2 size={18} />
            <span className="font-medium">Command Dashboard</span>
          </button>
          <button 
            onClick={() => setView('alerts')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${view === 'alerts' ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'hover:bg-slate-900 text-slate-400 hover:text-slate-200'}`}
          >
            <AlertCircle size={18} />
            <span className="font-medium">Operational Alerts</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-900 bg-slate-950/50">
          <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-800">
            <div className="text-[10px] text-slate-500 font-bold uppercase mb-2">System Health</div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Clinical DB</span>
                <span className="text-emerald-400">Online</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">GenAI Engine</span>
                <span className="text-blue-400">Gemini 1.5</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────
          MAIN CONTENT
          ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 relative flex flex-col bg-slate-950/30 backdrop-blur-3xl min-w-0">
        
        {/* Header Strip */}
        <header className="h-16 border-b border-slate-900 flex items-center justify-between px-8 bg-slate-950/20 sticky top-0 z-10">
          <div className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <Globe size={14} className="text-blue-500" /> Bengaluru Medical District
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 rounded-full border border-slate-800 text-xs">
              <Clock size={14} className="text-slate-500" /> {new Date().toLocaleTimeString()}
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
              SJ
            </div>
          </div>
        </header>

        {/* Dynamic View Area */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
          
          {view === 'chat' && (
            <div className="max-w-4xl mx-auto flex flex-col h-full">
              <div className="flex-1 space-y-6 pb-32">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-6 py-4 shadow-xl ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                    }`}>
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      
                      {msg.sql && (
                        <SQLPreview 
                          sql={msg.sql} 
                          onExecute={() => console.log('Executing...')} 
                          onCancel={() => console.log('Cancelled')} 
                        />
                      )}

                      {msg.data && (
                        <div className="mt-4">
                          <InsightCard 
                            title={msg.title}
                            chartType={msg.chartType}
                            data={msg.data}
                            onPin={() => pinInsight(msg)}
                            onShare={() => shareInsight(msg)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none px-6 py-4 flex gap-1">
                      <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce delay-0"></span>
                      <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce delay-150"></span>
                      <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce delay-300"></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Fixes */}
              <div className="absolute bottom-8 left-12 right-12 z-20">
                <div className="max-w-4xl mx-auto flex gap-3 p-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-white/5">
                  <input 
                    className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-3 placeholder-slate-600 text-slate-100"
                    placeholder="E.g. 'Summarize ICU occupancy by department' or 'Show vitals trends for PT0042'"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  />
                  <button 
                    onClick={handleSend}
                    className="aspect-square w-12 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-blue-600/20"
                  >
                    <Play size={18} className="rotate-[-45deg] relative left-[1px] top-[-1px]" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <section className="grid grid-cols-4 gap-6">
                {[
                  { label: "Total Patients", val: stats.total_patients || 0, icon: User, color: "text-blue-500" },
                  { label: "Active Admissions", val: stats.admitted || 0, icon: Activity, color: "text-emerald-500" },
                  { label: "Today's ICU Alerts", val: stats.critical_alerts || 0, icon: AlertCircle, color: "text-rose-500" },
                  { label: "Waitlist P5", val: 12, icon: Clock, color: "text-amber-500" }
                ].map((stat, i) => (
                  <div key={i} className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl group hover:border-blue-500/30 transition-all">
                    <div className="flex justify-between items-start mb-4">
                      <div className={`p-2 bg-slate-950 rounded-lg border border-slate-800 ${stat.color}`}>
                        <stat.icon size={20} />
                      </div>
                      <span className="text-[10px] text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">+4.3%</span>
                    </div>
                    <div className="text-2xl font-bold text-white mb-1">{stat.val}</div>
                    <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{stat.label}</div>
                  </div>
                ))}
              </section>

              <section className="mt-12">
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <Pin size={20} className="text-blue-500" /> Command Dashboard <span className="text-xs font-normal text-slate-500 ml-2">({pinnedInsights.length} Pinned Insights)</span>
                </h2>
                
                {pinnedInsights.length === 0 ? (
                  <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-3xl p-12 text-center">
                    <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-800">
                      <BarChart2 className="text-slate-600" size={32} />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-300">Nothing pinned yet</h3>
                    <p className="text-slate-500 mb-6 max-w-sm mx-auto">Use the Conversational AI to discover insights, then pin them here to build your real-time command center.</p>
                    <button onClick={() => setView('chat')} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-6 py-2 rounded-xl transition-all">Go to AI Chat</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-8 pb-12">
                    {pinnedInsights.map((insight, idx) => (
                      <InsightCard 
                        key={idx}
                        title={insight.title}
                        chartType={insight.chartType}
                        data={insight.data}
                        onPin={() => {}}
                        onShare={() => shareInsight(insight)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {view === 'alerts' && (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-2xl font-bold text-white mb-8">Operational Alerts Feed</h2>
              {alerts.length === 0 ? (
                <div className="text-slate-500 p-12 text-center h-[50vh] flex flex-col items-center justify-center">
                  <CheckCircle size={48} className="mb-4 text-emerald-500/50" />
                  <p>All systems normal. No pending operational alerts.</p>
                </div>
              ) : (
                alerts.map((alert, i) => (
                  <div key={i} className={`p-6 rounded-2xl border flex gap-6 items-start transition-all transform hover:scale-[1.01] ${
                    alert.severity === 'critical' 
                      ? 'bg-rose-950/20 border-rose-900/50' 
                      : 'bg-slate-900 border-slate-800'
                  }`}>
                    <div className={`p-3 rounded-xl ${
                      alert.severity === 'critical' ? 'bg-rose-900/40 text-rose-400' : 'bg-slate-950 text-slate-400'
                    }`}>
                      {alert.severity === 'critical' ? <AlertCircle size={24} /> : <Activity size={24} />}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-slate-200">{alert.message}</h4>
                        <span className="text-[10px] text-slate-500 font-mono">{new Date(alert.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-slate-500 mb-4 uppercase tracking-tighter text-xs">Patient ID: {alert.patient_id} • Status: Pending Action</p>
                      <div className="flex gap-2">
                        <button className="bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 px-4 py-1.5 rounded-lg">Acknowledge</button>
                        <button className="text-xs text-blue-500 hover:text-blue-400 px-4 py-1.5">View Record</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      </main>

      {/* Global CSS for scrollbars */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </div>
  );
}
