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
      nav: [
        { id: 'overview', label: 'Dashboard', icon: 'activity' },
        { id: 'reports', label: 'Reports & Records', icon: 'download' },
        { id: 'meds', label: 'Prescriptions', icon: 'pill' },
        { id: 'timeline', label: 'Care Timeline', icon: 'calendar' },
        { id: 'billing', label: 'Insurance & Billing', icon: 'currency' }
      ]
    },
    doctor: {
      label: 'Doctor',
      color: 'blue',
      welcomeSub: 'Access your clinical workspace',
      dashGreeting: 'Your clinical workspace is ready.',
      nav: [{ id: 'overview', label: 'Clinical Overview', icon: 'activity' }]
    },
    admin: {
      label: 'Administrator',
      color: 'purple',
      welcomeSub: 'Manage hospital operations',
      dashGreeting: 'Hospital operations at a glance.',
      nav: [{ id: 'overview', label: 'Operations', icon: 'activity' }]
    },
    lab: {
      label: 'Lab Admin',
      color: 'amber',
      welcomeSub: 'Laboratory management console',
      dashGreeting: 'Lab operations overview.',
      nav: [{ id: 'overview', label: 'Lab Dashboard', icon: 'activity' }]
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
    // Sidebar nav items from meta
    const navItems = meta.nav || [];

    const sidebarNavHTML = navItems.map((item, idx) =>
      `<button class="sidebar-nav-item ${idx === 0 ? 'active' : ''}" data-nav="${item.id}">
        ${getCardIcon(item.icon)}
        <span>${item.label}</span>
      </button>`
    ).join('');

    // Main content depends on role and current nav
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
    page.querySelector('#logoutBtn').addEventListener('click', () => {
      page.remove();
      $('.main-container').style.display = 'flex';
      usernameEl.value = '';
      passwordEl.value = '';
    });

    // Sidebar nav click handler
    page.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const navId = btn.dataset.nav;
        page.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const contentArea = page.querySelector('.dash-content');
        if (navId === 'reports') {
          contentArea.innerHTML = getReportsDashboard(record);
          initReportEvents(page);
        } else if (navId === 'meds') {
          contentArea.innerHTML = getMedicationDashboard(record);
          initMedicationEvents(page);
          // Simulated reminder notification
          setTimeout(() => {
            showToast('Reminder: Your evening dose of Lisinopril is due in 30 minutes.', 'success');
          }, 4000);
        } else if (navId === 'timeline') {
          contentArea.innerHTML = getTimelineDashboard(record);
          initTimelineEvents(page);
        } else if (navId === 'billing') {
          contentArea.innerHTML = getBillingDashboard(record);
        } else {
          contentArea.innerHTML = role === 'patient'
            ? getPatientDashboard(record)
            : getGenericDashboard(record, role, meta);
          
          if (role === 'patient') {
             requestAnimationFrame(() => animateHealthRings());
             initPatientEvents(page);
          }
        }
      });
    });

    // Med "Take now" buttons
    initPatientEvents(page);
  }

  function initPatientEvents(page) {
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
  }

  function initReportEvents(page) {
    page.querySelectorAll('.download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const reportName = btn.dataset.name;
        downloadReportAsPDF(reportName, record);
      });
    });
  }

  function initMedicationEvents(page) {
    page.querySelectorAll('.med-take-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.med-detail-card');
        const status = btn.querySelector('.btn-text');
        btn.classList.add('taken');
        btn.innerHTML = 'Taken ✓';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        showToast('Medication recorded.', 'success');
      });
    });
  }

  function initTimelineEvents(page) {
    page.querySelectorAll('.join-call-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showToast('Connecting to secure video consult...', 'success');
        btn.textContent = 'Connecting...';
        setTimeout(() => {
          btn.textContent = 'In Call';
          btn.style.background = 'var(--dash-green)';
        }, 1500);
      });
    });
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
          <div class="health-ring">
            <div class="ring-container">
              <svg viewBox="0 0 100 100">
                <circle class="ring-bg" cx="50" cy="50" r="42"/>
                <circle class="ring-progress purple" cx="50" cy="50" r="42"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${circumference}"
                  data-target="${circumference * 0.8}"/>
              </svg>
              <div class="ring-icon purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
            </div>
            <span class="ring-label">Records</span>
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

  // -------- Reports Dashboard Content --------
  function getReportsDashboard(record) {
    const reports = [
      { name: 'Complete Blood Count (CBC)', date: 'Oct 02, 2026', type: 'Lab Report', status: 'ready', isNew: true },
      { name: 'Lipid Profile', date: 'Oct 02, 2026', type: 'Lab Report', status: 'ready', isNew: true },
      { name: 'Cardiology Consultation', date: 'Sep 14, 2026', type: 'Medical Record', status: 'ready', isNew: false },
      { name: 'Chest X-Ray', date: 'Aug 22, 2026', type: 'Imaging', status: 'ready', isNew: false },
      { name: 'Routine Health Checkup', date: 'Jun 10, 2026', type: 'Medical Record', status: 'ready', isNew: false },
      { name: 'Diabetes Screening (HbA1c)', date: 'Oct 08, 2026', type: 'Lab Report', status: 'pending', isNew: true },
    ];

    const renderReportList = (list) => list.map(r => `
      <div class="report-item">
        <div class="report-icon-box">
          ${getCardIcon(r.type === 'Imaging' ? 'monitor' : 'pill')}
        </div>
        <div class="report-info">
          <div class="report-name">${r.name}</div>
          <div class="report-meta">
            <span>${r.date}</span>
            <span>•</span>
            <span>${r.type}</span>
            <span class="report-status status-${r.status}">${r.status}</span>
          </div>
        </div>
        <div class="report-actions">
          ${r.status === 'ready' 
            ? `<button class="download-btn" data-name="${r.name}">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                 Download PDF
               </button>`
            : `<span style="font-size: 0.75rem; color: var(--dash-text-muted);">Awaiting Results</span>`
          }
        </div>
      </div>
    `).join('');

    return `
      <div class="reports-dashboard">
        <h2 class="section-card-title">New Reports</h2>
        <div class="reports-list" style="margin-bottom: 32px;">
          ${renderReportList(reports.filter(r => r.isNew))}
        </div>
        
        <h2 class="section-card-title">Previous Reports</h2>
        <div class="reports-list">
          ${renderReportList(reports.filter(r => !r.isNew))}
        </div>
      </div>
    `;
  }

  // -------- Medication Dashboard Content --------
  function getMedicationDashboard(record) {
    const meds = [
      { name: 'Lisinopril', dosage: '10mg Tablet', schedule: { morning: '08:00 AM', evening: '08:00 PM' }, next: '08:00 PM', freq: 'Twice daily', icon: 'pill' },
      { name: 'Atorvastatin', dosage: '20mg Capsule', schedule: { morning: null, evening: '09:00 PM' }, next: '09:00 PM', freq: 'Once daily (Night)', icon: 'activity' },
      { name: 'Metformin', dosage: '500mg Tablet', schedule: { morning: '08:00 AM', evening: '08:00 PM' }, next: '08:00 PM', freq: 'Twice daily with meals', icon: 'pill' },
    ];

    const medsHTML = meds.map(m => `
      <div class="med-detail-card">
        <div class="med-header">
          <div class="med-icon-box">${getCardIcon(m.icon)}</div>
          <div class="med-title-group">
            <div class="med-primary-name">${m.name}</div>
            <div class="med-dosage">${m.dosage} • ${m.freq}</div>
          </div>
        </div>
        <div class="dosage-schedule">
          <div class="schedule-pill ${m.schedule.morning ? 'active' : ''}">
            <span class="sched-time">Morning</span>
            <span class="sched-hour">${m.schedule.morning || '—'}</span>
          </div>
          <div class="schedule-pill ${m.schedule.evening ? 'active' : ''}">
            <span class="sched-time">Evening</span>
            <span class="sched-hour">${m.schedule.evening || '—'}</span>
          </div>
        </div>
        <button class="med-action-btn med-take-btn" style="width: 100%;">
          <span class="btn-text">Mark as Taken</span>
        </button>
      </div>
    `).join('');

    return `
      <div class="meds-dashboard">
        <div class="interaction-warning">
          <div class="warning-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div class="warning-text">Basic Interaction Check: No severe conflicts detected between your current medications.</div>
        </div>
        
        <h2 class="section-card-title">Active Prescriptions</h2>
        <div class="med-grid">
          ${medsHTML}
        </div>
      </div>
    `;
  }

  // -------- Care Timeline Content --------
  function getTimelineDashboard(record) {
    const events = [
      { title: 'Follow-up Cardiology Visit', date: 'Oct 14, 2026', type: 'Appointment', desc: 'Secure video consultation with Dr. Jenkins.', status: 'upcoming' },
      { title: 'Diagnosis: Essential Hypertension', date: 'Sep 14, 2026', type: 'Diagnosis', desc: 'Blood pressure readings consistently above 140/90.', status: 'past' },
      { title: 'Started Lisinopril 10mg', date: 'Sep 15, 2026', type: 'Medication', desc: 'Prescribed daily dosage for hypertension management.', status: 'past' },
      { title: 'Initial Consultation', date: 'Sep 10, 2026', type: 'Visit', desc: 'General health screening and vitals check.', status: 'past' },
    ];

    const eventsHTML = events.map(e => `
      <div class="timeline-event">
        <div class="event-marker"></div>
        <div class="event-content">
          <div class="event-header">
            <span class="event-tag">${e.type}</span>
            <span class="event-date">${e.date}</span>
          </div>
          <div class="event-title">${e.title}</div>
          <p class="event-desc">${e.desc}</p>
          ${e.status === 'upcoming' 
            ? `<button class="appt-action-btn primary join-call-btn" style="margin-top: 12px; height: 36px; padding: 0 20px;">Join Teleconsult</button>` 
            : ''
          }
        </div>
      </div>
    `).join('');

    return `
      <div class="timeline-dashboard">
        <h2 class="section-card-title">Care Journey Timeline</h2>
        <div class="timeline-view">
          ${eventsHTML}
        </div>
      </div>
    `;
  }

  // -------- Billing Dashboard Content --------
  function getBillingDashboard(record) {
    const bills = [
      { id: 'INV-2026-001', service: 'Lab Work (CBC, Lipid)', date: 'Oct 02, 2026', amount: '₹1250', status: 'Paid', method: 'Insurance (HDFC Ergo)' },
      { id: 'INV-2026-002', service: 'Cardiology Consultation', date: 'Sep 14, 2026', amount: '₹800', status: 'Paid', method: 'UPI' },
      { id: 'INV-2026-003', service: 'Emergency Visit', date: 'Aug 22, 2026', amount: '₹4500', status: 'Claimed', method: 'Insurance (HDFC Ergo)' },
      { id: 'INV-2026-004', service: 'Pharmacy: Lisinopril', date: 'Sep 15, 2026', amount: '₹340', status: 'Pending', method: 'Pending Payment' },
    ];

    const tableHTML = bills.map(b => `
      <tr>
        <td style="font-family: monospace; font-weight: 600;">${b.id}</td>
        <td>${b.service}</td>
        <td>${b.date}</td>
        <td style="font-weight: 600;">${b.amount}</td>
        <td class="status-${b.status.toLowerCase().replace(' ', '-')}">${b.status}</td>
        <td>${b.method}</td>
      </tr>
    `).join('');

    return `
      <div class="billing-dashboard">
        <h2 class="section-card-title">Insurance Claims & Billing</h2>
        <div class="billing-table-card">
          <table class="billing-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Service</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Payment Method</th>
              </tr>
            </thead>
            <tbody>
              ${tableHTML}
            </tbody>
          </table>
          <div class="total-summary">
            <div class="summary-item">
              <div class="summary-label">Total Outstanding</div>
              <div class="summary-value">₹340.00</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Insurance Claims (Pending)</div>
              <div class="summary-value">₹4500.00</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // -------- PDF Generation Logic --------
  async function downloadReportAsPDF(reportName, record) {
    try {
      showToast('Preparing professional report...', 'success');
      
      const jspdfLib = window.jspdf;
      if (!jspdfLib) throw new Error('PDF Library not loaded. Ensure scripts loaded.');

      const { jsPDF } = jspdfLib;
      const doc = new jsPDF('p', 'mm', 'a4');
      const W = 210; // page width
      const M = 15; // margin
      const CW = W - M * 2; // content width
      const primaryBlue = [67, 97, 238];
      const softBlue = [238, 242, 255];
      const textPrimary = [26, 35, 50];
      const textSecondary = [90, 106, 126];
      const textMuted = [148, 163, 184];

      // ── Helper: draw filled rounded rect section ──
      const sectionBox = (y, h, fill=[248,250,252], stroke=[226,232,240]) => {
        doc.setFillColor(...fill);
        doc.setDrawColor(...stroke);
        doc.roundedRect(M, y, CW, h, 2, 2, 'FD');
      };

      // ── Helper: draw manual table row ──
      const drawRow = (cols, y, rowH, isHeader) => {
        const colWidths = [55, 35, 40, 40]; // px widths for 4 cols
        let x = M;
        cols.forEach((text, i) => {
          const cw = colWidths[i];
          if (isHeader) {
            doc.setFillColor(...softBlue);
            doc.rect(x, y, cw, rowH, 'F');
          }
          doc.setDrawColor(...[226,232,240]);
          doc.rect(x, y, cw, rowH, 'S');

          // Status color for last column
          if (!isHeader && i === 3) {
            if (text === 'NORMAL')      doc.setTextColor(16, 185, 129);
            else if (text === 'HIGH' || text === 'LOW')   doc.setTextColor(239, 68, 68);
            else if (text === 'BORDERLINE') doc.setTextColor(245, 158, 11);
            else doc.setTextColor(...textPrimary);
            doc.setFont('helvetica', 'bold');
          } else if (isHeader) {
            doc.setTextColor(...primaryBlue);
            doc.setFont('helvetica', 'bold');
          } else {
            doc.setTextColor(...textPrimary);
            doc.setFont('helvetica', 'normal');
          }
          doc.text(String(text), x + 3, y + rowH/2 + 1.5, { baseline: 'middle' });
          x += cw;
        });
      };



      // 1. Header Section
      // Hospital Logo/Name (left)
      doc.setTextColor(...primaryBlue);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('LUMINUS', 20, 25);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('HEALTHCARE SYSTEMS', 20, 30);

      // Report Metadata (right)
      doc.setTextColor(...textSecondary);
      doc.setFontSize(9);
      doc.text(`Report ID: LUM-${Math.floor(100000 + Math.random() * 900000)}`, 190, 20, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 190, 25, { align: 'right' });
      doc.text(`Referring Doctor: Dr. Sarah Jenkins`, 190, 30, { align: 'right' });

      // Divider
      doc.setDrawColor(226, 232, 240);
      doc.line(20, 38, 190, 38);

      // 2. Patient Information Section
      let y = 50;
      doc.setFillColor(...softBlue);
      doc.roundedRect(20, y, 170, 30, 3, 3, 'F');
      
      doc.setTextColor(...textSecondary);
      doc.setFontSize(8);
      doc.text('PATIENT NAME', 25, y+8);
      doc.text('AGE / GENDER', 85, y+8);
      doc.text('PATIENT ID', 145, y+8);
      
      doc.setTextColor(...textPrimary);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(record.name.toUpperCase(), 25, y+16);
      doc.text('34Y / MALE', 85, y+16);
      doc.text(`P-77421`, 145, y+16);

      // 3. Test Title Section
      y = 95;
      doc.setTextColor(...textPrimary);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(reportName, 20, y);
      
      // Status Badge
      const titleWidth = doc.getTextWidth(reportName);
      doc.setFillColor(16, 185, 129); // green
      doc.roundedRect(25 + titleWidth, y-7, 24, 8, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.text('COMPLETED', 27 + titleWidth, y-1.5);


      // 4. Results Table — drawn manually, no plugin needed
      y = 107;
      doc.setFontSize(9);
      const ROW_H = 8;
      const resultsData = reportName.toLowerCase().includes('blood') ? [
        ['Hemoglobin', '14.2 g/dL', '13.0 - 17.0', 'NORMAL'],
        ['WBC Count', '6.4 x10 /uL', '4.0 - 11.0', 'NORMAL'],
        ['Platelet Count', '284 x10 /uL', '150 - 450',  'NORMAL'],
        ['RBC Count', '4.8 mil/uL', '4.5 - 5.5',   'NORMAL'],
        ['MCV', '88.5 fL', '80.0 - 100.0', 'NORMAL'],
      ] : reportName.toLowerCase().includes('lipid') ? [
        ['Total Cholesterol', '185 mg/dL', '< 200 mg/dL', 'NORMAL'],
        ['Triglycerides', '210 mg/dL', '< 150 mg/dL', 'HIGH'],
        ['HDL Cholesterol', '45 mg/dL', '> 40 mg/dL', 'NORMAL'],
        ['LDL Cholesterol', '115 mg/dL', '< 100 mg/dL', 'BORDERLINE'],
      ] : reportName.toLowerCase().includes('diabetes') ? [
        ['HbA1c', '6.1 %', '< 5.7%', 'BORDERLINE'],
        ['Fasting Glucose', '102 mg/dL', '70-99 mg/dL', 'BORDERLINE'],
        ['Post-Prandial', '140 mg/dL', '< 140 mg/dL', 'NORMAL'],
      ] : [
        ['Systolic BP', '128 mmHg', '< 130 mmHg', 'NORMAL'],
        ['Diastolic BP', '82 mmHg', '< 80 mmHg', 'BORDERLINE'],
        ['Heart Rate', '74 bpm', '60-100 bpm', 'NORMAL'],
        ['SpO2', '98 %', '> 95%', 'NORMAL'],
      ];

      drawRow(['Test Parameter', 'Result', 'Normal Range', 'Remarks'], y, ROW_H, true);
      y += ROW_H;
      resultsData.forEach(row => {
        drawRow(row, y, ROW_H, false);
        y += ROW_H;
      });

      // 5. Visual Insight Section
      y += 8;
      doc.setTextColor(...textPrimary);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('VISUAL RANGE ANALYSIS', M, y);
      
      y += 6;
      sectionBox(y, 16, [248,250,252], [226,232,240]);
      const barX = M + 15;
      const barW = CW - 30;
      // Track bg
      doc.setFillColor(226, 232, 240);
      doc.rect(barX, y + 6.5, barW, 3, 'F');
      // Normal zone (middle 60%)
      doc.setFillColor(...primaryBlue);
      doc.setGState && doc.setGState(doc.GState ? new doc.GState({ opacity: 0.4 }) : {});
      doc.rect(barX + barW * 0.2, y + 6.5, barW * 0.6, 3, 'F');
      // Marker at ~55% (representing a normal value)
      doc.setFillColor(...textPrimary);
      doc.rect(barX + barW * 0.52, y + 5, 1.5, 7, 'F');
      doc.setFontSize(7);
      doc.setTextColor(...textMuted);
      doc.text('Low', barX, y + 13);
      doc.text('Normal Range', barX + barW * 0.5, y + 13, { align: 'center' });
      doc.text('High', barX + barW, y + 13, { align: 'right' });

      // 6. AI Explanation Section
      y += 24;
      sectionBox(y, 30, softBlue, [200, 213, 255]);
      doc.setTextColor(...primaryBlue);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('★  LUMINA AI INSIGHT', M + 3, y + 7);
      doc.setTextColor(...textSecondary);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      const aiText = reportName.toLowerCase().includes('lipid')
        ? 'Your triglycerides are mildly elevated. This is commonly linked to diet and lifestyle factors. Consider reducing refined sugars and increasing physical activity. HDL levels are within range, which is a positive indicator for cardiovascular health.'
        : 'Your blood cell counts are all within normal reference limits. This suggests healthy immune function, adequate oxygen-carrying capacity, and normal clotting ability. No concerning findings were detected in this diagnostic set.';
      const lines = doc.splitTextToSize(aiText, CW - 8);
      doc.text(lines, M + 3, y + 14);

      // 7. Doctor Notes Section
      y += 38;
      doc.setTextColor(...textPrimary);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('DOCTOR NOTES & RECOMMENDATIONS', M, y);
      sectionBox(y + 5, 22, [248, 250, 252], [226, 232, 240]);
      doc.setTextColor(...textSecondary);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('•  Maintain a balanced diet with leafy greens, whole grains, and lean proteins.', M + 4, y + 12);
      doc.text('•  Schedule a routine follow-up consultation within 3-6 months.', M + 4, y + 19);

      // 8. Alerts (only if abnormal detected)
      const hasAbnormal = resultsData.some(r => r[3] === 'HIGH' || r[3] === 'LOW');
      const hasBorderline = resultsData.some(r => r[3] === 'BORDERLINE');
      y += 32;
      if (hasAbnormal) {
        doc.setFillColor(254, 242, 242);
        doc.setDrawColor(252, 165, 165);
        doc.roundedRect(M, y, CW, 10, 2, 2, 'FD');
        doc.setTextColor(185, 28, 28);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('⚠  ALERT: One or more parameters are outside the normal reference range. Please consult your physician.', M + 3, y + 6.5);
        y += 14;
      } else if (hasBorderline) {
        doc.setFillColor(255, 251, 235);
        doc.setDrawColor(252, 211, 77);
        doc.roundedRect(M, y, CW, 10, 2, 2, 'FD');
        doc.setTextColor(146, 64, 14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('◈  NOTE: Some results are borderline. Monitor with your doctor and consider lifestyle adjustments.', M + 3, y + 6.5);
        y += 14;
      }

      // 9. Footer
      const pageH = doc.internal.pageSize.height;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(M, pageH - 28, W - M, pageH - 28);
      
      doc.setTextColor(...textMuted);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated on: ${new Date().toLocaleString()}  |  Report ID: LUM-${Math.floor(100000 + Math.random() * 900000)}`, M, pageH - 22);
      doc.text('DISCLAIMER: This report is electronically generated. Please correlate clinically with your physician.', M, pageH - 17);
      
      doc.setTextColor(...primaryBlue);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('✦  DIGITALLY VERIFIED BY LUMINUS HEALTH SYSTEMS', W/2, pageH - 10, { align: 'center' });

      // Save file
      doc.save(`${reportName.replace(/\s+/g, '_')}_LUMINUS_REPORT.pdf`);
      showToast('Report downloaded successfully.', 'success');
      
    } catch (err) {
      console.error('PDF Error:', err);
      showToast('Download failed: ' + err.message, 'error');
    }
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