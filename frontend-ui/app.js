/* ===================================================
   LUMINUS — Healthcare Intelligence Platform
   Application Logic: Login, Routing, Dashboard Render
   =================================================== */

(function () {
  'use strict';

  function resolveApiBase() {
    if (!window.location.origin || window.location.origin === 'null') {
      return 'http://127.0.0.1:8000';
    }

    if (window.location.port === '8000') {
      return window.location.origin;
    }

    return 'http://127.0.0.1:8000';
  }

  const API_BASE = resolveApiBase();
  window.LUMINUS_API_BASE = API_BASE;
  const LOGIN_API_URL = new URL('/api/login', API_BASE).toString();
  const REGISTER_PATIENT_API_URL = new URL('/api/patient/register', API_BASE).toString();
  const ADMIN_CRITICAL_QUEUE_API_URL = new URL('/api/admin/critical-queue', API_BASE).toString();
  const AMBULANCE_DISPATCH_API_URL = new URL('/api/ambulance/dispatch', API_BASE).toString();
  const AMBULANCE_NEARBY_API_URL = new URL('/api/ambulance/nearby', API_BASE).toString();

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
        { id: 'upload', label: 'Upload Records', icon: 'download' },
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
      nav: [
        { id: 'overview', label: 'Operations', icon: 'activity' },
        { id: 'critical', label: 'Critical Queue', icon: 'alert' },
        { id: 'dispatch', label: 'Ambulance Desk', icon: 'truck' }
      ]
    },
    lab: {
      label: 'Lab Admin',
      color: 'amber',
      welcomeSub: 'Laboratory management console',
      dashGreeting: 'Lab operations overview.',
      nav: [{ id: 'overview', label: 'Lab Dashboard', icon: 'activity' }]
    },
  };

  const LUMI_API_URL = new URL('/api/chat', API_BASE).toString();
  const UPLOADS_STORAGE_KEY = 'luminus_uploaded_reports_v1';

  const toTitleCase = (value) => value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  function deriveNameFromEmail(email) {
    const base = (email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
    return toTitleCase(base) || 'New Patient';
  }

  async function registerPatientAndLogin(email, phone) {
    const registerResponse = await fetch(REGISTER_PATIENT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        phone,
        name: deriveNameFromEmail(email),
      }),
    });

    const registerPayload = await registerResponse.json();
    if (!registerResponse.ok) {
      throw new Error(registerPayload.detail || 'Patient registration failed');
    }

    const loginResponse = await fetch(LOGIN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'patient', email, phone }),
    });
    const loginPayload = await loginResponse.json();
    if (!loginResponse.ok || !loginPayload.user) {
      throw new Error(loginPayload.detail || 'Patient login failed after registration');
    }

    return loginPayload.user;
  }

  async function getPatientOnboardingStatus(patientId) {
    if (!patientId) return { requires_upload: false, report_count: 0 };
    const response = await fetch(new URL(`/api/patient/onboarding/${patientId}`, API_BASE).toString());
    if (!response.ok) {
      return { requires_upload: false, report_count: 0 };
    }
    return response.json();
  }

  async function fetchPatientReports(record, username) {
    const patientId = record.patient_id;
    if (!patientId) {
      return getUploadedReports(username);
    }

    try {
      const response = await fetch(new URL(`/api/patient/reports/${patientId}`, API_BASE).toString());
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.reports)) {
        return [];
      }

      return payload.reports.map((item) => ({
        id: `db-${item.id}`,
        reportId: item.id,
        name: item.name || `Report ${item.id}`,
        date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
        type: item.type || 'REPORT',
        status: item.has_critical ? 'critical' : 'scanned',
        summary: item.summary || 'AI summary unavailable.',
        anomalyCount: item.anomaly_count || 0,
      }));
    } catch (error) {
      return [];
    }
  }

  async function uploadPatientReport(record, file, shareHospitalDetails, dispatchOptions = {}) {
    const patientId = record.patient_id;
    const uploadedBy = record.clinical_id;
    if (!patientId || !uploadedBy) {
      throw new Error('Patient profile not linked. Please log in again.');
    }

    const imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Unable to read selected file'));
      reader.readAsDataURL(file);
    });

    const response = await fetch(new URL('/api/patient/upload-report', API_BASE).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: patientId,
        uploaded_by: uploadedBy,
        file_name: file.name,
        file_type: file.type || 'image',
        image_data_url: imageDataUrl,
        share_hospital_details: shareHospitalDetails,
        auto_dispatch_ambulance: Boolean(dispatchOptions.autoDispatch),
        latitude: dispatchOptions.latitude,
        longitude: dispatchOptions.longitude,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || 'Upload failed');
    }
    return payload;
  }

  async function renderUploadDashboard(page, record, username) {
    const contentArea = page.querySelector('.dash-content');
    contentArea.innerHTML = '<div class="upload-empty">Loading uploaded reports...</div>';
    const backendReports = await fetchPatientReports(record, username);
    contentArea.innerHTML = getUploadDashboard(record, username, backendReports);
    initUploadEvents(page, record, username, backendReports);
  }

  async function maybeStartPatientOnboarding(page, record, username) {
    if (record.role !== 'patient' || !record.patient_id) return;

    const status = await getPatientOnboardingStatus(record.patient_id);
    if (!status.requires_upload) return;

    const shouldUploadNow = window.confirm(
      'Welcome. Please upload your previous hospital reports/tests so AI can summarize and detect anomalies. Upload now?'
    );
    if (!shouldUploadNow) return;

    const uploadBtn = page.querySelector('.sidebar-nav-item[data-nav="upload"]');
    if (uploadBtn) {
      page.querySelectorAll('.sidebar-nav-item').forEach((b) => b.classList.remove('active'));
      uploadBtn.classList.add('active');
      await renderUploadDashboard(page, record, username);
    }
  }

  function getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported in this browser.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => reject(new Error('Unable to fetch your location. Please enable GPS/location.')),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function dispatchAmbulance(payload) {
    const response = await fetch(AMBULANCE_DISPATCH_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || 'Ambulance dispatch failed');
    }
    return data;
  }

  let leafletLoaderPromise = null;

  async function ensureLeafletLoaded() {
    if (window.L && typeof window.L.map === 'function') {
      return true;
    }

    if (leafletLoaderPromise) {
      await leafletLoaderPromise;
      return true;
    }

    leafletLoaderPromise = new Promise((resolve, reject) => {
      const cssId = 'leaflet-css-runtime';
      if (!document.getElementById(cssId)) {
        const css = document.createElement('link');
        css.id = cssId;
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
      }

      const existing = document.getElementById('leaflet-js-runtime');
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => reject(new Error('Leaflet failed to load.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.id = 'leaflet-js-runtime';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Leaflet failed to load.'));
      document.head.appendChild(script);
    });

    try {
      await leafletLoaderPromise;
      return true;
    } catch {
      return false;
    }
  }

  async function searchOpenStreetMap(query) {
    const q = String(query || '').trim();
    if (q.length < 3) return [];

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) return [];
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      return data
        .map((item) => ({
          latitude: Number(item.lat),
          longitude: Number(item.lon),
          label: item.display_name || `${item.lat}, ${item.lon}`,
        }))
        .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    } catch {
      return [];
    }
  }

  async function pickLocationWithMap(initialLocation, titleText = 'Confirm emergency pickup location') {
    const mapsReady = await ensureLeafletLoaded();
    if (!mapsReady) return initialLocation;

    const fallbackLat = Number(initialLocation?.latitude) || 12.9716;
    const fallbackLng = Number(initialLocation?.longitude) || 77.5946;

    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'map-picker-overlay';
      overlay.innerHTML = `
        <div class="map-picker-dialog" role="dialog" aria-modal="true">
          <div class="map-picker-header">
            <h3>${titleText}</h3>
            <button type="button" class="map-picker-close" aria-label="Close map picker">×</button>
          </div>
          <div class="map-picker-search-row">
            <input id="mapPickerAddress" class="map-picker-address" type="text" placeholder="Search address or landmark" />
            <button type="button" class="btn btn-secondary" id="mapPickerSearchBtn">Search</button>
          </div>
          <div class="map-picker-search-results" id="mapPickerResults"></div>
          <div id="mapPickerCanvas" class="map-picker-canvas"></div>
          <p class="map-picker-coords" id="mapPickerCoords"></p>
          <div class="map-picker-actions">
            <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="confirm">Use This Location</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const closeBtn = overlay.querySelector('.map-picker-close');
      const cancelBtn = overlay.querySelector('[data-action="cancel"]');
      const confirmBtn = overlay.querySelector('[data-action="confirm"]');
      const canvas = overlay.querySelector('#mapPickerCanvas');
      const addressInput = overlay.querySelector('#mapPickerAddress');
      const searchBtn = overlay.querySelector('#mapPickerSearchBtn');
      const resultsBox = overlay.querySelector('#mapPickerResults');
      const coordsEl = overlay.querySelector('#mapPickerCoords');

      let selected = { latitude: fallbackLat, longitude: fallbackLng };

      const map = L.map(canvas).setView([fallbackLat, fallbackLng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const marker = L.marker([fallbackLat, fallbackLng], { draggable: true }).addTo(map);

      const updateSelected = (lat, lng) => {
        selected = {
          latitude: Number(Number(lat).toFixed(6)),
          longitude: Number(Number(lng).toFixed(6)),
        };
        coordsEl.textContent = `Latitude: ${selected.latitude} | Longitude: ${selected.longitude}`;
      };

      updateSelected(fallbackLat, fallbackLng);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        updateSelected(pos.lat, pos.lng);
        map.panTo(pos);
      });

      map.on('click', (event) => {
        marker.setLatLng(event.latlng);
        updateSelected(event.latlng.lat, event.latlng.lng);
      });

      const runSearch = async () => {
        const results = await searchOpenStreetMap(addressInput.value);
        if (!results.length) {
          resultsBox.innerHTML = '<div class="map-search-empty">No results found</div>';
          return;
        }

        resultsBox.innerHTML = results
          .map((item, idx) => `<button type="button" class="map-search-item" data-idx="${idx}">${item.label}</button>`)
          .join('');

        resultsBox.querySelectorAll('.map-search-item').forEach((button) => {
          button.addEventListener('click', () => {
            const item = results[Number(button.dataset.idx || -1)];
            if (!item) return;
            const target = L.latLng(item.latitude, item.longitude);
            marker.setLatLng(target);
            map.setView(target, 16);
            updateSelected(item.latitude, item.longitude);
            resultsBox.innerHTML = '';
          });
        });
      };

      searchBtn.addEventListener('click', runSearch);
      addressInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          runSearch();
        }
      });

      const cleanup = () => {
        map.remove();
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      };

      closeBtn.addEventListener('click', () => {
        cleanup();
        reject(new Error('Location selection cancelled.'));
      });

      cancelBtn.addEventListener('click', () => {
        cleanup();
        reject(new Error('Location selection cancelled.'));
      });

      confirmBtn.addEventListener('click', () => {
        cleanup();
        resolve(selected);
      });
    });
  }

  async function initAdminDispatchMap(page) {
    const mapContainer = page.querySelector('#dispatchMapPreview');
    const statusEl = page.querySelector('#dispatchMapStatus');
    const latInput = page.querySelector('#dispatchLat');
    const lngInput = page.querySelector('#dispatchLng');
    const addressInput = page.querySelector('#dispatchAddress');
    const searchBtn = page.querySelector('#dispatchAddressSearchBtn');
    const resultsBox = page.querySelector('#dispatchAddressResults');
    if (!mapContainer || !statusEl || !latInput || !lngInput || !addressInput || !searchBtn || !resultsBox) return;

    const mapsReady = await ensureLeafletLoaded();
    if (!mapsReady) {
      statusEl.textContent = 'Map preview unavailable right now. You can still enter latitude and longitude manually.';
      return;
    }

    const initialLat = Number(latInput.value) || 12.9716;
    const initialLng = Number(lngInput.value) || 77.5946;
    mapContainer.innerHTML = '';

    const map = L.map(mapContainer).setView([initialLat, initialLng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);

    const syncInputs = (lat, lng) => {
      latInput.value = Number(Number(lat).toFixed(6));
      lngInput.value = Number(Number(lng).toFixed(6));
      statusEl.textContent = `Live location selected: ${latInput.value}, ${lngInput.value}`;
    };

    syncInputs(initialLat, initialLng);

    map.on('click', (event) => {
      marker.setLatLng(event.latlng);
      syncInputs(event.latlng.lat, event.latlng.lng);
    });

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      syncInputs(pos.lat, pos.lng);
      map.panTo(pos);
    });

    const runSearch = async () => {
      const results = await searchOpenStreetMap(addressInput.value);
      if (!results.length) {
        resultsBox.innerHTML = '<div class="map-search-empty">No results found</div>';
        return;
      }

      resultsBox.innerHTML = results
        .map((item, idx) => `<button type="button" class="map-search-item" data-idx="${idx}">${item.label}</button>`)
        .join('');

      resultsBox.querySelectorAll('.map-search-item').forEach((button) => {
        button.addEventListener('click', () => {
          const item = results[Number(button.dataset.idx || -1)];
          if (!item) return;
          marker.setLatLng([item.latitude, item.longitude]);
          map.setView([item.latitude, item.longitude], 16);
          syncInputs(item.latitude, item.longitude);
          resultsBox.innerHTML = '';
        });
      });
    };

    searchBtn.addEventListener('click', runSearch);
    addressInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
      }
    });
  }

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
  const connectionStatus = $('#connectionStatus');
  const connectionStatusText = $('#connectionStatusText');
  const toast        = $('#toast');
  const toastMsg     = $('#toastMsg');

  let selectedRole = 'patient';
  let toastTimer = null;

  function getUploadedReports(username) {
    const all = JSON.parse(localStorage.getItem(UPLOADS_STORAGE_KEY) || '{}');
    return Array.isArray(all[username]) ? all[username] : [];
  }

  function saveUploadedReports(username, reports) {
    const all = JSON.parse(localStorage.getItem(UPLOADS_STORAGE_KEY) || '{}');
    all[username] = reports;
    localStorage.setItem(UPLOADS_STORAGE_KEY, JSON.stringify(all));
  }

  function createUploadedReport(file) {
    const now = new Date();
    const ext = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : 'FILE';
    return {
      id: `upl-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: file.name,
      date: now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      type: ext,
      status: 'uploaded',
      summary: 'Awaiting doctor scan for AI summary.',
    };
  }

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

  async function updateConnectionStatus() {
    if (!connectionStatus || !connectionStatusText) return;

    connectionStatus.className = 'connection-status checking';
    connectionStatusText.textContent = 'Checking secure backend connection...';

    try {
      const response = await fetch(new URL('/health', API_BASE).toString(), {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Health check failed');
      }

      const payload = await response.json();
      connectionStatus.className = 'connection-status online';
      connectionStatusText.textContent = payload.ok
        ? 'Secure backend online'
        : 'Backend available';
    } catch (error) {
      connectionStatus.className = 'connection-status offline';
      connectionStatusText.textContent = 'Backend unreachable';
    }
  }

  // -------- Role Selection --------
  $$('.role-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.role-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRole = btn.dataset.role;
      const meta = ROLE_META[selectedRole] || ROLE_META.patient;
      welcomeSub.textContent = meta.welcomeSub;
    });
  });

  // -------- Toggle Password --------
  togglePw.addEventListener('click', () => {
    const isPassword = passwordEl.type === 'password';
    passwordEl.type = isPassword ? 'text' : 'password';
    // swap icon to indicate state
    togglePw.style.opacity = isPassword ? '1' : '0.5';
  });

  // -------- Form Submit --------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset errors
    $('#usernameGroup').classList.remove('error');
    $('#passwordGroup').classList.remove('error');
    $('#usernameError').textContent = '';
    $('#passwordError').textContent = '';

    const email = usernameEl.value.trim().toLowerCase();
    const phone = passwordEl.value.trim();

    // Validate
    if (!email) {
      $('#usernameGroup').classList.add('error');
      $('#usernameError').textContent = 'Email is required';
      usernameEl.focus();
      return;
    }
    if (!phone) {
      $('#passwordGroup').classList.add('error');
      $('#passwordError').textContent = 'Phone number is required';
      passwordEl.focus();
      return;
    }

    loginBtn.classList.add('loading');
    loginBtn.disabled = true;

    try {
      let response = await fetch(LOGIN_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, email, phone }),
      });

      let payload = await response.json();
      if (!response.ok || !payload.user) {
        if (selectedRole === 'patient' && response.status === 401) {
          const createNow = window.confirm('No patient found with this email/phone. Create a new patient profile now?');
          if (createNow) {
            const newUser = await registerPatientAndLogin(email, phone);
            payload = { user: newUser };
          } else {
            throw new Error(payload.detail || 'Login failed');
          }
        } else {
          throw new Error(payload.detail || 'Login failed');
        }
      }

      const record = payload.user;
      showToast(`Welcome, ${record.name}!`, 'success');
      setTimeout(() => navigateToDashboard(record.email, record), 600);
    } catch (err) {
      const message = String(err.message || 'Login failed');
      showToast(message, 'error');
      $('#passwordGroup').classList.add('error');
      $('#passwordError').textContent = 'Invalid email or phone number';
    } finally {
      loginBtn.classList.remove('loading');
      loginBtn.disabled = false;
    }
  });

  // -------- Navigate to Dashboard --------
  function navigateToDashboard(username, record) {
    // Hide login UI
    $('.main-container').style.display = 'none';

    // Route to doctor portal for doctor role
    if (record.role === 'doctor') {
      initDoctorPortal(username, record);
    } else {
      // Build & show dashboard for other roles
      renderDashboard(username, record);
    }
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
      : role === 'admin'
        ? getAdminOverviewDashboard(record)
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

    const emergencyBtn = page.querySelector('#emergencyBtn');
    if (emergencyBtn) {
      emergencyBtn.addEventListener('click', async () => {
        if (role === 'patient') {
          try {
            emergencyBtn.disabled = true;
            emergencyBtn.textContent = 'Locating and dispatching...';
            await requestPatientEmergencyDispatch(record);
          } finally {
            emergencyBtn.disabled = false;
            emergencyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.1 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2z"/></svg>
              Emergency Help
            `;
          }
          return;
        }

        if (role === 'admin') {
          const dispatchNav = page.querySelector('.sidebar-nav-item[data-nav="dispatch"]');
          if (dispatchNav) dispatchNav.click();
          return;
        }

        showToast('Emergency dispatch is available from patient/admin workflow.', 'error');
      });
    }

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
          contentArea.innerHTML = getReportsDashboard(record, username);
          initReportEvents(page, record);
        } else if (navId === 'upload') {
          renderUploadDashboard(page, record, username);
        } else if (role === 'admin' && navId === 'critical') {
          contentArea.innerHTML = getAdminCriticalQueueView();
          loadAdminCriticalQueue(page, record);
        } else if (role === 'admin' && navId === 'dispatch') {
          contentArea.innerHTML = getAdminDispatchView();
          initAdminDispatchEvents(page, record);
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
        } else if (navId === 'ollama') {
          contentArea.innerHTML = getOllamaTestDashboard();
          initOllamaTestEvents(page);
        } else {
          contentArea.innerHTML = role === 'patient'
            ? getPatientDashboard(record)
            : role === 'admin'
              ? getAdminOverviewDashboard(record)
              : getGenericDashboard(record, role, meta);
          
          if (role === 'patient') {
             requestAnimationFrame(() => animateHealthRings());
             initPatientEvents(page, username, record, role);
          } else if (role === 'admin') {
            loadAdminCriticalQueue(page, record, true);
          }
        }
      });
    });

    // Med "Take now" buttons
    initPatientEvents(page, username, record, role);

    if (role === 'patient') {
      maybeStartPatientOnboarding(page, record, username);
    }

    if (role === 'admin') {
      loadAdminCriticalQueue(page, record, true);
    }
  }

  function initPatientEvents(page, username, record, role) {
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

    const userMsgLower = userMessage.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (userMsgLower === 'hi' || userMsgLower === 'hello' || userMsgLower === 'hey') {
      addLumiMessage(messages, 'assistant', 'Hi there! How can I help you today?');
      sendBtn.disabled = false;
      return;
    }

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

  function initReportEvents(page, record) {
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
  function getReportsDashboard(record, username) {
    const reports = [
      { name: 'Complete Blood Count (CBC)', date: 'Oct 02, 2026', type: 'Lab Report', status: 'ready', isNew: true },
      { name: 'Lipid Profile', date: 'Oct 02, 2026', type: 'Lab Report', status: 'ready', isNew: true },
      { name: 'Cardiology Consultation', date: 'Sep 14, 2026', type: 'Medical Record', status: 'ready', isNew: false },
      { name: 'Chest X-Ray', date: 'Aug 22, 2026', type: 'Imaging', status: 'ready', isNew: false },
      { name: 'Routine Health Checkup', date: 'Jun 10, 2026', type: 'Medical Record', status: 'ready', isNew: false },
      { name: 'Diabetes Screening (HbA1c)', date: 'Oct 08, 2026', type: 'Lab Report', status: 'pending', isNew: true },
    ];

    const uploaded = getUploadedReports(username).map((item) => ({
      name: item.name,
      date: item.date,
      type: 'Uploaded Prescription',
      status: item.status === 'scanned' ? 'ready' : 'pending',
      isNew: false,
      summary: item.summary,
      uploaded: true,
    }));

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
        ${r.summary ? `<div class="report-summary-pill">${r.summary}</div>` : ''}
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

    const previousReports = reports.filter(r => !r.isNew).concat(uploaded);

    return `
      <div class="reports-dashboard">
        <h2 class="section-card-title">New Reports</h2>
        <div class="reports-list" style="margin-bottom: 32px;">
          ${renderReportList(reports.filter(r => r.isNew))}
        </div>
        
        <h2 class="section-card-title">Previous Reports</h2>
        <div class="reports-list">
          ${renderReportList(previousReports)}
        </div>
      </div>
    `;
  }

  function getUploadDashboard(record, username, uploadedReports = null) {
    const uploaded = Array.isArray(uploadedReports) ? uploadedReports : getUploadedReports(username);
    const uploadedList = uploaded.length
      ? uploaded.map(item => `
        <div class="upload-file-row" data-upload-id="${item.id}">
          <div class="upload-file-main">
            <div class="upload-file-name">${item.name}</div>
            <div class="upload-file-meta">${item.date} • ${item.type}</div>
            <div class="upload-file-summary">${item.summary}</div>
          </div>
          <button class="scan-report-btn" data-upload-id="${item.id}" ${item.status !== 'uploaded' ? 'disabled' : ''}>
            ${item.status !== 'uploaded' ? 'Scanned ✓' : 'Doctor Scan'}
          </button>
        </div>
      `).join('')
      : '<div class="upload-empty">No uploaded prescriptions yet. Upload a photo to get started.</div>';

    return `
      <div class="upload-dashboard-card">
        <h2 class="section-card-title">Upload Prescription Photo</h2>
        <p class="upload-help-text">Upload doctor-written prescriptions (image or PDF). Files will appear in Previous Reports after upload.</p>

        <div class="upload-dropzone" id="uploadDropzone">
          <div class="upload-drop-title">Drop image here or choose file</div>
          <div class="upload-drop-sub">Supported: JPG, PNG, WEBP, PDF</div>
          <input type="file" id="prescriptionFileInput" accept="image/*,.pdf" capture="environment" hidden />
          <button class="upload-select-btn" id="uploadSelectBtn">Choose Photo</button>
        </div>

        <div class="upload-list-wrap">
          <h3 class="upload-list-title">Uploaded Files</h3>
          ${uploadedList}
        </div>
      </div>
    `;
  }

  function initUploadEvents(page, record, username, uploadedReports = null) {
    const input = page.querySelector('#prescriptionFileInput');
    const selectBtn = page.querySelector('#uploadSelectBtn');
    const dropzone = page.querySelector('#uploadDropzone');

    if (!input || !selectBtn || !dropzone) return;

    const onFilesSelected = async (files) => {
      if (!files || !files.length) return;

      let shareHospitalDetails = false;
      let dispatchOptions = { autoDispatch: false };
      if (record.role === 'patient' && record.patient_id) {
        const choice = window.prompt(
          'Report privacy option:\nType SHARE to include previous hospital/doctor details.\nType HIDE to hide those details.\nPress Cancel to stop upload.',
          'HIDE'
        );

        if (choice === null) {
          showToast('Upload cancelled.', 'error');
          return;
        }

        const normalized = String(choice).trim().toUpperCase();
        if (normalized === 'SHARE') {
          shareHospitalDetails = true;
        } else if (normalized === 'HIDE') {
          shareHospitalDetails = false;
        } else {
          showToast('Invalid option. Type SHARE or HIDE.', 'error');
          return;
        }

        const wantsAutoDispatch = window.confirm(
          'If this report is detected as CRITICAL, should we auto-dispatch ambulance using your live location?'
        );
        if (wantsAutoDispatch) {
          try {
            const loc = await getCurrentLocation();
            let selectedLoc = loc;
            try {
              selectedLoc = await pickLocationWithMap(loc, 'Confirm location for auto-dispatch');
            } catch {
              selectedLoc = loc;
            }
            dispatchOptions = {
              autoDispatch: true,
              latitude: selectedLoc.latitude,
              longitude: selectedLoc.longitude,
            };
          } catch (error) {
            dispatchOptions = { autoDispatch: false };
            showToast('Location unavailable. Upload will continue without auto-dispatch.', 'error');
          }
        }
      }

      try {
        if (record.role === 'patient' && record.patient_id) {
          let lastUpload = null;
          for (const file of Array.from(files)) {
            lastUpload = await uploadPatientReport(record, file, shareHospitalDetails, dispatchOptions);
          }

          if (lastUpload?.routed_to_admin) {
            showToast('Report flagged for urgent admin review. Doctor will be informed after review.', 'success');
          } else {
            showToast('Report uploaded and AI analysis completed.', 'success');
          }

          if (lastUpload?.ambulance_dispatch?.status === 'dispatched') {
            const unit = lastUpload.ambulance_dispatch?.ambulance?.unit_name || 'Ambulance';
            showToast(`${unit} auto-dispatched. ETA ${lastUpload.ambulance_dispatch.eta_minutes} min.`, 'success');
          }

          await renderUploadDashboard(page, record, username);
          return;
        }

        const existing = getUploadedReports(username);
        const created = Array.from(files).map(createUploadedReport);
        saveUploadedReports(username, created.concat(existing));
        showToast('Prescription uploaded. Check Previous Reports.', 'success');
        const contentArea = page.querySelector('.dash-content');
        contentArea.innerHTML = getUploadDashboard(record, username);
        initUploadEvents(page, record, username);
      } catch (error) {
        showToast(error.message || 'Upload failed.', 'error');
      }
    };

    selectBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => onFilesSelected(input.files));

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      onFilesSelected(e.dataTransfer.files);
    });

    page.querySelectorAll('.scan-report-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (record.role === 'patient' && record.patient_id) {
          showToast('AI scan already completed during upload.', 'success');
          return;
        }

        const uploadId = btn.dataset.uploadId;
        const reports = getUploadedReports(username);
        const target = reports.find(r => r.id === uploadId);
        if (!target) return;
        target.status = 'scanned';
        target.summary = 'Doctor scan complete: probable hypertension medication guidance and dosage notes extracted.';
        saveUploadedReports(username, reports);
        showToast('Doctor scan summary generated.', 'success');
        const contentArea = page.querySelector('.dash-content');
        contentArea.innerHTML = getUploadDashboard(record, username);
        initUploadEvents(page, record, username);
      });
    });
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

  async function requestPatientEmergencyDispatch(record) {
    if (!record.patient_id) {
      throw new Error('Patient profile not linked. Please log in again.');
    }

    const location = await getCurrentLocation();
    let selectedLocation = location;
    try {
      selectedLocation = await pickLocationWithMap(location, 'Confirm emergency pickup location');
    } catch {
      selectedLocation = location;
    }
    const dispatch = await dispatchAmbulance({
      patient_id: record.patient_id,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
      severity: 'critical',
      requested_by_role: 'patient',
      requested_by_id: record.clinical_id || record.id,
      notes: 'Patient requested emergency help from dashboard.',
    });

    if (dispatch.status === 'dispatched') {
      const unit = dispatch.ambulance?.unit_name || 'ambulance unit';
      showToast(`${unit} dispatched. ETA ${dispatch.eta_minutes} min.`, 'success');
      return;
    }
    showToast(dispatch.message || 'No ambulance currently available.', 'error');
  }

  function getAdminOverviewDashboard(record) {
    return `
      <div class="admin-dashboard-grid">
        <div class="admin-kpi-card">
          <h3>Critical Review Queue</h3>
          <p id="adminCriticalCount">Loading...</p>
        </div>
        <div class="admin-kpi-card">
          <h3>Provider Stack</h3>
          <p>OpenAI main brain + Gemini triage + Groq action engine</p>
        </div>
      </div>
      <div class="admin-queue-card">
        <div class="admin-queue-header-row">
          <h3>Latest Critical Cases</h3>
          <button class="btn-small btn-primary" id="adminRefreshQueueBtn">Refresh</button>
        </div>
        <div id="adminCriticalPreview">Loading queue...</div>
      </div>
    `;
  }

  function getAdminCriticalQueueView() {
    return `
      <div class="admin-queue-card">
        <div class="admin-queue-header-row">
          <h3>Admin Critical Queue</h3>
          <button class="btn-small btn-primary" id="adminRefreshQueueBtn">Refresh</button>
        </div>
        <p class="upload-help-text">Critical reports are hidden from patient panic view until admin releases to doctor.</p>
        <div id="adminCriticalQueueList">Loading queue...</div>
      </div>
    `;
  }

  function getAdminDispatchView() {
    return `
      <div class="admin-queue-card">
        <h3>Ambulance Dispatch Desk</h3>
        <p class="upload-help-text">Dispatch nearest ambulance using patient latitude/longitude.</p>

        <div class="admin-dispatch-grid">
          <input id="dispatchPatientId" type="number" placeholder="Patient ID" />
          <input id="dispatchReportId" type="number" placeholder="Report ID (optional)" />
          <input id="dispatchAddress" type="text" placeholder="Search location by address/landmark" />
          <button class="btn-small btn-secondary" id="dispatchAddressSearchBtn">Search Address</button>
          <input id="dispatchLat" type="number" step="any" placeholder="Latitude" />
          <input id="dispatchLng" type="number" step="any" placeholder="Longitude" />
          <select id="dispatchSeverity">
            <option value="critical">Critical</option>
            <option value="urgent">Urgent</option>
            <option value="routine">Routine</option>
          </select>
          <button class="btn-small btn-secondary" id="useMyLocationBtn">Use My Location</button>
        </div>

        <div class="admin-dispatch-actions">
          <button class="btn btn-primary" id="dispatchNowBtn">Dispatch Ambulance</button>
          <button class="btn btn-secondary" id="findNearbyBtn">Find Nearby Units</button>
        </div>

        <div id="adminDispatchOutput" class="validation-status" style="margin-top:12px;">No dispatch action yet.</div>
        <div id="dispatchAddressResults" class="map-picker-search-results" style="margin-top:8px;"></div>
        <p id="dispatchMapStatus" class="upload-help-text" style="margin-top:10px;">Loading map preview...</p>
        <div id="dispatchMapPreview" class="dispatch-map-preview"></div>
        <div id="adminNearbyList" class="reports-list" style="margin-top:12px;"></div>
      </div>
    `;
  }

  async function releaseCriticalReport(reportId, record) {
    const response = await fetch(new URL(`/api/admin/release-report/${reportId}`, API_BASE).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: record.clinical_id || record.id,
        message: 'Admin released critical report to doctor. Please act immediately.',
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || 'Failed to release report');
    }
    return data;
  }

  async function loadAdminCriticalQueue(page, record, compact = false) {
    const targetId = compact ? '#adminCriticalPreview' : '#adminCriticalQueueList';
    const target = page.querySelector(targetId);
    if (!target) return;

    try {
      target.innerHTML = 'Loading critical queue...';
      const response = await fetch(`${ADMIN_CRITICAL_QUEUE_API_URL}?status=pending_admin`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Unable to load critical queue');
      }

      const queue = Array.isArray(data.queue) ? data.queue : [];
      const countEl = page.querySelector('#adminCriticalCount');
      if (countEl) {
        countEl.textContent = `${data.critical_count || queue.length} pending critical`; 
      }

      if (!queue.length) {
        target.innerHTML = '<div class="upload-empty">No pending critical escalations.</div>';
      } else {
        target.innerHTML = queue.map((item) => `
          <div class="admin-critical-item" data-report-id="${item.report_id}" data-patient-id="${item.patient_id}">
            <div class="admin-critical-main">
              <div class="admin-critical-title">${item.patient_name} • ${item.report_name || 'Report ' + item.report_id}</div>
              <div class="admin-critical-meta">Risk: ${item.risk_level.toUpperCase()} • Suggested ESI: ${item.suggested_esi || 3}</div>
              <div class="admin-critical-summary">${item.admin_summary || 'No summary available.'}</div>
            </div>
            <div class="admin-critical-actions">
              <button class="btn-small btn-primary" data-action="release">Release to Doctor</button>
              <button class="btn-small btn-secondary" data-action="dispatch">Dispatch Ambulance</button>
            </div>
          </div>
        `).join('');
      }

      const refreshBtn = page.querySelector('#adminRefreshQueueBtn');
      if (refreshBtn) {
        refreshBtn.onclick = () => loadAdminCriticalQueue(page, record, compact);
      }

      target.querySelectorAll('[data-action="release"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.admin-critical-item');
          const reportId = Number(row?.dataset.reportId || 0);
          if (!reportId) return;
          try {
            btn.disabled = true;
            await releaseCriticalReport(reportId, record);
            showToast(`Report #${reportId} released to doctor.`, 'success');
            await loadAdminCriticalQueue(page, record, compact);
          } catch (error) {
            showToast(error.message || 'Release failed.', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });

      target.querySelectorAll('[data-action="dispatch"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.admin-critical-item');
          const patientId = row?.dataset.patientId || '';
          const reportId = row?.dataset.reportId || '';
          const dispatchNav = page.querySelector('.sidebar-nav-item[data-nav="dispatch"]');
          if (!dispatchNav) return;
          dispatchNav.click();
          const patientInput = page.querySelector('#dispatchPatientId');
          const reportInput = page.querySelector('#dispatchReportId');
          if (patientInput) patientInput.value = patientId;
          if (reportInput) reportInput.value = reportId;
        });
      });
    } catch (error) {
      target.innerHTML = `<div class="upload-empty">${error.message || 'Unable to load queue.'}</div>`;
    }
  }

  function initAdminDispatchEvents(page, record) {
    const useMyLocationBtn = page.querySelector('#useMyLocationBtn');
    const dispatchNowBtn = page.querySelector('#dispatchNowBtn');
    const findNearbyBtn = page.querySelector('#findNearbyBtn');
    const out = page.querySelector('#adminDispatchOutput');
    const nearbyList = page.querySelector('#adminNearbyList');
    const latInput = page.querySelector('#dispatchLat');
    const lngInput = page.querySelector('#dispatchLng');

    initAdminDispatchMap(page);

    if (useMyLocationBtn) {
      useMyLocationBtn.addEventListener('click', async () => {
        try {
          const loc = await getCurrentLocation();
          latInput.value = loc.latitude;
          lngInput.value = loc.longitude;
          showToast('Location captured.', 'success');
        } catch (error) {
          showToast(error.message || 'Unable to get location.', 'error');
        }
      });
    }

    if (findNearbyBtn) {
      findNearbyBtn.addEventListener('click', async () => {
        const lat = Number(latInput.value);
        const lng = Number(lngInput.value);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          showToast('Enter valid latitude and longitude.', 'error');
          return;
        }

        try {
          const url = `${AMBULANCE_NEARBY_API_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}`;
          const response = await fetch(url);
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || 'Unable to fetch nearby units');

          const units = Array.isArray(data.ambulances) ? data.ambulances : [];
          if (!units.length) {
            nearbyList.innerHTML = '<div class="upload-empty">No nearby available units.</div>';
            return;
          }

          nearbyList.innerHTML = units.map((unit) => `
            <div class="report-item">
              <div class="report-icon-box">${getCardIcon('truck')}</div>
              <div class="report-info">
                <div class="report-name">${unit.unit_name} (${unit.vehicle_type})</div>
                <div class="report-meta">
                  <span>${unit.distance_km} km away</span>
                  <span>•</span>
                  <span>${unit.crew_info || 'Crew info pending'}</span>
                </div>
              </div>
            </div>
          `).join('');
        } catch (error) {
          showToast(error.message || 'Nearby query failed.', 'error');
        }
      });
    }

    if (dispatchNowBtn) {
      dispatchNowBtn.addEventListener('click', async () => {
        const patientId = Number(page.querySelector('#dispatchPatientId')?.value);
        const reportIdRaw = page.querySelector('#dispatchReportId')?.value;
        const lat = Number(latInput.value);
        const lng = Number(lngInput.value);
        const severity = page.querySelector('#dispatchSeverity')?.value || 'critical';

        if (!patientId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          showToast('Patient ID and valid coordinates are required.', 'error');
          return;
        }

        try {
          dispatchNowBtn.disabled = true;
          dispatchNowBtn.textContent = 'Dispatching...';
          const result = await dispatchAmbulance({
            patient_id: patientId,
            report_id: reportIdRaw ? Number(reportIdRaw) : null,
            latitude: lat,
            longitude: lng,
            severity,
            requested_by_role: 'admin',
            requested_by_id: record.clinical_id || record.id,
            notes: 'Manual dispatch from admin desk.',
          });

          if (result.status === 'dispatched') {
            out.innerHTML = `<strong>${result.ambulance?.unit_name || 'Unit'} dispatched</strong><p>ETA ${result.eta_minutes} min • Distance ${result.distance_km} km</p>`;
            showToast('Ambulance dispatched successfully.', 'success');
          } else {
            out.textContent = result.message || 'No unit available.';
            showToast(result.message || 'No unit available.', 'error');
          }
        } catch (error) {
          showToast(error.message || 'Dispatch failed.', 'error');
        } finally {
          dispatchNowBtn.disabled = false;
          dispatchNowBtn.textContent = 'Dispatch Ambulance';
        }
      });
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
      cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>',
    };
    return icons[name] || '';
  }

  // -------- Ollama Test Dashboard --------
  function getOllamaTestDashboard() {
    return `
      <div class="dash-card">
        <h2 class="dash-card-title">Test Local Ollama (Qwen)</h2>
        <div class="dash-card-body">
          <p style="margin-bottom:1rem;color:var(--text-light)">Send a prompt to the local Ollama instance running the Qwen model. This routes securely through the Luminus backend.</p>
          <div class="chat-input-area" style="position:static; margin-top:20px; box-shadow:none; padding:0; background:transparent;">
            <textarea id="ollamaPrompt" class="chat-input" placeholder="Type a prompt for Qwen..." rows="3"></textarea>
            <button id="ollamaSendBtn" class="chat-send-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <div style="margin-top: 2rem;">
            <h3 style="font-size:1rem;margin-bottom:0.5rem;">Response:</h3>
            <div id="ollamaResponse" style="background:var(--bg-lighter); padding:1.5rem; border-radius:12px; min-height:100px; font-family:monospace; white-space:pre-wrap; border:1px solid var(--border-color);">
              <em style="color:var(--text-lighter)">Response will appear here...</em>
            </div>
            <div id="ollamaError" style="color:var(--danger-color); margin-top:0.5rem; font-weight:500; display:none;"></div>
          </div>
        </div>
      </div>
    `;
  }

  function initOllamaTestEvents(page) {
    const sendBtn = page.querySelector('#ollamaSendBtn');
    const promptInput = page.querySelector('#ollamaPrompt');
    const responseBox = page.querySelector('#ollamaResponse');
    const errorBox = page.querySelector('#ollamaError');

    if (!sendBtn || !promptInput) return;

    sendBtn.addEventListener('click', async () => {
      const prompt = promptInput.value.trim();
      if (!prompt) return;

      // Reset UI
      promptInput.value = '';
      responseBox.innerHTML = '<em style="color:var(--text-lighter)">Generating... Please wait.</em>';
      errorBox.style.display = 'none';
      sendBtn.disabled = true;

      try {
        console.log('Sending prompt to /api/ollama:', prompt);
        const res = await fetch(new URL('/api/ollama', API_BASE).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        
        const data = await res.json();
        console.log('Received response from backend:', data);
        
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to fetch response from Ollama.');
        }

        responseBox.textContent = data.result || 'No response returned.';
      } catch (err) {
        responseBox.innerHTML = '<em style="color:var(--text-lighter)">Failed.</em>';
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
      } finally {
        sendBtn.disabled = false;
      }
    });

    // Support Enter key (Shift+Enter for newline)
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }

  // -------- Init --------
  function init() {
    initParticles();
    animateCounters();
    updateConnectionStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

  /* ========== DOCTOR PORTAL INITIALIZATION ========== */
  (function() {
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);
    const API_BASE = window.LUMINUS_API_BASE || 'http://127.0.0.1:8000';

    window.initDoctorPortal = async function(username, doctorRecord) {
      const doctorPortal = $('#doctorPortal');
      const logoutBtn = $('#logoutBtn');
      const effectiveDoctorId = doctorRecord.clinical_id || doctorRecord.id;
      
      // Set doctor info
      $('#doctorName').textContent = doctorRecord.name;
      $('#doctorSpecialty').textContent = doctorRecord.specialty || 'General Medicine';
      
      // Show doctor portal
      doctorPortal.style.display = 'flex';
      
      // Load doctor's queue
      loadDoctorQueue(effectiveDoctorId);
      
      // Load alerts
      loadCriticalAlerts(effectiveDoctorId);

      // Load triaged urgent requests
      loadDoctorUrgentRequests(effectiveDoctorId);
      
      // Bind logout
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          location.reload();
        });
      }
      
      // Bind visit controls
      bindVisitControls({ ...doctorRecord, effectiveId: effectiveDoctorId });
      
      // Bind prescription upload
      bindPrescriptionUpload({ ...doctorRecord, effectiveId: effectiveDoctorId });
      
      // Setup real-time updates
      setInterval(() => loadDoctorQueue(effectiveDoctorId), 30000); // Refresh queue every 30s
      setInterval(() => loadCriticalAlerts(effectiveDoctorId), 20000); // Refresh alerts every 20s
      setInterval(() => loadDoctorUrgentRequests(effectiveDoctorId), 25000); // Refresh AI triage
    };

    async function loadDoctorQueue(doctorId) {
      try {
        const response = await fetch(new URL(`/api/doctor/queue/${doctorId}`, API_BASE).toString());
        const data = await response.json();
        
        $('#queueStatus').textContent = `${data.queue_length} patients in queue`;
        $('#pendingCount').textContent = data.queue_length;
        $('#avgWait').textContent = data.average_wait;
        
        const queueList = $('#queueList');
        queueList.innerHTML = data.appointments.map(appt => `
          <div class="queue-item" data-patient-id="${appt.patient_id}">
            <div class="queue-item-name">${appt.patient_name}</div>
            <div class="queue-item-time">ESI ${appt.esi_priority} • ${new Date(appt.scheduled_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
        `).join('');
        
        // Bind queue item clicks
        $$('.queue-item').forEach(item => {
          item.addEventListener('click', () => loadPatientCard(item.dataset.patientId, doctorId));
        });
      } catch (err) {
        console.error('Queue load error:', err);
      }
    }

    async function loadCriticalAlerts(doctorId) {
      try {
        const response = await fetch(new URL(`/api/doctor/alerts/${doctorId}`, API_BASE).toString());
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || 'Unable to load alerts');
        }

        const alertsBanner = $('#alertsBanner');
        const alertsList = $('#alertsList');
        const alertCount = $('#alertCount');

        alertCount.textContent = String(data.critical_count || 0);
        alertsList.innerHTML = (data.alerts || []).map((alert) => `
          <div class="alert-item ${alert.severity}">${alert.message}</div>
        `).join('');

        alertsBanner.style.display = (data.alerts || []).length > 0 ? 'block' : 'none';
      } catch (err) {
        console.error('Alerts load error:', err);
      }
    }

    async function loadDoctorUrgentRequests(doctorId) {
      try {
        const response = await fetch(new URL(`/api/doctor/urgent-requests/${doctorId}`, API_BASE).toString());
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || 'Unable to load urgent requests');
        }

        const priorityList = $('#priorityList');
        const aiSuggestions = $('#aiSuggestions');
        const requests = Array.isArray(data.requests) ? data.requests : [];

        if (priorityList) {
          if (!requests.length) {
            priorityList.innerHTML = '<div class="critical-item">No urgent requests released by admin.</div>';
          } else {
            priorityList.innerHTML = requests.map((item) => `
              <div class="critical-item">
                <div class="queue-item-name">${item.patient_name} • ${item.risk_level.toUpperCase()}</div>
                <div class="queue-item-time">ESI ${item.suggested_esi || 3} • ${item.report_name || ('Report #' + item.report_id)}</div>
                <div class="queue-item-time">${(item.doctor_actions || []).slice(0, 2).join(' | ') || 'Review now'}</div>
                ${item.ambulance_recommended ? '<div class="report-summary-pill" style="margin-top:6px;">Ambulance Recommended</div>' : ''}
              </div>
            `).join('');
          }
        }

        if (aiSuggestions) {
          const suggestions = Array.isArray(data.ai_suggestions) ? data.ai_suggestions : [];
          if (!suggestions.length) {
            aiSuggestions.innerHTML = '<p style="text-align: center; font-size: 12px; color: #999;">No AI suggestions yet</p>';
          } else {
            aiSuggestions.innerHTML = suggestions.slice(0, 6).map((suggestion) => `
              <div class="alert-item" style="border-left-color:#4361ee;">${suggestion}</div>
            `).join('');
          }
        }
      } catch (err) {
        console.error('Urgent request load error:', err);
      }
    }

    async function loadPatientCard(patientId, doctorId) {
      try {
        const historyResponse = await fetch(new URL(`/api/patient/history-summary/${patientId}`, API_BASE).toString());
        const history = await historyResponse.json();

        if (!historyResponse.ok) {
          throw new Error(history.detail || 'Failed to load patient summary');
        }
        
        const card = $('#patientCard');
        $('#patientName').textContent = history.known_conditions ? 'Patient ' + patientId : 'Patient';
        $('#patientId').textContent = `ID: #${patientId}`;
        $('#patientAge').textContent = 'Age: --';
        $('#patientBlood').textContent = `Blood: ${history.blood_group || '--'}`;
        
        // Show medical history
        const historyGrid = $('#patientHistory');
        const historyItems = [
          { label: 'Conditions', value: (history.known_conditions || []).join(', ') || 'None' },
          { label: 'Medications', value: (history.medication_history || []).slice(0, 3).join(', ') || 'None listed' },
          { label: 'Reports', value: history.previous_reports ? `${history.previous_reports.length} on file` : '0 on file' },
          { label: 'Blood Group', value: history.blood_group || 'Unknown' }
        ];
        
        historyGrid.innerHTML = historyItems.map(item => `
          <div class="history-item">
            <div class="history-label">${item.label}</div>
            <div class="history-value">${item.value}</div>
          </div>
        `).join('');

        const summaryList = $('#patientSummaryPoints');
        if (summaryList) {
          const points = Array.isArray(history.summary_points) ? history.summary_points : [];
          if (points.length > 0) {
            summaryList.innerHTML = points.map((point) => `<li>${point}</li>`).join('');
          } else {
            summaryList.innerHTML = '<li>No AI summary available.</li>';
          }
        }
        
        card.style.display = 'block';
        
        // Store for later use
        window.currentPatient = { id: patientId, doctorId: doctorId, history: history };
      } catch (err) {
        console.error('Patient card error:', err);
      }
    }

    function bindVisitControls(doctorRecord) {
      const startVisitBtn = $('#startVisitBtn');
      const visitPanel = $('#visitPanel');
      const closeVisitBtn = $('#closeVisitBtn');
      const saveVisitBtn = $('#saveVisitBtn');
      const addNoteBtn = $('#addNoteBtn');
      const transcriptInput = $('#transcriptInput');
      const transcriptContent = $('#transcriptContent');
      const transcriptTime = $('#transcriptTime');
      
      if (!startVisitBtn) return;

      function appendTranscriptLine(text, speaker = 'doctor') {
        if (!text) return;
        const line = document.createElement('div');
        line.className = `transcript-line ${speaker}`;
        line.textContent = text;
        transcriptContent.appendChild(line);
        transcriptContent.scrollTop = transcriptContent.scrollHeight;
      }
      
      startVisitBtn.addEventListener('click', async () => {
        if (!window.currentPatient) {
          alert('Please select a patient first');
          return;
        }
        
        // Start visit session
        try {
          const response = await fetch(new URL('/api/visit/start', API_BASE).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patient_id: window.currentPatient.id,
              doctor_id: doctorRecord.effectiveId,
              appointment_id: null
            })
          });
          
          const visitData = await response.json();
          if (!response.ok) {
            throw new Error(visitData.detail || 'Failed to start consultation');
          }
          window.currentVisit = visitData;
          
          $('#patientCard').style.display = 'none';
          visitPanel.style.display = 'flex';
          $('#transcriptContent').innerHTML = '';
          $('#voiceStatus').textContent = 'Enable Voice to Text';
          if (transcriptTime) transcriptTime.textContent = '00:00';
        } catch (err) {
          console.error('Visit start error:', err);
          alert(err.message || 'Unable to start consultation');
        }
      });

      if (addNoteBtn && transcriptInput) {
        addNoteBtn.addEventListener('click', () => {
          const text = transcriptInput.value.trim();
          if (!text) return;
          appendTranscriptLine(text, 'doctor');
          transcriptInput.value = '';
        });

        transcriptInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addNoteBtn.click();
          }
        });
      }
      
      if (closeVisitBtn) {
        closeVisitBtn.addEventListener('click', () => {
          visitPanel.style.display = 'none';
          $('#patientCard').style.display = 'block';
        });
      }
      
      if (saveVisitBtn) {
        saveVisitBtn.addEventListener('click', async () => {
          if (!window.currentVisit) return;
          
          const transcript = [];
          $$('.transcript-line').forEach(line => {
            const speaker = line.classList.contains('doctor') ? 'doctor' : 'patient';
            transcript.push({
              speaker: speaker,
              text: line.textContent
            });
          });
          
          try {
            const response = await fetch(new URL('/api/visit/save', API_BASE).toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                visit_session_id: window.currentVisit.visit_session_id,
                patient_id: window.currentPatient.id,
                doctor_id: doctorRecord.effectiveId,
                transcript: transcript,
                urgency_level: 'routine'
              })
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.detail || 'Failed to save consultation');
            }
            
            visitPanel.style.display = 'none';
            alert('Visit saved successfully');
          } catch (err) {
            console.error('Visit save error:', err);
            alert(err.message || 'Unable to save consultation');
          }
        });
      }
    }

    function bindPrescriptionUpload(doctorRecord) {
      const uploadPrescriptionBtn = $('#uploadPrescriptionBtn');
      const validatePrescriptionBtn = $('#validatePrescriptionBtn');
      
      if (!uploadPrescriptionBtn) return;
      
      uploadPrescriptionBtn.addEventListener('click', () => {
        const medications = prompt('Enter medications (comma-separated):');
        if (!medications || !window.currentPatient) return;
        if (!window.currentVisit || !window.currentVisit.visit_session_id) {
          alert('Start and save consultation first before uploading prescription.');
          return;
        }
        
        const medList = medications.split(',').map(m => m.trim()).filter(m => m);
        
        fetch(new URL('/api/prescription/upload', API_BASE).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visit_session_id: window.currentVisit.visit_session_id,
            patient_id: window.currentPatient.id,
            doctor_id: doctorRecord.effectiveId,
            medications: medList,
            dosage: 'As directed',
            notes: 'Uploaded from doctor portal'
          })
        }).then(r => r.json()).then(data => {
          if (data.detail) {
            throw new Error(data.detail);
          }
          window.currentPrescription = data;
          alert('Prescription uploaded');
          // Trigger validation
          validatePrescriptionBtn.click();
        }).catch(err => {
          console.error('Upload error:', err);
          alert(err.message || 'Unable to upload prescription');
        });
      });
      
      if (validatePrescriptionBtn) {
        validatePrescriptionBtn.addEventListener('click', () => {
          if (!window.currentPatient || !window.currentPrescription) return;
          
          const medications = prompt('Enter medications to validate (comma-separated):');
          if (!medications) return;
          
          const medList = medications.split(',').map(m => m.trim()).filter(m => m);
          
          fetch(new URL('/api/prescription/validate', API_BASE).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prescription_id: window.currentPrescription.prescription_id || 0,
              patient_id: window.currentPatient.id,
              doctor_id: doctorRecord.effectiveId,
              medications: medList
            })
          }).then(r => r.json()).then(data => {
            if (data.detail) {
              throw new Error(data.detail);
            }
            const validationStatus = $('#validationStatus');
            const validationIssues = $('#validationIssues');
            
            validationStatus.innerHTML = `<strong>Severity: ${data.severity.toUpperCase()}</strong><p>Score: ${data.confidence_score}%</p>`;
            
            validationIssues.innerHTML = data.issues.map(issue => `
              <div class="validation-issue ${issue.severity}">
                <div class="issue-title">${issue.type}</div>
                <div>${issue.message}</div>
              </div>
            `).join('');
            
            // Show alerts if critical
            if (data.severity === 'critical') {
              const alertsBanner = $('#alertsBanner');
              alertsBanner.style.display = 'block';
              const alertsList = $('#alertsList');
              data.issues.filter(i => i.severity === 'critical').forEach(issue => {
                const alertItem = document.createElement('div');
                alertItem.className = 'alert-item';
                alertItem.textContent = issue.message;
                alertsList.appendChild(alertItem);
              });
            }
          }).catch(err => {
            console.error('Validation error:', err);
            alert(err.message || 'Validation failed');
          });
        });
      }
    }
  })();