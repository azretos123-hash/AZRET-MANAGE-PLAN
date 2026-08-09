/* ==========================================================================
   AZRET MANAGE PLAN — Application Logic
   ========================================================================== */

/* Security: attach CSRF token to every same-origin state-changing fetch. */
const AZRET_CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
const _azretFetch = window.fetch.bind(window);
window.fetch = function(input, init = {}) {
  const requestUrl = typeof input === 'string' ? input : (input && input.url) || '';
  let sameOrigin = true;
  try { sameOrigin = new URL(requestUrl, window.location.href).origin === window.location.origin; } catch (_) {}
  const method = String(init.method || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();
  if (sameOrigin && ['POST','PUT','PATCH','DELETE'].includes(method)) {
    const headers = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || undefined);
    if (AZRET_CSRF_TOKEN) headers.set('X-CSRF-Token', AZRET_CSRF_TOKEN);
    init = { ...init, headers };
  }
  return _azretFetch(input, init);
};

const state = {
  currency: localStorage.getItem('azret_currency') || 'AED',
  theme: localStorage.getItem('azret_theme') || 'light',
  exchangeRate: parseFloat(localStorage.getItem('azret_rate') || '22.60'), // 1 AED -> INR
  tables: {},          // cache of last-fetched records per table
  dashboard: null,     // cache of last dashboard payload
  editing: {},          // { tableName: id } currently being edited
  shoppingBudget: 0,    // budget threshold, stored in AED
  lastSalaryAED: 0,     // last salary amount entered, stored in AED
  salaryPlan: null,     // cache of last /api/salary-plan response
  incomeProfile: null,  // cache of last /api/income-profile response (Phase 4 gate)
  voiceLanguage: 'en-US',  // voice AI language toggle ('en-US' or 'ml-IN')
  aiListening: false,      // true while SpeechRecognition is actively listening
  aiRecognition: null,     // the active SpeechRecognition instance, if any
  emiFullyPaidAlertShown: false,
  username: 'User',        // display name, kept in sync with the users table
  userId: null,             // authenticated account id; used to namespace device-local preferences
};

/** Same palette as AzretCharts, kept in sync so the allocation list
 *  swatches always match the pie chart slice colours. */
const SALARY_PALETTE = ['#4C8DFF', '#1E4DB7', '#1FAA59', '#F5A524', '#E5484D', '#7C8AA5', '#0F2A5E', '#6EDB9A'];

const CURRENCY_SYMBOL = { AED: 'AED', INR: '₹' };

/** Which fields on each form hold a monetary amount stored in AED in the
 *  database. Used to convert values entered/displayed in the currently
 *  selected currency back to/from the AED base value, and to know which
 *  field to summarise inside the auto-appended Notes info block. */
const AMOUNT_FIELDS = {
  income: ['amount'],
  expenses: ['amount'],
  savings: ['amount', 'goal'],
  family_transfers: ['amount'],
  emi: ['amount', 'paid', 'monthly_payment'],
  debts: ['total_amount', 'paid_amount', 'monthly_payment'],
  shopping: ['price'],
  salaryplan: ['amount'],
  incomeprofile: ['monthly_income', 'other_income', 'fixed_emi_commitment', 'fixed_debt_commitment'],
};

/** The single field per table that represents "the" amount for the
 *  auto-generated Notes info block (Original AED / Converted INR). */
const PRIMARY_AMOUNT_FIELD = {
  income: 'amount',
  expenses: 'amount',
  savings: 'amount',
  family_transfers: 'amount',
  emi: 'amount',
  debts: 'total_amount',
  shopping: 'total',
};

/** Phase 3: Smart EMI & Smart Debt config — mirrors the backend's
 *  SMART_TRACKING map. Drives the name auto-suggest, the "previous record
 *  details" panel, and the payment-history modal for both modules. */
const SMART_TRACKING = {
  emi: { nameField: 'name', totalField: 'amount', paidField: 'paid', categoryField: 'category', label: 'EMI' },
  debts: { nameField: 'person', totalField: 'total_amount', paidField: 'paid_amount', categoryField: null, label: 'Debt' },
};

/* ---------------------------------------------------------------------- */
/* Bootstrapping                                                          */
/* ---------------------------------------------------------------------- */
function hideAppLoader() {
  const loader = document.getElementById('appLoader');
  if (loader) loader.classList.add('hidden');

  const splash = document.getElementById('splash-screen') || document.getElementById('splashScreen');
  if (splash) splash.style.display = 'none';
}

if (document.readyState !== 'loading') hideAppLoader();
window.addEventListener('DOMContentLoaded', hideAppLoader);
window.addEventListener('load', hideAppLoader);

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(state.theme, false);
  applyCurrency(state.currency, false);

  setupSidebar();
  setupTopbar();
  setupForms();
  setupProductFetchers();
  setupIncomeProfile();
  setupSalaryPlanner();
  setupCalculators();
  setupSettingsPage();
  setupReportButtons();
  setupSalaryCountdown();
  setupDailyReminder();
  setupVoiceSynthesis();
  setupVoiceAssistant();

  document.getElementById('footerYear').textContent = new Date().getFullYear();
  updateGreetingClock();
  setInterval(updateGreetingClock, 1000);

  await loadServerSettings();
  await loadProfile();
  check27thSalaryNotification();
  await loadBranding();
  await refreshExchangeRate(true);

  if (window.START_SPLASH) {
    await playSplashIntro();
    await loadPage('dashboard');
  } else {
    await loadPage('dashboard');
    hideAppLoader();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

/* ---------------------------------------------------------------------- */
/* Toast                                                                  */
/* ---------------------------------------------------------------------- */
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 2800);
}

/* ---------------------------------------------------------------------- */
/* Greeting / Live Clock                                                  */
/* ---------------------------------------------------------------------- */
function updateGreetingClock() {
  const now = new Date();
  const hour = now.getHours();
  let greeting = 'Good Evening';
  if (hour < 12) greeting = 'Good Morning';
  else if (hour < 17) greeting = 'Good Afternoon';

  // Single combined, centered line — e.g. "Good Evening, Ijas" — instead of
  // a stacked eyebrow label + name.
  const greetingEl = document.getElementById('greetingText');
  if (greetingEl) greetingEl.textContent = greeting;
  const nameEl = document.getElementById('greetingName');
  if (nameEl) nameEl.textContent = state.username || 'Ijas';

  const timeEl = document.getElementById('clockTime');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  const dateEl = document.getElementById('clockDate');
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }
}

/** Fetches the current username and syncs it everywhere it's displayed:
 *  the topbar greeting, the Settings > Profile field, and (implicitly,
 *  server-side) the AI assistant's system prompt on its next request. */
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    const data = await res.json();
    if (data.user_id != null) state.userId = String(data.user_id);
    if (data.username) {
      state.username = data.username;
      updateGreetingClock();
      const input = document.getElementById('profileUsername');
      if (input && document.activeElement !== input) input.value = data.username;
    }
    const emailInput = document.getElementById('profileEmail');
    if (emailInput && data.email && document.activeElement !== emailInput) emailInput.value = data.email;
  } catch (e) { /* offline: keep local/default username */ }
}

/* ---------------------------------------------------------------------- */
/* Sidebar / Navigation                                                   */
/* ---------------------------------------------------------------------- */
function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  document.getElementById('menuToggle').addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  });
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadPage(btn.dataset.page);
      closeSidebar();
    });
  });

  // Mobile bottom navigation: quick access to the most-used finance pages.
  document.querySelectorAll('.mobile-nav-item[data-mobile-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.mobilePage;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
      loadPage(page);
      closeSidebar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  const mobileMoreBtn = document.getElementById('mobileMoreBtn');
  if (mobileMoreBtn) mobileMoreBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  document.getElementById('themeToggle').addEventListener('click', () => {
    setTheme(state.theme === 'light' ? 'dark' : 'light');
  });
}

async function loadPage(page) {
  document.querySelectorAll('.mobile-nav-item[data-mobile-page]').forEach(b => b.classList.toggle('active', b.dataset.mobilePage === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  if (page === 'dashboard') await loadDashboard();
  else if (page === 'about') await loadAbout();
  else if (page === 'salary-planner') await loadSalaryPlanner();
  else if (TABLES_BY_PAGE[page]) await loadTable(TABLES_BY_PAGE[page]);
}

const TABLES_BY_PAGE = {
  income: 'income',
  expenses: 'expenses',
  savings: 'savings',
  shopping: 'shopping',
  family: 'family_transfers',
  emi: 'emi',
  debt: 'debts',
  notes: 'notes',
};

/* ---------------------------------------------------------------------- */
/* Topbar: search, currency, theme                                        */
/* ---------------------------------------------------------------------- */
function setupTopbar() {
  document.querySelectorAll('.cur-opt').forEach(btn => {
    btn.addEventListener('click', () => setCurrency(btn.dataset.currency));
  });

  const searchInput = document.getElementById('globalSearch');
  const resultsBox = document.getElementById('globalSearchResults');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { resultsBox.classList.remove('show'); return; }
    searchTimer = setTimeout(() => runGlobalSearch(q), 300);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-search')) resultsBox.classList.remove('show');
  });

  document.getElementById('refreshRate').addEventListener('click', () => refreshExchangeRate(false));
}

async function runGlobalSearch(q) {
  const resultsBox = document.getElementById('globalSearchResults');
  try {
    const res = await fetch(`/api/global-search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.length) {
      resultsBox.innerHTML = '<div class="gsr-empty">No matches found</div>';
    } else {
      resultsBox.innerHTML = data.slice(0, 20).map(item => {
        const label = item.name || item.title || item.person || item.receiver || item.product_name || item.type || 'Record';
        const amount = item.amount !== undefined ? fmt(item.amount) :
                        item.total_amount !== undefined ? fmt(item.total_amount) :
                        item.total !== undefined ? fmt(item.total) : '';
        return `<div class="gsr-item"><div class="gsr-mod">${escapeHtml(String(item.module || '').replace('_', ' '))}</div>${escapeHtml(String(label))} ${amount ? '· ' + escapeHtml(String(amount)) : ''}</div>`;
      }).join('');
    }
    resultsBox.classList.add('show');
  } catch (e) { /* silent */ }
}

/* ---------------------------------------------------------------------- */
/* Branding (custom logo)                                                 */
/* ---------------------------------------------------------------------- */
async function loadBranding() {
  try {
    const res = await fetch('/api/branding');
    const data = await res.json();
    applyBranding(data.logo_url);
    applySplashVideo(data.splash_video_url);
    applyThemeImage(data.theme_image_url);
    applyThemeVideo(data.theme_video_url);
  } catch (e) { /* offline: keep default branding */ }
}

function applyBranding(logoUrl) {
  const targets = ['sidebarLogo', 'splashLogo', 'brandingPreview'];
  targets.forEach(id => {
    const el = document.getElementById(id);
    if (!el || !logoUrl) return;
    el.textContent = '';
    const img = document.createElement('img');
    img.src = String(logoUrl);
    img.alt = 'Logo';
    el.appendChild(img);
  });
  if (logoUrl) {
    const fav = document.getElementById('faviconLink');
    if (fav) fav.href = String(logoUrl);
  }
}

/* ---------------------------------------------------------------------- */
/* Splash Screen Video (Phase 1)                                          */
/* ---------------------------------------------------------------------- */
function applySplashVideo(videoUrl) {
  const wrap = document.getElementById('splashVideoWrap');
  const fallback = document.getElementById('splashLogo');
  const video = document.getElementById('splashVideo');
  const preview = document.getElementById('splashVideoPreview');

  if (!videoUrl) {
    if (wrap) wrap.style.display = 'none';
    if (fallback) fallback.style.display = '';
    return;
  }

  [video, preview].forEach(v => {
    if (!v) return;
    if (v.currentSrc !== videoUrl) v.src = videoUrl;
    v.play().catch(() => { /* autoplay may be blocked; poster/logo still shows */ });
  });

  // If the video fails to load (missing/corrupt file), fall back to the
  // static logo instead of leaving a broken player on screen.
  if (video) {
    video.onerror = () => {
      wrap.style.display = 'none';
      if (fallback) fallback.style.display = '';
    };
  }
}

async function playSplashIntro() {
  const loader = document.getElementById('appLoader');
  const video = document.getElementById('splashVideo');
  const wrap = document.getElementById('splashVideoWrap');
  if (!video || !loader || !wrap) {
    document.getElementById('appLoader').classList.add('hidden');
    return;
  }

  return new Promise(resolve => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      video.pause();
      loader.classList.add('hidden');
      resolve();
    };

    video.onended = cleanup;
    video.onerror = cleanup;
    video.play().catch(() => {
      setTimeout(cleanup, 1800);
    });
    setTimeout(cleanup, 8000);
  });
}

/* ---------------------------------------------------------------------- */
/* Background Theme Image (Phase 1)                                       */
/* ---------------------------------------------------------------------- */
function applyThemeImage(imageUrl) {
  const layer = document.getElementById('themeBgLayer');
  const previewWrap = document.getElementById('themeImagePreviewWrap');
  const previewEmpty = document.getElementById('themeImagePreviewEmpty');

  if (layer) {
    if (imageUrl) {
      layer.style.backgroundImage = `url("${imageUrl}")`;
      layer.classList.add('active');
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('active');
    }
  }

  if (previewWrap) {
    previewWrap.innerHTML = '';
    if (imageUrl) {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = 'Theme background';
      previewWrap.appendChild(img);
    } else if (previewEmpty) {
      previewWrap.appendChild(previewEmpty);
    } else {
      previewWrap.textContent = 'No image set';
    }
  }
}

function applyThemeVideo(videoUrl) {
  const videoLayer = document.getElementById('themeVideoLayer');
  const bgVideo = document.getElementById('themeVideoBg');
  const previewWrap = document.getElementById('themeVideoPreviewWrap');
  const previewEmpty = document.getElementById('themeVideoPreviewEmpty');

  if (!videoUrl) {
    if (videoLayer) videoLayer.style.display = 'none';
    if (bgVideo) {
      bgVideo.pause();
      bgVideo.removeAttribute('src');
      bgVideo.load();
    }
    if (previewWrap) {
      previewWrap.innerHTML = '';
      if (previewEmpty) previewWrap.appendChild(previewEmpty);
    }
    return;
  }

  if (bgVideo && bgVideo.currentSrc !== videoUrl) {
    bgVideo.src = videoUrl;
    bgVideo.load();
    bgVideo.play().catch(() => {});
  }
  if (videoLayer) videoLayer.style.display = 'block';

  if (previewWrap) {
    previewWrap.innerHTML = '';
    const previewVideo = document.createElement('video');
    previewVideo.src = videoUrl;
    previewVideo.muted = true;
    previewVideo.loop = true;
    previewVideo.autoplay = true;
    previewVideo.playsInline = true;
    previewVideo.style.maxWidth = '100%';
    previewVideo.style.maxHeight = '156px';
    previewWrap.appendChild(previewVideo);
  }
}

/* ---------------------------------------------------------------------- */
/* Theme                                                                  */
/* ---------------------------------------------------------------------- */
function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem('azret_theme', theme);
  applyTheme(theme, true);
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme })
  }).catch(() => {});
}

function applyTheme(theme, rerender) {
  document.body.setAttribute('data-theme', theme);
  document.getElementById('themeIconSun').style.display = theme === 'dark' ? 'none' : 'block';
  document.getElementById('themeIconMoon').style.display = theme === 'dark' ? 'block' : 'none';
  document.querySelectorAll('#settingsThemeSwitch button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  if (rerender && state.dashboard) renderDashboard(state.dashboard);
}

/* ---------------------------------------------------------------------- */
/* Currency                                                               */
/* ---------------------------------------------------------------------- */
function setCurrency(cur) {
  state.currency = cur;
  localStorage.setItem('azret_currency', cur);
  applyCurrency(cur, true);
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ default_currency: cur })
  }).catch(() => {});
}

function applyCurrency(cur, rerender) {
  document.querySelectorAll('.cur-opt').forEach(b => b.classList.toggle('active', b.dataset.currency === cur));
  document.querySelectorAll('#settingsCurrencySwitch button').forEach(b => {
    b.classList.toggle('active', b.dataset.currency === cur);
  });
  // Every field label, running-total prefix and budget label carries a
  // `.cur-unit` span so it instantly reflects the active currency too.
  document.querySelectorAll('.cur-unit').forEach(el => { el.textContent = cur; });
  if (rerender) {
    rerenderAllVisible();
    // Amount inputs currently open for editing must reflect the new
    // currency immediately (e.g. an AED value shown while INR is active).
    Object.keys(state.editing).forEach(table => convertVisibleAmountInputs(table));
    updateAllAmountHints();
  }
}

/** Re-populate the currently-open amount inputs for `table` in the newly
 *  selected display currency, converting from the AED value that was
 *  cached when the record was opened for editing. */
function convertVisibleAmountInputs(table) {
  const id = state.editing[table];
  if (!id) return;
  const rows = state.tables[table] || [];
  const row = rows.find(r => String(r.id) === String(id));
  if (!row) return;
  (AMOUNT_FIELDS[table] || []).forEach(f => {
    const el = document.getElementById(`${table}-${f}`);
    if (!el) return;
    const aedVal = Number(row[f]) || 0;
    el.value = state.currency === 'INR'
      ? round2(aedVal * state.exchangeRate)
      : round2(aedVal);
  });
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function rerenderAllVisible() {
  if (state.dashboard) renderDashboard(state.dashboard);
  Object.keys(state.tables).forEach(table => renderTable(table, state.tables[table]));
  if (state.salaryPlan) renderSalaryPlan(state.salaryPlan);
  const salInput = document.getElementById('salaryplan-amount');
  if (salInput && state.lastSalaryAED) {
    salInput.value = state.currency === 'INR'
      ? round2(state.lastSalaryAED * state.exchangeRate)
      : round2(state.lastSalaryAED);
  }
}

/** Convert an AED amount into the active display currency and format it. */
function fmt(amountAED) {
  const val = Number(amountAED) || 0;
  if (state.currency === 'INR') {
    return `₹${(val * state.exchangeRate).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `AED ${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/* ---------------------------------------------------------------------- */
/* Exchange rate                                                          */
/* ---------------------------------------------------------------------- */
async function loadServerSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    if (s.theme) { state.theme = s.theme; applyTheme(s.theme, false); }
    if (s.default_currency) { state.currency = s.default_currency; applyCurrency(s.default_currency, false); }
    if (s.exchange_rate) { state.exchangeRate = parseFloat(s.exchange_rate); }
    if (s.shopping_budget) { state.shoppingBudget = parseFloat(s.shopping_budget) || 0; }
    if (s.last_salary_amount) { state.lastSalaryAED = parseFloat(s.last_salary_amount) || 0; }
    updateShoppingBudgetUI((state.tables.shopping || []).reduce((a, r) => a + (Number(r.total) || 0), 0));
  } catch (e) { /* offline: keep local defaults */ }
}

async function refreshExchangeRate(silent) {
  const rateEl = document.getElementById('rateValue');
  const btn = document.getElementById('refreshRate');
  btn.classList.add('loading');
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/AED', { cache: 'no-store' });
    const data = await res.json();
    if (data && data.rates && data.rates.INR) {
      state.exchangeRate = data.rates.INR;
      localStorage.setItem('azret_rate', state.exchangeRate);
      fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange_rate: state.exchangeRate })
      }).catch(() => {});
      if (!silent) toast('Exchange rate updated', 'success');
    }
  } catch (e) {
    if (!silent) toast('Could not fetch live rate — using last known value', 'error');
  }
  rateEl.textContent = `1 AED = ₹${state.exchangeRate.toFixed(2)}`;
  btn.classList.remove('loading');
  rerenderAllVisible();
}

/* ==========================================================================
   Animated Salary Countdown Widget (Phase 2)
   ========================================================================== */
const SALARY_CREDIT_DAY = 27;
const COUNTDOWN_RING_CIRCUMFERENCE = 2 * Math.PI * 52; // matches the r=52 SVG circle

/** Returns the next Salary Credited Date (the 27th of this month, or next
 *  month if today is already past the 27th), and how many days away it is. */
function getNextSalaryDate() {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), SALARY_CREDIT_DAY, 0, 0, 0);
  if (now > target) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, SALARY_CREDIT_DAY, 0, 0, 0);
  }
  return { target };
}

function setupSalaryCountdown() {
  renderSalaryCountdown();
  setInterval(renderSalaryCountdown, 1000);
}

function renderSalaryCountdown() {
  const card = document.getElementById('salaryCountdownCard');
  const daysEl = document.getElementById('countdownDays');
  const hoursEl = document.getElementById('countdownHours');
  const minutesEl = document.getElementById('countdownMinutes');
  const secondsEl = document.getElementById('countdownSeconds');
  const ringFill = document.getElementById('countdownRingFill');
  const dateEl = document.getElementById('countdownDate');
  if (!card || !daysEl || !hoursEl || !minutesEl || !secondsEl || !ringFill || !dateEl) return;

  const { target } = getNextSalaryDate();
  const diffMs = target - new Date();
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const cyclePct = Math.max(0, Math.min(1, 1 - days / 30));
  const offset = COUNTDOWN_RING_CIRCUMFERENCE * (1 - cyclePct);
  ringFill.style.strokeDashoffset = String(offset);

  animateCountdownNumber(daysEl, days);
  hoursEl.textContent = String(hours).padStart(2, '0');
  minutesEl.textContent = String(minutes).padStart(2, '0');
  secondsEl.textContent = String(seconds).padStart(2, '0');

  dateEl.textContent = target.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  });

  card.classList.toggle('urgent', totalSeconds <= 3 * 24 * 60 * 60);
}

/** Counts up smoothly to the target number instead of just swapping text,
 *  giving the widget a "beautifully animated" feel on every load/refresh. */
function animateCountdownNumber(el, target) {
  const start = Number(el.dataset.value) || 0;
  if (start === target) { el.textContent = String(target); return; }
  const duration = 700;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(start + (target - start) * eased);
    el.textContent = String(current);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.dataset.value = String(target);
    }
  }
  requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------------- */
/* Daily rotating Islamic reminder + visual (Salary Credited banner)      */
/* ---------------------------------------------------------------------- */
// Short, original daily reflections inspired by Islamic values of peace,
// patience, gratitude and quiet confidence — not verbatim scripture quotes,
// so nothing here risks mis-citing a specific verse/hadith translation.
const DAILY_REFLECTIONS = [
  "Ease follows hardship — trust the process and keep moving forward with patience.",
  "A grateful heart finds peace even in a busy day. Pause and give thanks.",
  "Speak kindly — gentle words are a quiet form of charity.",
  "Trust in Allah, but tie your camel: plan wisely, then have faith in the outcome.",
  "Every sunrise is a fresh chance to start again with a clean heart.",
  "Patience isn't waiting quietly — it's staying graceful while working toward your goal.",
  "Contentment is true wealth. Be thankful for what today has already given you.",
  "A calm heart makes wiser decisions — take a breath before you react.",
  "Small good deeds done consistently mean more than big ones done rarely.",
  "Whoever is grateful for little will be trusted with more.",
  "Your worth isn't measured by wealth, but by the good you bring to others.",
  "Difficulties are temporary — resilience and trust make them easier to carry.",
  "Kindness toward family reflects the peace already living in your heart.",
  "Ask for help with patience and prayer; both steady the mind for what's ahead.",
  "Every act of honesty in your finances is also an act of faith.",
  "Confidence grows quietly when you keep your word, even in small promises.",
  "The best provision is a thankful heart — carry it into every decision today.",
  "Hardship is never wasted; it always leaves you a little stronger, a little wiser.",
  "Be gentle with yourself — growth, like faith, takes patient and steady effort.",
  "A peaceful home starts with a peaceful heart. Guard yours today.",
];

// Daily-changing colour theme for the little visual beside the reflection —
// a rotating gradient rather than an external image, so it always renders
// instantly and works fully offline.
const DAILY_VISUAL_GRADIENTS = [
  "linear-gradient(135deg, #1E4DB7, #4C8DFF)",
  "linear-gradient(135deg, #0F2A5E, #1FAA59)",
  "linear-gradient(135deg, #D4AF6A, #1E4DB7)",
  "linear-gradient(135deg, #1FAA59, #6EDB9A)",
  "linear-gradient(135deg, #7C8AA5, #1E4DB7)",
  "linear-gradient(135deg, #E5484D, #D4AF6A)",
  "linear-gradient(135deg, #4C8DFF, #0F2A5E)",
];

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / 86400000);
}

function setupDailyReminder() {
  const quoteEl = document.getElementById('dailyReminderQuote');
  const visualEl = document.getElementById('dailyReminderVisual');
  if (!quoteEl || !visualEl) return;

  const doy = dayOfYear(new Date());
  const quote = DAILY_REFLECTIONS[doy % DAILY_REFLECTIONS.length];
  // Offset the gradient index so the colour and the quote don't always
  // change in perfect lock-step across the year.
  const gradient = DAILY_VISUAL_GRADIENTS[(doy + 3) % DAILY_VISUAL_GRADIENTS.length];

  quoteEl.textContent = quote;
  visualEl.style.setProperty('--daily-gradient', gradient);
  visualEl.style.background = gradient;
}

function setupVoiceSynthesis() {
  const toggle = document.getElementById('voiceLangToggle');
  const speakBtn = document.getElementById('voiceSpeakBtn');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.voiceLanguage = btn.dataset.lang === 'ml' ? 'ml-IN' : 'en-US';
        toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }
  if (speakBtn) {
    speakBtn.addEventListener('click', speakDashboardSummary);
  }
}

function getVoiceForLanguage(lang) {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase())) || voices[0];
}

function speakDashboardSummary() {
  if (!window.speechSynthesis) {
    toast('Speech synthesis is not supported in this browser', 'error');
    return;
  }
  const data = state.dashboard;
  if (!data) {
    toast('Load the dashboard first to speak the summary', 'error');
    return;
  }

  const income = data.total_income || 0;
  const expenses = data.total_expenses || 0;
  const savings = data.total_savings || 0;
  const emiPending = data.emi_pending || 0;
  const activeEmis = data.active_emi_count || 0;
  const balance = data.net_balance || 0;
  const language = String(state.voiceLanguage || '').toLowerCase().startsWith('ml') ? 'ml-IN' : 'en-US';
  let text;

  if (String(state.voiceLanguage || '').toLowerCase().startsWith('ml')) {
    text = `നിങ്ങളുടെ മൊത്തം വരുമാനം ആർ. ഐ. എൻ. ആർ. ${income.toLocaleString()} ആണ്. ` +
      `ചിലവുകൾ ആർ. ഐ. എൻ. ആർ. ${expenses.toLocaleString()} ആണ്. ` +
      `സേവിംഗ്സ് ആർ. ഐ. എൻ. ആർ. ${savings.toLocaleString()} ആണ്. ` +
      `സജീവമായ EMIകൾ ${activeEmis} ആണ്. ` +
      `EMI ബാക്കി ആർ. ഐ. എൻ. ആർ. ${emiPending.toLocaleString()} ആണ്. ` +
      `നിങ്ങളുടെ ശുദ്ധ ബാലൻസ് ആർ. ഐ. എൻ. ആർ. ${balance.toLocaleString()} ആണ്.`;
  } else {
    text = `Your total income is ₹${income.toLocaleString()}. ` +
      `Your total expenses are ₹${expenses.toLocaleString()}. ` +
      `Total savings are ₹${savings.toLocaleString()}. ` +
      `You have ${activeEmis} active EMIs and ₹${emiPending.toLocaleString()} pending. ` +
      `Your net balance is ₹${balance.toLocaleString()}.`;
  }

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  const voice = getVoiceForLanguage(language);
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

/* ==========================================================================
   AZRET Voice Assistant — simplified, single mic-button workflow
   --------------------------------------------------------------------------
   1. Tap the mic button -> browser starts listening (Web Speech API
      SpeechRecognition), supports English and Malayalam.
   2. On the final recognized transcript, the text is sent to the server
      (/api/ai-assistant), which calls Gemini and returns a short, on-topic
      reply restricted to this app's financial data.
   3. The reply is spoken back automatically (SpeechSynthesis), and shown as
      a single status/transcript line — no scrolling chat window.
   ========================================================================== */

/* ==========================================================================
   AZRET Gemini AI Assistant — Chat & Live Voice Call
   ========================================================================== */

let liveCallActive = false;
let liveCallMuted = false;
let liveSpeakerOn = true;
let liveCallTimerInterval = null;
let liveCallSeconds = 0;
let geminiCurrentMode = 'chat'; // 'chat' or 'live'
let geminiHistoryLoaded = false;
let geminiRequestInFlight = false;
let liveTurnSerial = 0;

function setupVoiceAssistant() {
  const openBtn = document.getElementById('assistantBtn');
  const closeBtn = document.getElementById('voiceAssistantClose');
  const modal = document.getElementById('voiceAssistantModal');
  const langToggle = document.getElementById('voiceAssistantLangToggle');
  const modeChatBtn = document.getElementById('modeChatBtn');
  const modeLiveBtn = document.getElementById('modeLiveBtn');
  const clearBtn = document.getElementById('clearGeminiChatBtn');

  if (openBtn) openBtn.addEventListener('click', openGeminiModal);
  if (clearBtn) clearBtn.addEventListener('click', clearGeminiConversation);
  if (closeBtn) closeBtn.addEventListener('click', closeGeminiModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeGeminiModal();
    });
  }

  // Mode tab switching
  if (modeChatBtn && modeLiveBtn) {
    modeChatBtn.addEventListener('click', () => switchGeminiMode('chat'));
    modeLiveBtn.addEventListener('click', () => switchGeminiMode('live'));
  }

  // Language toggle
  if (langToggle) {
    updateVoiceAssistantLanguageUI(langToggle);
    langToggle.querySelectorAll('button').forEach(langBtn => {
      langBtn.addEventListener('click', () => {
        speechSynthesis.cancel();
        state.voiceLanguage = langBtn.dataset.lang === 'ml' ? 'ml-IN' : 'en-US';
        updateVoiceAssistantLanguageUI(langToggle);
        
        // Update welcome text if changed in chat
        const welcomeEl = document.getElementById('geminiWelcomeText');
        if (welcomeEl) {
          if (state.voiceLanguage === 'ml-IN') {
            welcomeEl.textContent = 'നമസ്കാരം! ഞാൻ zuooi Ai ആണ്. ഫിനാൻസ് ഉൾപ്പെടെ സാധാരണ ചോദ്യങ്ങളും ടെക്‌നോളജി, യാത്ര, ആശയങ്ങൾ, കണക്കുകൾ തുടങ്ങിയ കാര്യങ്ങളും ചോദിക്കാം.';
          } else {
            welcomeEl.textContent = 'Hello! I am zuooi Ai, powered by Gemini. Ask me general questions or questions about your AZRET finances in English or Malayalam.';
          }
        }
      });
    });
  }

  // Gemini Chat Setup
  setupGeminiChat();

  // Gemini Live Call Setup
  setupGeminiLiveCall();
}

function openVoiceAssistantModal() {
  const modal = document.getElementById('voiceAssistantModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  setVoiceAssistantStatus('Tap the mic and ask AZRET about your finances.');
  setVoiceAssistantTranscript('');
}

function closeVoiceAssistantModal() {
  const modal = document.getElementById('voiceAssistantModal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  stopVoiceAssistantListening();
  speechSynthesis.cancel();
  setMicButtonState('idle');
}

function openGeminiModal() {
  const modal = document.getElementById('voiceAssistantModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  loadGeminiHistory();
}

function closeGeminiModal() {
  const modal = document.getElementById('voiceAssistantModal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  endLiveCall();
  speechSynthesis.cancel();
  stopVoiceAssistantListening();
}

function switchGeminiMode(mode) {
  geminiCurrentMode = mode;
  const chatView = document.getElementById('geminiChatView');
  const liveView = document.getElementById('geminiLiveView');
  const modeChatBtn = document.getElementById('modeChatBtn');
  const modeLiveBtn = document.getElementById('modeLiveBtn');

  if (mode === 'chat') {
    if (chatView) chatView.style.display = 'flex';
    if (liveView) liveView.style.display = 'none';
    if (modeChatBtn) modeChatBtn.classList.add('active');
    if (modeLiveBtn) modeLiveBtn.classList.remove('active');
    endLiveCall();
  } else {
    if (chatView) chatView.style.display = 'none';
    if (liveView) liveView.style.display = 'flex';
    if (modeChatBtn) modeChatBtn.classList.remove('active');
    if (modeLiveBtn) modeLiveBtn.classList.add('active');
  }
}

function updateVoiceAssistantLanguageUI(toggle) {
  const current = state.voiceLanguage || 'en-US';
  toggle.querySelectorAll('button').forEach(btn => {
    const btnLang = btn.dataset.lang === 'ml' ? 'ml-IN' : 'en-US';
    btn.classList.toggle('active', current === btnLang);
  });
}

function getAssistantLanguageKey(languageCode) {
  return String(languageCode || '').toLowerCase().startsWith('ml') ? 'ml' : 'en';
}

/* ---------------------------------------------------------------------- */
/* Gemini Chat Logic                                                      */
/* ---------------------------------------------------------------------- */
async function loadGeminiHistory(force = false) {
  if (geminiHistoryLoaded && !force) return;
  try {
    const res = await fetch('/api/ai-history', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const history = Array.isArray(data.history) ? data.history : [];
    const container = document.getElementById('geminiChatMessages');
    if (!container) return;
    if (history.length) {
      container.innerHTML = '';
      history.forEach(item => {
        appendGeminiChatMessage(item.role === 'assistant' ? 'bot' : 'user', item.content || '');
      });
    }
    geminiHistoryLoaded = true;
  } catch (e) {
    console.warn('Could not load Gemini history', e);
  }
}

async function clearGeminiConversation() {
  speechSynthesis.cancel();
  stopVoiceAssistantListening();
  try {
    const res = await fetch('/api/ai-history', { method: 'DELETE' });
    if (!res.ok) throw new Error('Clear failed');
    const container = document.getElementById('geminiChatMessages');
    if (container) {
      container.innerHTML = '';
      appendGeminiChatMessage('bot', state.voiceLanguage === 'ml-IN'
        ? 'സംഭാഷണ മെമ്മറി ക്ലിയർ ചെയ്തു. പുതിയതായി ചോദിക്കാം.'
        : 'Conversation memory cleared. You can start a new topic.');
    }
    updateLiveTranscript(state.voiceLanguage === 'ml-IN' ? 'സംഭാഷണം ക്ലിയർ ചെയ്തു.' : 'Conversation cleared.');
    geminiHistoryLoaded = true;
    toast('Gemini conversation cleared', 'success');
  } catch (e) {
    toast('Could not clear Gemini conversation', 'error');
  }
}

function setupGeminiChat() {
  const form = document.getElementById('geminiChatForm');
  const input = document.getElementById('geminiChatInput');
  const micBtn = document.getElementById('geminiMicBtn');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      input.value = '';
      sendGeminiChatMessage(query);
    });
  }

  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (state.aiListening) {
        stopVoiceAssistantListening();
        micBtn.classList.remove('listening');
      } else {
        startChatMicListening();
      }
    });
  }

  // Suggestion Chips
  document.querySelectorAll('.suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.query;
      if (q) sendGeminiChatMessage(q);
    });
  });
}

async function sendGeminiChatMessage(text) {
  const cleanText = String(text || '').trim();
  if (!cleanText || geminiRequestInFlight) return;

  appendGeminiChatMessage('user', cleanText);
  const botMsgId = appendGeminiChatMessage('bot', '✨ Thinking…');
  geminiRequestInFlight = true;
  const sendBtn = document.getElementById('geminiSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch('/api/ai-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: cleanText, language: getAssistantLanguageKey(state.voiceLanguage), mode: 'chat' }),
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const detail = data.hint ? `${data.error || 'Gemini error'}\n${data.hint}` : (data.error || `Gemini request failed (${res.status})`);
      updateGeminiChatMessage(botMsgId, detail, state.voiceLanguage);
      return;
    }
    const reply = data.response || data.reply;
    if (!reply) throw new Error('Gemini returned an empty response');
    updateGeminiChatMessage(botMsgId, reply, data.language || state.voiceLanguage);
  } catch (err) {
    updateGeminiChatMessage(botMsgId, `Could not connect to Gemini AI: ${err.message || 'network error'}`, state.voiceLanguage);
  } finally {
    geminiRequestInFlight = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function appendGeminiChatMessage(role, text) {
  const container = document.getElementById('geminiChatMessages');
  if (!container) return;

  const msgId = 'gmsg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const div = document.createElement('div');
  div.className = `gemini-msg ${role}`;
  div.id = msgId;

  const avatar = role === 'bot' ? '✨' : (state.username ? state.username.charAt(0).toUpperCase() : 'U');
  
  div.innerHTML = `
    <div class="gemini-avatar">${avatar}</div>
    <div class="gemini-bubble">
      <p class="msg-content">${escapeHtml(text)}</p>
    </div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return msgId;
}

function updateGeminiChatMessage(msgId, text, lang) {
  const el = document.getElementById(msgId);
  if (!el) return;
  const bubble = el.querySelector('.gemini-bubble');
  if (bubble) {
    bubble.innerHTML = `
      <p class="msg-content">${escapeHtml(text)}</p>
      <div class="gemini-msg-footer">
        <button type="button" class="gemini-speak-btn" title="Listen reply">🔊 Speak</button>
      </div>
    `;

    const speakBtn = bubble.querySelector('.gemini-speak-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => {
        speakVoiceAssistantReply(text, lang || state.voiceLanguage);
      });
    }
  }

  const container = document.getElementById('geminiChatMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

function startChatMicListening() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    toast('Speech recognition is not supported in this browser', 'error');
    return;
  }

  speechSynthesis.cancel();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = state.voiceLanguage || 'en-US';

  const micBtn = document.getElementById('geminiMicBtn');
  const input = document.getElementById('geminiChatInput');

  if (micBtn) micBtn.classList.add('listening');
  state.aiListening = true;

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    if (input) input.value = transcript;
  };

  recognition.onend = () => {
    if (micBtn) micBtn.classList.remove('listening');
    state.aiListening = false;
    if (input && input.value.trim()) {
      sendGeminiChatMessage(input.value.trim());
      input.value = '';
    }
  };

  recognition.onerror = () => {
    if (micBtn) micBtn.classList.remove('listening');
    state.aiListening = false;
  };

  recognition.start();
  state.aiRecognition = recognition;
}

/* ---------------------------------------------------------------------- */
/* Gemini Live Call Logic                                                 */
/* ---------------------------------------------------------------------- */
function setupGeminiLiveCall() {
  const mainCallBtn = document.getElementById('liveMainCallBtn');
  const muteBtn = document.getElementById('liveMuteBtn');
  const speakerBtn = document.getElementById('liveSpeakerBtn');

  if (mainCallBtn) {
    mainCallBtn.addEventListener('click', () => {
      if (liveCallActive) {
        endLiveCall();
      } else {
        startLiveCall();
      }
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      liveCallMuted = !liveCallMuted;
      muteBtn.classList.toggle('active', liveCallMuted);
      document.getElementById('iconMicOn').style.display = liveCallMuted ? 'none' : 'block';
      document.getElementById('iconMicOff').style.display = liveCallMuted ? 'block' : 'none';
      if (liveCallMuted) {
        stopVoiceAssistantListening();
        updateLiveStatus('Muted');
      } else if (liveCallActive) {
        startLiveCallTurn();
      }
    });
  }

  if (speakerBtn) {
    speakerBtn.addEventListener('click', () => {
      liveSpeakerOn = !liveSpeakerOn;
      speakerBtn.classList.toggle('active', liveSpeakerOn);
      if (!liveSpeakerOn) speechSynthesis.cancel();
    });
  }
}

function startLiveCall() {
  liveCallActive = true;
  liveCallSeconds = 0;
  updateLiveTimerDisplay();
  
  clearInterval(liveCallTimerInterval);
  liveCallTimerInterval = setInterval(() => {
    liveCallSeconds++;
    updateLiveTimerDisplay();
  }, 1000);

  const mainBtn = document.getElementById('liveMainCallBtn');
  const btnLabel = document.getElementById('liveCallBtnLabel');
  if (mainBtn) {
    mainBtn.classList.remove('start');
    mainBtn.classList.add('end');
  }
  if (btnLabel) btnLabel.textContent = 'End Call';

  updateLiveStatus('Connecting to Gemini AI…');
  const orb = document.getElementById('liveOrb');
  if (orb) orb.classList.add('active');

  setTimeout(() => {
    if (!liveCallActive) return;
    updateLiveStatus('Live Connected 🟢');
    const welcome = state.voiceLanguage === 'ml-IN'
      ? 'നമസ്കാരം! അസ്രെറ്റ് ലൈവ് കോളിലേക്ക് സ്വാഗതം. നിങ്ങളുടെ ചോദ്യം ചോദിക്കാം.'
      : "Hello! Connected to AZRET Gemini voice chat. Ask me anything, including follow-up questions.";
    
    updateLiveTranscript(`AZRET: ${welcome}`);
    if (liveSpeakerOn) {
      speakVoiceAssistantReply(welcome, state.voiceLanguage, () => {
        if (liveCallActive && !liveCallMuted) startLiveCallTurn();
      });
    } else {
      if (liveCallActive && !liveCallMuted) startLiveCallTurn();
    }
  }, 1000);
}

function endLiveCall() {
  liveCallActive = false;
  liveTurnSerial++;
  clearInterval(liveCallTimerInterval);
  liveCallSeconds = 0;
  updateLiveTimerDisplay();

  const mainBtn = document.getElementById('liveMainCallBtn');
  const btnLabel = document.getElementById('liveCallBtnLabel');
  if (mainBtn) {
    mainBtn.classList.remove('end');
    mainBtn.classList.add('start');
  }
  if (btnLabel) btnLabel.textContent = 'Start Call';

  const orb = document.getElementById('liveOrb');
  if (orb) orb.classList.remove('active', 'speaking');

  updateLiveStatus('Call Ended');
  speechSynthesis.cancel();
  stopVoiceAssistantListening();
}

function updateLiveTimerDisplay() {
  const el = document.getElementById('liveCallTimer');
  if (!el) return;
  const m = String(Math.floor(liveCallSeconds / 60)).padStart(2, '0');
  const s = String(liveCallSeconds % 60).padStart(2, '0');
  el.textContent = `${m}:${s}`;
}

function updateLiveStatus(statusText) {
  const el = document.getElementById('liveCallStatus');
  if (el) el.textContent = statusText;
}

function updateLiveTranscript(text) {
  const el = document.getElementById('liveTranscriptText');
  if (el) el.textContent = text;
}

function startLiveCallTurn() {
  if (!liveCallActive || liveCallMuted) return;

  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    updateLiveStatus('Voice recognition not supported');
    return;
  }

  speechSynthesis.cancel();
  stopVoiceAssistantListening();
  const myTurn = ++liveTurnSerial;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = state.voiceLanguage || 'en-US';

  updateLiveStatus('Listening to you… 🎙️');
  const orb = document.getElementById('liveOrb');
  if (orb) orb.classList.add('active');

  let finalTranscript = '';
  let hadError = false;
  let retryScheduled = false;
  const scheduleRetry = (delay) => {
    if (retryScheduled || myTurn !== liveTurnSerial || !liveCallActive || liveCallMuted) return;
    retryScheduled = true;
    setTimeout(() => {
      if (myTurn === liveTurnSerial && liveCallActive && !liveCallMuted) startLiveCallTurn();
    }, delay);
  };

  recognition.onresult = (e) => {
    if (myTurn !== liveTurnSerial) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const text = (finalTranscript + interim).trim();
    if (text) updateLiveTranscript(`You: ${text}`);
  };

  recognition.onerror = () => {
    hadError = true;
    if (state.aiRecognition === recognition) state.aiRecognition = null;
    scheduleRetry(1500);
  };

  recognition.onend = () => {
    if (state.aiRecognition === recognition) state.aiRecognition = null;
    if (myTurn !== liveTurnSerial || hadError) return;
    const text = finalTranscript.trim();
    if (text) {
      updateLiveStatus('AZRET Thinking… 🧠');
      if (orb) orb.classList.add('speaking');

      fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, language: getAssistantLanguageKey(state.voiceLanguage), mode: 'voice' }),
      })
        .then(async res => {
          let data = {};
          try { data = await res.json(); } catch (e) {}
          if (!res.ok) throw new Error(data.error || data.hint || `Gemini request failed (${res.status})`);
          return data;
        })
        .then(data => {
          if (myTurn !== liveTurnSerial || !liveCallActive) return;
          const reply = data.response || data.reply;
          if (!reply) throw new Error('Empty Gemini response');
          updateLiveTranscript(`AZRET: ${reply}`);
          if (liveSpeakerOn) {
            updateLiveStatus('AZRET Speaking… 🔊');
            speakVoiceAssistantReply(reply, data.language || state.voiceLanguage, () => {
              if (myTurn !== liveTurnSerial) return;
              if (orb) orb.classList.remove('speaking');
              scheduleRetry(600);
            });
          } else {
            if (orb) orb.classList.remove('speaking');
            scheduleRetry(1000);
          }
        })
        .catch((err) => {
          if (myTurn !== liveTurnSerial || !liveCallActive) return;
          updateLiveTranscript(`AZRET: ${err.message || 'Gemini connection error.'}`);
          updateLiveStatus('Gemini connection problem');
          if (orb) orb.classList.remove('speaking');
          scheduleRetry(2500);
        });
    } else {
      scheduleRetry(1000);
    }
  };

  try {
    recognition.start();
    state.aiRecognition = recognition;
  } catch (e) {
    hadError = true;
    scheduleRetry(2000);
  }
}

function stopVoiceAssistantListening() {
  if (state.aiRecognition) {
    try { state.aiRecognition.stop(); } catch (e) {}
    state.aiRecognition = null;
  }
  state.aiListening = false;
}

function cleanTextForSpeech(text) {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#/g, '')
    .replace(/`/g, '')
    .replace(/_/g, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function speakVoiceAssistantReply(text, lang, onEndCallback) {
  if (!window.speechSynthesis || !text) {
    if (onEndCallback) onEndCallback();
    return;
  }

  speechSynthesis.cancel();
  const clean = cleanTextForSpeech(text);
  const utterance = new SpeechSynthesisUtterance(clean);
  const targetLang = String(lang || '').toLowerCase().startsWith('ml') ? 'ml-IN' : 'en-US';
  utterance.lang = targetLang;
  utterance.rate = 0.95;

  const voices = speechSynthesis.getVoices();
  const matchVoice = voices.find(v => v.lang.toLowerCase().startsWith(targetLang.toLowerCase()))
    || voices.find(v => v.lang.toLowerCase().includes('ml') || v.lang.toLowerCase().includes('hi') || v.lang.toLowerCase().includes('in'));
  if (matchVoice) utterance.voice = matchVoice;

  if (onEndCallback) {
    utterance.onend = onEndCallback;
    utterance.onerror = onEndCallback;
  }

  speechSynthesis.speak(utterance);
}

function check27thSalaryNotification() {
  const today = new Date();
  const dayOfMonth = today.getDate();

  // Show ONLY on the 27th day of the month
  if (dayOfMonth !== 27) return;

  const dateStr = today.toISOString().slice(0, 10);
  const salaryStorageKey = `salary_asked_${state.userId || state.username || 'account'}_${dateStr}`;
  const answered = localStorage.getItem(salaryStorageKey);
  if (answered) return;

  const notifEl = document.getElementById('salary27Notification');
  if (!notifEl) return;

  notifEl.style.display = 'flex';

  const yesBtn = document.getElementById('s27YesBtn');
  const noBtn = document.getElementById('s27NoBtn');

  if (yesBtn) {
    yesBtn.onclick = () => {
      localStorage.setItem(salaryStorageKey, 'yes');
      notifEl.style.display = 'none';
      toast('Great! Opening Income page to log your salary.', 'success');
      loadPage('income');
      const incType = document.getElementById('income-type');
      if (incType) incType.value = 'Salary';
      const incDate = document.getElementById('income-date');
      if (incDate) incDate.value = dateStr;
    };
  }

  if (noBtn) {
    noBtn.onclick = () => {
      localStorage.setItem(salaryStorageKey, 'no');
      notifEl.style.display = 'none';
      toast('Noted. You can log your salary anytime from Income page.', 'info');
    };
  }
}


/* ==========================================================================
   DASHBOARD
   ========================================================================== */
async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    state.dashboard = data;
    renderDashboard(data);
  } catch (e) { toast('Could not load dashboard', 'error'); }
}

function renderDashboard(d) {
  const cards = [
    { label: 'Total Income', value: d.total_income, icon: iconTrendUp(), cls: 'positive' },
    { label: 'Total Expenses', value: d.total_expenses, icon: iconTrendDown(), cls: 'negative' },
    { label: 'Total Savings', value: d.total_savings, icon: iconPiggy(), cls: 'positive' },
    { label: 'Family Transfer', value: d.total_family_transfer, icon: iconFamily(), cls: '' },
    { label: 'Total EMI', value: d.total_emi, icon: iconCard(), cls: '' },
    { label: 'Active EMIs', value: d.active_emi_count, icon: iconClock(), cls: d.active_emi_count > 0 ? '' : 'positive' },
    { label: 'Outstanding Debt', value: d.outstanding_debt, icon: iconAlert(), cls: 'negative' },
    { label: 'Total Shopping', value: d.total_shopping, icon: iconCart(), cls: '' },
    { label: 'Net Balance', value: d.net_balance, icon: iconWallet(), cls: d.net_balance >= 0 ? 'positive' : 'negative' },
    { label: 'Monthly Income', value: d.monthly_income, icon: iconTrendUp(), cls: 'positive' },
    { label: 'Monthly Expense', value: d.monthly_expense, icon: iconTrendDown(), cls: 'negative' },
    { label: 'Monthly Savings', value: d.monthly_savings, icon: iconPiggy(), cls: d.monthly_savings >= 0 ? 'positive' : 'negative' },
  ];

  document.getElementById('statGrid').innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-value">${c.label === 'Active EMIs' ? String(c.value) : fmt(c.value)}</div>
    </div>
  `).join('');
  attachClickPop(document.querySelectorAll('#statGrid .stat-card'));

  const monthLabels = d.chart_months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short' });
  });

  AzretCharts.barChart('chartIncomeExpense', monthLabels, [
    { data: d.chart_income, color: '#1FAA59' },
    { data: d.chart_expense, color: '#E5484D' },
  ]);
  AzretCharts.lineChart('chartSavingsGrowth', monthLabels, [
    { data: d.chart_savings_growth, color: '#4C8DFF' },
  ]);
  AzretCharts.donutChart('chartCategories', d.chart_categories, d.chart_category_totals);

  const goalPct = d.savings_goal > 0 ? Math.min(100, Math.round((d.total_savings / d.savings_goal) * 100)) : 0;
  document.getElementById('quickSummary').innerHTML = `
    <div class="qs-row"><span>Savings Goal Progress</span><span>${goalPct}%</span></div>
    <div class="qs-row"><span>EMI Pending</span><span>${fmt(d.emi_pending)}</span></div>
    <div class="qs-row"><span>Active EMIs</span><span>${d.active_emi_count}</span></div>
    <div class="qs-row"><span>This Month's Balance</span><span>${fmt(d.monthly_income - d.monthly_expense)}</span></div>
  `;

  if (d.total_emi > 0 && d.emi_pending <= 0 && !state.emiFullyPaidAlertShown) {
    toast('Congratulations! EMI Fully Paid!', 'success');
    state.emiFullyPaidAlertShown = true;
  }
}

function iconTrendUp() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8M17 7h4v4"/></svg>`; }
function iconTrendDown() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l6 6 4-4 8 8M17 17h4v-4"/></svg>`; }
function iconPiggy() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M4 8c0-2 2-3 8-3s8 1 8 3-2 3-8 3-8 1-8 3 2 3 8 3 8 1 8 3-2 3-8 3-8-1-8-3"/></svg>`; }
function iconFamily() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M2 21v-2a5 5 0 015-5h4M14 12a5 5 0 015 5v4"/></svg>`; }
function iconCard() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/></svg>`; }
function iconAlert() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`; }
function iconClock() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`; }
function iconWallet() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h13a1 1 0 011 1v3M3 7v11a2 2 0 002 2h15a1 1 0 001-1v-6a1 1 0 00-1-1h-4a2 2 0 000 4h5"/></svg>`; }
function iconCart() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1.4"/><circle cx="18" cy="21" r="1.4"/><path d="M2.5 3h2.5l2.6 12.2a2 2 0 002 1.6h8.1a2 2 0 002-1.6L21 7H6"/></svg>`; }

/* ---------------------------------------------------------------------- */
/* Click micro-animations (Phase 2)                                       */
/* ---------------------------------------------------------------------- */
/** Adds a satisfying little "pop" to a card the moment it's clicked —
 *  used on the Dashboard stat cards. */
function attachClickPop(elements) {
  elements.forEach(el => {
    el.addEventListener('click', () => {
      el.classList.remove('click-pop');
      void el.offsetWidth; // restart animation even on rapid re-clicks
      el.classList.add('click-pop');
    });
  });
}

/** Adds a brief highlight sweep to a table row the moment it's clicked —
 *  used on Expenses, Savings and every other record table. Ignores clicks
 *  on the row-action (edit/delete) buttons themselves. */
function attachRowPulse(tbody) {
  if (!tbody) return;
  tbody.querySelectorAll('tr:not(.empty-row)').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      row.classList.remove('row-pulse');
      void row.offsetWidth;
      row.classList.add('row-pulse');
    });
  });
}

/* ==========================================================================
   GENERIC CRUD (income, expenses, savings, family_transfers, emi, debts, notes)
   ========================================================================== */
async function loadTable(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`/api/${table}${qs ? '?' + qs : ''}`);
    const data = await res.json();
    state.tables[table] = data;
    renderTable(table, data);
  } catch (e) { toast('Could not load records', 'error'); }
}

function renderTable(table, rows) {
  if (table === 'notes') return renderNotes(rows);

  const tbody = document.getElementById(`${table}-tbody`);
  if (!tbody) return;

  if (!rows.length) {
    const colCount = tbody.closest('table').querySelectorAll('thead th').length;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${colCount}">No records yet — add your first entry.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => rowHtml(table, r)).join('');
    tbody.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => editRecord(table, btn.dataset.edit, rows));
    });
    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => deleteRecord(table, btn.dataset.del));
    });
    tbody.querySelectorAll('[data-history]').forEach(btn => {
      btn.addEventListener('click', () => openPaymentHistory(btn.dataset.historyTable, btn.dataset.history));
    });
    attachRowPulse(tbody);
  }

  computeTotals(table, rows);
}

function rowHtml(table, r) {
  const historyBtn = SMART_TRACKING[table] ? `
      <button data-history="${r.id}" data-history-table="${table}" class="history-btn" aria-label="Payment history" title="View payment history">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
      </button>` : '';
  const actions = `
    <div class="row-actions">
      ${historyBtn}
      <button data-edit="${r.id}" aria-label="Edit"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
      <button data-del="${r.id}" class="del-btn" aria-label="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg></button>
    </div>`;

  switch (table) {
    case 'income':
      return `<tr><td>${escapeHtml(r.type || '')}</td><td>${fmt(r.amount)}</td><td>${escapeHtml(r.date || '')}</td><td>${escapeHtml(r.notes || '')}</td><td>${actions}</td></tr>`;
    case 'expenses':
      return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${fmt(r.amount)}</td><td>${escapeHtml(r.date || '')}</td><td>${actions}</td></tr>`;
    case 'savings':
      return `<tr><td>${escapeHtml(r.type || '')}</td><td>${fmt(r.amount)}</td><td>${escapeHtml(r.date || '')}</td><td>${escapeHtml(r.notes || '')}</td><td>${actions}</td></tr>`;
    case 'family_transfers':
      return `<tr><td>${escapeHtml(r.receiver)}</td><td>${fmt(r.amount)}</td><td>${escapeHtml(r.date || '')}</td><td>${escapeHtml(r.notes || '')}</td><td>${actions}</td></tr>`;
    case 'emi': {
      const pending = Math.max(0, (r.amount || 0) - (r.paid || 0));
      return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${fmt(r.amount)}</td><td>${fmt(r.paid)}</td><td>${fmt(pending)}</td><td>${fmt(r.monthly_payment)}</td><td>${escapeHtml(r.date || '')}</td><td>${actions}</td></tr>`;
    }
    case 'debts': {
      const remaining = Math.max(0, (r.total_amount || 0) - (r.paid_amount || 0));
      return `<tr><td>${escapeHtml(r.person)}</td><td>${fmt(r.total_amount)}</td><td>${fmt(r.paid_amount)}</td><td>${fmt(remaining)}</td><td>${fmt(r.monthly_payment)}</td><td>${escapeHtml(r.due_date || '—')}</td><td>${actions}</td></tr>`;
    }
    case 'shopping': {
      const prioClass = { Low: 'low', Medium: 'medium', High: 'high', Urgent: 'urgent' }[r.priority] || 'medium';
      return `<tr><td>${escapeHtml(r.product_name)}</td><td>${escapeHtml(r.category)}</td><td>${Number(r.quantity) || 0}</td><td>${fmt(r.price)}</td><td>${fmt(r.total)}</td><td><span class="priority-badge ${prioClass}">${escapeHtml(r.priority || 'Medium')}</span></td><td>${escapeHtml(r.date || '')}</td><td>${actions}</td></tr>`;
    }
    default: return '';
  }
}

function computeTotals(table, rows) {
  const sum = (key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

  if (table === 'income') document.getElementById('income-total').textContent = fmt(sum('amount'));
  if (table === 'expenses') document.getElementById('expenses-total').textContent = fmt(sum('amount'));
  if (table === 'family_transfers') document.getElementById('family_transfers-total').textContent = fmt(sum('amount'));

  if (table === 'savings') {
    const total = sum('amount');
    const goal = Math.max(...rows.map(r => Number(r.goal) || 0), 0);
    document.getElementById('savings-total').textContent = fmt(total);
    const pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
    document.getElementById('savings-goal-pct').textContent = pct + '%';
    document.getElementById('savings-goal-fill').style.width = pct + '%';
  }

  if (table === 'emi') {
    document.getElementById('emi-total-paid').textContent = fmt(sum('paid'));
    document.getElementById('emi-total-pending').textContent = fmt(Math.max(0, sum('amount') - sum('paid')));
  }

  if (table === 'debts') {
    document.getElementById('debts-total').textContent = fmt(Math.max(0, sum('total_amount') - sum('paid_amount')));
  }

  if (table === 'shopping') {
    const total = sum('total');
    document.getElementById('shopping-count').textContent = String(rows.length);
    document.getElementById('shopping-total').innerHTML = `<span class="cur-unit">${state.currency}</span> ${(state.currency === 'INR' ? total * state.exchangeRate : total).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    updateShoppingBudgetUI(total);
  }
}

/* ---------------------------------------------------------------------- */
/* Shopping Planner: budget                                               */
/* ---------------------------------------------------------------------- */
function setupShoppingBudget() {
  const btn = document.getElementById('shopping-budget-save');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const input = document.getElementById('shopping-budget-input');
    const typed = Number(input.value) || 0;
    // The budget is stored in AED (base currency), same as every other
    // amount in the database, regardless of which currency is displayed.
    state.shoppingBudget = state.currency === 'INR' ? typed / state.exchangeRate : typed;
    fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopping_budget: state.shoppingBudget })
    }).catch(() => {});
    toast('Shopping budget updated', 'success');
    const rows = state.tables.shopping || [];
    const total = rows.reduce((a, r) => a + (Number(r.total) || 0), 0);
    updateShoppingBudgetUI(total);
  });
}

/** Refreshes the budget progress bar/input and shows a warning banner once
 *  the running total reaches or exceeds the configured budget. `totalAED`
 *  is always the AED running total of the shopping list. */
function updateShoppingBudgetUI(totalAED) {
  const input = document.getElementById('shopping-budget-input');
  const fill = document.getElementById('shopping-budget-fill');
  const warning = document.getElementById('shopping-budget-warning');
  if (!input || !fill || !warning) return;

  const budgetAED = state.shoppingBudget || 0;
  input.value = budgetAED > 0
    ? round2(state.currency === 'INR' ? budgetAED * state.exchangeRate : budgetAED)
    : '';

  if (budgetAED <= 0) {
    fill.style.width = '0%';
    warning.style.display = 'none';
    return;
  }

  const pct = Math.min(100, Math.round((totalAED / budgetAED) * 100));
  fill.style.width = pct + '%';

  if (totalAED >= budgetAED) {
    warning.textContent = `Budget exceeded! You've spent ${fmt(totalAED)} of your ${fmt(budgetAED)} budget.`;
    warning.className = 'budget-warning over';
    warning.style.display = 'block';
  } else if (pct >= 80) {
    warning.textContent = `Heads up — you're at ${pct}% of your ${fmt(budgetAED)} shopping budget.`;
    warning.className = 'budget-warning';
    warning.style.display = 'block';
  } else {
    warning.style.display = 'none';
  }
}

function renderNotes(rows) {
  const list = document.getElementById('notes-list');
  if (!rows.length) {
    list.innerHTML = `<div class="gsr-empty">No notes yet — write your first one.</div>`;
    return;
  }
  list.innerHTML = rows.map(r => `
    <div class="note-item">
      <h4>${escapeHtml(r.title)}</h4>
      <p>${escapeHtml(r.content || '')}</p>
      <div class="note-meta">
        <span>${escapeHtml(r.date || '')} ${escapeHtml(r.time || '')}</span>
        <div class="row-actions">
          <button data-edit="${r.id}" aria-label="Edit"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
          <button data-del="${r.id}" class="del-btn" aria-label="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg></button>
        </div>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => editRecord('notes', btn.dataset.edit, rows));
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteRecord('notes', btn.dataset.del));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* ---------------------------------------------------------------------- */
/* Forms: create / edit / delete                                          */
/* ---------------------------------------------------------------------- */
function setupForms() {
  Object.entries(TABLES_BY_PAGE).forEach(([page, table]) => {
    const form = document.getElementById(`${table}-form`);
    if (!form) return;

    // default date/time to now
    const dateInput = document.getElementById(`${table}-date`);
    const timeInput = document.getElementById(`${table}-time`);
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    if (timeInput && !timeInput.value) timeInput.value = new Date().toTimeString().slice(0, 5);

    form.addEventListener('submit', (e) => { e.preventDefault(); submitForm(table); });

    const cancelBtn = document.getElementById(`${table}-cancel`);
    if (cancelBtn) cancelBtn.addEventListener('click', () => resetForm(table));

    const searchInput = document.getElementById(`${table}-search`);
    if (searchInput) {
      let t;
      searchInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => loadTable(table, { q: searchInput.value.trim() }), 300);
      });
    }

    // Live "instantly converted" hint under every amount field — shows
    // what the typed-in figure is worth in the other currency right away.
    // (Phase 3: emi/debts amount fields carry their own independent
    // dual-currency toggle, wired separately by setupSmartTracking below.)
    if (!SMART_TRACKING[table]) {
      (AMOUNT_FIELDS[table] || []).forEach(f => {
        const el = document.getElementById(`${table}-${f}`);
        if (el) el.addEventListener('input', () => updateAmountHint(table, f));
      });
    }
  });

  setupShoppingBudget();
  setupSmartTracking();
}

function setupProductFetchers() {
  const mapping = [
    { buttonId: 'expenses-fetch-product', urlId: 'expenses-product_url', nameId: 'expenses-name', priceId: 'expenses-amount' },
    { buttonId: 'shopping-fetch-product', urlId: 'shopping-product_url', nameId: 'shopping-product_name', priceId: 'shopping-price' },
  ];

  mapping.forEach(({ buttonId, urlId, nameId, priceId }) => {
    const button = document.getElementById(buttonId);
    const urlInput = document.getElementById(urlId);
    if (!button || !urlInput) return;
    button.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        toast('Paste a shopping link first', 'error');
        return;
      }
      button.disabled = true;
      button.textContent = 'Fetching…';
      try {
        const res = await fetch('/api/fetch-product-details', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Unable to parse product details');
        }
        if (data.title) {
          const nameInput = document.getElementById(nameId);
          if (nameInput) nameInput.value = data.title;
        }
        if (data.price !== undefined) {
          const priceInput = document.getElementById(priceId);
          if (priceInput) priceInput.value = data.price;
        }
        toast('Product details filled. Review and save.', 'success');
      } catch (err) {
        toast(err.message || 'Could not fetch product details', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Fetch Details';
      }
    });
  });
}

/** Shows the opposite-currency equivalent of whatever the user just typed,
 *  in the neat box sitting immediately to the right of the amount field,
 *  so amounts convert instantly, side-by-side, as they're entered. */
function updateAmountHint(table, field) {
  const el = document.getElementById(`${table}-${field}`);
  const tag = document.getElementById(`${table}-${field}-tag`);
  const value = document.getElementById(`${table}-${field}-value`);
  const box = document.getElementById(`${table}-${field}-box`);
  if (!el || !value) return;

  const typed = Number(el.value) || 0;
  const toINR = state.currency !== 'INR';
  const converted = toINR ? typed * state.exchangeRate : typed / state.exchangeRate;

  if (tag) tag.textContent = toINR ? '≈ INR' : '≈ AED';
  const formatted = converted.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (value.textContent !== formatted) {
    value.textContent = formatted;
    if (box && typed > 0) {
      box.classList.remove('pulse');
      // eslint-disable-next-line no-unused-expressions
      void box.offsetWidth; // restart the CSS animation on every keystroke
      box.classList.add('pulse');
    }
  }
}

function updateAllAmountHints() {
  Object.entries(AMOUNT_FIELDS).forEach(([table, fields]) => {
    fields.forEach(f => updateAmountHint(table, f));
  });
}

function fieldIds(table) {
  const map = {
    income: ['type', 'amount', 'date', 'time', 'notes'],
    expenses: ['name', 'category', 'amount', 'date', 'time', 'notes'],
    savings: ['type', 'amount', 'goal', 'date', 'time', 'notes'],
    family_transfers: ['amount', 'receiver', 'date', 'time', 'notes'],
    emi: ['name', 'category', 'amount', 'paid', 'monthly_payment', 'date', 'time', 'notes'],
    debts: ['person', 'description', 'total_amount', 'paid_amount', 'monthly_payment', 'due_date', 'date', 'time', 'notes'],
    notes: ['title', 'content', 'date', 'time'],
    shopping: ['product_name', 'category', 'quantity', 'price', 'priority', 'date', 'time', 'notes'],
  };
  return map[table] || [];
}

/** Strips any previously auto-appended "[Original: ... ]" info block from
 *  the end of a notes string, so re-submitting an edited record refreshes
 *  the block instead of stacking a new one on every save. */
function stripAutoNote(notes) {
  return String(notes || '').replace(/\n?\[Original:[^\]]*\]\s*$/i, '').trimEnd();
}

/** Builds the "Original AED / Converted INR / Date / Time" info line that
 *  gets appended to a record's Notes field on every submission. */
function buildAutoNote(amountAED, dateVal, timeVal) {
  const inrVal = amountAED * state.exchangeRate;
  const d = dateVal || new Date().toISOString().slice(0, 10);
  const t = timeVal || new Date().toTimeString().slice(0, 5);
  return `[Original: AED ${round2(amountAED).toFixed(2)} | Converted: INR ${round2(inrVal).toFixed(2)} | ${d} ${t}]`;
}

async function submitForm(table) {
  const payload = {};
  fieldIds(table).forEach(f => {
    const el = document.getElementById(`${table}-${f}`);
    if (el) payload[f] = el.value;
  });

  // Every amount field is always stored in AED. Fields with their own
  // dual-currency toggle (Phase 3: emi/debts) carry a per-field entry
  // currency on the input's dataset; everything else falls back to
  // whatever the global display currency is set to.
  (AMOUNT_FIELDS[table] || []).forEach(f => {
    if (payload[f] === undefined || payload[f] === '') return;
    const el = document.getElementById(`${table}-${f}`);
    const entryCur = (el && el.dataset.entryCur) || state.currency;
    const typed = Number(payload[f]) || 0;
    payload[f] = entryCur === 'INR' ? typed / state.exchangeRate : typed;
  });

  // Shopping Planner's Total is always computed server-side-equivalent
  // here: Quantity × Price (Price already normalised to AED above).
  if (table === 'shopping') {
    const qty = Number(payload.quantity) || 0;
    const price = Number(payload.price) || 0;
    payload.total = round2(qty * price);
  }

  // Auto-append Original AED / Converted INR / Date / Time to Notes on
  // every submission, refreshing (not stacking) the block on edits.
  const primaryField = PRIMARY_AMOUNT_FIELD[table];
  if (primaryField && 'notes' in payload) {
    const amountAED = Number(payload[primaryField]) || 0;
    payload.notes = stripAutoNote(payload.notes) + '\n' + buildAutoNote(amountAED, payload.date, payload.time);
    payload.notes = payload.notes.trim();
  }

  const editId = state.editing[table];
  try {
    const res = await fetch(`/api/${table}${editId ? '/' + editId : ''}`, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not save record', 'error'); return; }

    toast(editId ? 'Record updated' : 'Record saved', 'success');
    resetForm(table);
    await loadTable(table);
    if (state.dashboard) await loadDashboard();
  } catch (e) { toast('Network error while saving', 'error'); }
}

function editRecord(table, id, rows) {
  const row = rows.find(r => String(r.id) === String(id));
  if (!row) return;
  state.editing[table] = id;

  const amountFields = new Set(AMOUNT_FIELDS[table] || []);
  fieldIds(table).forEach(f => {
    const el = document.getElementById(`${table}-${f}`);
    if (!el) return;
    if (amountFields.has(f)) {
      const aedVal = Number(row[f]) || 0;
      if (SMART_TRACKING[table]) {
        // Phase 3 dual-currency fields carry their own independent entry
        // currency — always show the true AED value on edit and reset
        // that field's toggle back to AED.
        el.value = round2(aedVal);
        setEntryCurrency(`${table}-${f}`, 'AED');
      } else {
        // Amount fields are stored in AED; show them converted into
        // whichever currency is currently selected for display.
        el.value = state.currency === 'INR' ? round2(aedVal * state.exchangeRate) : round2(aedVal);
      }
    } else if (f === 'notes') {
      el.value = stripAutoNote(row[f]);
    } else if (table === 'emi' && f === 'category') {
      applyEmiCategoryFromValue(row[f]);
    } else {
      el.value = row[f] ?? '';
    }
  });
  const idInput = document.getElementById(`${table}-id`);
  if (idInput) idInput.value = id;

  const cancelBtn = document.getElementById(`${table}-cancel`);
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  updateAllAmountHints();
  document.getElementById(`${table}-form`).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm(table) {
  delete state.editing[table];
  const form = document.getElementById(`${table}-form`);
  if (form) form.reset();
  const idInput = document.getElementById(`${table}-id`);
  if (idInput) idInput.value = '';
  const cancelBtn = document.getElementById(`${table}-cancel`);
  if (cancelBtn) cancelBtn.style.display = 'none';

  const dateInput = document.getElementById(`${table}-date`);
  const timeInput = document.getElementById(`${table}-time`);
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  if (timeInput) timeInput.value = new Date().toTimeString().slice(0, 5);

  if (SMART_TRACKING[table]) {
    (AMOUNT_FIELDS[table] || []).forEach(f => setEntryCurrency(`${table}-${f}`, 'AED'));
    const panel = document.getElementById(`${table}-prev-panel`);
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  }
  if (table === 'emi') applyEmiCategoryFromValue('Vehicle');
}

async function deleteRecord(table, id) {
  if (!confirm('Delete this record? This cannot be undone.')) return;
  try {
    await fetch(`/api/${table}/${id}`, { method: 'DELETE' });
    toast('Record deleted', 'success');
    await loadTable(table);
    if (state.dashboard) await loadDashboard();
  } catch (e) { toast('Could not delete record', 'error'); }
}

/* ==========================================================================
   REPORTS
   ========================================================================== */
function setupReportButtons() {
  document.querySelectorAll('[data-report]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.report;
      toast('Generating PDF report…');
      window.open(`/api/report/${kind}`, '_blank');
    });
  });
}

/* ==========================================================================
   ABOUT / ADVICE
   ========================================================================== */
async function loadAbout() {
  try {
    const res = await fetch('/api/advice');
    const data = await res.json();
    document.getElementById('healthBadge').textContent = data.health;
    document.getElementById('motivationalText').textContent = `"${data.motivational}"`;
    document.getElementById('tipsList').innerHTML = data.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('');
  } catch (e) { toast('Could not load advice', 'error'); }
}

/* ==========================================================================
   INCOME & COMMITMENT PROFILE (Phase 4 — Allocation Gate)
   ========================================================================== */
function setupIncomeProfile() {
  const form = document.getElementById('income-profile-form');
  if (!form) return;
  form.addEventListener('submit', (e) => { e.preventDefault(); saveIncomeProfile(); });

  (AMOUNT_FIELDS.incomeprofile || []).forEach(f => {
    const el = document.getElementById(`incomeprofile-${f}`);
    if (el) el.addEventListener('input', () => updateAmountHint('incomeprofile', f));
  });
}

async function loadIncomeProfile() {
  try {
    const res = await fetch('/api/income-profile');
    const data = await res.json();
    state.incomeProfile = data;
    renderIncomeProfile(data);
  } catch (e) { /* offline: leave whatever was cached */ }
}

async function saveIncomeProfile() {
  const fields = AMOUNT_FIELDS.incomeprofile;
  const typedIncome = Number(document.getElementById('incomeprofile-monthly_income').value) || 0;
  if (typedIncome <= 0) { toast('Enter a valid verified monthly income', 'error'); return; }

  const toAED = (typed) => state.currency === 'INR' ? typed / state.exchangeRate : typed;
  const payload = {
    monthly_income: toAED(typedIncome),
    other_income: toAED(Number(document.getElementById('incomeprofile-other_income').value) || 0),
    fixed_emi_commitment: toAED(Number(document.getElementById('incomeprofile-fixed_emi_commitment').value) || 0),
    fixed_debt_commitment: toAED(Number(document.getElementById('incomeprofile-fixed_debt_commitment').value) || 0),
    notes: document.getElementById('incomeprofile-notes').value || '',
  };

  try {
    const res = await fetch('/api/income-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not save profile', 'error'); return; }
    state.incomeProfile = data;
    renderIncomeProfile(data);
    toast('Income & Commitment Profile saved — Smart Plan unlocked', 'success');
  } catch (e) { toast('Network error while saving profile', 'error'); }
}

function renderIncomeProfile(profile) {
  const statusEl = document.getElementById('incomeProfileStatus');
  const statusText = document.getElementById('incomeProfileStatusText');
  const locked = document.getElementById('salaryPlanLocked');
  const unlocked = document.getElementById('salaryPlanUnlocked');
  if (!statusEl || !statusText) return;

  if (profile && profile.saved) {
    statusEl.classList.add('saved');
    statusText.textContent = `Profile saved${profile.updated_at ? ' — updated ' + profile.updated_at : ''} · verified income ${fmt(profile.total_verified_income)}`;
    if (locked) locked.style.display = 'none';
    if (unlocked) unlocked.style.display = 'block';

    const salInput = document.getElementById('salaryplan-amount');
    const hint = document.getElementById('salaryPlanVerifiedHint');
    if (salInput && !salInput.value) {
      salInput.value = state.currency === 'INR'
        ? round2(profile.total_verified_income * state.exchangeRate)
        : round2(profile.total_verified_income);
      updateAmountHint('salaryplan', 'amount');
    }
    if (hint) hint.textContent = `Defaults to your verified income (${fmt(profile.total_verified_income)}). Change it to try a what-if amount.`;
  } else {
    statusEl.classList.remove('saved');
    statusText.textContent = 'Profile not saved yet — save it to unlock the Smart Plan.';
    if (locked) locked.style.display = 'block';
    if (unlocked) unlocked.style.display = 'none';
  }
}

/* ==========================================================================
   SMART SALARY PLANNER
   ========================================================================== */
async function loadSalaryPlanner() {
  await loadIncomeProfile();
  if (state.salaryPlan) renderSalaryPlan(state.salaryPlan);
}

function setupSalaryPlanner() {
  const form = document.getElementById('salary-plan-form');
  if (!form) return;
  form.addEventListener('submit', (e) => { e.preventDefault(); generateSalaryPlan(); });

  const input = document.getElementById('salaryplan-amount');
  if (input) input.addEventListener('input', () => updateAmountHint('salaryplan', 'amount'));
}

async function generateSalaryPlan() {
  if (!state.incomeProfile || !state.incomeProfile.saved) {
    toast('Save your Income & Commitment Profile first', 'error');
    return;
  }

  const input = document.getElementById('salaryplan-amount');
  const typed = Number(input.value) || 0;
  if (typed <= 0) { toast('Enter a valid salary amount', 'error'); return; }

  // Amount fields are always stored/sent in AED, same convention as
  // every other form in the app.
  const salaryAED = state.currency === 'INR' ? typed / state.exchangeRate : typed;
  state.lastSalaryAED = salaryAED;

  try {
    const res = await fetch('/api/salary-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salary: salaryAED }),
    });
    let data = null;
    let text = null;
    try {
      data = await res.json();
    } catch (jsonErr) {
      text = await res.text();
    }
    if (!res.ok) {
      const message = data?.error || text || 'Could not generate plan';
      toast(message, 'error');
      if (data?.gate_locked) { await loadIncomeProfile(); }
      return;
    }
    state.salaryPlan = data;
    renderSalaryPlan(data);
    toast('Smart plan generated', 'success');
  } catch (e) {
    toast('Network error while generating plan', 'error');
  }
}

function renderSalaryPlan(data) {
  const block = document.getElementById('salaryHealthBlock');
  const badge = document.getElementById('salaryHealthBadge');
  const rateText = document.getElementById('salarySavingsRateText');
  const ring = document.getElementById('healthScoreRing');
  const ringValue = document.getElementById('healthScoreValue');
  if (block && badge && rateText) {
    block.style.display = 'block';
    badge.textContent = data.health;
    badge.className = 'health-badge ' + salaryHealthClass(data.health);
    rateText.textContent = data.is_projection
      ? `What-if projection — recommended savings rate: ${data.savings_rate}% of the entered amount.`
      : `Recommended savings rate this month: ${data.savings_rate}% of salary.`;
  }
  if (ring && ringValue) {
    const score = Number(data.budget_health_score) || 0;
    ring.style.setProperty('--score', score);
    ringValue.textContent = Math.round(score);
  }

  const allocationSource = (data.real_allocations && data.real_allocations.length) ? data.real_allocations : data.allocations;
  AzretCharts.pieChart(
    'chartSalaryPie',
    allocationSource.map(a => a.label),
    allocationSource.map(a => a.amount)
  );

  if (data.commitment_breakdown) {
    AzretCharts.pieChart(
      'chartIncomeCommitments',
      data.commitment_breakdown.map(c => c.label),
      data.commitment_breakdown.map(c => c.amount)
    );
    const commitText = document.getElementById('salaryCommitmentText');
    if (commitText) {
      commitText.textContent = `EMI ${data.emi_to_income_pct}% + Debt ${data.debt_to_income_pct}% of income committed — `
        + `${fmt(data.commitment_breakdown[0].amount)} stays free/flexible.`;
    }
  }

  const list = document.getElementById('salaryAllocationList');
  if (list) {
    list.innerHTML = allocationSource.map((a, i) => `
      <div class="salary-alloc-row">
        <span class="alloc-swatch" style="background:${SALARY_PALETTE[i % SALARY_PALETTE.length]}"></span>
        <span class="alloc-label">${escapeHtml(a.label)}</span>
        <span class="alloc-pct">${a.percent}%</span>
        <span class="alloc-amount">${fmt(a.amount)}</span>
      </div>
    `).join('');
  }

  const sugg = document.getElementById('salarySuggestionsList');
  if (sugg) {
    sugg.className = 'tips-list';
    sugg.innerHTML = data.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  }

  const tips = document.getElementById('salaryMoneyTipsList');
  if (tips) {
    tips.className = 'tips-list';
    tips.innerHTML = data.money_tips.map(t => `<li>${escapeHtml(t)}</li>`).join('');
  }
}

function salaryHealthClass(health) {
  if (health === 'Needs Attention') return 'warn';
  if (health === 'Critical') return 'bad';
  return '';
}

/* ==========================================================================
   CALCULATORS
   ========================================================================== */
function setupCalculators() {
  // Simple calculator
  const display = document.getElementById('calcDisplay');
  const buttonsEl = document.getElementById('calcButtons');
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'C', '0', '.', '+', '='];
  let expr = '';

  buttonsEl.innerHTML = keys.map(k => {
    const cls = ['÷', '×', '−', '+'].includes(k) ? 'op' : (k === '=' ? 'eq' : '');
    return `<button class="${cls}" data-key="${k}">${k}</button>`;
  }).join('');

  buttonsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      if (k === 'C') { expr = ''; }
      else if (k === '=') {
        try {
          const safe = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
          if (!/^[0-9.+\-*/() ]+$/.test(safe)) throw new Error('invalid');
          // eslint-disable-next-line no-eval
          const result = Function(`"use strict"; return (${safe})`)();
          expr = String(Math.round(result * 1e6) / 1e6);
        } catch (e) { expr = 'Error'; }
      } else {
        expr = expr === 'Error' ? k : expr + k;
      }
      display.textContent = expr || '0';
    });
  });

  // AED <-> INR converter
  const convAmount = document.getElementById('convAmount');
  const convFrom = document.getElementById('convFrom');
  const convTo = document.getElementById('convTo');
  const convResult = document.getElementById('convResult');
  function runConv() {
    const amt = parseFloat(convAmount.value) || 0;
    let result;
    if (convFrom.value === convTo.value) result = amt;
    else if (convFrom.value === 'AED' && convTo.value === 'INR') result = amt * state.exchangeRate;
    else result = amt / state.exchangeRate;
    convResult.textContent = `${CURRENCY_SYMBOL[convFrom.value]} ${amt.toLocaleString(undefined,{maximumFractionDigits:2})} = ${CURRENCY_SYMBOL[convTo.value]} ${result.toLocaleString(undefined,{maximumFractionDigits:2})}`;
  }
  [convAmount, convFrom, convTo].forEach(el => el.addEventListener('input', runConv));
  runConv();

  // Savings calculator
  const savMonthly = document.getElementById('savCalcMonthly');
  const savMonths = document.getElementById('savCalcMonths');
  const savRate = document.getElementById('savCalcRate');
  const savResult = document.getElementById('savCalcResult');
  function runSavCalc() {
    const monthly = parseFloat(savMonthly.value) || 0;
    const months = parseInt(savMonths.value) || 0;
    const annualRate = parseFloat(savRate.value) || 0;
    const monthlyRate = annualRate / 100 / 12;
    let total = 0;
    for (let i = 0; i < months; i++) {
      total += monthly;
      total += total * monthlyRate;
    }
    savResult.textContent = `Projected Total: ${fmt(total)}`;
  }
  [savMonthly, savMonths, savRate].forEach(el => el.addEventListener('input', runSavCalc));
  runSavCalc();

  // EMI calculator
  const emiP = document.getElementById('emiCalcPrincipal');
  const emiR = document.getElementById('emiCalcRate');
  const emiN = document.getElementById('emiCalcMonths');
  const emiResult = document.getElementById('emiCalcResult');
  function runEmiCalc() {
    const p = parseFloat(emiP.value) || 0;
    const annualRate = parseFloat(emiR.value) || 0;
    const n = parseInt(emiN.value) || 1;
    const r = annualRate / 100 / 12;
    let emi;
    if (r === 0) emi = p / n;
    else emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const totalPay = emi * n;
    emiResult.textContent = `Monthly EMI: ${fmt(emi)}  ·  Total Payable: ${fmt(totalPay)}`;
  }
  [emiP, emiR, emiN].forEach(el => el.addEventListener('input', runEmiCalc));
  runEmiCalc();
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */
function setupSettingsPage() {
  document.querySelectorAll('#settingsThemeSwitch button').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });
  document.querySelectorAll('#settingsCurrencySwitch button').forEach(btn => {
    btn.addEventListener('click', () => setCurrency(btn.dataset.currency));
  });

  document.getElementById('logoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/logo', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        applyBranding(data.logo_url);
        toast('Logo updated', 'success');
      } else {
        toast(data.error || 'Could not upload logo', 'error');
      }
    } catch (err) { toast('Could not upload logo', 'error'); }
    e.target.value = '';
  });

  document.getElementById('btnResetLogo').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/logo', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast('Logo reset to default', 'success');
        setTimeout(() => window.location.reload(), 600);
      } else {
        toast('Could not reset logo', 'error');
      }
    } catch (err) { toast('Could not reset logo', 'error'); }
  });

  // Splash Screen Video (Phase 1) ----------------------------------------
  document.getElementById('splashVideoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    toast('Uploading splash video…');
    try {
      const res = await fetch('/api/splash-video', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        applySplashVideo(data.splash_video_url);
        toast('Splash video updated', 'success');
      } else {
        toast(data.error || 'Could not upload video', 'error');
      }
    } catch (err) { toast('Could not upload video', 'error'); }
    e.target.value = '';
  });

  document.getElementById('btnResetSplashVideo').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/splash-video', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        applySplashVideo(data.splash_video_url);
        toast('Splash video reset to default', 'success');
      } else {
        toast('Could not reset splash video', 'error');
      }
    } catch (err) { toast('Could not reset splash video', 'error'); }
  });

  // Background Theme Image (Phase 1) --------------------------------------
  document.getElementById('themeImageFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    toast('Uploading theme image…');
    try {
      const res = await fetch('/api/theme-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        applyThemeImage(data.theme_image_url);
        toast('Background theme updated', 'success');
      } else {
        toast(data.error || 'Could not upload image', 'error');
      }
    } catch (err) { toast('Could not upload image', 'error'); }
    e.target.value = '';
  });

  document.getElementById('btnResetThemeImage').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/theme-image', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        applyThemeImage('');
        toast('Background theme removed', 'success');
      } else {
        toast('Could not remove background', 'error');
      }
    } catch (err) { toast('Could not remove background', 'error'); }
  });

  document.getElementById('btnBackup').addEventListener('click', () => {
    window.open('/api/export', '_blank');
  });
  document.getElementById('btnExport').addEventListener('click', () => {
    window.open('/api/export', '_blank');
  });

  document.getElementById('restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Import this backup into your account? Existing records are kept.')) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) { toast('Account backup imported', 'success'); await loadDashboard(); }
      else toast(data.error || 'Restore failed', 'error');
    } catch (err) { toast('Restore failed', 'error'); }
    e.target.value = '';
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        toast('Data imported successfully', 'success');
        await loadDashboard();
      } else {
        toast(data.error || 'Import failed', 'error');
      }
    } catch (err) { toast('Import failed', 'error'); }
  });

  document.getElementById('btnClearAll').addEventListener('click', async () => {
    const confirmText = prompt('This will permanently delete ALL financial data. Type DELETE to confirm:');
    if (confirmText !== 'DELETE') return;
    try {
      const res = await fetch('/api/clear-all-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' })
      });
      const data = await res.json();
      if (data.success) {
        toast('All data cleared', 'success');
        await loadDashboard();
      } else {
        toast(data.error || 'Could not clear data', 'error');
      }
    } catch (e) { toast('Could not clear data', 'error'); }
  });

  document.getElementById('usernameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('profileUsername').value.trim();
    const msg = document.getElementById('usernameMsg');
    try {
      const res = await fetch('/api/update-username', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (data.success) {
        msg.style.display = 'none';
        state.username = data.username;
        updateGreetingClock();
        toast('Username updated', 'success');
      } else {
        msg.textContent = data.error;
        msg.style.display = 'block';
      }
    } catch (err) {
      msg.textContent = 'Network error';
      msg.style.display = 'block';
    }
  });



  const emailForm = document.getElementById('emailForm');
  if (emailForm) emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('profileEmail').value.trim();
    const msg = document.getElementById('emailMsg');
    try {
      const res = await fetch('/api/update-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.success) { msg.style.display = 'none'; toast('Email updated', 'success'); }
      else { msg.textContent = data.error || 'Could not update email'; msg.style.display = 'block'; }
    } catch (err) { msg.textContent = 'Network error'; msg.style.display = 'block'; }
  });

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const current_password = document.getElementById('currentPassword').value;
    const new_password = document.getElementById('newPassword').value;
    const msg = document.getElementById('passwordMsg');
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password, new_password })
      });
      const data = await res.json();
      if (data.success) {
        msg.style.display = 'none';
        toast('Password updated', 'success');
        e.target.reset();
      } else {
        msg.textContent = data.error;
        msg.style.display = 'block';
      }
    } catch (err) {
      msg.textContent = 'Network error';
      msg.style.display = 'block';
    }
  });
}

/* ==========================================================================
   PHASE 3 — SMART EMI & SMART DEBT OVERHAUL
   - EMI category dropdown (Vehicle / Mobile / Home / Custom)
   - Independent per-field dual-currency entry (AED <-> INR) for EMI/Debt
   - Name auto-suggest with "previous record details" for repeat payments
   - Partial-payment logging that auto-deducts from Pending Amount
   - Full payment transaction history modal
   ========================================================================== */

/* ---------------------------------------------------------------------- */
/* EMI category dropdown ("Vehicle"/"Mobile"/"Home"/"Custom")             */
/* ---------------------------------------------------------------------- */
function setupEmiCategorySelect() {
  const select = document.getElementById('emi-category-select');
  const custom = document.getElementById('emi-category-custom');
  const hidden = document.getElementById('emi-category');
  if (!select || !custom || !hidden) return;

  function sync() {
    if (select.value === 'Custom') {
      custom.style.display = 'block';
      hidden.value = custom.value.trim();
    } else {
      custom.style.display = 'none';
      hidden.value = select.value;
    }
  }
  select.addEventListener('change', sync);
  custom.addEventListener('input', sync);
  sync();
}

/** Sets the Category dropdown/custom-input/hidden-field trio to match a
 *  category value loaded from a record (used by editRecord). Falls back
 *  to "Custom" with the raw text if the value isn't one of the presets. */
function applyEmiCategoryFromValue(catValue) {
  const select = document.getElementById('emi-category-select');
  const custom = document.getElementById('emi-category-custom');
  const hidden = document.getElementById('emi-category');
  if (!select || !custom || !hidden) return;

  const presets = ['Vehicle', 'Mobile', 'Home'];
  if (presets.includes(catValue)) {
    select.value = catValue;
    custom.style.display = 'none';
    custom.value = '';
  } else {
    select.value = 'Custom';
    custom.style.display = 'block';
    custom.value = catValue || '';
  }
  hidden.value = catValue || '';
}

/* ---------------------------------------------------------------------- */
/* Independent per-field dual-currency entry (AED <-> INR)                */
/* ---------------------------------------------------------------------- */
function updateDualHint(inputId) {
  const el = document.getElementById(inputId);
  const tag = document.getElementById(`${inputId}-tag`);
  const value = document.getElementById(`${inputId}-value`);
  const box = document.getElementById(`${inputId}-box`);
  if (!el || !value) return;

  const typed = Number(el.value) || 0;
  const entryCur = el.dataset.entryCur || 'AED';
  const toINR = entryCur !== 'INR';
  const converted = toINR ? typed * state.exchangeRate : typed / state.exchangeRate;

  if (tag) tag.textContent = toINR ? '≈ INR' : '≈ AED';
  const formatted = converted.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (value.textContent !== formatted) {
    value.textContent = formatted;
    if (box && typed > 0) {
      box.classList.remove('pulse');
      void box.offsetWidth;
      box.classList.add('pulse');
    }
  }
}

function setEntryCurrency(inputId, cur) {
  const el = document.getElementById(inputId);
  if (!el) return;

  const oldCur = el.dataset.entryCur || 'AED';
  if (oldCur !== cur) {
    const rawVal = el.value.trim();
    if (rawVal !== '' && !isNaN(rawVal)) {
      const typed = Number(rawVal);
      if (typed > 0) {
        let converted = typed;
        if (oldCur === 'AED' && cur === 'INR') {
          converted = typed * state.exchangeRate;
        } else if (oldCur === 'INR' && cur === 'AED') {
          converted = typed / state.exchangeRate;
        }
        el.value = Number(converted.toFixed(2));
      }
    }
    el.dataset.entryCur = cur;
  }

  const toggle = document.querySelector(`.dual-currency-toggle[data-field="${inputId}"]`);
  if (toggle) {
    toggle.querySelectorAll('.dc-btn').forEach(b => b.classList.toggle('active', b.dataset.cur === cur));
  }
  const unit = document.getElementById(`${inputId}-unit`);
  if (unit) unit.textContent = cur;

  updateDualHint(inputId);
}

function wireDualCurrencyToggle(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.dataset.entryCur = el.dataset.entryCur || 'AED';
  el.addEventListener('input', () => updateDualHint(inputId));

  const toggle = document.querySelector(`.dual-currency-toggle[data-field="${inputId}"]`);
  if (toggle) {
    toggle.querySelectorAll('.dc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setEntryCurrency(inputId, btn.dataset.cur);
      });
    });
  }

  const box = document.getElementById(`${inputId}-box`);
  if (box) {
    box.style.cursor = 'pointer';
    box.onclick = () => {
      const currentCur = el.dataset.entryCur || 'AED';
      const nextCur = currentCur === 'AED' ? 'INR' : 'AED';
      setEntryCurrency(inputId, nextCur);
    };
  }

  updateDualHint(inputId);
}

/* ---------------------------------------------------------------------- */
/* Name auto-suggest + "previous record details" panel                    */
/* ---------------------------------------------------------------------- */
function setupAutosuggest(inputId, dropdownId, table, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) { dropdown.classList.remove('show'); dropdown.innerHTML = ''; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/${table}/suggest?q=${encodeURIComponent(q)}`);
        const rows = await res.json();
        renderSuggestions(dropdown, table, rows, onSelect);
      } catch (e) { /* silent — autosuggest failures shouldn't block typing */ }
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (e.target !== input && !dropdown.contains(e.target)) dropdown.classList.remove('show');
  });
}

function renderSuggestions(dropdown, table, rows, onSelect) {
  if (!rows.length) { dropdown.classList.remove('show'); dropdown.innerHTML = ''; return; }
  const cfg = SMART_TRACKING[table];

  dropdown.innerHTML = rows.map((r, i) => {
    const name = escapeHtml(r[cfg.nameField]);
    const catBit = cfg.categoryField ? `${escapeHtml(r[cfg.categoryField] || '')} · ` : '';
    return `<div class="autosuggest-item" data-idx="${i}">${name}<small>${catBit}Pending: ${fmt(r.pending_amount)}</small></div>`;
  }).join('');
  dropdown.classList.add('show');

  dropdown.querySelectorAll('.autosuggest-item').forEach(item => {
    item.addEventListener('click', () => {
      dropdown.classList.remove('show');
      onSelect(rows[Number(item.dataset.idx)]);
    });
  });
}

function renderPrevPanel(panelId, table, row, opts = {}) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  if (!row) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

  const cfg = SMART_TRACKING[table];
  const catRow = cfg.categoryField
    ? `<div class="prp-row"><span>Category</span><span>${escapeHtml(row[cfg.categoryField] || '—')}</span></div>`
    : '';

  panel.innerHTML = `
    <div class="prp-title">${escapeHtml(opts.title || 'Existing Record Found')}</div>
    ${catRow}
    <div class="prp-row"><span>Total Amount</span><span>${fmt(row.total_amount_view)}</span></div>
    <div class="prp-row"><span>Paid Amount</span><span>${fmt(row.paid_amount_view)}</span></div>
    <div class="prp-row"><span>Pending Amount</span><strong class="pending">${fmt(row.pending_amount)}</strong></div>
  `;
  panel.style.display = 'block';
}

/* ---------------------------------------------------------------------- */
/* "Log a Payment" mini-forms (repeat EMI/Debt payments)                  */
/* ---------------------------------------------------------------------- */
function setupSmartPaymentForm(table) {
  const form = document.getElementById(`${table}-payment-form`);
  if (!form) return;

  const dateInput = document.getElementById(`${table}-payment-date`);
  const timeInput = document.getElementById(`${table}-payment-time`);
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  if (timeInput && !timeInput.value) timeInput.value = new Date().toTimeString().slice(0, 5);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const recordId = document.getElementById(`${table}-payment-record-id`).value;
    if (!recordId) {
      toast('Pick a saved EMI/Debt from the suggestions first', 'error');
      return;
    }

    const amountEl = document.getElementById(`${table}-payment-amount`);
    const entryCur = amountEl.dataset.entryCur || 'AED';
    const typed = Number(amountEl.value) || 0;
    if (typed <= 0) { toast('Enter a payment amount', 'error'); return; }
    const amountAED = entryCur === 'INR' ? typed / state.exchangeRate : typed;

    const payload = {
      amount: round2(amountAED),
      date: document.getElementById(`${table}-payment-date`).value,
      time: document.getElementById(`${table}-payment-time`).value,
      notes: document.getElementById(`${table}-payment-notes`).value,
    };

    try {
      const res = await fetch(`/api/${table}/${recordId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Could not log payment', 'error'); return; }

      toast('Payment logged — pending balance updated', 'success');
      resetSmartPaymentForm(table);
      await loadTable(table);
      if (state.dashboard) await loadDashboard();
    } catch (e) { toast('Network error while logging payment', 'error'); }
  });
}

function resetSmartPaymentForm(table) {
  const form = document.getElementById(`${table}-payment-form`);
  if (form) form.reset();

  document.getElementById(`${table}-payment-record-id`).value = '';
  document.getElementById(`${table}-payment-submit`).disabled = true;
  renderPrevPanel(`${table}-payment-prev-panel`, table, null);
  setEntryCurrency(`${table}-payment-amount`, 'AED');

  const dateInput = document.getElementById(`${table}-payment-date`);
  const timeInput = document.getElementById(`${table}-payment-time`);
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  if (timeInput) timeInput.value = new Date().toTimeString().slice(0, 5);
}

/* ---------------------------------------------------------------------- */
/* Payment history modal (click a record -> full transaction history)     */
/* ---------------------------------------------------------------------- */
async function openPaymentHistory(table, id) {
  const modal = document.getElementById('payment-history-modal');
  if (!modal) return;
  const titleEl = document.getElementById('ph-modal-title');
  const summaryEl = document.getElementById('ph-modal-summary');
  const listEl = document.getElementById('ph-modal-list');

  try {
    const res = await fetch(`/api/${table}/${id}/payments`);
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not load history', 'error'); return; }

    const cfg = SMART_TRACKING[table];
    const record = data.record;
    titleEl.textContent = `${cfg.label} — ${record[cfg.nameField]}`;

    const catRow = cfg.categoryField
      ? `<div class="prp-row"><span>Category</span><span>${escapeHtml(record[cfg.categoryField] || '—')}</span></div>`
      : '';
    summaryEl.innerHTML = `
      ${catRow}
      <div class="prp-row"><span>Total Amount</span><span>${fmt(record.total_amount_view)}</span></div>
      <div class="prp-row"><span>Paid Amount</span><span>${fmt(record.paid_amount_view)}</span></div>
      <div class="prp-row"><span>Pending Amount</span><span>${fmt(record.pending_amount)}</span></div>
    `;

    listEl.innerHTML = !data.payments.length
      ? `<div class="ph-empty">No payments logged yet.</div>`
      : data.payments.map(p => `
          <div class="ph-payment-item">
            <div>
              <div>${fmt(p.amount)}</div>
              <div class="ph-date">${escapeHtml(p.date || '')} ${escapeHtml(p.time || '')}${p.notes ? ' · ' + escapeHtml(p.notes) : ''}</div>
            </div>
          </div>
        `).join('');

    modal.style.display = 'flex';
  } catch (e) { toast('Could not load payment history', 'error'); }
}

function setupPaymentHistoryModal() {
  const modal = document.getElementById('payment-history-modal');
  if (!modal) return;
  document.getElementById('ph-modal-close').addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

/* ---------------------------------------------------------------------- */
/* Master init — called once from setupForms()                            */
/* ---------------------------------------------------------------------- */
function setupSmartTracking() {
  setupEmiCategorySelect();

  ['incomeprofile-monthly_income', 'incomeprofile-other_income', 'incomeprofile-fixed_emi_commitment', 'incomeprofile-fixed_debt_commitment',
   'salaryplan-amount', 'income-amount', 'expenses-amount', 'savings-amount', 'savings-goal', 'shopping-price', 'family_transfers-amount',
   'emi-amount', 'emi-paid', 'emi-monthly_payment', 'debts-total_amount', 'debts-paid_amount', 'debts-monthly_payment',
   'emi-payment-amount', 'debts-payment-amount'].forEach(wireDualCurrencyToggle);

  setupAutosuggest('emi-name', 'emi-name-suggestions', 'emi', (row) => {
    document.getElementById('emi-name').value = row.name;
    renderPrevPanel('emi-prev-panel', 'emi', row, { title: 'Already exists — consider logging a payment instead' });
  });
  setupAutosuggest('debts-person', 'debts-person-suggestions', 'debts', (row) => {
    document.getElementById('debts-person').value = row.person;
    renderPrevPanel('debts-prev-panel', 'debts', row, { title: 'Already exists — consider logging a payment instead' });
  });

  setupAutosuggest('emi-payment-name', 'emi-payment-suggestions', 'emi', (row) => {
    document.getElementById('emi-payment-name').value = row.name;
    document.getElementById('emi-payment-record-id').value = row.id;
    renderPrevPanel('emi-payment-prev-panel', 'emi', row, { title: 'Selected EMI' });
    document.getElementById('emi-payment-submit').disabled = false;
  });
  setupAutosuggest('debts-payment-name', 'debts-payment-suggestions', 'debts', (row) => {
    document.getElementById('debts-payment-name').value = row.person;
    document.getElementById('debts-payment-record-id').value = row.id;
    renderPrevPanel('debts-payment-prev-panel', 'debts', row, { title: 'Selected Debt' });
    document.getElementById('debts-payment-submit').disabled = false;
  });

  [['emi-payment-name', 'emi'], ['debts-payment-name', 'debts']].forEach(([id, table]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      document.getElementById(`${table}-payment-record-id`).value = '';
      document.getElementById(`${table}-payment-submit`).disabled = true;
      renderPrevPanel(`${table}-payment-prev-panel`, table, null);
    });
  });

  setupSmartPaymentForm('emi');
  setupSmartPaymentForm('debts');
  setupPaymentHistoryModal();
}
