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
        ctx.fillStyle = `rgba(110, 231, 183, ${this.opacity})`;
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
            ctx.strokeStyle = `rgba(110, 231, 183, ${0.04 * (1 - dist / 120)})`;
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

    page.innerHTML = `
      <header class="dashboard-header">
        <div class="logo-mini">
          <svg viewBox="0 0 60 60" fill="none">
            <circle cx="30" cy="30" r="28" stroke="url(#logoGrad2)" stroke-width="2.5"/>
            <path d="M30 14V46M22 30H38" stroke="url(#logoGrad2)" stroke-width="3" stroke-linecap="round"/>
            <circle cx="30" cy="30" r="8" stroke="url(#logoGrad2)" stroke-width="1.5" opacity="0.5"/>
            <defs><linearGradient id="logoGrad2" x1="0" y1="0" x2="60" y2="60"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="100%" stop-color="#3B82F6"/></linearGradient></defs>
          </svg>
          <span>Luminus</span>
        </div>
        <div class="user-info">
          <span class="role-badge ${role}">${meta.label}</span>
          <span class="username-display">${record.name}</span>
          <button class="logout-btn" id="logoutBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>
      </header>
      <div class="dashboard-body">
        <div class="dashboard-welcome">
          <h1>Good ${getTimeGreeting()}, ${record.name.split(' ')[0]}</h1>
          <p>${meta.dashGreeting}</p>
        </div>
        <div class="dash-grid">
          ${getDashboardCards(role)}
        </div>
      </div>
    `;

    document.body.appendChild(page);

    // Logout handler
    $('#logoutBtn').addEventListener('click', () => {
      page.remove();
      $('.main-container').style.display = 'flex';
      usernameEl.value = '';
      passwordEl.value = '';
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
        { title: 'Upcoming Appointments', value: '2', desc: 'Next: Dr. Sharma — Apr 12', accent: 'purple', icon: 'calendar' },
        { title: 'Medications', value: '4 Active', desc: '1 refill due in 3 days', accent: 'amber', icon: 'pill' },
        { title: 'Lab Results', value: '3 New', desc: 'CBC, Lipid Panel, HbA1c', accent: 'blue', icon: 'flask' },
        { title: 'Mental Health', value: '😊 Good', desc: 'Last check-in: Today 9:15 AM', accent: 'green', icon: 'smile' },
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
