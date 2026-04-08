/* ===================================================
   LUMINUS — Healthcare Intelligence Platform
   Application Logic: Login, Routing, Dashboard Render
   =================================================== */

(function () {
  'use strict';

  // -------- Demo credential store --------
  const USERS = {
    patient1: { password: 'pass123', role: 'patient', name: 'Arjun Mehta' },
    drsharma: { password: 'pass123', role: 'doctor', name: 'Dr. Priya Sharma' },
    admin01:  { password: 'pass123', role: 'admin',  name: 'Ravi Kapoor' },
    labadmin: { password: 'pass123', role: 'lab',    name: 'Sneha Iyer' },
  };

  // -------- Role metadata --------
  const ROLE_META = {
    patient: {
      label: 'Patient',
      color: 'green',
      welcomeSub: 'Sign in to your patient portal',
      dashGreeting: 'Here\'s your health summary for today.',
    },
    doctor: {
      label: 'Doctor',
      color: 'blue',
      welcomeSub: 'Access your clinical workspace',
      dashGreeting: 'Your clinical workspace is ready.',
    },
    admin: {
      label: 'Administrator',
      color: 'purple',
      welcomeSub: 'Manage hospital operations',
      dashGreeting: 'Hospital operations at a glance.',
    },
    lab: {
      label: 'Lab Admin',
      color: 'amber',
      welcomeSub: 'Laboratory management console',
      dashGreeting: 'Lab operations overview.',
    },
  };

  const LUMI_API_URL = 'http://127.0.0.1:8000/api/chat';

  // -------- DOM References --------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const loginCard    = $('#loginCard');
  const loginForm    = $('#loginForm');
  const usernameEl   = $('#username');
  const passwordEl   = $('#password');
  const loginBtn     = $('#loginBtn');
  const togglePw     = $('#togglePw');
  const welcomeTitle = $('#welcomeTitle');
  const welcomeSub   = $('#welcomeSub');
  const toast        = $('#toast');
  const toastMsg     = $('#toastMsg');

  let selectedRole = 'patient';
  let toastTimer = null;

  // -------- Particle Canvas --------
  function initParticles() {
    const canvas = $('#particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 50;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
      constructor() { this.reset(); }
      reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.radius = Math.random() * 1.5 + 0.5;
        this.opacity = Math.random() * 0.3 + 0.1;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(67, 97, 238, ${this.opacity * 0.6})`;
        ctx.fill();
      }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    function connectParticles() {
      for (let a = 0; a < particles.length; a++) {
        for (let b = a + 1; b < particles.length; b++) {
          const dx = particles[a].x - particles[b].x;
          const dy = particles[a].y - particles[b].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.strokeStyle = `rgba(67, 97, 238, ${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => { p.update(); p.draw(); });
      connectParticles();
      requestAnimationFrame(animate);
    }
    animate();
  }

  // -------- Counter Animation --------
  function animateCounters() {
    $$('.stat-number').forEach((el) => {
      const target = parseInt(el.dataset.target, 10);
      const duration = 2000;
      const step = target / (duration / 16);
      let current = 0;
      const tick = () => {
        current += step;
        if (current >= target) {
          el.textContent = target.toLocaleString();
          if (el.dataset.target === '99') el.textContent += '%';
          return;
        }
        el.textContent = Math.floor(current).toLocaleString();
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  // -------- Toast --------
  function showToast(msg, type = 'error') {
    toastMsg.textContent = msg;
    toast.className = 'toast ' + type + ' show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  // -------- Role Selection --------
  $$('.role-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.role-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRole = btn.dataset.role;
      const meta = ROLE_META[selectedRole];
      welcomeSub.textContent = meta.welcomeSub;

      // Animate focus color change on input
      document.documentElement.style.setProperty(
        '--focus-ring',
        getComputedStyle(document.documentElement).getPropertyValue(`--accent-${meta.color}`)
      );
    });
  });

  // -------- Toggle Password --------
  togglePw.addEventListener('click', () => {
    const isPassword = passwordEl.type === 'password';
    passwordEl.type = isPassword ? 'text' : 'password';
    // swap icon to indicate state
    togglePw.style.opacity = isPassword ? '1' : '0.5';
  });

  // -------- Demo Chips --------
  $$('.demo-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const { user, pass, role } = chip.dataset;
      usernameEl.value = user;
      passwordEl.value = pass;
      // Select matching role
      $$('.role-btn').forEach((b) => b.classList.remove('active'));
      const matching = $(`.role-btn[data-role="${role}"]`);
      if (matching) matching.classList.add('active');
      selectedRole = role;
      welcomeSub.textContent = ROLE_META[role].welcomeSub;

      // Subtle bounce feedback
      chip.style.transform = 'scale(0.95)';
      setTimeout(() => (chip.style.transform = ''), 150);
    });
  });

  // -------- Form Submit --------
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Reset errors
    $('#usernameGroup').classList.remove('error');
    $('#passwordGroup').classList.remove('error');
    $('#usernameError').textContent = '';
    $('#passwordError').textContent = '';

    const user = usernameEl.value.trim().toLowerCase();
    const pass = passwordEl.value;

    // Validate
    if (!user) {
      $('#usernameGroup').classList.add('error');
      $('#usernameError').textContent = 'Username is required';
      usernameEl.focus();
      return;
    }
    if (!pass) {
      $('#passwordGroup').classList.add('error');
      $('#passwordError').textContent = 'Password is required';
      passwordEl.focus();
      return;
    }

    // Simulate async auth
    loginBtn.classList.add('loading');
    loginBtn.disabled = true;

    setTimeout(() => {
      loginBtn.classList.remove('loading');
      loginBtn.disabled = false;

      const record = USERS[user];
      if (!record) {
        showToast('User not found. Try a demo account.', 'error');
        $('#usernameGroup').classList.add('error');
        $('#usernameError').textContent = 'Unknown username';
        return;
      }
      if (record.password !== pass) {
        showToast('Incorrect password.', 'error');
        $('#passwordGroup').classList.add('error');
        $('#passwordError').textContent = 'Wrong password';
        return;
      }
      if (record.role !== selectedRole) {
        showToast(`This account is for the ${ROLE_META[record.role].label} role.`, 'error');
        return;
      }

      // Auth success → transition to dashboard
      showToast(`Welcome, ${record.name}!`, 'success');
      setTimeout(() => navigateToDashboard(user, record), 600);
    }, 1200);
  });

  // -------- Navigate to Dashboard --------
  function navigateToDashboard(username, record) {
    // Hide login UI
    $('.main-container').style.display = 'none';

    // Build & show dashboard
    renderDashboard(username, record);
  }

  // -------- Render Dashboard --------
  function renderDashboard(username, record) {
    const existing = $('#dashboardPage');
    if (existing) existing.remove();

    const role = record.role;
    const meta = ROLE_META[role];

    const page = document.createElement('div');
    page.id = 'dashboardPage';
    page.className = 'dashboard-page active';

    // Avatar initials & color
    const initials = record.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const avatarColors = { patient: '#10b981', doctor: '#4361ee', admin: '#8b5cf6', lab: '#f59e0b' };
    const avatarColor = avatarColors[role] || '#4361ee';

    // Sidebar nav items
    const allNavItems = [
      { id: 'doctor', label: 'Doctor', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
      { id: 'patient', label: 'Patient', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
      { id: 'admin', label: 'Admin', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
      { id: 'lab', label: 'Laboratory', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3v7.2l-4 6.8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-4-6.8V3"/><line x1="9" y1="3" x2="15" y2="3"/></svg>' },
    ];

    // Only show the current role's nav item
    const navItems = allNavItems.filter(item => item.id === role);

    const sidebarNavHTML = navItems.map(item =>
      `<button class="sidebar-nav-item active" data-nav="${item.id}">
        ${item.icon}
        <span>${item.label}</span>
      </button>`
    ).join('');

    // Main content depends on role
    const mainContentHTML = role === 'patient'
      ? getPatientDashboard(record)
      : getGenericDashboard(record, role, meta);

    page.innerHTML = `
      <aside class="dash-sidebar">
        <div class="sidebar-logo">
          <svg viewBox="0 0 60 60" fill="none">
            <circle cx="30" cy="30" r="28" stroke="#4361ee" stroke-width="2.5"/>
            <path d="M30 14V46M22 30H38" stroke="#4361ee" stroke-width="3" stroke-linecap="round"/>
            <circle cx="30" cy="30" r="8" stroke="#4361ee" stroke-width="1.5" opacity="0.4"/>
          </svg>
          <span class="sidebar-logo-text">Luminus</span>
        </div>
        <nav class="sidebar-nav">
          ${sidebarNavHTML}
        </nav>
        <button class="dash-logout-btn" id="logoutBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
        <div class="sidebar-footer">
          <div class="sidebar-footer-avatar" style="background:${avatarColor}">${initials}</div>
          <div class="sidebar-footer-info">
            <span class="sidebar-footer-name">${record.name}</span>
            <span class="sidebar-footer-role">${meta.label}</span>
          </div>
        </div>
      </aside>
      <main class="dash-main">
        <div class="dash-topbar">
          <div class="dash-greeting">
            <h1>Hello, ${record.name.split(' ')[0]}</h1>
            <p>${meta.dashGreeting}</p>
          </div>
          <button class="emergency-btn" id="emergencyBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.1 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2z"/></svg>
            Emergency Help
          </button>
        </div>
        <div class="dash-content">
          ${mainContentHTML}
        </div>
      </main>
    `;

    document.body.appendChild(page);

    // Animate health rings after paint
    if (role === 'patient') {
      requestAnimationFrame(() => {
        setTimeout(() => animateHealthRings(), 100);
      });
    }

    // Logout handler
    $('#logoutBtn').addEventListener('click', () => {
      page.remove();
      $('.main-container').style.display = 'flex';
      usernameEl.value = '';
      passwordEl.value = '';
    });

    // Med "Take now" buttons
    page.querySelectorAll('.med-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.medication-item');
        const check = item.querySelector('.med-check');
        const name = item.querySelector('.med-name');
        check.classList.add('taken');
        name.classList.add('taken-text');
        btn.textContent = 'Taken ✓';
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'default';
      });
    });

    if (role === 'patient') {
      const lumiChatBtn = page.querySelector('.lumi-chat-btn');
      if (lumiChatBtn) {
        lumiChatBtn.addEventListener('click', () => {
          openLumiAssistant(page, username, record);
        });
      }
    }
  }

  function getPatientContext(page, username, record) {
    const appointments = Array.from(page.querySelectorAll('.appointment-item')).map((item) => {
      const month = item.querySelector('.appt-month')?.textContent?.trim() || '';
      const day = item.querySelector('.appt-day')?.textContent?.trim() || '';
      const doctor = item.querySelector('.appt-doctor')?.textContent?.trim() || '';
      const type = item.querySelector('.appt-type')?.textContent?.trim() || '';
      return { date: `${month} ${day}`.trim(), doctor, type };
    });

    const medications = Array.from(page.querySelectorAll('.medication-item')).map((item) => {
      const name = item.querySelector('.med-name')?.textContent?.trim() || '';
      const schedule = item.querySelector('.med-schedule')?.textContent?.trim() || '';
      const taken = item.querySelector('.med-check')?.classList.contains('taken') || false;
      return { name, schedule, taken };
    });

    return {
      username,
      name: record.name,
      role: record.role,
      reports: [
        {
          title: 'Lipid Panel',
          date: '2026-03-22',
          summary: 'LDL slightly elevated. HDL in normal range.',
        },
        {
          title: 'CBC',
          date: '2026-03-22',
          summary: 'All key markers within normal limits.',
        },
        {
          title: 'Blood Pressure Trend',
          date: '2026-04-06',
          summary: 'Average reading 120/80 over the past week.',
        },
      ],
      upcoming_appointments: appointments,
      medications,
      vitals: {
        heart_rate: '78 bpm',
        blood_pressure: '120/80',
        sleep: '7h 20m',
      },
    };
  }

  function addLumiMessage(container, sender, text) {
    const bubble = document.createElement('div');
    bubble.className = `lumi-message ${sender}`;
    bubble.textContent = text;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  async function sendLumiMessage(page, username, record, chatPanel) {
    const input = chatPanel.querySelector('.lumi-chat-input');
    const messages = chatPanel.querySelector('.lumi-chat-messages');
    const sendBtn = chatPanel.querySelector('.lumi-send-btn');
    const userMessage = input.value.trim();

    if (!userMessage) return;

    addLumiMessage(messages, 'user', userMessage);
    input.value = '';
    sendBtn.disabled = true;

    const thinkingBubble = addLumiMessage(messages, 'assistant', 'Let me check your records...');

    try {
      const response = await fetch(LUMI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: `${username}-${record.role}`,
          message: userMessage,
          patient: getPatientContext(page, username, record),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to reach Lumi backend');
      }

      const payload = await response.json();
      thinkingBubble.remove();
      addLumiMessage(messages, 'assistant', payload.reply || 'I could not generate a response right now.');
    } catch (err) {
      thinkingBubble.remove();
      addLumiMessage(
        messages,
        'assistant',
        'I am unable to connect right now. Start the Python server and check that OPENAI_API_KEY is set.'
      );
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function ensureLumiAssistantPanel(page, username, record) {
    let panel = page.querySelector('#lumiChatPanel');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'lumiChatPanel';
    panel.className = 'lumi-chat-panel';
    panel.innerHTML = `
      <div class="lumi-chat-header">
        <div>
          <h3>Lumi Assistant</h3>
          <p>Personalized AI support for ${record.name}</p>
        </div>
        <button class="lumi-close-btn" aria-label="Close chat">×</button>
      </div>
      <div class="lumi-chat-messages"></div>
      <div class="lumi-chat-input-row">
        <input class="lumi-chat-input" type="text" placeholder="Ask about reports, medication, or appointments" />
        <button class="lumi-send-btn">Send</button>
      </div>
    `;

    page.appendChild(panel);

    const messages = panel.querySelector('.lumi-chat-messages');
    addLumiMessage(
      messages,
      'assistant',
      `Hi ${record.name.split(' ')[0]}, I can help with your reports, upcoming appointments, medications, and health questions.`
    );

    panel.querySelector('.lumi-close-btn').addEventListener('click', () => {
      panel.classList.remove('open');
    });

    panel.querySelector('.lumi-send-btn').addEventListener('click', () => {
      sendLumiMessage(page, username, record, panel);
    });

    panel.querySelector('.lumi-chat-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendLumiMessage(page, username, record, panel);
      }
    });

    return panel;
  }

  function openLumiAssistant(page, username, record) {
    const panel = ensureLumiAssistantPanel(page, username, record);
    panel.classList.add('open');
    const input = panel.querySelector('.lumi-chat-input');
    if (input) input.focus();
  }

  // -------- Patient Dashboard Content --------
  function getPatientDashboard(record) {
    const circumference = 2 * Math.PI * 42; // r=42

    return `
      <!-- Health Summary -->
      <div class="health-summary-card">
        <h2 class="health-summary-title">Your Health Summary</h2>
        <div class="health-rings">
          <div class="health-ring">
            <div class="ring-container">
              <svg viewBox="0 0 100 100">
                <circle class="ring-bg" cx="50" cy="50" r="42"/>
                <circle class="ring-progress green" cx="50" cy="50" r="42"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${circumference}"
                  data-target="${circumference * 0.25}"/>
              </svg>
              <div class="ring-icon green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </div>
            </div>
            <span class="ring-label">Active</span>
          </div>
          <div class="health-ring">
            <div class="ring-container">
              <svg viewBox="0 0 100 100">
                <circle class="ring-bg" cx="50" cy="50" r="42"/>
                <circle class="ring-progress blue" cx="50" cy="50" r="42"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${circumference}"
                  data-target="${circumference * 0.3}"/>
              </svg>
              <div class="ring-icon blue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 12.8 3a7 7 0 0 0 8.2 9.8z"/></svg>
              </div>
            </div>
            <span class="ring-label">7h 20m</span>
          </div>
          <div class="health-ring">
            <div class="ring-container">
              <svg viewBox="0 0 100 100">
                <circle class="ring-bg" cx="50" cy="50" r="42"/>
                <circle class="ring-progress orange" cx="50" cy="50" r="42"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${circumference}"
                  data-target="${circumference * 0.35}"/>
              </svg>
              <div class="ring-icon orange">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>
              </div>
            </div>
            <span class="ring-label">BP</span>
          </div>
        </div>
      </div>

      <!-- Two-column: Appointments + Medications -->
      <div class="dash-two-col">
        <div class="dash-section-card">
          <h3 class="section-card-title">Upcoming Appointments</h3>
          <div class="appointment-item">
            <div class="appt-date-badge">
              <span class="appt-month">Oct</span>
              <span class="appt-day">14</span>
            </div>
            <div class="appt-details">
              <div class="appt-doctor">Dr. Sarah Jenkins</div>
              <div class="appt-type">Cardiology Follow-up</div>
            </div>
            <button class="appt-action-btn primary">Join Call</button>
          </div>
          <div class="appointment-item">
            <div class="appt-date-badge">
              <span class="appt-month">Nov</span>
              <span class="appt-day">02</span>
            </div>
            <div class="appt-details">
              <div class="appt-doctor">Lab Work</div>
              <div class="appt-type">Routine Blood Test</div>
            </div>
            <button class="appt-action-btn secondary">Reschedule</button>
          </div>
        </div>

        <div class="dash-section-card">
          <h3 class="section-card-title">Medication Tracker</h3>
          <div class="medication-item">
            <div class="med-check taken">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="med-info">
              <div class="med-name taken-text">Lisinopril (10mg)</div>
              <div class="med-schedule">Morning • 08:00 AM</div>
            </div>
          </div>
          <div class="medication-item">
            <div class="med-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="med-info">
              <div class="med-name">Atorvastatin (20mg)</div>
              <div class="med-schedule">Evening • 08:00 PM</div>
            </div>
            <button class="med-action-btn">Take now</button>
          </div>
        </div>
      </div>

      <!-- Lumi Assistant -->
      <div class="lumi-assistant-card">
        <div class="lumi-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a6 6 0 0 0-6 6c0 2.2 1.2 4.2 3 5.2V22h6v-8.8c1.8-1 3-3 3-5.2a6 6 0 0 0-6-6z"/></svg>
        </div>
        <div class="lumi-info">
          <div class="lumi-title">Lumi Assistant</div>
          <div class="lumi-subtitle">Always here to help. Ask me anything about your health.</div>
        </div>
        <button class="lumi-chat-btn">Start Chat</button>
      </div>
    `;
  }

  // -------- Generic Dashboard (Doctor, Admin, Lab) --------
  function getGenericDashboard(record, role, meta) {
    return `
      <div class="dash-grid">
        ${getDashboardCards(role)}
      </div>
    `;
  }

  // -------- Animate Health Rings --------
  function animateHealthRings() {
    document.querySelectorAll('.ring-progress').forEach(ring => {
      const dashArray = parseFloat(ring.getAttribute('stroke-dasharray'));
      const targetOffset = parseFloat(ring.getAttribute('data-target'));
      ring.style.strokeDashoffset = dashArray - (dashArray - targetOffset);
    });
  }

  function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  }

  // -------- Dashboard Cards per Role --------
  function getDashboardCards(role) {
    const cards = {
      patient: [
        { title: 'Heart Rate', value: '78 bpm', desc: 'Last synced 2 min ago', accent: 'green', icon: 'heart' },
        { title: 'Blood Pressure', value: '120/80', desc: 'Normal range', accent: 'blue', icon: 'activity' },
        { title: 'Glucose Level', value: '102 mg/dL', desc: 'Fasting — within range', accent: 'amber', icon: 'droplet' },
        { title: 'SpO₂', value: '98%', desc: 'Oxygen saturation normal', accent: 'green', icon: 'wind' },
      ],
      doctor: [
        { title: 'Patient Queue', value: '14', desc: 'P1: 2 · P2: 4 · P3: 5 · P4/5: 3', accent: 'blue', icon: 'users' },
        { title: 'AI Co-Pilot', value: 'Active', desc: 'SOAP notes auto-generating', accent: 'green', icon: 'brain' },
        { title: 'Ward Vitals', value: '32 Patients', desc: '2 anomalies detected', accent: 'amber', icon: 'monitor' },
        { title: 'Prescriptions Today', value: '18', desc: '1 interaction warning', accent: 'purple', icon: 'pill' },
        { title: 'Appointments', value: '9 Slots', desc: '3 available today', accent: 'green', icon: 'calendar' },
        { title: 'Readmission Risk', value: '3 Flags', desc: 'High risk: R. Kumar, S. Patel', accent: 'amber', icon: 'alert' },
        { title: 'Differential Dx', value: '87%', desc: 'Avg. confidence score today', accent: 'blue', icon: 'search' },
        { title: 'Voice Dictation', value: 'Ready', desc: 'Whisper v3 · Tap to dictate', accent: 'purple', icon: 'mic' },
      ],
      admin: [
        { title: 'Bed Occupancy', value: '82%', desc: 'ICU at 94% — threshold alert', accent: 'amber', icon: 'bed' },
        { title: 'Ambulance Fleet', value: '8 Active', desc: '2 en route · 6 standby', accent: 'green', icon: 'truck' },
        { title: 'NL Query Engine', value: 'Online', desc: '"Show ICU admits last 7 days"', accent: 'blue', icon: 'terminal' },
        { title: 'Proactive Alerts', value: '5 Active', desc: 'ICU surge, Drug shortfall…', accent: 'amber', icon: 'bell' },
        { title: 'Staff On Duty', value: '142', desc: 'Next shift change in 3h 20m', accent: 'purple', icon: 'users' },
        { title: 'Revenue Today', value: '₹14.2L', desc: '2 ICD coding errors flagged', accent: 'green', icon: 'currency' },
        { title: 'Operations', value: '12 Scheduled', desc: '3 in progress · OT-2 free', accent: 'blue', icon: 'scalpel' },
        { title: 'Alert Thresholds', value: 'Configured', desc: '8 rules active', accent: 'purple', icon: 'settings' },
      ],
      lab: [
        { title: 'Test Queue', value: '47', desc: 'STAT: 8 · Urgent: 12 · Routine: 27', accent: 'amber', icon: 'list' },
        { title: 'Sample Tracking', value: '23 In Process', desc: 'Collected → Processed → Reported', accent: 'blue', icon: 'tracking' },
        { title: 'Critical Results', value: '3', desc: '1 pending doctor alert', accent: 'amber', icon: 'alert' },
        { title: 'Pharma Inventory', value: '1,240 Items', desc: '4 below reorder level', accent: 'green', icon: 'inventory' },
        { title: 'Drug Interactions', value: 'Checker Ready', desc: 'Last check: Amox + Metformin ✓', accent: 'blue', icon: 'shield' },
        { title: 'Equipment Status', value: '14 / 16 Online', desc: 'Centrifuge-B: maintenance', accent: 'purple', icon: 'wrench' },
        { title: 'TAT Analytics', value: 'Avg 42 min', desc: 'CBC: 28m · Lipid: 55m · HbA1c: 1h', accent: 'green', icon: 'clock' },
        { title: 'Report Export', value: '3 Formats', desc: 'HL7 FHIR · PDF · CSV', accent: 'purple', icon: 'download' },
      ],
    };

    return (cards[role] || [])
      .map(
        (c) => `
        <div class="dash-card accent-${c.accent}">
          <div class="card-header">
            <span class="card-title">${c.title}</span>
            <div class="card-icon ${c.accent}">
              ${getCardIcon(c.icon)}
            </div>
          </div>
          <div class="card-value">${c.value}</div>
          <p class="card-desc">${c.desc}</p>
        </div>`
      )
      .join('');
  }

  function getCardIcon(name) {
    const icons = {
      heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
      activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
      droplet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.7S5 9.3 5 14a7 7 0 0 0 14 0c0-4.7-7-11.3-7-11.3z"/></svg>',
      wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.6 4.5A3 3 0 0 1 15 6H2m10.5-1.5A3 3 0 0 1 18 9H2m7.5 3A3 3 0 0 1 13 15H2"/></svg>',
      calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      pill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.5 1.5l-8 8a5.66 5.66 0 0 0 8 8l8-8a5.66 5.66 0 0 0-8-8z"/><line x1="6" y1="14" x2="14" y2="6" opacity="0.4"/></svg>',
      flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3v7.2l-4 6.8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-4-6.8V3"/><line x1="9" y1="3" x2="15" y2="3"/></svg>',
      smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
      users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a6 6 0 0 0-6 6c0 2.2 1.2 4.2 3 5.2V22h6v-8.8c1.8-1 3-3 3-5.2a6 6 0 0 0-6-6z"/></svg>',
      monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
      alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.3 1.3l-9 15.4A2 2 0 0 0 3 20h18a2 2 0 0 0 1.7-3.3l-9-15.4a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
      bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v-2a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg>',
      truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
      terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
      currency: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      scalpel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 2l-9.6 9.6a2 2 0 0 0 0 2.8l1.2 1.2a2 2 0 0 0 2.8 0L22 6"/><path d="M4 20l5-5"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/></svg>',
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      tracking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    };
    return icons[name] || '';
  }

  // -------- Init --------
  function init() {
    initParticles();
    animateCounters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
