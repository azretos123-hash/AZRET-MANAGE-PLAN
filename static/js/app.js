/* ==========================================================================
   YARIN يارين — Application Logic
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
  return _azretFetch(input, init).then((response) => {
    // A public multi-user site can leave a tab open longer than the server
    // session. Redirect cleanly instead of letting every widget try to render
    // the {error: 'unauthorized'} JSON as finance data.
    if (sameOrigin && response.status === 401 && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    return response;
  });
};

const state = {
  currency: localStorage.getItem('azret_currency') || 'AED',
  theme: localStorage.getItem('azret_theme') || 'light',
  visualTheme: localStorage.getItem('yarin_visual_theme') || 'classic',
  // Never trust a browser-stored FX quote. A verified live or server-persisted
  // rate is loaded during boot; until then foreign conversion fails closed.
  exchangeRate: NaN, // 1 AED -> INR, populated only from a verified server response
  tables: {},          // cache of last-fetched records per table
  dashboard: null,     // cache of last dashboard payload
  editing: {},          // { tableName: id } currently being edited
  shoppingBudget: 0,    // budget threshold, stored in AED
  lastSalaryAED: 0,     // last salary amount entered, stored in AED
  salaryCreditDay: 27,  // per-user salary day (1-31), loaded from Settings
  salaryPlan: null,     // cache of last /api/salary-plan response
  incomeProfile: null,  // cache of last /api/income-profile response (Phase 4 gate)
  voiceLanguage: 'en-US',  // voice AI language toggle ('en-US' or 'ml-IN')
  aiListening: false,      // true while SpeechRecognition is actively listening
  aiRecognition: null,     // the active SpeechRecognition instance, if any
  emiFullyPaidAlertShown: false,
  username: 'User',        // display name, kept in sync with the users table
  userId: null,             // authenticated account id; used to namespace device-local preferences
  primaryCurrency: localStorage.getItem('rizq_primary_currency') || 'AED',
  secondaryCurrency: localStorage.getItem('rizq_secondary_currency') || 'INR',
  aedRates: { AED: 1 },
  fxRateDates: {},
  fxRange: '1M',
  fxLastRefreshAt: 0,
};

/** Same palette as AzretCharts, kept in sync so the allocation list
 *  swatches always match the pie chart slice colours. */
function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const SALARY_PALETTE = ['#4C8DFF', '#1E4DB7', '#1FAA59', '#F5A524', '#E5484D', '#7C8AA5', '#0F2A5E', '#6EDB9A'];

const CURRENCY_SYMBOL = { AED:'AED', INR:'₹', USD:'$', EUR:'€', GBP:'£', JPY:'¥', CNY:'¥', KRW:'₩', RUB:'₽', TRY:'₺', SAR:'SAR', QAR:'QAR', KWD:'KWD', BHD:'BHD', OMR:'OMR', CAD:'C$', AUD:'A$', CHF:'CHF', SGD:'S$', NZD:'NZ$' };

// Primary country/region flag for the full right-half salary-card flag panel. Multi-country/supranational currencies use
// the best-recognised regional flag; unsupported/metal/archive codes fall back
// to a subtle currency-code watermark instead of showing the wrong country.
const CURRENCY_FLAG_COUNTRY = {
  AED:'AE',AFN:'AF',ALL:'AL',AMD:'AM',ANG:'CW',AOA:'AO',ARS:'AR',AUD:'AU',AWG:'AW',AZN:'AZ',
  BAM:'BA',BBD:'BB',BDT:'BD',BGN:'BG',BHD:'BH',BIF:'BI',BMD:'BM',BND:'BN',BOB:'BO',BRL:'BR',BSD:'BS',BTN:'BT',BWP:'BW',BYN:'BY',BZD:'BZ',
  CAD:'CA',CDF:'CD',CHF:'CH',CLP:'CL',CNY:'CN',CNH:'CN',COP:'CO',CRC:'CR',CUP:'CU',CVE:'CV',CZK:'CZ',
  DJF:'DJ',DKK:'DK',DOP:'DO',DZD:'DZ',EGP:'EG',ERN:'ER',ETB:'ET',EUR:'EU',FJD:'FJ',FKP:'FK',
  GBP:'GB',GEL:'GE',GGP:'GG',GHS:'GH',GIP:'GI',GMD:'GM',GNF:'GN',GTQ:'GT',GYD:'GY',
  HKD:'HK',HNL:'HN',HTG:'HT',HUF:'HU',IDR:'ID',ILS:'IL',IMP:'IM',INR:'IN',IQD:'IQ',IRR:'IR',ISK:'IS',JEP:'JE',JMD:'JM',JOD:'JO',JPY:'JP',
  KES:'KE',KGS:'KG',KHR:'KH',KMF:'KM',KPW:'KP',KRW:'KR',KWD:'KW',KYD:'KY',KZT:'KZ',
  LAK:'LA',LBP:'LB',LKR:'LK',LRD:'LR',LSL:'LS',LYD:'LY',MAD:'MA',MDL:'MD',MGA:'MG',MKD:'MK',MMK:'MM',MNT:'MN',MOP:'MO',MRU:'MR',MUR:'MU',MVR:'MV',MWK:'MW',MXN:'MX',MYR:'MY',MZN:'MZ',
  NAD:'NA',NGN:'NG',NIO:'NI',NOK:'NO',NPR:'NP',NZD:'NZ',OMR:'OM',PAB:'PA',PEN:'PE',PGK:'PG',PHP:'PH',PKR:'PK',PLN:'PL',PYG:'PY',QAR:'QA',RON:'RO',RSD:'RS',RUB:'RU',RWF:'RW',
  SAR:'SA',SBD:'SB',SCR:'SC',SDG:'SD',SEK:'SE',SGD:'SG',SHP:'SH',SLE:'SL',SOS:'SO',SRD:'SR',SSP:'SS',STN:'ST',SYP:'SY',SZL:'SZ',
  THB:'TH',TJS:'TJ',TMT:'TM',TND:'TN',TOP:'TO',TRY:'TR',TTD:'TT',TWD:'TW',TZS:'TZ',UAH:'UA',UGX:'UG',USD:'US',UYU:'UY',UZS:'UZ',VES:'VE',VND:'VN',VUV:'VU',WST:'WS',YER:'YE',ZAR:'ZA',ZMW:'ZM',ZWG:'ZW'
};
function countryFlagEmoji(countryCode){
  const cc=String(countryCode||'').toUpperCase();
  if(!/^[A-Z]{2}$/.test(cc))return '';
  return [...cc].map(ch=>String.fromCodePoint(127397+ch.charCodeAt(0))).join('');
}
function updateSalaryCurrencyFlag(currency=state.currency){
  const card=document.getElementById('salaryCountdownCard');
  const glyph=document.getElementById('salaryCurrencyFlagGlyph');
  if(!card||!glyph)return;
  const code=String(currency||state.primaryCurrency||'AED').toUpperCase();
  const flag=countryFlagEmoji(CURRENCY_FLAG_COUNTRY[code]);
  const next=flag||code;
  // Rapid AED⇄INR taps could previously leave an older 160ms timer pending.
  // Example: AED→INR→AED before the first fade completed would later paint INR
  // even though AED was active. Always cancel the stale transition first.
  if(updateSalaryCurrencyFlag._timer){
    clearTimeout(updateSalaryCurrencyFlag._timer);
    updateSalaryCurrencyFlag._timer=null;
  }
  updateSalaryCurrencyFlag._pendingCode=code;
  if(glyph.textContent===next){
    glyph.classList.toggle('currency-code-watermark',!flag);
    card.dataset.currencyFlag=code;
    card.classList.remove('flag-changing');
    return;
  }
  card.classList.add('flag-changing');
  updateSalaryCurrencyFlag._timer=window.setTimeout(()=>{
    if(updateSalaryCurrencyFlag._pendingCode!==code)return;
    glyph.textContent=next;
    glyph.classList.toggle('currency-code-watermark',!flag);
    card.dataset.currencyFlag=code;
    updateSalaryCurrencyFlag._timer=null;
    requestAnimationFrame(()=>card.classList.remove('flag-changing'));
  },160);
}

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
function hideAppLoader(force = false) {
  // When /splash is intentionally requested, keep the premium intro visible
  // until playSplashIntro() completes. Normal dashboard loads still hide the
  // loader immediately.
  if (window.START_SPLASH && !force) return;
  const loader = document.getElementById('appLoader');
  if (loader) loader.classList.add('hidden');

  const splash = document.getElementById('splash-screen') || document.getElementById('splashScreen');
  if (splash) splash.style.display = 'none';
}

if (document.readyState !== 'loading') hideAppLoader();
window.addEventListener('DOMContentLoaded', hideAppLoader);
window.addEventListener('load', hideAppLoader);

document.addEventListener('DOMContentLoaded', async () => {
  applyVisualTheme(state.visualTheme, false);
  applyTheme(state.theme, false);
  applyCurrency(state.currency, false);

  setupSidebar();
  setupTopbar();
  setupForms();
  setupProductFetchers();
  setupIncomeProfile();
  setupSalaryPlanner();
  setupCalculators();
  setupFloatingCalculator();
  setupSettingsPage();
  setupReportButtons();
  setupSalaryCountdown();
  setupDailyReminder();
  setupVoiceAssistant();

  document.getElementById('footerYear').textContent = new Date().getFullYear();
  updateGreetingClock();
  setInterval(updateGreetingClock, 1000);

  await loadServerSettings();
  await loadProfile();
  checkSalaryNotification();
  await loadBranding();
  await refreshExchangeRate(true);
  setupFxAutoRefresh();

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
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).catch(() => {});
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

  // Single combined, centered line — e.g. "Good Evening, User" — instead of
  // a stacked eyebrow label + name.
  const greetingEl = document.getElementById('greetingText');
  if (greetingEl) greetingEl.textContent = greeting;
  const nameEl = document.getElementById('greetingName');
  if (nameEl) nameEl.textContent = state.username || 'User';
  const mobileGreetingEl = document.getElementById('mobileGreetingText');
  if (mobileGreetingEl) mobileGreetingEl.textContent = greeting;
  const mobileNameEl = document.getElementById('mobileGreetingName');
  if (mobileNameEl) mobileNameEl.textContent = state.username || 'User';
  const azretGreetingName = document.getElementById('azretGreetingName');
  if (azretGreetingName) azretGreetingName.textContent = state.username || 'User';
  const azretModalGreetingName = document.getElementById('azretModalGreetingName');
  if (azretModalGreetingName) azretModalGreetingName.textContent = state.username || 'User';

  // V101 topbar identity frame. Keep it synced with Profile changes and greeting.
  const topbarUserName = document.getElementById('topbarUserName');
  const topbarUserInitial = document.getElementById('topbarUserInitial');
  const topbarName = String(state.username || 'User').trim() || 'User';
  if (topbarUserName) topbarUserName.textContent = topbarName;
  if (topbarUserInitial) topbarUserInitial.textContent = (topbarName.match(/[\p{L}\p{N}]/u)?.[0] || 'U').toUpperCase();

  const timeText = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const timeEl = document.getElementById('clockTime');
  if (timeEl) timeEl.textContent = timeText;
  const mobileTimeEl = document.getElementById('mobileClockTime');
  if (mobileTimeEl) mobileTimeEl.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const dateText = now.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
  const dateEl = document.getElementById('clockDate');
  if (dateEl) dateEl.textContent = dateText;
  const mobileDateEl = document.getElementById('mobileClockDate');
  if (mobileDateEl) mobileDateEl.textContent = dateText;

  const salaryTimeEl = document.getElementById('salaryLiveTime');
  if (salaryTimeEl) salaryTimeEl.textContent = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
  const salaryDateEl = document.getElementById('salaryLiveDate');
  if (salaryDateEl) salaryDateEl.textContent = now.toLocaleDateString(undefined, {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
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
    document.body.classList.add('sidebar-mobile-open');
  });
  document.getElementById('sidebarClose')?.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.classList.remove('sidebar-mobile-open');
  }

  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
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
    document.body.classList.add('sidebar-mobile-open');
  });

  const performLogout = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
    window.location.href = '/login';
  };
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', performLogout);

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.addEventListener('click', () => {
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
  document.querySelectorAll('#currencySwitch .cur-opt').forEach(btn => {
    btn.addEventListener('click', () => setCurrency(btn.dataset.currency));
  });

  const searchInput = document.getElementById('globalSearch');
  const resultsBox = document.getElementById('globalSearchResults');
  const mobileSearchToggle = document.getElementById('mobileSearchToggle');
  const mobileSearchClose = document.getElementById('mobileSearchClose');
  const searchBackdrop = document.getElementById('globalSearchBackdrop');
  const isMobileSearch = () => window.matchMedia('(max-width: 767px)').matches;
  const openSearchFocus = () => {
    document.body.classList.add('global-search-open');
    searchBackdrop?.setAttribute('aria-hidden', 'false');
  };
  const closeSearchFocus = ({ clear = false } = {}) => {
    document.body.classList.remove('global-search-open', 'mobile-search-open');
    searchBackdrop?.setAttribute('aria-hidden', 'true');
    resultsBox?.classList.remove('show');
    if (clear && searchInput) searchInput.value = '';
    searchInput?.blur();
  };
  const openMobileSearch = () => {
    if (!isMobileSearch()) return;
    document.body.classList.add('mobile-search-open');
    openSearchFocus();
    mobileSearchToggle?.setAttribute('aria-label', 'Search');
    window.setTimeout(() => searchInput?.focus({ preventScroll: true }), 40);
  };
  const closeMobileSearch = () => closeSearchFocus();
  mobileSearchToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    if (!isMobileSearch()) { searchInput?.focus(); return; }
    openMobileSearch();
  });
  mobileSearchClose?.addEventListener('click', (event) => { event.preventDefault(); closeSearchFocus(); });
  searchInput?.addEventListener('focus', () => {
    openSearchFocus();
    if (isMobileSearch()) document.body.classList.add('mobile-search-open');
  });
  searchInput?.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSearchFocus(); });
  searchBackdrop?.addEventListener('click', () => closeSearchFocus());
  window.addEventListener('resize', () => {
    if (!isMobileSearch()) document.body.classList.remove('mobile-search-open');
  }, { passive: true });
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { resultsBox.classList.remove('show'); return; }
    searchTimer = setTimeout(() => runGlobalSearch(q), 300);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-search') && !e.target.closest('#globalSearchBackdrop')) {
      resultsBox?.classList.remove('show');
      if (document.body.classList.contains('global-search-open')) closeSearchFocus();
    }
  });

  const refreshRateBtn = document.getElementById('refreshRate');
  if (refreshRateBtn) refreshRateBtn.addEventListener('click', () => refreshExchangeRate(false));
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
  const targets = ['splashLogo', 'brandingPreview'];
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
  if (!loader) return;

  // V13: the startup experience is a deterministic premium brand animation.
  // Keeping it local avoids autoplay, network and missing-video failures.
  return new Promise(resolve => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      loader.classList.add('hidden');
      setTimeout(() => { loader.style.display = 'none'; }, 450);
      resolve();
    };

    // Long enough to see the reveal, short enough to keep startup feeling fast.
    setTimeout(cleanup, 4800);
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
function setVisualTheme(theme) {
  const next = theme === 'premium' ? 'premium' : 'classic';
  state.visualTheme = next;
  localStorage.setItem('yarin_visual_theme', next);
  applyVisualTheme(next, true);
}

function applyVisualTheme(theme, rerender) {
  const next = theme === 'premium' ? 'premium' : 'classic';
  state.visualTheme = next;
  document.documentElement.setAttribute('data-visual-theme', next);
  document.body.setAttribute('data-visual-theme', next);
  document.querySelectorAll('#settingsVisualThemeSwitch [data-visual-theme]').forEach(b => {
    const active = b.dataset.visualTheme === next;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  syncBrowserThemeColor();
  if (rerender && state.dashboard) renderDashboard(state.dashboard);
}

function syncBrowserThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const dark = state.theme === 'dark';
  if (state.visualTheme === 'premium') meta.setAttribute('content', dark ? '#0C0805' : '#F7EFE4');
  else meta.setAttribute('content', dark ? '#070F22' : '#1E4DB7');
}

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
  // V98: the old header theme icon was intentionally removed in V96.
  // Keep these references optional so Settings Light/Dark switching remains live.
  const themeIconSun = document.getElementById('themeIconSun');
  const themeIconMoon = document.getElementById('themeIconMoon');
  if (themeIconSun) themeIconSun.style.display = theme === 'dark' ? 'none' : 'block';
  if (themeIconMoon) themeIconMoon.style.display = theme === 'dark' ? 'block' : 'none';
  document.querySelectorAll('#settingsThemeSwitch button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  syncBrowserThemeColor();
  if (rerender && state.dashboard) renderDashboard(state.dashboard);
}

/* ---------------------------------------------------------------------- */
/* Currency                                                               */
/* ---------------------------------------------------------------------- */
function legacy_setCurrency(cur) {
  state.currency = cur;
  localStorage.setItem('azret_currency', cur);
  applyCurrency(cur, true);
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ default_currency: cur })
  }).catch(() => {});
}

function legacy_applyCurrency(cur, rerender) {
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
function legacy_convertVisibleAmountInputs(table) {
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

/* Legacy single-pair currency helpers removed in V64.
   The active implementation below uses YARIN's server-verified multi-currency
   endpoints only, avoiding stale browser/provider fallbacks. */

/* ==========================================================================
   Animated Salary Countdown Widget (Phase 2)
   ========================================================================== */
const COUNTDOWN_RING_CIRCUMFERENCE = 2 * Math.PI * 52; // matches the r=52 SVG circle

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function effectiveSalaryDay(year, monthIndex) {
  const configured = Math.max(1, Math.min(31, parseInt(state.salaryCreditDay, 10) || 27));
  return Math.min(configured, daysInMonth(year, monthIndex));
}

/** Returns the next salary date using this user's configured salary day.
 * If a month is shorter than the configured day (e.g. 31st in February),
 * that month's last calendar day is used. */
function getNextSalaryDate() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let day = effectiveSalaryDay(year, month);
  let target = new Date(year, month, day, 0, 0, 0);
  if (now.getFullYear() !== target.getFullYear() || now.getMonth() !== target.getMonth() || now.getDate() > target.getDate()) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    day = effectiveSalaryDay(year, month);
    target = new Date(year, month, day, 0, 0, 0);
  }
  return { target };
}

function ordinalDay(day) {
  const n = Number(day) || 27;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
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
  const dayOfMonthEl = document.getElementById('countdownDayOfMonth');
  if (!card || !daysEl || !hoursEl || !minutesEl || !secondsEl || !ringFill || !dateEl) return;

  if (dayOfMonthEl) dayOfMonthEl.textContent = ordinalDay(state.salaryCreditDay);

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
   YARIN Voice Assistant — simplified, single mic-button workflow
   --------------------------------------------------------------------------
   1. Tap the mic button -> browser starts listening (Web Speech API
      SpeechRecognition), supports English and Malayalam.
   2. On the final recognized transcript, the text is sent to the server
      (/api/ai-assistant), which calls Gemini and returns a short, on-topic
      Gemini reply; finance context is attached only when the question is finance-related.
   3. The reply is spoken back automatically (SpeechSynthesis), and shown as
      a single status/transcript line — no scrolling chat window.
   ========================================================================== */

/* ==========================================================================
   YARIN Gemini AI Assistant — Chat & Live Voice Call
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
  if (!state.voiceLanguage || state.voiceLanguage === 'en-US') state.voiceLanguage = chooseInitialAssistantLanguage();
  const openBtn = document.getElementById('assistantBtn');
  const closeBtn = document.getElementById('voiceAssistantClose');
  const minimizeBtn = document.getElementById('voiceAssistantMinimize');
  const modal = document.getElementById('voiceAssistantModal');
  const langToggle = document.getElementById('voiceAssistantLangToggle');
  const modeChatBtn = document.getElementById('modeChatBtn');
  const modeLiveBtn = document.getElementById('modeLiveBtn');
  const clearBtn = document.getElementById('clearGeminiChatBtn');

  if (openBtn) openBtn.addEventListener('click', openGeminiModal);
  if (clearBtn) clearBtn.addEventListener('click', clearGeminiConversation);
  if (closeBtn) closeBtn.addEventListener('click', closeGeminiModal);
  if (minimizeBtn) minimizeBtn.addEventListener('click', toggleGeminiMinimize);
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
            welcomeEl.textContent = 'ഹായ്! ഞാൻ Azret AI ✨ നിങ്ങളുടെ YARIN ഫിനാൻസ് കാര്യങ്ങളോ സാധാരണ ചോദ്യങ്ങളോ മലയാളത്തിലോ ഇംഗ്ലീഷിലോ ചോദിക്കാം.';
          } else {
            welcomeEl.textContent = 'Hi! I’m Azret AI. Ask me anything in English or Malayalam — finance, ideas, travel, tech, or everyday questions.';
          }
        }
      });
    });
  }

  // Gemini Chat Setup
  setupGeminiChat();

  // Gemini Live Call Setup
  setupGeminiLiveCall();

  // The Azret AI orb is the natural voice trigger. Opening the window never starts the microphone.
  const liveAvatar = document.getElementById('liveOrb');
  const heroAvatar = document.getElementById('aiHeroAvatar');
  const triggerVoice = () => {
    switchGeminiMode('live');
    if (!liveCallActive) document.getElementById('liveMainCallBtn')?.click();
  };
  if (liveAvatar) {
    liveAvatar.addEventListener('click', triggerVoice);
    liveAvatar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerVoice(); } });
  }
  if (heroAvatar) heroAvatar.addEventListener('click', triggerVoice);
}

function openVoiceAssistantModal() {
  const modal = document.getElementById('voiceAssistantModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  setVoiceAssistantStatus('Tap the mic and ask YARIN يارين about your finances.');
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
  modal.querySelector('.gemini-assistant-modal')?.classList.remove('ai-minimized');
  document.getElementById('assistantBtn')?.classList.add('ai-launcher-hidden');
  document.body.classList.add('modal-open');
  loadGeminiHistory();
  switchGeminiMode('chat');
  updateLiveStatus('Azret AI Ready');
  if (typeof setAzretAIState === 'function') setAzretAIState('greeting');
}

function closeGeminiModal() {
  const modal = document.getElementById('voiceAssistantModal');
  if (modal) modal.style.display = 'none';
  modal?.querySelector('.gemini-assistant-modal')?.classList.remove('ai-minimized');
  document.getElementById('assistantBtn')?.classList.remove('ai-launcher-hidden');
  document.body.classList.remove('modal-open');
  endLiveCall();
  speechSynthesis.cancel();
  stopVoiceAssistantListening();
}

function toggleGeminiMinimize() {
  const shell = document.querySelector('#voiceAssistantModal .gemini-assistant-modal');
  if (!shell) return;
  const minimized = shell.classList.toggle('ai-minimized');
  const btn = document.getElementById('voiceAssistantMinimize');
  if (btn) { btn.textContent = minimized ? '□' : '−'; btn.title = minimized ? 'Restore' : 'Minimize'; }
  // Minimize only changes the visual shell. Keep an already-started voice conversation alive.
  // Closing (X) is the action that stops the microphone, speech and call state.
  if (minimized) { updateLiveStatus(liveCallActive ? 'Azret AI active in minimized mode' : 'Azret AI minimized'); }
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

function detectAssistantLanguageFromText(text) {
  const value = String(text || '');
  // Malayalam Unicode block. No visible EN/ML switch is required.
  if (/[\u0D00-\u0D7F]/.test(value)) return 'ml-IN';
  return 'en-US';
}

function chooseInitialAssistantLanguage() {
  const langs = Array.isArray(navigator.languages) ? navigator.languages : [navigator.language || 'en-US'];
  return langs.some(l => String(l).toLowerCase().startsWith('ml')) ? 'ml-IN' : 'en-US';
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
    toast('Azret AI conversation cleared', 'success');
  } catch (e) {
    toast('Could not clear Azret AI conversation', 'error');
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
    const detectedLang = detectAssistantLanguageFromText(cleanText);
    state.voiceLanguage = detectedLang;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cleanText, language: getAssistantLanguageKey(detectedLang), mode: 'chat' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const detail = data.hint ? `${data.error || 'AI service error'}\n${data.hint}` : (data.error || `Gemini request failed (${res.status})`);
      updateGeminiChatMessage(botMsgId, detail, state.voiceLanguage);
      return;
    }
    const reply = data.response || data.reply;
    if (!reply) throw new Error('Azret AI returned an empty response');
    updateGeminiChatMessage(botMsgId, reply, data.language || state.voiceLanguage);
  } catch (err) {
    const detail = err && err.name === 'AbortError' ? 'Azret AI took too long to respond. Please try again.' : `Could not connect to Azret AI: ${err.message || 'network error'}`;
    updateGeminiChatMessage(botMsgId, detail, state.voiceLanguage);
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
      const query = input.value.trim();
      state.voiceLanguage = detectAssistantLanguageFromText(query);
      sendGeminiChatMessage(query);
      input.value = '';
    }
  };

  recognition.onerror = (event) => {
    if (micBtn) micBtn.classList.remove('listening');
    state.aiListening = false;
    const code = event && event.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') toast('Microphone permission is blocked. Allow microphone access in the browser and try again.', 'error');
    else if (code === 'audio-capture') toast('No microphone was found on this device.', 'error');
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

  updateLiveStatus('Connecting to Azret AI…');
  const orb = document.getElementById('liveOrb');
  if (orb) orb.classList.add('active');

  setTimeout(() => {
    if (!liveCallActive) return;
    updateLiveStatus('Azret AI Connected 🟢');
    const welcome = state.voiceLanguage === 'ml-IN'
      ? 'ഹായ്! Azret AI ഇവിടെ ഉണ്ട് ✨ സംസാരിക്കൂ, ഞാൻ കേൾക്കുന്നു.'
      : "Hi! Azret AI is connected ✨ Talk naturally — I can handle follow-up questions too.";
    
    updateLiveTranscript(`Azret AI: ${welcome}`);
    if (liveSpeakerOn) {
      speakVoiceAssistantReply(welcome, state.voiceLanguage, () => {
        if (liveCallActive && !liveCallMuted) startLiveCallTurn();
      });
    } else {
      if (liveCallActive && !liveCallMuted) startLiveCallTurn();
    }
  }, 250);
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
  if (btnLabel) btnLabel.textContent = 'Start Voice';

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
  let submitted = false;

  const scheduleRetry = (delay) => {
    if (retryScheduled || myTurn !== liveTurnSerial || !liveCallActive || liveCallMuted) return;
    retryScheduled = true;
    setTimeout(() => {
      if (myTurn === liveTurnSerial && liveCallActive && !liveCallMuted) startLiveCallTurn();
    }, delay);
  };

  const submitVoiceQuery = async (text) => {
    const clean = String(text || '').trim();
    if (!clean || submitted || myTurn !== liveTurnSerial || !liveCallActive) return;
    submitted = true;
    state.voiceLanguage = detectAssistantLanguageFromText(clean);
    updateLiveStatus('Azret AI Thinking… ✨');
    if (orb) orb.classList.add('speaking');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let res;
      try {
        res = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: clean, language: getAssistantLanguageKey(state.voiceLanguage), mode: 'voice' }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      let data = {};
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new Error(data.error || data.hint || `Gemini request failed (${res.status})`);
      if (myTurn !== liveTurnSerial || !liveCallActive) return;
      const reply = data.response || data.reply;
      if (!reply) throw new Error('Empty Azret AI response');
      updateLiveTranscript(`Azret AI: ${reply}`);
      if (liveSpeakerOn) {
        updateLiveStatus('Azret AI Speaking… 🔊');
        speakVoiceAssistantReply(reply, data.language || state.voiceLanguage, () => {
          if (myTurn !== liveTurnSerial) return;
          if (orb) orb.classList.remove('speaking');
          scheduleRetry(250);
        });
      } else {
        if (orb) orb.classList.remove('speaking');
        scheduleRetry(400);
      }
    } catch (err) {
      if (myTurn !== liveTurnSerial || !liveCallActive) return;
      const msg = err && err.name === 'AbortError' ? 'Response took too long. Please try again.' : (err.message || 'AI connection error.');
      updateLiveTranscript(`Azret AI: ${msg}`);
      updateLiveStatus('Azret AI connection problem');
      if (orb) orb.classList.remove('speaking');
      scheduleRetry(1200);
    }
  };

  recognition.onresult = (e) => {
    if (myTurn !== liveTurnSerial || submitted) return;
    let interim = '';
    let gotFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
        gotFinal = true;
      } else {
        interim += e.results[i][0].transcript;
      }
    }
    const text = (finalTranscript + interim).trim();
    if (text) updateLiveTranscript(`You: ${text}`);
    // Do not wait for the browser's onend event once a final transcript exists.
    // Starting the Gemini request immediately removes a noticeable voice-mode pause.
    if (gotFinal && finalTranscript.trim()) {
      try { recognition.stop(); } catch (e) {}
      submitVoiceQuery(finalTranscript);
    }
  };

  recognition.onerror = (event) => {
    hadError = true;
    if (state.aiRecognition === recognition) state.aiRecognition = null;
    const code = event && event.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      updateLiveStatus('Microphone permission required');
      updateLiveTranscript('Allow microphone access in your browser, then tap the avatar or Start Voice again.');
      liveCallActive = false;
      updateLiveTimerDisplay();
      return;
    }
    if (code === 'audio-capture') {
      updateLiveStatus('Microphone not available');
      updateLiveTranscript('No working microphone was detected on this device.');
      liveCallActive = false;
      return;
    }
    if (!submitted) scheduleRetry(code === 'no-speech' ? 450 : 900);
  };

  recognition.onend = () => {
    if (state.aiRecognition === recognition) state.aiRecognition = null;
    if (myTurn !== liveTurnSerial || hadError || submitted) return;
    const text = finalTranscript.trim();
    if (text) submitVoiceQuery(text);
    else scheduleRetry(500);
  };

  try {
    recognition.start();
    state.aiRecognition = recognition;
  } catch (e) {
    hadError = true;
    scheduleRetry(1200);
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

function pickPreferredAssistantVoice(targetLang) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  if (!voices.length) return null;
  const base = String(targetLang || 'en-US').toLowerCase().split('-')[0];
  const sameLang = voices.filter(v => String(v.lang || '').toLowerCase().startsWith(base));
  // Voice names vary by ChromeOS/Android/Windows. Prefer commonly feminine/natural
  // voices when present, but always fall back to a correct-language voice.
  const preferredName = /female|samantha|zira|aria|jenny|ava|emma|google.*(us|uk)|microsoft.*(aria|zira|jenny)/i;
  return sameLang.find(v => preferredName.test(v.name || '')) || sameLang.find(v => v.localService) || sameLang[0] || voices[0];
}

function speakVoiceAssistantReply(text, lang, onEndCallback) {
  if (!window.speechSynthesis || !text) {
    setAzretAIState('idle');
    if (onEndCallback) onEndCallback();
    return;
  }
  speechSynthesis.cancel();
  const clean = cleanTextForSpeech(text);
  if (!clean) {
    setAzretAIState('idle');
    if (onEndCallback) onEndCallback();
    return;
  }
  const targetLang = String(lang || '').toLowerCase().startsWith('ml') ? 'ml-IN' : 'en-US';
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = targetLang;
  utterance.rate = targetLang === 'ml-IN' ? 0.96 : 1.01;
  utterance.pitch = 1.03;
  const selected = pickPreferredAssistantVoice(targetLang);
  if (selected) utterance.voice = selected;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    setAzretAIState('idle');
    if (onEndCallback) onEndCallback();
  };
  utterance.onstart = () => setAzretAIState('speaking');
  utterance.onend = finish;
  utterance.onerror = finish;
  speechSynthesis.speak(utterance);
}

function checkSalaryNotification() {
  const today = new Date();
  const configuredDay = Math.max(1, Math.min(31, parseInt(state.salaryCreditDay, 10) || 27));
  const salaryDayThisMonth = effectiveSalaryDay(today.getFullYear(), today.getMonth());

  // Show only on this user's configured salary day (or the month's last day
  // when the configured day does not exist in a shorter month).
  if (today.getDate() !== salaryDayThisMonth) return;

  const dateStr = localDateISO(today);
  const salaryStorageKey = `salary_asked_${state.userId || state.username || 'account'}_${dateStr}`;
  const answered = localStorage.getItem(salaryStorageKey);
  if (answered) return;

  const notifEl = document.getElementById('salary27Notification');
  if (!notifEl) return;

  notifEl.style.display = 'flex';
  const title = notifEl.querySelector('.s27-text strong');
  if (title) title.textContent = `Salary day (${ordinalDay(configuredDay)})`;

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
    const res = await fetch(`/api/dashboard?today=${encodeURIComponent(localDateISO())}`, {cache:'no-store'});
    const data = await res.json();
    state.dashboard = data;
    renderDashboard(data);
    if (typeof window.refreshYarinFinanceSuite === 'function') window.refreshYarinFinanceSuite();
  } catch (e) { toast('Could not load dashboard', 'error'); }
}

function renderDashboard(d) {
  const standardCards = [
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
  const cards = state.visualTheme === 'premium' ? [
    standardCards[8], standardCards[0], standardCards[1], standardCards[2],
    standardCards[9], standardCards[10], standardCards[11], standardCards[6],
    standardCards[4], standardCards[5], standardCards[3], standardCards[7],
  ] : standardCards;

  document.getElementById('statGrid').innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}" data-stat="${c.label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}">
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

  const premiumPalette = state.visualTheme === 'premium';
  AzretCharts.barChart('chartIncomeExpense', monthLabels, [
    { data: d.chart_income, color: premiumPalette ? '#2FD47D' : '#1FAA59' },
    { data: d.chart_expense, color: premiumPalette ? '#FF615D' : '#E5484D' },
  ]);
  AzretCharts.lineChart('chartSavingsGrowth', monthLabels, [
    { data: d.chart_savings_growth, color: premiumPalette ? '#FF8A16' : '#4C8DFF' },
  ]);
  AzretCharts.donutChart('chartCategories', d.chart_categories, d.chart_category_totals);

  const goalPct = d.savings_goal > 0 ? Math.min(100, Math.round((d.total_savings / d.savings_goal) * 100)) : 0;
  document.getElementById('quickSummary').innerHTML = `
    <div class="qs-row"><span>Savings Goal Progress</span><span>${goalPct}%</span></div>
    <div class="qs-row"><span>EMI Pending</span><span>${fmt(d.emi_pending)}</span></div>
    <div class="qs-row"><span>Active EMIs</span><span>${d.active_emi_count}</span></div>
    <div class="qs-row"><span>This Month's Balance</span><span>${fmt(Number.isFinite(Number(d.monthly_available)) ? Number(d.monthly_available) : (Number(d.monthly_income||0)-Number(d.monthly_expense||0)))}</span></div>
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
    if (!res.ok) throw new Error(data?.error || `Could not load ${table}`);
    if (!Array.isArray(data)) throw new Error(`Invalid ${table} response`);
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
    const pctEl = document.getElementById('savings-goal-pct');
    const fillEl = document.getElementById('savings-goal-fill');
    const savedEl = document.getElementById('savings-goal-saved');
    const targetEl = document.getElementById('savings-goal-target');
    const messageEl = document.getElementById('savings-goal-message');
    if (pctEl) pctEl.textContent = pct + '%';
    if (fillEl) {
      fillEl.style.width = pct + '%';
      fillEl.dataset.progress = String(pct);
    }
    if (savedEl) savedEl.textContent = fmt(total);
    if (targetEl) targetEl.textContent = goal > 0 ? fmt(goal) : 'Not set';
    if (messageEl) {
      messageEl.textContent = goal <= 0
        ? 'Set a goal — give every saved dirham a destination.'
        : pct >= 100
          ? 'Goal reached. That discipline looks good on you.'
          : pct >= 75
            ? 'Almost there — protect the streak and finish strong.'
            : pct >= 50
              ? 'Halfway and climbing. Keep the momentum alive.'
              : pct >= 25
                ? 'Momentum is building — another deposit moves the line.'
                : total > 0
                  ? 'Great start. Small deposits become serious progress.'
                  : 'Start small. Your future self will notice.';
    }
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
    document.getElementById('shopping-total').textContent = fmt(total);
    updateShoppingBudgetUI(total);
  }
}

/* ---------------------------------------------------------------------- */
/* Shopping Planner: budget                                               */
/* ---------------------------------------------------------------------- */
function setupShoppingBudget() {
  const btn = document.getElementById('shopping-budget-save');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const input = document.getElementById('shopping-budget-input');
    const typed = Number(input.value);
    if (!Number.isFinite(typed) || typed < 0) { toast('Enter a valid shopping budget', 'error'); return; }
    if (!hasCurrencyRate(state.currency)) { toast(`Exchange rate unavailable for ${state.currency}. Refresh rates first.`, 'error'); return; }
    const budgetAED = toAED(typed, state.currency);
    if (!Number.isFinite(budgetAED)) { toast('Could not convert budget safely', 'error'); return; }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopping_budget: budgetAED })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      state.shoppingBudget = budgetAED;
      toast('Shopping budget updated', 'success');
      const rows = state.tables.shopping || [];
      const total = rows.reduce((a, r) => a + (Number(r.total) || 0), 0);
      updateShoppingBudgetUI(total);
    } catch (e) { toast(e.message || 'Could not save shopping budget', 'error'); }
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
    ? safeConvertedInputValue(budgetAED, state.currency)
    : '';
  if (budgetAED > 0 && !input.value) input.placeholder = 'Exchange rate unavailable';

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
    if (dateInput && !dateInput.value) dateInput.value = localDateISO();
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
function legacy_updateAmountHint(table, field) {
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
  let out = String(notes || '').trimEnd();
  // V20+ writes [Base: ...] while older versions wrote [Original: ...].
  // Remove every trailing generated block so editing a record never stacks
  // duplicate conversion metadata.
  const generated = /\n?\[(?:Original|Base):[^\]]*\]\s*$/i;
  while (generated.test(out)) out = out.replace(generated, '').trimEnd();
  return out;
}

/** Builds the "Original AED / Converted INR / Date / Time" info line that
 *  gets appended to a record's Notes field on every submission. */
function legacy_buildAutoNote(amountAED, dateVal, timeVal) {
  const inrVal = amountAED * state.exchangeRate;
  const d = dateVal || localDateISO();
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
  const amountFields = AMOUNT_FIELDS[table] || [];
  for (const f of amountFields) {
    if (payload[f] === undefined || payload[f] === '') continue;
    const el = document.getElementById(`${table}-${f}`);
    const entryCur = (el && el.dataset.entryCur) || state.currency;
    const typed = Number(payload[f]) || 0;
    if (!hasCurrencyRate(entryCur)) { toast(`Exchange rate unavailable for ${entryCur}. Refresh rates before saving.`, 'error'); return; }
    payload[f] = toAED(typed, entryCur);
    if (!Number.isFinite(payload[f])) { toast(`Could not convert ${entryCur} safely.`, 'error'); return; }
  }

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
        // Show stored AED values in the user's currently selected currency.
        // This keeps EMI/Debt edit forms consistent even when AED is not
        // one of the user's two configured currencies.
        el.dataset.entryCur = state.currency;
        el.value = safeConvertedInputValue(aedVal, state.currency);
        if (!el.value && aedVal !== 0) el.placeholder = 'Exchange rate unavailable';
        setEntryCurrency(`${table}-${f}`, state.currency);
      } else {
        // Amount fields are stored in AED; show them converted into
        // whichever currency is currently selected for display.
        el.value = safeConvertedInputValue(aedVal, state.currency);
        if (!el.value && aedVal !== 0) el.placeholder = 'Exchange rate unavailable';
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
  if (dateInput) dateInput.value = localDateISO();
  if (timeInput) timeInput.value = new Date().toTimeString().slice(0, 5);

  if (SMART_TRACKING[table]) {
    (AMOUNT_FIELDS[table] || []).forEach(f => setEntryCurrency(`${table}-${f}`, state.currency));
    const panel = document.getElementById(`${table}-prev-panel`);
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  }
  if (table === 'emi') applyEmiCategoryFromValue('Vehicle');
}

async function deleteRecord(table, id) {
  if (!confirm('Delete this record? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/${table}/${id}`, { method: 'DELETE' });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      toast(data.error || 'Could not delete record', 'error');
      return;
    }
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
      window.open(`/api/report/${kind}?today=${encodeURIComponent(localDateISO())}`, '_blank', 'noopener');
    });
  });
}

/* ==========================================================================
   ABOUT / ADVICE
   ========================================================================== */
async function loadAbout() {
  try {
    const res = await fetch(`/api/advice?today=${encodeURIComponent(localDateISO())}`, {cache:'no-store'});
    const data = await res.json();
    document.getElementById('healthBadge').textContent = data.health;
    document.getElementById('motivationalText').textContent = `"${data.motivational}"`;
    document.getElementById('tipsList').innerHTML = data.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('');
    const tipsDateLabel = document.getElementById('tipsDateLabel');
    if (tipsDateLabel) tipsDateLabel.textContent = data.daily_label || 'Today';
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

  const toBaseAED = (typed) => toAED(typed, state.currency);
  const payload = {
    monthly_income: toBaseAED(typedIncome),
    other_income: toBaseAED(Number(document.getElementById('incomeprofile-other_income').value) || 0),
    fixed_emi_commitment: toBaseAED(Number(document.getElementById('incomeprofile-fixed_emi_commitment').value) || 0),
    fixed_debt_commitment: toBaseAED(Number(document.getElementById('incomeprofile-fixed_debt_commitment').value) || 0),
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
      salInput.value = safeConvertedInputValue(profile.total_verified_income, state.currency);
      if (!salInput.value && Number(profile.total_verified_income)) salInput.placeholder = 'Exchange rate unavailable';
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
  const salaryAED = toAED(typed, state.currency);
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
  if (!display || !buttonsEl) return;
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'C', '⌫', '0', '+', '.', '='];
  let expr = '';

  buttonsEl.innerHTML = keys.map(k => {
    const cls = ['÷', '×', '−', '+'].includes(k) ? 'op' : (k === '=' ? 'eq' : (k === '⌫' ? 'backspace-v82' : ''));
    const label = k === 'C' ? 'All clear' : (k === '⌫' ? 'Backspace' : k);
    return `<button class="${cls}" data-key="${k}" aria-label="${label}" title="${label}">${k}</button>`;
  }).join('');

  buttonsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      if (k === 'C') { expr = ''; }
      else if (k === '⌫') { expr = expr === 'Error' ? '' : expr.slice(0, -1); }
      else if (k === '=') {
        try {
          const safe = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
          if (!/^[0-9.+\-*/() ]+$/.test(safe)) throw new Error('invalid');
          // eslint-disable-next-line no-eval
          const result = Function(`"use strict"; return (${safe})`)();
          if (!Number.isFinite(result)) throw new Error('non-finite');
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
    const amt = Math.max(0, parseFloat(convAmount.value) || 0);
    let result;
    if (convFrom.value === convTo.value) result = amt;
    else result = fromAED(toAED(amt, convFrom.value), convTo.value);
    convResult.textContent = Number.isFinite(result)
      ? `${currencySymbol(convFrom.value)} ${amt.toLocaleString(undefined,{maximumFractionDigits:2})} = ${currencySymbol(convTo.value)} ${result.toLocaleString(undefined,{maximumFractionDigits:2})}`
      : 'Exchange rate unavailable';
  }
  [convAmount, convFrom, convTo].forEach(el => el.addEventListener('input', runConv));
  const convSwap = document.getElementById('convSwapCurrencies');
  if (convSwap) {
    convSwap.addEventListener('click', () => {
      const from = convFrom.value;
      convFrom.value = convTo.value;
      convTo.value = from;
      convSwap.classList.remove('swap-animate-v82');
      void convSwap.offsetWidth;
      convSwap.classList.add('swap-animate-v82');
      runConv();
    });
  }
  runConv();

  // Savings calculator
  const savMonthly = document.getElementById('savCalcMonthly');
  const savMonths = document.getElementById('savCalcMonths');
  const savRate = document.getElementById('savCalcRate');
  const savResult = document.getElementById('savCalcResult');
  function runSavCalc() {
    const monthly = Math.max(0, parseFloat(savMonthly.value) || 0);
    const months = Math.max(0, parseInt(savMonths.value, 10) || 0);
    const annualRate = Math.max(0, parseFloat(savRate.value) || 0);
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
    const p = Math.max(0, parseFloat(emiP.value) || 0);
    const annualRate = Math.max(0, parseFloat(emiR.value) || 0);
    const n = Math.max(1, parseInt(emiN.value, 10) || 1);
    const r = annualRate / 100 / 12;
    let emi;
    if (r === 0) emi = p / n;
    else emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const totalPay = emi * n;
    if (!Number.isFinite(emi) || !Number.isFinite(totalPay)) {
      emiResult.textContent = 'Enter valid loan values';
      return;
    }
    emiResult.textContent = `Monthly EMI: ${fmt(emi)}  ·  Total Payable: ${fmt(totalPay)}`;
  }
  [emiP, emiR, emiN].forEach(el => el.addEventListener('input', runEmiCalc));
  runEmiCalc();
}

/* ==========================================================================
   V82 — DRAGGABLE FLOATING CALCULATOR + QUICK SHORTCUT MENU
   ========================================================================== */
function setupFloatingCalculator() {
  const btn = document.getElementById('floatingCalculatorBtn');
  const win = document.getElementById('floatingCalculatorWindow');
  const header = document.getElementById('floatingCalcWindowHeader');
  const body = document.getElementById('floatingCalcBody');
  const title = document.getElementById('floatingCalcTitle');
  const counter = document.getElementById('floatingCalcCounter');
  const nextBtn = document.getElementById('floatingCalcNext');
  const minBtn = document.getElementById('floatingCalcMinimize');
  const closeBtn = document.getElementById('floatingCalcClose');
  if (!btn || !win || !header || !body) return;

  const STORAGE_KEY = 'yarin_floating_calculator_position_v84';
  const LEGACY_KEYS = ['yarin_floating_calculator_position_v83','yarin_floating_calculator_position_v82','yarin_floating_calculator_position_v81'];
  const WINDOW_KEY = 'yarin_floating_calculator_window_position_v84';
  const DATA_KEY = 'yarin_floating_calculator_data_v85';
  const EDGE_GAP = 8;
  const calcOrder = ['simple','currency','savings','emi'];
  const calcTitles = {simple:'Calculator',currency:'Currency Calculator',savings:'Savings Calculator',emi:'EMI Calculator'};
  const calcIcons = {simple:'⌗',currency:'⇄',savings:'＋',emi:'％'};
  let activeCalc = 'simple';
  let drag = null;
  let windowDrag = null;
  let isOpen = false;
  let isMinimized = false;
  let miniExpr = '';

  function readCalculatorData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }

  function saveCalculatorData() {
    const data = {
      activeCalc,
      miniExpr,
      currency: {
        amount: document.getElementById('floatingConvAmount')?.value ?? '',
        from: document.getElementById('floatingConvFrom')?.value ?? '',
        to: document.getElementById('floatingConvTo')?.value ?? ''
      },
      savings: {
        monthly: document.getElementById('floatingSavMonthly')?.value ?? '',
        months: document.getElementById('floatingSavMonths')?.value ?? '',
        rate: document.getElementById('floatingSavRate')?.value ?? ''
      },
      emi: {
        principal: document.getElementById('floatingEmiPrincipal')?.value ?? '',
        rate: document.getElementById('floatingEmiRate')?.value ?? '',
        months: document.getElementById('floatingEmiMonths')?.value ?? ''
      }
    };
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (_) {}
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  function triggerBounds() {
    const rect = btn.getBoundingClientRect();
    return {
      maxX: Math.max(EDGE_GAP, window.innerWidth - rect.width - EDGE_GAP),
      maxY: Math.max(EDGE_GAP, window.innerHeight - rect.height - EDGE_GAP),
    };
  }

  function placeTrigger(x, y, persist = false) {
    const bounds = triggerBounds();
    const left = clamp(Number(x) || 0, EDGE_GAP, bounds.maxX);
    const top = clamp(Number(y) || 0, EDGE_GAP, bounds.maxY);
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: left, y: top })); } catch (_) {}
    }
  }

  function restoreTrigger() {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || LEGACY_KEYS.map(k => localStorage.getItem(k)).find(Boolean) || 'null';
      saved = JSON.parse(raw);
    } catch (_) {}
    if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
      requestAnimationFrame(() => placeTrigger(saved.x, saved.y, false));
    }
  }

  function windowBounds() {
    const rect = win.getBoundingClientRect();
    return {
      maxX: Math.max(EDGE_GAP, window.innerWidth - rect.width - EDGE_GAP),
      maxY: Math.max(EDGE_GAP, window.innerHeight - rect.height - EDGE_GAP),
    };
  }

  function placeWindow(x, y, persist = false) {
    const bounds = windowBounds();
    const left = clamp(Number(x) || 0, EDGE_GAP, bounds.maxX);
    const top = clamp(Number(y) || 0, EDGE_GAP, bounds.maxY);
    win.style.left = `${left}px`;
    win.style.top = `${top}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    if (persist) {
      try { localStorage.setItem(WINDOW_KEY, JSON.stringify({ x: left, y: top })); } catch (_) {}
    }
  }

  function centerWindow() {
    requestAnimationFrame(() => {
      const rect = win.getBoundingClientRect();
      placeWindow((window.innerWidth - rect.width) / 2, Math.max(18, (window.innerHeight - rect.height) / 2), false);
    });
  }

  function restoreWindow() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WINDOW_KEY) || 'null'); } catch (_) {}
    requestAnimationFrame(() => {
      if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) placeWindow(saved.x, saved.y, false);
      else centerWindow();
    });
  }

  function setView(name) {
    if (!calcOrder.includes(name)) name = 'simple';
    activeCalc = name;
    document.querySelectorAll('.floating-calc-view-v84').forEach(view => {
      const active = view.dataset.floatingCalc === name;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    title.textContent = calcTitles[name];
    counter.textContent = `${calcOrder.indexOf(name) + 1} / ${calcOrder.length}`;
    const icon = win.querySelector('.floating-calc-app-icon-v84');
    if (icon) icon.textContent = calcIcons[name];
    isMinimized = false;
    win.classList.remove('is-minimized-v84');
    body.hidden = false;
    minBtn?.setAttribute('aria-label','Minimize calculator');
    saveCalculatorData();
    requestAnimationFrame(() => {
      const rect = win.getBoundingClientRect();
      placeWindow(rect.left, rect.top, false);
    });
  }

  function openWindow() {
    if (!isOpen) {
      isOpen = true;
      win.hidden = false;
      win.setAttribute('aria-hidden','false');
      btn.setAttribute('aria-expanded','true');
      restoreWindow();
    }
    if (isMinimized) {
      isMinimized = false;
      win.classList.remove('is-minimized-v84');
      body.hidden = false;
    }
    setView(activeCalc);
  }

  function closeWindow() {
    saveCalculatorData();
    isOpen = false;
    isMinimized = false;
    win.hidden = true;
    win.setAttribute('aria-hidden','true');
    btn.setAttribute('aria-expanded','false');
    win.classList.remove('is-minimized-v84');
    body.hidden = false;
  }

  function toggleMinimize() {
    if (!isOpen) return;
    isMinimized = !isMinimized;
    win.classList.toggle('is-minimized-v84', isMinimized);
    body.hidden = isMinimized;
    if (minBtn) minBtn.setAttribute('aria-label', isMinimized ? 'Restore calculator' : 'Minimize calculator');
    requestAnimationFrame(() => {
      const rect = win.getBoundingClientRect();
      placeWindow(rect.left, rect.top, true);
    });
  }

  // Compact simple calculator — includes All Clear and one-character Backspace.
  const miniDisplay = document.getElementById('floatingCalcDisplay');
  const miniKeys = document.getElementById('floatingCalcKeys');
  const simpleKeys = ['C','⌫','÷','×','7','8','9','−','4','5','6','+','1','2','3','=','0','.'];
  function renderMiniDisplay() { if (miniDisplay) miniDisplay.textContent = miniExpr || '0'; }
  function pressMiniKey(k) {
    if (k === 'C') miniExpr = '';
    else if (k === '⌫') miniExpr = miniExpr === 'Error' ? '' : miniExpr.slice(0,-1);
    else if (k === '=') {
      try {
        const safe = miniExpr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
        if (!safe || !/^[0-9.+\-*/() ]+$/.test(safe)) throw new Error('invalid');
        const result = Function(`"use strict"; return (${safe})`)();
        if (!Number.isFinite(result)) throw new Error('non-finite');
        miniExpr = String(Math.round(result * 1e6) / 1e6);
      } catch (_) { miniExpr = 'Error'; }
    } else miniExpr = miniExpr === 'Error' ? k : miniExpr + k;
    saveCalculatorData();
    renderMiniDisplay();
  }
  if (miniKeys) {
    miniKeys.innerHTML = simpleKeys.map(k => `<button type="button" data-floating-key="${k}" class="${['÷','×','−','+'].includes(k)?'op-v84':k==='='?'eq-v84':k==='C'?'clear-v84':k==='⌫'?'erase-v84':''}" aria-label="${k==='C'?'All clear':k==='⌫'?'Backspace':k}">${k}</button>`).join('');
    miniKeys.querySelectorAll('button').forEach(k => k.addEventListener('click', () => pressMiniKey(k.dataset.floatingKey)));
  }

  // Currency mini calculator, synced to the account pair.
  const fAmount = document.getElementById('floatingConvAmount');
  const fFrom = document.getElementById('floatingConvFrom');
  const fTo = document.getElementById('floatingConvTo');
  const fSwap = document.getElementById('floatingConvSwap');
  const fResult = document.getElementById('floatingConvResult');
  function syncFloatingPair() {
    if (!fFrom || !fTo) return;
    const pair = [state.primaryCurrency, state.secondaryCurrency];
    const oldFrom = fFrom.value, oldTo = fTo.value;
    fFrom.innerHTML = pair.map(c => `<option value="${c}">${c}</option>`).join('');
    fTo.innerHTML = pair.map(c => `<option value="${c}">${c}</option>`).join('');
    fFrom.value = pair.includes(oldFrom) ? oldFrom : pair[0];
    fTo.value = pair.includes(oldTo) && oldTo !== fFrom.value ? oldTo : pair[1];
  }
  function runFloatingConv() {
    syncFloatingPair();
    const amt = Math.max(0, parseFloat(fAmount?.value) || 0);
    if (!fFrom || !fTo || !fResult) return;
    const result = fFrom.value === fTo.value ? amt : fromAED(toAED(amt, fFrom.value), fTo.value);
    fResult.textContent = Number.isFinite(result)
      ? `${currencySymbol(fFrom.value)} ${amt.toLocaleString(undefined,{maximumFractionDigits:2})} = ${currencySymbol(fTo.value)} ${result.toLocaleString(undefined,{maximumFractionDigits:2})}`
      : 'Exchange rate unavailable';
    saveCalculatorData();
  }
  [fAmount,fFrom,fTo].filter(Boolean).forEach(el => el.addEventListener('input', runFloatingConv));
  fSwap?.addEventListener('click', () => {
    const value = fFrom.value; fFrom.value = fTo.value; fTo.value = value;
    fSwap.classList.remove('swap-v84'); void fSwap.offsetWidth; fSwap.classList.add('swap-v84');
    runFloatingConv();
  });

  // Savings mini calculator.
  const fsMonthly = document.getElementById('floatingSavMonthly');
  const fsMonths = document.getElementById('floatingSavMonths');
  const fsRate = document.getElementById('floatingSavRate');
  const fsResult = document.getElementById('floatingSavResult');
  function runFloatingSavings() {
    const monthly = Math.max(0, parseFloat(fsMonthly?.value) || 0);
    const months = Math.max(0, parseInt(fsMonths?.value,10) || 0);
    const monthlyRate = Math.max(0, parseFloat(fsRate?.value) || 0) / 100 / 12;
    let total = 0;
    for (let i=0;i<months;i++){ total += monthly; total += total * monthlyRate; }
    if (fsResult) fsResult.textContent = `Projected Total: ${fmt(total)}`;
    saveCalculatorData();
  }
  [fsMonthly,fsMonths,fsRate].filter(Boolean).forEach(el => el.addEventListener('input', runFloatingSavings));

  // EMI mini calculator.
  const feP = document.getElementById('floatingEmiPrincipal');
  const feR = document.getElementById('floatingEmiRate');
  const feN = document.getElementById('floatingEmiMonths');
  const feResult = document.getElementById('floatingEmiResult');
  function runFloatingEmi() {
    const p = Math.max(0, parseFloat(feP?.value) || 0);
    const annual = Math.max(0, parseFloat(feR?.value) || 0);
    const n = Math.max(1, parseInt(feN?.value,10) || 1);
    const r = annual / 100 / 12;
    const emi = r === 0 ? p / n : (p*r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1);
    const total = emi*n;
    if (!feResult) return;
    feResult.textContent = Number.isFinite(emi) && Number.isFinite(total)
      ? `Monthly EMI: ${fmt(emi)}  ·  Total: ${fmt(total)}` : 'Enter valid loan values';
    saveCalculatorData();
  }
  [feP,feR,feN].filter(Boolean).forEach(el => el.addEventListener('input', runFloatingEmi));

  nextBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const idx = calcOrder.indexOf(activeCalc);
    setView(calcOrder[(idx + 1) % calcOrder.length]);
    if (activeCalc === 'currency') runFloatingConv();
    if (activeCalc === 'savings') runFloatingSavings();
    if (activeCalc === 'emi') runFloatingEmi();
  });
  minBtn?.addEventListener('click', e => { e.stopPropagation(); toggleMinimize(); });
  closeBtn?.addEventListener('click', e => { e.stopPropagation(); closeWindow(); });

  // Floating trigger drag; a tap opens/restores the compact window.
  btn.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = btn.getBoundingClientRect();
    drag = {id:event.pointerId,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,startX:event.clientX,startY:event.clientY,moved:false};
    btn.setPointerCapture?.(event.pointerId);
    btn.classList.add('is-dragging');
    event.preventDefault();
  });
  btn.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>5) drag.moved=true;
    if (!drag.moved) return;
    placeTrigger(event.clientX-drag.offsetX,event.clientY-drag.offsetY,false);
    event.preventDefault();
  });
  const finishTriggerDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = drag.moved; const rect = btn.getBoundingClientRect();
    try { btn.releasePointerCapture?.(event.pointerId); } catch (_) {}
    drag=null; btn.classList.remove('is-dragging');
    if (moved) placeTrigger(rect.left,rect.top,true); else openWindow();
    event.preventDefault();
  };
  btn.addEventListener('pointerup', finishTriggerDrag);
  btn.addEventListener('pointercancel', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect=btn.getBoundingClientRect(); drag=null; btn.classList.remove('is-dragging'); placeTrigger(rect.left,rect.top,true);
  });
  btn.addEventListener('keydown', event => {
    if (event.key==='Enter' || event.key===' '){ event.preventDefault(); openWindow(); }
    else if (event.key==='Escape') closeWindow();
  });

  // Calculator window itself can be moved by its title bar.
  header.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    if (event.button !== undefined && event.button !== 0) return;
    const rect=win.getBoundingClientRect();
    windowDrag={id:event.pointerId,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top};
    header.setPointerCapture?.(event.pointerId);
    win.classList.add('is-window-dragging-v84');
    event.preventDefault();
  });
  header.addEventListener('pointermove', event => {
    if (!windowDrag || windowDrag.id !== event.pointerId) return;
    placeWindow(event.clientX-windowDrag.offsetX,event.clientY-windowDrag.offsetY,false);
    event.preventDefault();
  });
  const finishWindowDrag = event => {
    if (!windowDrag || windowDrag.id !== event.pointerId) return;
    const rect=win.getBoundingClientRect();
    try { header.releasePointerCapture?.(event.pointerId); } catch (_) {}
    windowDrag=null; win.classList.remove('is-window-dragging-v84'); placeWindow(rect.left,rect.top,true);
  };
  header.addEventListener('pointerup', finishWindowDrag);
  header.addEventListener('pointercancel', finishWindowDrag);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen) closeWindow();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(() => {
      const b=btn.getBoundingClientRect(); if (btn.style.left || btn.style.top) placeTrigger(b.left,b.top,true);
      if (isOpen) { const r=win.getBoundingClientRect(); placeWindow(r.left,r.top,true); }
    },120);
  });

  // V85: restore every calculator's working data. Closing or switching calculators never clears it.
  const savedCalcData = readCalculatorData();
  if (typeof savedCalcData.miniExpr === 'string') miniExpr = savedCalcData.miniExpr;

  if (fAmount && savedCalcData.currency && savedCalcData.currency.amount !== undefined) fAmount.value = savedCalcData.currency.amount;
  if (fsMonthly && savedCalcData.savings && savedCalcData.savings.monthly !== undefined) fsMonthly.value = savedCalcData.savings.monthly;
  if (fsMonths && savedCalcData.savings && savedCalcData.savings.months !== undefined) fsMonths.value = savedCalcData.savings.months;
  if (fsRate && savedCalcData.savings && savedCalcData.savings.rate !== undefined) fsRate.value = savedCalcData.savings.rate;
  if (feP && savedCalcData.emi && savedCalcData.emi.principal !== undefined) feP.value = savedCalcData.emi.principal;
  if (feR && savedCalcData.emi && savedCalcData.emi.rate !== undefined) feR.value = savedCalcData.emi.rate;
  if (feN && savedCalcData.emi && savedCalcData.emi.months !== undefined) feN.value = savedCalcData.emi.months;

  restoreTrigger();
  syncFloatingPair();
  if (savedCalcData.currency) {
    if (fFrom && [state.primaryCurrency,state.secondaryCurrency].includes(savedCalcData.currency.from)) fFrom.value = savedCalcData.currency.from;
    if (fTo && [state.primaryCurrency,state.secondaryCurrency].includes(savedCalcData.currency.to)) fTo.value = savedCalcData.currency.to;
    if (fFrom && fTo && fFrom.value === fTo.value) fTo.value = fFrom.value === state.primaryCurrency ? state.secondaryCurrency : state.primaryCurrency;
  }
  runFloatingConv();
  runFloatingSavings();
  runFloatingEmi();
  renderMiniDisplay();
  saveCalculatorData();
}
/* ==========================================================================
   SETTINGS
   ========================================================================== */
function setupSettingsPage() {
  document.querySelectorAll('#settingsVisualThemeSwitch [data-visual-theme]').forEach(btn => {
    btn.addEventListener('click', () => setVisualTheme(btn.dataset.visualTheme));
  });
  document.querySelectorAll('#settingsThemeSwitch button').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });
  document.querySelectorAll('#settingsCurrencySwitch button').forEach(btn => {
    btn.addEventListener('click', () => setCurrency(btn.dataset.currency));
  });

  // Branding, splash-video and dashboard-wallpaper controls were intentionally removed.

  const salaryDateForm = document.getElementById('salaryDateForm');
  if (salaryDateForm) salaryDateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('salaryCreditDay');
    const msg = document.getElementById('salaryDateMsg');
    const day = parseInt(input.value, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      msg.textContent = 'Choose a day from 1 to 31.';
      msg.style.display = 'block';
      return;
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salary_credit_day: day })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not save salary date');
      state.salaryCreditDay = day;
      msg.style.display = 'none';
      renderSalaryCountdown();
      checkSalaryNotification();
      toast(`Salary date saved: ${ordinalDay(day)} of each month`, 'success');
    } catch (err) {
      msg.textContent = err.message || 'Could not save salary date';
      msg.style.display = 'block';
    }
  });

  document.getElementById('btnBackup').addEventListener('click', async () => {
    const ok = typeof window.prepareYarinSuiteServerAction === 'function' ? await window.prepareYarinSuiteServerAction({flush:true}) : true;
    if (!ok) return toast('Could not sync the latest finance-suite changes. Backup was not started.', 'error');
    window.location.href='/api/export';
  });
  document.getElementById('btnExport').addEventListener('click', async () => {
    const ok = typeof window.prepareYarinSuiteServerAction === 'function' ? await window.prepareYarinSuiteServerAction({flush:true}) : true;
    if (!ok) return toast('Could not sync the latest finance-suite changes. Export was not started.', 'error');
    window.location.href='/api/export';
  });

  document.getElementById('restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Import this backup into your account? Existing records are kept.')) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      if (typeof window.prepareYarinSuiteServerAction === 'function') await window.prepareYarinSuiteServerAction({flush:false});
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) { toast('Account backup imported', 'success'); if (typeof window.reloadYarinFinanceSuite === 'function') await window.reloadYarinFinanceSuite(true); else window.dispatchEvent(new CustomEvent('yarin-suite-refresh', {detail:{forceRemote:true}})); await loadDashboard(); }
      else { if (typeof window.resumeYarinFinanceSuite === 'function') window.resumeYarinFinanceSuite(); toast(data.error || 'Restore failed', 'error'); }
    } catch (err) { if (typeof window.resumeYarinFinanceSuite === 'function') window.resumeYarinFinanceSuite(); toast('Restore failed', 'error'); }
    e.target.value = '';
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      if (typeof window.prepareYarinSuiteServerAction === 'function') await window.prepareYarinSuiteServerAction({flush:false});
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        toast('Data imported successfully', 'success');
        if (typeof window.reloadYarinFinanceSuite === 'function') await window.reloadYarinFinanceSuite(true);
        else window.dispatchEvent(new CustomEvent('yarin-suite-refresh', {detail:{forceRemote:true}}));
        await loadDashboard();
      } else {
        if (typeof window.resumeYarinFinanceSuite === 'function') window.resumeYarinFinanceSuite();
        toast(data.error || 'Import failed', 'error');
      }
    } catch (err) { if (typeof window.resumeYarinFinanceSuite === 'function') window.resumeYarinFinanceSuite(); toast('Import failed', 'error'); }
  });

  document.getElementById('btnClearAll').addEventListener('click', async () => {
    const confirmText = prompt('This will permanently delete ALL financial data. Type DELETE to confirm:');
    if (confirmText !== 'DELETE') return;
    try {
      if (typeof window.prepareYarinSuiteServerAction === 'function') await window.prepareYarinSuiteServerAction({flush:false});
      const res = await fetch('/api/clear-all-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' })
      });
      const data = await res.json();
      if (data.success) {
        if (typeof window.clearYarinLocalFinanceSuite === 'function') await window.clearYarinLocalFinanceSuite();
        state.tables = {}; state.editing = {}; state.salaryPlan = null; state.shoppingBudget = 0; state.lastSalaryAED = 0;
        updateShoppingBudgetUI(0);
        toast('All data cleared', 'success');
        await loadDashboard();
      } else {
        if (typeof window.resumeYarinFinanceSuite === 'function') window.resumeYarinFinanceSuite();
        toast(data.error || 'Could not clear data', 'error');
      }
    } catch (e) { if (typeof window.resumeYarinFinanceSuite === 'function') window.resumeYarinFinanceSuite(); toast('Could not clear data', 'error'); }
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
function legacy_updateDualHint(inputId) {
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

function legacy_setEntryCurrency(inputId, cur) {
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

function legacy_wireDualCurrencyToggle(inputId) {
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
  if (dateInput && !dateInput.value) dateInput.value = localDateISO();
  if (timeInput && !timeInput.value) timeInput.value = new Date().toTimeString().slice(0, 5);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const recordId = document.getElementById(`${table}-payment-record-id`).value;
    if (!recordId) {
      toast('Pick a saved EMI/Debt from the suggestions first', 'error');
      return;
    }

    const amountEl = document.getElementById(`${table}-payment-amount`);
    const entryCur = amountEl.dataset.entryCur || state.currency;
    const typed = Number(amountEl.value) || 0;
    if (typed <= 0) { toast('Enter a payment amount', 'error'); return; }
    if (!hasCurrencyRate(entryCur)) { toast(`Exchange rate unavailable for ${entryCur}. Refresh rates before saving.`, 'error'); return; }
    const amountAED = toAED(typed, entryCur);
    if (!Number.isFinite(amountAED)) { toast('Could not convert payment safely', 'error'); return; }

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
  setEntryCurrency(`${table}-payment-amount`, state.currency);

  const dateInput = document.getElementById(`${table}-payment-date`);
  const timeInput = document.getElementById(`${table}-payment-time`);
  if (dateInput) dateInput.value = localDateISO();
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


/* ========================================================================
   YARIN V22 — Final hardening: safe FX, persistence, UI reliability
   ======================================================================== */
function currencySymbol(code) { return CURRENCY_SYMBOL[code] || code; }
function hasCurrencyRate(code) {
  code = String(code || 'AED').toUpperCase();
  if (code === 'AED') return true;
  const rate = Number(state.aedRates?.[code]);
  return Number.isFinite(rate) && rate > 0;
}
function rateFromAED(code) {
  code = String(code || 'AED').toUpperCase();
  if (code === 'AED') return 1;
  const rate = Number(state.aedRates?.[code]);
  if (Number.isFinite(rate) && rate > 0) return rate;
  // Never silently treat a foreign currency as 1 AED. Returning NaN makes
  // callers fail closed instead of corrupting stored financial amounts.
  return NaN;
}
function fromAED(amountAED, code = state.currency) {
  const rate = rateFromAED(code);
  return Number.isFinite(rate) ? (Number(amountAED) || 0) * rate : NaN;
}
function toAED(amount, code = state.currency) {
  const rate = rateFromAED(code);
  return Number.isFinite(rate) && rate > 0 ? (Number(amount) || 0) / rate : NaN;
}
function currencyPairRate(base = state.primaryCurrency, quote = state.secondaryCurrency) {
  const b = rateFromAED(base), q = rateFromAED(quote);
  return Number.isFinite(b) && b > 0 && Number.isFinite(q) && q > 0 ? q / b : NaN;
}

function syncDashboardMarketPeek(rateOverride) {
  const pairEl = document.getElementById('dashboardFxPair');
  const rateEl = document.getElementById('dashboardFxRate');
  const captionEl = document.getElementById('dashboardFxCaption');
  const base = state.primaryCurrency || 'AED';
  const quote = state.secondaryCurrency || 'INR';
  const rate = Number.isFinite(Number(rateOverride)) ? Number(rateOverride) : currencyPairRate(base, quote);
  if (pairEl) pairEl.textContent = `${base} → ${quote}`;
  if (rateEl) {
    const next = Number.isFinite(rate)
      ? `1 ${base} = ${currencySymbol(quote)} ${rate.toLocaleString(undefined,{maximumFractionDigits:5})}`
      : `1 ${base} = ${currencySymbol(quote)} —`;
    if (rateEl.textContent !== next) {
      rateEl.textContent = next;
      rateEl.classList.remove('v99-rate-pop');
      void rateEl.offsetWidth;
      rateEl.classList.add('v99-rate-pop');
    }
  }
  if (captionEl) captionEl.textContent = Number.isFinite(rate)
    ? 'Reference rate • auto-updating'
    : 'Reference rate temporarily unavailable';
}
function otherCurrency(code = state.currency) {
  return code === state.primaryCurrency ? state.secondaryCurrency : state.primaryCurrency;
}

function syncCurrencyPairUI() {
  const pair = [state.primaryCurrency, state.secondaryCurrency];
  updateSalaryCurrencyFlag(state.currency);
  const switchEl = document.getElementById('currencySwitch');
  if (switchEl) {
    const buttons = [...switchEl.querySelectorAll('.cur-opt')];
    buttons.slice(0,2).forEach((btn, i) => {
      const code = pair[i];
      const flag = countryFlagEmoji(CURRENCY_FLAG_COUNTRY[code]);
      btn.dataset.currency = code;
      btn.replaceChildren();
      if (flag) {
        const flagSpan = document.createElement('span');
        flagSpan.className = 'v101-cur-flag';
        flagSpan.setAttribute('aria-hidden', 'true');
        flagSpan.textContent = flag;
        btn.appendChild(flagSpan);
      }
      const codeSpan = document.createElement('span');
      codeSpan.textContent = code;
      btn.appendChild(codeSpan);
      btn.classList.toggle('active', state.currency === code);
    });
  }
  const pairLabel = document.getElementById('exchangePairLabel');
  if (pairLabel) pairLabel.textContent = `${state.primaryCurrency} → ${state.secondaryCurrency}`;
  syncDashboardMarketPeek();
  const title = document.getElementById('fxTitle');
  if (title) title.textContent = `${state.primaryCurrency} / ${state.secondaryCurrency} Exchange Trend`;
  const curLabel = document.getElementById('fxCurrentLabel');
  if (curLabel) curLabel.textContent = `1 ${state.primaryCurrency}`;
  const calcTitle = document.getElementById('currencyCalcTitle');
  if (calcTitle) calcTitle.textContent = `${state.primaryCurrency} ↔ ${state.secondaryCurrency} Calculator`;
  const fromSel = document.getElementById('convFrom'), toSel = document.getElementById('convTo');
  [fromSel, toSel].forEach(sel => {
    if (!sel) return;
    const old = sel.value;
    sel.innerHTML = pair.map(c => `<option value="${c}">${c}</option>`).join('');
    sel.value = pair.includes(old) ? old : (sel === fromSel ? pair[0] : pair[1]);
  });
  const floatingFrom = document.getElementById('floatingConvFrom'), floatingTo = document.getElementById('floatingConvTo');
  [floatingFrom, floatingTo].forEach(sel => {
    if (!sel) return;
    const old = sel.value;
    sel.innerHTML = pair.map(c => `<option value="${c}">${c}</option>`).join('');
    sel.value = pair.includes(old) ? old : (sel === floatingFrom ? pair[0] : pair[1]);
  });
  if (floatingFrom && floatingTo && floatingFrom.value === floatingTo.value) floatingTo.value = pair[1];
  document.getElementById('floatingConvAmount')?.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelectorAll('.dual-currency-toggle').forEach(toggle => {
    const buttons=[...toggle.querySelectorAll('.dc-btn')];
    buttons.slice(0,2).forEach((btn,i)=>{ btn.dataset.cur=pair[i]; btn.textContent=pair[i]; });
  });
  document.querySelectorAll('[data-entry-cur]').forEach(el => {
    if (!pair.includes(el.dataset.entryCur)) el.dataset.entryCur = pair[0];
  });
  const pSel=document.getElementById('primaryCurrencySelect'), sSel=document.getElementById('secondaryCurrencySelect');
  if (pSel && [...pSel.options].some(o=>o.value===pair[0])) pSel.value=pair[0];
  if (sSel && [...sSel.options].some(o=>o.value===pair[1])) sSel.value=pair[1];
}

async function setCurrency(cur) {
  cur = String(cur || '').toUpperCase();
  if (![state.primaryCurrency, state.secondaryCurrency].includes(cur)) cur = state.primaryCurrency;
  if (!hasCurrencyRate(cur)) { toast(`Exchange rate unavailable for ${cur}. Refresh rates first.`, 'error'); return; }
  const previous = state.currency;
  state.currency = cur;
  localStorage.setItem('azret_currency', cur);
  applyCurrency(cur, true);
  try {
    const res = await fetch('/api/settings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({default_currency:cur})});
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not save currency');
  } catch (e) {
    state.currency = previous;
    localStorage.setItem('azret_currency', previous);
    applyCurrency(previous, true);
    toast(e.message || 'Could not save currency selection', 'error');
  }
}

function applyCurrency(cur, rerender) {
  state.currency = String(cur || state.primaryCurrency).toUpperCase();
  syncCurrencyPairUI();
  document.querySelectorAll('.cur-opt[data-currency]').forEach(b => b.classList.toggle('active', b.dataset.currency === state.currency));
  document.querySelectorAll('.cur-unit').forEach(el => { el.textContent = state.currency; });
  if (rerender) {
    rerenderAllVisible();
    Object.keys(state.editing).forEach(convertVisibleAmountInputs);
    updateAllAmountHints();
    updateShoppingBudgetUI((state.tables.shopping || []).reduce((a,r)=>a+(Number(r.total)||0),0));
    if (typeof window.refreshYarinFinanceSuite === 'function') window.refreshYarinFinanceSuite();
  }
}

function safeConvertedInputValue(amountAED, currency) {
  const converted=fromAED(Number(amountAED)||0,currency);
  return Number.isFinite(converted) ? String(round2(converted)) : '';
}
function convertVisibleAmountInputs(table) {
  const id=state.editing[table]; if(!id) return;
  const row=(state.tables[table]||[]).find(r=>String(r.id)===String(id)); if(!row) return;
  (AMOUNT_FIELDS[table]||[]).forEach(f=>{
    const el=document.getElementById(`${table}-${f}`); if(!el)return;
    const value=safeConvertedInputValue(row[f],state.currency);
    el.value=value;
    if(!value && (Number(row[f])||0)!==0) el.placeholder='Exchange rate unavailable';
  });
}
function rerenderAllVisible() {
  if(state.dashboard) renderDashboard(state.dashboard);
  Object.keys(state.tables).forEach(t=>renderTable(t,state.tables[t]));
  if(state.salaryPlan) renderSalaryPlan(state.salaryPlan);
  const sal=document.getElementById('salaryplan-amount'); if(sal&&state.lastSalaryAED){sal.value=safeConvertedInputValue(state.lastSalaryAED,state.currency);if(!sal.value)sal.placeholder='Exchange rate unavailable';}
}
function fmt(amountAED) {
  const v=fromAED(amountAED,state.currency);
  if (!Number.isFinite(v)) return `${state.currency} —`;
  const value=v.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:0});
  const sym=currencySymbol(state.currency);
  return ['₹','$','€','£','¥','₩','₽','₺'].includes(sym) ? `${sym}${value}` : `${sym} ${value}`;
}

async function fetchAEDRate(code) {
  code=String(code||'AED').toUpperCase(); if(code==='AED') return 1;
  const res=await fetch(`/api/fx/rate?base=AED&quote=${encodeURIComponent(code)}`,{cache:'no-store'});
  if(!res.ok) throw new Error('rate unavailable');
  const data=await res.json(); const r=Number(data.rate); if(!Number.isFinite(r)||r<=0) throw new Error('invalid rate');
  if(data.date) state.fxRateDates[code]=String(data.date);
  return r;
}
async function refreshCurrencyRates() {
  const codes=[...new Set([state.primaryCurrency,state.secondaryCurrency,'INR'])];
  const results=await Promise.allSettled(codes.map(async c=>[c,await fetchAEDRate(c)]));
  results.forEach(x=>{ if(x.status==='fulfilled'){ const [c,r]=x.value; state.aedRates[c]=r; if(c==='INR'){state.exchangeRate=r;} } });
  const required=[state.primaryCurrency,state.secondaryCurrency].filter(c=>c!=='AED');
  const missing=required.filter(c=>!(Number.isFinite(Number(state.aedRates[c]))&&Number(state.aedRates[c])>0));
  if(missing.length) throw new Error(`Missing exchange rate for ${missing.join(', ')}`);
}

async function loadServerSettings() {
  try {
    const res=await fetch('/api/settings',{cache:'no-store'}); const cfg=await res.json();
    if(cfg.theme){state.theme=cfg.theme;applyTheme(cfg.theme,false);}
    state.primaryCurrency=String(cfg.primary_currency||'AED').toUpperCase();
    state.secondaryCurrency=String(cfg.secondary_currency||'INR').toUpperCase();
    if(state.primaryCurrency===state.secondaryCurrency) state.secondaryCurrency=state.primaryCurrency==='INR'?'AED':'INR';
    state.currency=[state.primaryCurrency,state.secondaryCurrency].includes(String(cfg.default_currency||'').toUpperCase())?String(cfg.default_currency).toUpperCase():state.primaryCurrency;
    localStorage.setItem('rizq_primary_currency',state.primaryCurrency); localStorage.setItem('rizq_secondary_currency',state.secondaryCurrency); localStorage.setItem('azret_currency',state.currency);
    // Browser localStorage is intentionally not a source of truth for rates.
    // Server-persisted last-known FX rates make conversions safe on a new
    // device even if the external reference service is temporarily offline.
    Object.entries(cfg).forEach(([k,v])=>{
      const m=/^fx_rate_([A-Z]{3})$/.exec(k);
      if(m){const n=Number(v);if(Number.isFinite(n)&&n>0)state.aedRates[m[1]]=n;}
    });
    if(cfg.shopping_budget) state.shoppingBudget=Number(cfg.shopping_budget)||0;
    if(cfg.last_salary_amount) state.lastSalaryAED=Number(cfg.last_salary_amount)||0;
    if(cfg.salary_credit_day){const d=parseInt(cfg.salary_credit_day,10);if(d>=1&&d<=31)state.salaryCreditDay=d;}
    syncCurrencyPairUI(); applyCurrency(state.currency,false);
    const sd=document.getElementById('salaryCreditDay'); if(sd) sd.value=String(state.salaryCreditDay);
    renderSalaryCountdown();
    try {
      await refreshCurrencyRates();
    } catch (e) {
      const missing=[state.primaryCurrency,state.secondaryCurrency].filter(c=>!hasCurrencyRate(c));
      if (missing.length && [state.primaryCurrency,state.secondaryCurrency].includes('AED')) {
        state.currency='AED';
        localStorage.setItem('azret_currency','AED');
        toast(`Exchange rate unavailable for ${missing.join(', ')} — showing AED until rates refresh.`, 'error');
      } else if (missing.length) {
        toast(`Exchange rates unavailable for ${missing.join(', ')}. Saving converted amounts is disabled until rates refresh.`, 'error');
      }
    }
    applyCurrency(state.currency,true);
    updateShoppingBudgetUI((state.tables.shopping||[]).reduce((a,r)=>a+(Number(r.total)||0),0));
  } catch(e) { console.warn('Settings load failed',e); }
}

async function refreshExchangeRate(silent=false) {
  const btn=document.getElementById('refreshRate'); if(btn) btn.classList.add('loading');
  try {
    await refreshCurrencyRates();
    state.fxLastRefreshAt=Date.now();
    const rate=currencyPairRate();
    syncDashboardMarketPeek(rate);
    const rateEl=document.getElementById('rateValue');
    if(rateEl) rateEl.textContent=Number.isFinite(rate)?`1 ${state.primaryCurrency} = ${currencySymbol(state.secondaryCurrency)} ${rate.toLocaleString(undefined,{maximumFractionDigits:4})}`:'Exchange rate unavailable';
    if(!silent) toast('Exchange reference rate updated','success');
    await refreshFxChart(state.fxRange||'1M');
  } catch(e) { if(!silent) toast('Rate service unavailable — using last known values','error'); }
  finally { if(btn) btn.classList.remove('loading'); rerenderAllVisible(); }
}

function updateAmountHint(table,field) {
  const el=document.getElementById(`${table}-${field}`),tag=document.getElementById(`${table}-${field}-tag`),value=document.getElementById(`${table}-${field}-value`),box=document.getElementById(`${table}-${field}-box`); if(!el||!value)return;
  const typed=Number(el.value)||0, other=otherCurrency(state.currency); const converted=fromAED(toAED(typed,state.currency),other);
  if(tag) tag.textContent=`≈ ${other}`;
  const txt=Number.isFinite(converted)?converted.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}):'—';
  if(value.textContent!==txt){value.textContent=txt;if(box&&typed>0){box.classList.remove('pulse');void box.offsetWidth;box.classList.add('pulse');}}
}
function buildAutoNote(amountAED,dateVal,timeVal) {
  const other=otherCurrency(state.currency), otherVal=fromAED(amountAED,other),d=dateVal||localDateISO(),t=timeVal||new Date().toTimeString().slice(0,5);
  const otherText=Number.isFinite(otherVal)?round2(otherVal).toFixed(2):'unavailable';
  return `[Base: AED ${round2(amountAED).toFixed(2)} | ${other}: ${otherText} | ${d} ${t}]`;
}

function updateDualHint(inputId) {
  const el=document.getElementById(inputId),tag=document.getElementById(`${inputId}-tag`),value=document.getElementById(`${inputId}-value`),box=document.getElementById(`${inputId}-box`); if(!el||!value)return;
  const entry=el.dataset.entryCur||state.primaryCurrency, other=entry===state.primaryCurrency?state.secondaryCurrency:state.primaryCurrency, typed=Number(el.value)||0;
  const converted=fromAED(toAED(typed,entry),other); if(tag)tag.textContent=`≈ ${other}`;
  const txt=Number.isFinite(converted)?converted.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}):'—'; if(value.textContent!==txt){value.textContent=txt;if(box&&typed>0){box.classList.remove('pulse');void box.offsetWidth;box.classList.add('pulse');}}
}
function setEntryCurrency(inputId,cur) {
  const el=document.getElementById(inputId); if(!el)return; cur=String(cur||state.primaryCurrency).toUpperCase();
  if (![state.primaryCurrency, state.secondaryCurrency].includes(cur)) cur = state.currency || state.primaryCurrency;
  const old=[state.primaryCurrency, state.secondaryCurrency].includes(el.dataset.entryCur) ? el.dataset.entryCur : (state.currency || state.primaryCurrency); if(old!==cur){const typed=Number(el.value);if(Number.isFinite(typed)&&typed>0){const converted=fromAED(toAED(typed,old),cur);if(!Number.isFinite(converted)){toast(`Exchange rate unavailable for ${old} ⇄ ${cur}`,'error');return;}el.value=Number(converted.toFixed(2));}} el.dataset.entryCur=cur;
  const toggle=document.querySelector(`.dual-currency-toggle[data-field="${inputId}"]`); if(toggle)toggle.querySelectorAll('.dc-btn').forEach(b=>b.classList.toggle('active',b.dataset.cur===cur));
  const unit=document.getElementById(`${inputId}-unit`); if(unit)unit.textContent=cur; updateDualHint(inputId);
}
function wireDualCurrencyToggle(inputId) {
  const el=document.getElementById(inputId);if(!el)return; if(![state.primaryCurrency,state.secondaryCurrency].includes(el.dataset.entryCur))el.dataset.entryCur=state.primaryCurrency;
  el.addEventListener('input',()=>updateDualHint(inputId)); const toggle=document.querySelector(`.dual-currency-toggle[data-field="${inputId}"]`);
  if(toggle)toggle.querySelectorAll('.dc-btn').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();setEntryCurrency(inputId,btn.dataset.cur);}));
  const box=document.getElementById(`${inputId}-box`);if(box){box.style.cursor='pointer';box.onclick=()=>setEntryCurrency(inputId,(el.dataset.entryCur||state.primaryCurrency)===state.primaryCurrency?state.secondaryCurrency:state.primaryCurrency);} updateDualHint(inputId);
}

async function loadCurrencyCatalog() {
  const p=document.getElementById('primaryCurrencySelect'),q=document.getElementById('secondaryCurrencySelect'); if(!p||!q)return;
  try { const r=await fetch('/api/fx/currencies',{cache:'no-store'});const d=await r.json();const list=Array.isArray(d.currencies)?d.currencies:[]; if(!list.length)return;
    const html=list.map(x=>`<option value="${x.code}">${x.code} — ${escapeHtml(x.name||x.code)}</option>`).join('');p.innerHTML=html;q.innerHTML=html;
  } catch(_) {}
  if([...p.options].some(o=>o.value===state.primaryCurrency))p.value=state.primaryCurrency;
  if([...q.options].some(o=>o.value===state.secondaryCurrency))q.value=state.secondaryCurrency;
}
function setupCurrencyPairSettings() {
  const form=document.getElementById('currencyPairForm'),p=document.getElementById('primaryCurrencySelect'),q=document.getElementById('secondaryCurrencySelect'),swap=document.getElementById('currencyPairSwap'),msg=document.getElementById('currencyPairMsg');
  if(swap)swap.addEventListener('click',()=>{const t=p.value;p.value=q.value;q.value=t;});
  if(form)form.addEventListener('submit',async e=>{e.preventDefault();const a=p.value,b=q.value;if(!a||!b||a===b){if(msg){msg.textContent='Choose two different currencies.';msg.style.display='block';}return;}
    try{
      // Never save a new currency pair until both conversion rates are known.
      // Otherwise an outage could make a non-AED amount be treated as AED.
      const needed=[...new Set([a,b].filter(c=>c!=='AED'))];
      const fetched=await Promise.all(needed.map(async c=>[c,await fetchAEDRate(c)]));
      fetched.forEach(([c,r])=>{state.aedRates[c]=r;if(c==='INR'){state.exchangeRate=r;}});
      const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({primary_currency:a,secondary_currency:b,default_currency:a})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'Save failed');state.primaryCurrency=a;state.secondaryCurrency=b;state.currency=a;localStorage.setItem('rizq_primary_currency',a);localStorage.setItem('rizq_secondary_currency',b);localStorage.setItem('azret_currency',a);syncCurrencyPairUI();await refreshExchangeRate(true);applyCurrency(a,true);if(msg)msg.style.display='none';toast(`Currency pair saved: ${a} ⇄ ${b}`,'success');
    }catch(err){if(msg){msg.textContent=(err.message==='rate unavailable'?'Exchange rate is temporarily unavailable. Please try again.':(err.message||'Could not save currencies'));msg.style.display='block';}}});
}

function dateLabel(d){try{return new Date(d+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch(_){return d;}}
function drawFxChart(points) {
  const canvas=document.getElementById('fxChart');if(!canvas)return;const wrap=canvas.parentElement;const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(280,wrap.clientWidth),h=Math.max(180,wrap.clientHeight);canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  if(!points||points.length<2){ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text-muted')||'#718096';ctx.font='13px Manrope, sans-serif';ctx.fillText('Exchange history will appear when reference data is available.',18,h/2);return;}
  const pad={l:16,r:16,t:18,b:28},vals=points.map(p=>Number(p.rate)),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(max-min,Math.abs(max)*0.006,0.0001);
  const x=i=>pad.l+(i/(points.length-1))*(w-pad.l-pad.r),y=v=>pad.t+(1-(v-(min-span*.12))/(span*1.24))*(h-pad.t-pad.b);
  const css=getComputedStyle(document.documentElement),accent=(css.getPropertyValue('--gold-500')||'#d4af6a').trim(),blue=(css.getPropertyValue('--blue-400')||'#4c8dff').trim(),premium=state.visualTheme==='premium';
  ctx.strokeStyle='rgba(127,150,190,.16)';ctx.lineWidth=1;for(let i=0;i<4;i++){const yy=pad.t+i*(h-pad.t-pad.b)/3;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();}
  const grad=ctx.createLinearGradient(0,pad.t,0,h-pad.b);grad.addColorStop(0,premium?'rgba(255,138,22,.30)':'rgba(76,141,255,.28)');grad.addColorStop(1,premium?'rgba(255,138,22,0)':'rgba(76,141,255,0)');ctx.beginPath();points.forEach((p,i)=>{const xx=x(i),yy=y(Number(p.rate));i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.lineTo(x(points.length-1),h-pad.b);ctx.lineTo(x(0),h-pad.b);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();points.forEach((p,i)=>{const xx=x(i),yy=y(Number(p.rate));i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.strokeStyle=blue;ctx.lineWidth=2.6;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor=premium?'rgba(255,119,11,.30)':'rgba(76,141,255,.28)';ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;
  const last=points[points.length-1];ctx.beginPath();ctx.arc(x(points.length-1),y(Number(last.rate)),4.5,0,Math.PI*2);ctx.fillStyle=accent;ctx.fill();
  ctx.fillStyle=css.getPropertyValue('--text-muted')||'#718096';ctx.font='11px Manrope, sans-serif';ctx.fillText(dateLabel(points[0].date),pad.l,h-7);const end=dateLabel(last.date);ctx.fillText(end,w-pad.r-ctx.measureText(end).width,h-7);
  canvas._fx={points,x,y,w,h};
}
async function refreshFxChart(range='1M') {
  state.fxRange=range;document.querySelectorAll('#fxRange button').forEach(b=>b.classList.toggle('active',b.dataset.range===range));const status=document.getElementById('fxStatus');if(status)status.textContent='Updating reference market data…';
  try{const r=await fetch(`/api/fx/series?base=${state.primaryCurrency}&quote=${state.secondaryCurrency}&range=${range}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Exchange history unavailable');const pts=Array.isArray(d.points)?d.points:[];if(!pts.length)throw new Error('No exchange history available');drawFxChart(pts);const pair=currencyPairRate();syncDashboardMarketPeek(pair);const current=document.getElementById('fxCurrentRate');if(current)current.textContent=Number.isFinite(pair)?`${currencySymbol(state.secondaryCurrency)} ${pair.toLocaleString(undefined,{maximumFractionDigits:5})}`:'—';let change=0;if(pts.length>1){const first=Number(pts[0].rate),last=Number(pts[pts.length-1].rate);if(first)change=(last-first)/first*100;}const ch=document.getElementById('fxChange');if(ch){ch.textContent=`${change>=0?'+':''}${change.toFixed(2)}%`;ch.className=`fx-change ${change>0?'up':change<0?'down':''}`;}if(status)status.textContent='Latest central-bank reference trend';const upd=document.getElementById('fxUpdated');if(upd){const refDate=pts.length?pts[pts.length-1].date:'';const refreshed=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});upd.textContent=refDate?`Reference: ${refDate} • refreshed ${refreshed}`:`Refreshed ${refreshed}`;}}catch(e){drawFxChart([]);if(status)status.textContent='Reference history temporarily unavailable';const upd=document.getElementById('fxUpdated');if(upd)upd.textContent='Last update unavailable';}
}

function setupFxAutoRefresh(){
  if(setupFxAutoRefresh._started)return; setupFxAutoRefresh._started=true;
  let lastAttempt=0;
  const refreshIfNeeded=()=>{
    if(document.visibilityState==='hidden')return;
    const now=Date.now();
    if(now-lastAttempt<5*60*1000)return;
    if(state.fxLastRefreshAt && now-state.fxLastRefreshAt<10*60*1000)return;
    lastAttempt=now;
    refreshExchangeRate(true).catch(()=>{});
  };
  setupFxAutoRefresh._timer=setInterval(refreshIfNeeded,15*60*1000);
  window.addEventListener('focus',refreshIfNeeded);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshIfNeeded();});
}

function setupFxInteractions(){
  document.querySelectorAll('#fxRange button').forEach(b=>b.addEventListener('click',()=>refreshFxChart(b.dataset.range)));
  let lastWidth=window.innerWidth;
  window.addEventListener('resize',()=>{
    const width=window.innerWidth;
    // Mobile browser chrome/keyboard can fire resize repeatedly without a real
    // layout-width change. Avoid unnecessary network/chart work in that case.
    if(Math.abs(width-lastWidth)<16)return;
    lastWidth=width;
    clearTimeout(setupFxInteractions._t);
    setupFxInteractions._t=setTimeout(()=>{
      if(document.getElementById('page-dashboard')?.classList.contains('active')) refreshFxChart(state.fxRange);
    },450);
  });
}

function setupDashboardWallpaper() {
  const layer=document.getElementById('themeBgLayer');
  if(!layer)return;
  // Keep the dashboard background deterministic and local. Earlier builds fetched
  // a new third-party Picsum image every hour, which added network work, privacy
  // dependency and visible layout/paint churn on phones. The existing premium
  // gradient fallback preserves the intended glass look with zero network cost.
  layer.style.backgroundImage='';
  layer.classList.remove('live-wallpaper');
  layer.classList.add('active','live-wallpaper-fallback');
}

function setAzretAIState(mode) {
  const orb=document.getElementById('liveOrb'),caption=document.getElementById('azretStateCaption');if(orb)orb.dataset.aiState=mode;
  const labels={idle:'Idle • ready when you are',listening:'Listening…',thinking:'Thinking…',speaking:'Speaking…',greeting:'Hi 👋'};if(caption)caption.textContent=labels[mode]||mode;
}
const _v16UpdateLiveStatus=updateLiveStatus;
updateLiveStatus=function(text){_v16UpdateLiveStatus(text);const t=String(text||'').toLowerCase();if(t.includes('listening'))setAzretAIState('listening');else if(t.includes('thinking')||t.includes('connecting'))setAzretAIState('thinking');else if(t.includes('speaking'))setAzretAIState('speaking');else if(t.includes('connected'))setAzretAIState('greeting');else setAzretAIState('idle');};


document.addEventListener('DOMContentLoaded',()=>{setupDashboardWallpaper();setupCurrencyPairSettings();setupFxInteractions();loadCurrencyCatalog();setAzretAIState('idle');});

/* === YARIN V54 — Notification modal + Finance Suite === */
(() => {
  const LEGACY_KEY = 'yarin_v48_';
  const SUITE_SYNC_KEYS = ['calendar','networth','goals','bills','gold_savings','gold_goal','gold_targets','gold_country'];
  const SUITE_LOCAL_KEYS = ['gold_rate','gold_snapshots','gold_target','notification_read'];
  const SUITE_MAX_MONEY = 1e15;
  let suiteScope = 'account';
  let suiteReady = false;
  let suiteSyncTimer = null;
  let suitePushPromise = null;
  let suiteDirty = false;
  const scopedKey = k => `yarin_v48_u${suiteScope}_${k}`;
  const read = (k, fallback=[]) => { try { return JSON.parse(localStorage.getItem(scopedKey(k))) ?? fallback; } catch (_) { return fallback; } };
  const rawWrite = (k,v) => localStorage.setItem(scopedKey(k), JSON.stringify(v));
  const suiteFallback = k => k==='gold_goal' ? 10 : k==='gold_targets' ? {} : k==='gold_country' ? 'AE' : [];
  const suiteSnapshot = () => Object.fromEntries(SUITE_SYNC_KEYS.map(k => [k, read(k, suiteFallback(k))]));
  const hasSuiteData = obj => !!(obj && (
    ['calendar','networth','goals','bills','gold_savings'].some(k => Array.isArray(obj[k]) && obj[k].length) ||
    Number(obj.gold_goal || 10) !== 10 || Object.keys(obj.gold_targets || {}).length || (obj.gold_country && obj.gold_country !== 'AE')
  ));
  async function pushSuiteToServer(){
    if(!suiteReady) return;
    if(suitePushPromise){suiteDirty=true;return suitePushPromise;}
    suiteDirty=false;
    const snapshot=suiteSnapshot();
    suitePushPromise=(async()=>{
      let ok=false;
      try{
        const r=await fetch('/api/finance-suite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({suite:snapshot})});
        const d=await r.json();
        if(!r.ok||!d.success) throw new Error(d.error||'Finance suite sync failed');
        if(Number(d.updated_at)>0) rawWrite('_updated_at',Number(d.updated_at));
        ok=true;
      }catch(e){ suiteDirty=true; console.warn('Finance suite sync failed', e); }
      finally{
        suitePushPromise=null;
        if(suiteReady&&suiteDirty) scheduleSuiteSync();
      }
      return ok;
    })();
    return suitePushPromise;
  }
  function scheduleSuiteSync(){
    if(!suiteReady) return;
    clearTimeout(suiteSyncTimer);
    suiteSyncTimer=setTimeout(pushSuiteToServer,450);
  }
  const write = (k,v) => {
    rawWrite(k,v);
    if(suiteReady && SUITE_SYNC_KEYS.includes(k)){
      rawWrite('_updated_at',Date.now());
      suiteDirty=true;
      scheduleSuiteSync();
    }
  };
  async function hydrateSuite(forceRemote=false){
    try{
      const r=await fetch('/api/finance-suite',{cache:'no-store'});
      const d=await r.json();
      if(!r.ok) return;
      const remote=d.suite&&typeof d.suite==='object'?d.suite:{};
      const remoteAt=Math.max(0,Number(d.updated_at)||0);
      const localAt=Math.max(0,Number(read('_updated_at',0))||0);
      const local=suiteSnapshot();
      if(remoteAt>0 && (forceRemote || remoteAt>localAt || (!localAt && hasSuiteData(remote)))){
        SUITE_SYNC_KEYS.forEach(k=>rawWrite(k,Object.prototype.hasOwnProperty.call(remote,k)?remote[k]:suiteFallback(k)));
        rawWrite('_updated_at',remoteAt);
      }else if(hasSuiteData(local) && (!remoteAt || localAt>=remoteAt)){
        suiteReady=true;
        suiteDirty=true;
        await pushSuiteToServer();
        suiteReady=false;
      }
    }catch(e){ console.warn('Finance suite hydrate failed', e); }
  }
  async function ensureSuiteScope(){
    if(!state.userId){
      try{const r=await fetch('/api/profile',{cache:'no-store'});const d=await r.json();if(r.ok&&d.user_id!=null)state.userId=String(d.user_id);}catch(_){}
    }
    if(!state.userId)return false;
    suiteScope=String(state.userId).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);
    if(!suiteScope)return false;
    // Never auto-assign old unscoped finance data to whichever account logs in
    // first on a shared browser. V53+ server sync is account-scoped; stale legacy
    // browser keys are removed instead of risking cross-account disclosure.
    const migrateKeys=['calendar','networth','goals','bills','gold_savings','gold_rate','gold_snapshots','gold_goal','gold_target','gold_targets','gold_country'];
    for(const k of migrateKeys)localStorage.removeItem(LEGACY_KEY+k);
    const legacyTarget=Number(read('gold_target',0));if(Number.isFinite(legacyTarget)&&legacyTarget>0){const cc=read('gold_country','AE');const cur=(countryMap[cc]||countryMap.AE).currency;const targets=read('gold_targets',{});if(!Number(targets?.[cur]))write('gold_targets',{...(targets&&typeof targets==='object'?targets:{}),[cur]:legacyTarget});rawWrite('gold_target',0);}
    return true;
  }
  const $ = id => document.getElementById(id);
  const h = value => escapeHtml(value == null ? '' : String(value));
  const money = (n,cur) => `${cur || state.currency || 'AED'} ${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})}`;
  const suiteCurrency = () => state.currency || state.primaryCurrency || 'AED';
  const suiteRate = cur => cur==='AED' ? 1 : Number(state.aedRates?.[cur]);
  const validSuiteMoney = (n, allowZero=true) => Number.isFinite(Number(n)) && Number(n) >= (allowZero?0:Number.EPSILON) && Number(n) <= SUITE_MAX_MONEY;
  const convertSuite = (amount, fromCur, toCur=suiteCurrency()) => {
    const n=Number(amount); if(!Number.isFinite(n)) return NaN;
    fromCur=String(fromCur||toCur).toUpperCase(); toCur=String(toCur||suiteCurrency()).toUpperCase();
    if(fromCur===toCur) return n;
    const fr=suiteRate(fromCur), tr=suiteRate(toCur);
    return fr>0&&tr>0 ? (n/fr)*tr : NaN;
  };
  const sumSuiteConverted = (items, type, base=suiteCurrency()) => {
    let total=0, complete=true;
    items.filter(x=>!type||x.type===type).forEach(x=>{const v=convertSuite(x.amount,x.cur||base,base);if(Number.isFinite(v))total+=v;else complete=false;});
    return {total,complete};
  };
  const localDateKey = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const countryMap={AE:{currency:'AED',name:'UAE'},IN:{currency:'INR',name:'India'},SA:{currency:'SAR',name:'Saudi Arabia'},QA:{currency:'QAR',name:'Qatar'},GB:{currency:'GBP',name:'United Kingdom'},US:{currency:'USD',name:'United States'}};
  let lastGoldRefreshAt=0; let goldRefreshInFlight=false; let goldChartRange='1M';
  const GOLD_RANGE_MS={
    '7D':7*24*60*60*1000,
    '1M':31*24*60*60*1000,
    '3M':93*24*60*60*1000,
    '1Y':366*24*60*60*1000
  };
  function compactGoldSnapshots(items,now=Date.now()){
    const valid=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x.cur==='string'&&Number.isFinite(Number(x.rate))&&Number(x.rate)>0&&Number.isFinite(Number(x.at))).filter(x=>now-Number(x.at)<=GOLD_RANGE_MS['1Y']).sort((a,b)=>Number(a.at)-Number(b.at));
    const buckets=new Map();
    valid.forEach(x=>{
      const at=Number(x.at),age=Math.max(0,now-at);
      const bucketMs=age<=2*24*60*60*1000?15*60*1000:age<=31*24*60*60*1000?2*60*60*1000:24*60*60*1000;
      const key=`${x.cur}:${Math.floor(at/bucketMs)}`;
      buckets.set(key,{at,rate:Number(x.rate),cur:x.cur});
    });
    return Array.from(buckets.values()).sort((a,b)=>a.at-b.at).slice(-3000);
  }
  const readList = k => { const v=read(k,[]); return Array.isArray(v)?v:[]; };
  const goldTargetFor = cur => { const all=read('gold_targets',{}); const v=Number(all&&typeof all==='object'?all[cur]:0); return Number.isFinite(v)&&v>0?v:0; };
  const setGoldTargetFor = (cur,value) => { const all=read('gold_targets',{}); const next={...(all&&typeof all==='object'&&!Array.isArray(all)?all:{})}; const v=Number(value); if(validSuiteMoney(v,false)) next[cur]=v; else delete next[cur]; write('gold_targets',next); };

  function removeItem(key,idx,render){ const a=readList(key); if(!Number.isInteger(idx)||idx<0||idx>=a.length) return; a.splice(idx,1); write(key,a); render(); renderHealth(); refreshNotifications(); }
  function empty(text){ return `<div class="v48-empty">${text}</div>`; }
  async function initSuite(){
    if(!(await ensureSuiteScope())){setTimeout(initSuite,1500);return;}
    await hydrateSuite(false);
    suiteReady=true;
    // Existing logout item is also .nav-item; never route it to an undefined page.
    document.querySelectorAll('.nav-item:not([data-page])').forEach(b=>b.dataset.v48NoRoute='1');
    bindGold(); bindCalendar(); bindNetWorth(); bindBills(); bindVault(); bindNotifications();
    renderAll(); refreshGold();
    setInterval(refreshNotifications, 60000); setTimeout(refreshNotifications, 1800);
    // Keep the Gold Saver reference fresh while the app remains open. The server
    // still owns provider caching, so this is lightweight and avoids stale all-day values.
    setInterval(()=>{if(!document.hidden && Date.now()-lastGoldRefreshAt>5*60*1000)refreshGold();},60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-lastGoldRefreshAt>2*60*1000)refreshGold();});
    window.addEventListener('focus',()=>{if(Date.now()-lastGoldRefreshAt>2*60*1000)refreshGold();});
  }

  async function refreshGold(){
    if(!$('goldCountry') || goldRefreshInFlight) return;
    goldRefreshInFlight=true;
    let cc=read('gold_country','AE')||$('goldCountry').value||'AE'; if(!countryMap[cc]) cc='AE'; $('goldCountry').value=cc;
    const cur=countryMap[cc].currency; $('goldMarketStatus').textContent='Refreshing live reference…';
    try{
      const r=await fetch(`/api/gold/rate?currency=${encodeURIComponent(cur)}`,{cache:'no-store'});
      const j=await r.json(); const perGram=Number(j.per_gram),usdOz=Number(j.usd_per_oz); if(!r.ok||!(perGram>0)||!(usdOz>0)) throw new Error(j.error||'No live gold price');
      write('gold_rate',{perGram,cur,usdOz,at:Date.now(),cc});
      const snapNow=Date.now(); let snaps=readList('gold_snapshots'); snaps.push({at:snapNow,rate:perGram,cur}); snaps=compactGoldSnapshots(snaps,snapNow); write('gold_snapshots',snaps);
      lastGoldRefreshAt=Date.now(); $('goldMarketStatus').textContent='Live reference • updated now'; renderGold();
    }catch(e){ const g=read('gold_rate',{}); const sameMarket=Number(g.perGram)>0&&g.cc===cc&&g.cur===cur; $('goldMarketStatus').textContent=sameMarket?'Offline • showing last saved reference':'Live rate unavailable • automatic retry is active'; renderGold(); }
    finally{ goldRefreshInFlight=false; }
  }
  function bindGold(){
    $('goldCountry')?.addEventListener('change',()=>{write('gold_country',$('goldCountry').value);refreshGold();});
    document.querySelectorAll('#goldRange button').forEach(b=>b.addEventListener('click',()=>{goldChartRange=b.dataset.goldRange||'1M';document.querySelectorAll('#goldRange button').forEach(x=>x.classList.toggle('active',x===b));drawGoldChart();}));
    if(!bindGold._resizeBound){
      bindGold._resizeBound=true;
      let lastWidth=window.innerWidth;
      window.addEventListener('resize',()=>{const width=window.innerWidth;if(Math.abs(width-lastWidth)<16)return;lastWidth=width;clearTimeout(bindGold._resizeTimer);bindGold._resizeTimer=setTimeout(()=>{if(document.getElementById('page-gold-saver')?.classList.contains('active'))drawGoldChart();},220);});
    }
    $('addGoldSaving')?.addEventListener('click',()=>{ const amt=Number($('goldContribution').value), g=read('gold_rate',{}),cc=$('goldCountry')?.value||read('gold_country','AE'); if(!validSuiteMoney(amt,false)) return toast('Enter a valid saving amount','error'); if(!(g.perGram>0)||g.cc!==cc) return toast('Live gold rate is still updating. Please wait a moment and try again.','error'); const a=readList('gold_savings'); a.unshift({id:Date.now(),amount:amt,grams:amt/g.perGram,rate:g.perGram,cur:g.cur,cc:g.cc,date:new Date().toISOString(),localDate:localDateKey()}); write('gold_savings',a); $('goldContribution').value=''; {const gg=Number($('goldGoalGrams').value);write('gold_goal',Number.isFinite(gg)&&gg>0&&gg<=1000000?gg:10);} renderGold(); refreshNotifications(); toast('Gold saving recorded','success'); });
    $('goldGoalGrams')?.addEventListener('change',()=>{const v=Number($('goldGoalGrams').value);write('gold_goal',Number.isFinite(v)&&v>0&&v<=1000000?v:10);renderGold();});
    $('saveGoldTarget')?.addEventListener('click',()=>{const cc=$('goldCountry')?.value||read('gold_country','AE'),cur=(countryMap[cc]||countryMap.AE).currency,v=Number($('goldTargetPrice').value),valid=validSuiteMoney(v,false);setGoldTargetFor(cur,v);toast(valid?`Gold price alert saved for ${cur}`:'Gold price alert cleared','success');refreshNotifications();});
  }
  function renderGold(){
    if(!$('goldSavedValue')) return; const a=readList('gold_savings'), g=read('gold_rate',{}), rawGoal=Number(read('gold_goal',10)), goal=Number.isFinite(rawGoal)&&rawGoal>0?rawGoal:10; $('goldGoalGrams').value=goal;
    let persistedCc=read('gold_country','AE');if(!countryMap[persistedCc])persistedCc='AE';if($('goldCountry').value!==persistedCc)$('goldCountry').value=persistedCc;
    const grams=a.reduce((s,x)=>s+Math.max(0,Number(x.grams)||0),0); const selectedCc=countryMap[$('goldCountry').value] ? $('goldCountry').value : 'AE'; const cur=countryMap[selectedCc].currency; const rateOk=Number(g.perGram)>0&&g.cc===selectedCc&&g.cur===cur; const current=grams*(rateOk?Number(g.perGram):0);
    $('goldSavedValue').textContent=rateOk?money(current,cur):'—'; $('goldSavedGrams').textContent=`${grams.toFixed(3)} g`; $('goldGramRate').textContent=rateOk?money(g.perGram,cur):'—'; $('goldGoalProgress').textContent=`${Math.min(100,grams/goal*100).toFixed(0)}%`; $('goldMarketPrice').textContent=rateOk?money(g.perGram,cur):'—'; $('goldTargetPrice').value=goldTargetFor(cur)||'';
    if($('goldCurrentLabel')) $('goldCurrentLabel').textContent=`24K • 1 gram • ${cur}`;
    if($('goldUpdated')){const at=rateOk&&Number(g.at)>0?new Date(Number(g.at)):null;$('goldUpdated').textContent=at&&Number.isFinite(at.getTime())?`Last updated: ${at.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'Last updated: —';}

    $('goldHistory').innerHTML=a.length?a.slice(0,30).map((x,i)=>{const dt=x.date?new Date(x.date):null;const dateLabel=dt&&Number.isFinite(dt.getTime())?dt.toLocaleDateString():(x.localDate?new Date(x.localDate+'T12:00:00').toLocaleDateString():'Saved entry');return `<div class="v48-list-item"><div><strong>${Number(x.grams).toFixed(3)} g</strong><small>${dateLabel} • ${money(x.amount,x.cur)} @ ${money(x.rate,x.cur)}/g</small></div><button data-gold-del="${i}">Delete</button></div>`;}).join(''):empty('No gold savings recorded yet.');
    document.querySelectorAll('[data-gold-del]').forEach(b=>b.onclick=()=>removeItem('gold_savings',Number(b.dataset.goldDel),renderGold)); drawGoldChart();
  }
  function drawGoldChart(){
    const canvas=$('goldMiniChart');if(!canvas)return;
    const wrap=canvas.parentElement,cc=$('goldCountry')?.value||read('gold_country','AE'),cur=(countryMap[cc]||countryMap.AE).currency;
    const rangeMs=GOLD_RANGE_MS[goldChartRange]||GOLD_RANGE_MS['1M'],now=Date.now(),cutoff=now-rangeMs;
    const all=readList('gold_snapshots').filter(x=>x.cur===cur&&Number.isFinite(Number(x.rate))&&Number(x.rate)>0&&Number.isFinite(Number(x.at))).sort((a,b)=>Number(a.at)-Number(b.at));
    const points=all.filter(x=>Number(x.at)>=cutoff);
    const css=getComputedStyle(document.documentElement),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(280,wrap.clientWidth||canvas.clientWidth||400),h=Math.max(190,wrap.clientHeight||260);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const muted=(css.getPropertyValue('--text-muted')||'#718096').trim(),gold=(css.getPropertyValue('--gold-500')||'#d4af6a').trim(),blue=(css.getPropertyValue('--blue-400')||'#4c8dff').trim(),premium=state.visualTheme==='premium';
    const pad={l:18,r:18,t:18,b:30},plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;
    ctx.strokeStyle='rgba(127,150,190,.16)';ctx.lineWidth=1;for(let i=0;i<4;i++){const yy=pad.t+i*plotH/3;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();}
    const changeEl=$('goldChange');
    if(!points.length){
      ctx.fillStyle=muted;ctx.font='13px Manrope, sans-serif';ctx.textAlign='center';ctx.fillText('Gold trend will appear as live snapshots are collected.',w/2,h/2);ctx.textAlign='left';
      if(changeEl){changeEl.textContent='—';changeEl.className='fx-change';}
      return;
    }
    const vals=points.map(p=>Number(p.rate)),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(max-min,Math.abs(max)*0.004,0.01);
    const yMin=min-span*.20,yMax=max+span*.20,ySpan=Math.max(yMax-yMin,.01);
    const x=i=>points.length===1?w/2:pad.l+(i/(points.length-1))*plotW;
    const y=v=>pad.t+(1-(v-yMin)/ySpan)*plotH;
    if(points.length===1){
      const xx=x(0),yy=y(vals[0]);ctx.beginPath();ctx.arc(xx,yy,5,0,Math.PI*2);ctx.fillStyle=gold;ctx.shadowColor='rgba(212,175,106,.42)';ctx.shadowBlur=14;ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle=muted;ctx.font='11px Manrope, sans-serif';ctx.textAlign='center';ctx.fillText('Collecting trend…',xx,h-8);ctx.textAlign='left';
      if(changeEl){changeEl.textContent='—';changeEl.className='fx-change';}
      return;
    }
    const fill=ctx.createLinearGradient(0,pad.t,0,h-pad.b);fill.addColorStop(0,premium?'rgba(255,159,44,.28)':'rgba(212,175,106,.25)');fill.addColorStop(.45,premium?'rgba(255,112,8,.10)':'rgba(76,141,255,.10)');fill.addColorStop(1,premium?'rgba(255,112,8,0)':'rgba(76,141,255,0)');
    ctx.beginPath();points.forEach((p,i)=>{const xx=x(i),yy=y(Number(p.rate));i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.lineTo(x(points.length-1),h-pad.b);ctx.lineTo(x(0),h-pad.b);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    const stroke=ctx.createLinearGradient(pad.l,0,w-pad.r,0);stroke.addColorStop(0,blue);stroke.addColorStop(1,gold);ctx.beginPath();points.forEach((p,i)=>{const xx=x(i),yy=y(Number(p.rate));i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.strokeStyle=stroke;ctx.lineWidth=2.8;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor=premium?'rgba(255,119,11,.28)':'rgba(76,141,255,.24)';ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;
    const last=points[points.length-1];ctx.beginPath();ctx.arc(x(points.length-1),y(Number(last.rate)),4.8,0,Math.PI*2);ctx.fillStyle=gold;ctx.shadowColor='rgba(212,175,106,.45)';ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
    const formatStamp=ts=>{const d=new Date(Number(ts));if(goldChartRange==='7D')return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});if(goldChartRange==='1Y')return d.toLocaleDateString(undefined,{month:'short',year:'2-digit'});return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
    ctx.fillStyle=muted;ctx.font='11px Manrope, sans-serif';ctx.textAlign='left';ctx.fillText(formatStamp(points[0].at),pad.l,h-8);const end=formatStamp(last.at);ctx.textAlign='right';ctx.fillText(end,w-pad.r,h-8);ctx.textAlign='left';
    const firstRate=Number(points[0].rate),lastRate=Number(last.rate),change=firstRate>0?(lastRate-firstRate)/firstRate*100:0;
    if(changeEl){changeEl.textContent=`${change>=0?'+':''}${change.toFixed(2)}%`;changeEl.className=`fx-change ${change>0?'up':change<0?'down':''}`;}
  }

  function bindCalendar(){ $('addCalEvent')?.addEventListener('click',()=>{if(!$('calTitle').value.trim()||!$('calDate').value)return toast('Add a title and date','error');const a=readList('calendar');a.push({title:$('calTitle').value.trim(),date:$('calDate').value,type:$('calType').value});write('calendar',a);$('calTitle').value='';$('calDate').value='';renderCalendar();refreshNotifications();}); }
  function renderCalendar(){ if(!$('calendarList'))return;const a=readList('calendar').map((x,_idx)=>({...x,_idx})).sort((x,y)=>String(x.date||'').localeCompare(String(y.date||'')));const now=new Date(),configuredSalaryDay=Math.max(1,Math.min(31,Number(state.salaryCreditDay)||27));let sy=now.getFullYear(),sm=now.getMonth(),salaryDay=Math.min(configuredSalaryDay,new Date(sy,sm+1,0).getDate());if(now.getDate()>salaryDay){sm++;if(sm>11){sm=0;sy++;}salaryDay=Math.min(configuredSalaryDay,new Date(sy,sm+1,0).getDate());}const salaryDate=new Date(sy,sm,salaryDay);const auto=`<div class="v48-list-item"><div><strong>Salary credit day</strong><small>Automatic • ${salaryDate.toLocaleDateString()} • from Settings</small></div><span>↻</span></div>`;$('calendarList').innerHTML=auto+(a.length?a.map(x=>`<div class="v48-list-item"><div><strong>${h(x.title)}</strong><small>${h(x.type)} • ${new Date(x.date+'T12:00:00').toLocaleDateString()}</small></div><button data-cal-del="${x._idx}">Delete</button></div>`).join(''):empty('No extra reminders yet.'));document.querySelectorAll('[data-cal-del]').forEach(b=>b.onclick=()=>removeItem('calendar',Number(b.dataset.calDel),renderCalendar)); }

  function bindNetWorth(){ $('addNetWorth')?.addEventListener('click',()=>{const n=$('nwName').value.trim(),v=Number($('nwAmount').value);if(!n||!validSuiteMoney(v,true))return toast('Enter item and a valid amount','error');const a=readList('networth');a.push({name:n,amount:v,type:$('nwType').value,cur:suiteCurrency()});write('networth',a);$('nwName').value='';$('nwAmount').value='';renderNetWorth();renderHealth();}); }
  function renderNetWorth(){if(!$('nwList'))return;const a=readList('networth'),base=suiteCurrency(),assetSum=sumSuiteConverted(a,'asset',base),liabSum=sumSuiteConverted(a,'liability',base),complete=assetSum.complete&&liabSum.complete,assets=assetSum.total,liab=liabSum.total;$('nwAssets').textContent=complete?money(assets,base):'—';$('nwLiabilities').textContent=complete?money(liab,base):'—';$('nwTotal').textContent=complete?money(assets-liab,base):'—';$('nwList').innerHTML=a.length?a.map((x,i)=>`<div class="v48-list-item"><div><strong>${h(x.name)}</strong><small>${x.type==='asset'?'Asset':'Liability'} • ${money(x.amount,x.cur||base)}</small></div><button data-nw-del="${i}">Delete</button></div>`).join(''):empty('Add assets and liabilities to calculate net worth.');if(!complete)$('nwList').insertAdjacentHTML('afterbegin','<div class="v48-empty">A saved currency rate is unavailable. Refresh exchange rates to calculate totals safely.</div>');document.querySelectorAll('[data-nw-del]').forEach(b=>b.onclick=()=>removeItem('networth',Number(b.dataset.nwDel),renderNetWorth));}


  function bindBills(){ $('addBill')?.addEventListener('click',()=>{const n=$('billName').value.trim(),a=Number($('billAmount').value),d=Number($('billDay').value);if(!n||!validSuiteMoney(a,true)||!Number.isInteger(d)||d<1||d>31)return toast('Enter bill name, amount and valid due day','error');const v=readList('bills');v.push({name:n,amount:a,day:d,kind:$('billKind').value,cur:suiteCurrency()});write('bills',v);$('billName').value=$('billAmount').value=$('billDay').value='';renderBills();renderHealth();refreshNotifications();}); }
  function renderBills(){if(!$('billsList'))return;const a=readList('bills').map((x,_idx)=>({...x,_idx})).sort((x,y)=>Number(x.day)-Number(y.day));$('billsList').innerHTML=a.length?a.map(x=>`<div class="v48-list-item"><div><strong>${h(x.name)}</strong><small>${h(x.kind)} • ${money(x.amount,x.cur||suiteCurrency())} • due day ${Number(x.day)}</small></div><button data-bill-del="${x._idx}">Delete</button></div>`).join(''):empty('No recurring bills or subscriptions yet.');document.querySelectorAll('[data-bill-del]').forEach(b=>b.onclick=()=>removeItem('bills',Number(b.dataset.billDel),renderBills));}

  function vaultDb(){return new Promise((resolve,reject)=>{const q=indexedDB.open(`yarin_vault_v2_u${suiteScope}`,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('docs'))q.result.createObjectStore('docs',{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
  let lastVaultId=0;
  function nextVaultId(){const now=Date.now();lastVaultId=Math.max(now,lastVaultId+1);return lastVaultId;}
  function bindVault(){ $('vaultAdd')?.addEventListener('click',async()=>{const f=$('vaultFile').files?.[0];if(!f)return toast('Choose a document first','error');if(f.size>8*1024*1024)return toast('Keep vault files under 8 MB','error');try{const db=await vaultDb(),tx=db.transaction('docs','readwrite');tx.objectStore('docs').put({id:nextVaultId(),name:f.name,type:f.type,size:f.size,added:Date.now(),blob:f});tx.oncomplete=()=>{db.close();$('vaultFile').value='';renderVault();toast('Document saved locally','success');};tx.onerror=()=>db.close();}catch(e){toast('Vault storage is unavailable in this browser','error');}}); }
  async function renderVault(){if(!$('vaultList'))return;try{const db=await vaultDb(),tx=db.transaction('docs','readonly'),q=tx.objectStore('docs').getAll();q.onsuccess=()=>{$('vaultList').innerHTML=q.result.length?q.result.map(x=>`<div class="v48-list-item"><div><strong>${h(x.name)}</strong><small>${(x.size/1024).toFixed(0)} KB • ${new Date(x.added).toLocaleDateString()}</small></div><span><button data-vault-open="${x.id}">Open</button> <button data-vault-del="${x.id}">Delete</button></span></div>`).join(''):empty('Your local document vault is empty.');document.querySelectorAll('[data-vault-open]').forEach(b=>b.onclick=()=>vaultOpen(Number(b.dataset.vaultOpen)));document.querySelectorAll('[data-vault-del]').forEach(b=>b.onclick=()=>vaultDelete(Number(b.dataset.vaultDel)));};tx.oncomplete=()=>db.close();tx.onerror=()=>db.close();}catch(_){$('vaultList').innerHTML=empty('Vault unavailable in this browser.');}}
  async function vaultOpen(id){const db=await vaultDb(),tx=db.transaction('docs','readonly'),q=tx.objectStore('docs').get(id);q.onsuccess=()=>{if(q.result?.blob){const url=URL.createObjectURL(q.result.blob),a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}};tx.oncomplete=()=>db.close();tx.onerror=()=>db.close();}
  async function vaultDelete(id){const db=await vaultDb(),tx=db.transaction('docs','readwrite');tx.objectStore('docs').delete(id);tx.oncomplete=()=>{db.close();renderVault();};tx.onerror=()=>db.close();}

  function healthData(){
    const nw=readList('networth'),bills=readList('bills'),gold=readList('gold_savings'),calendar=readList('calendar'),dash=state.dashboard||{};
    const base=suiteCurrency(),assetSum=sumSuiteConverted(nw,'asset',base),liabSum=sumSuiteConverted(nw,'liability',base),conversionComplete=assetSum.complete&&liabSum.complete,assets=Math.max(0,assetSum.total),liab=Math.max(0,liabSum.total);
    const debt=Math.max(0,liab),ratio=conversionComplete?(assets>0?debt/assets:debt?1:0):0;
    // Goals Center was removed in V65. Use the existing Savings page goal instead,
    // so Financial Health still reflects the user's real savings target.
    const savingsGoal=Math.max(0,Number(dash.savings_goal)||0),totalSavings=Math.max(0,Number(dash.total_savings)||0);
    const goalProgress=savingsGoal>0?Math.min(1,totalSavings/savingsGoal):0;
    const income=Math.max(0,Number(dash.monthly_income)||0),savings=Math.max(0,Number(dash.monthly_savings)||0),savingsRate=income>0?Math.min(1,savings/income):0;
    const evidence=(nw.length?1:0)+(bills.length?1:0)+(gold.length?1:0)+(calendar.length?1:0)+(income>0?1:0)+(savingsGoal>0||totalSavings>0?1:0);
    if(!evidence)return{score:0,ratio:0,goalProgress:0,assets:0,liab:0,savingsRate:0,hasData:false,savingsGoal:0};
    let score=20;
    score+=conversionComplete?Math.round((1-Math.min(1,ratio))*25):0;
    score+=Math.round(goalProgress*20);
    score+=Math.round(savingsRate*15);
    score+=Math.min(10,((assets>0?1:0)+(gold.length?1:0)+(savingsGoal>0?1:0))*4);
    score+=bills.length?5:0; score+=calendar.length?5:0;
    score=Math.max(0,Math.min(100,score));
    return{score,ratio,goalProgress,assets,liab,savingsRate,hasData:true,conversionComplete,savingsGoal};
  }
  function renderHealth(){
    if(!$('healthScore'))return; const h=healthData();
    $('healthScore').textContent=h.hasData?h.score:'—'; document.querySelector('.v48-score-ring')?.style.setProperty('--score',(h.hasData?h.score:0)+'%');
    if(!h.hasData){$('healthLabel').textContent='Add data to calculate your score';$('healthAdvice').textContent='Record income, assets, savings, bills or gold savings to build a meaningful financial health score.';$('healthBreakdown').innerHTML='<div class="v48-health-chip">Status<b>Waiting for financial data</b></div>';return;}
    $('healthLabel').textContent=h.score>=80?'Strong financial foundation':h.score>=60?'Healthy — keep improving':h.score>=40?'Building momentum':'Needs attention';
    $('healthAdvice').textContent=h.conversionComplete===false?'Refresh exchange rates to include all saved currencies in your Net Worth score.':h.ratio>.6?'Liabilities are high relative to recorded assets. Focus on debt reduction and emergency savings.':h.savingsGoal>0&&h.goalProgress<.3?'Your debt position looks manageable; increase regular savings contributions toward your Savings Goal.':'Good progress. Keep bills planned, savings growing and records current.';
    $('healthBreakdown').innerHTML=`<div class="v48-health-chip">Debt / Asset ratio<b>${(h.ratio*100).toFixed(0)}%</b></div><div class="v48-health-chip">Savings goal progress<b>${(h.goalProgress*100).toFixed(0)}%</b></div><div class="v48-health-chip">Savings rate<b>${(h.savingsRate*100).toFixed(0)}%</b></div><div class="v48-health-chip">Recorded net worth<b>${money(h.assets-h.liab)}</b></div>`;
  }


  function localDayNumber(date){return Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000;}
  function daysFromToday(date,now=new Date()){return Math.round(localDayNumber(date)-localDayNumber(now));}
  function notifications(){
    const out=[],now=new Date(),today=now.getDate();
    const year=now.getFullYear(),month=now.getMonth();
    const monthToken=`${year}-${String(month+1).padStart(2,'0')}`;
    const effectiveDay=Math.min(
      Math.max(1,Number(state.salaryCreditDay)||27),
      new Date(year,month+1,0).getDate()
    );
    const dash=state.dashboard||{};

    if(today>=effectiveDay&&Number(dash.monthly_income||0)<=0){
      out.push({
        id:`salary-missing:${monthToken}`,
        page:'income',
        text:'Salary date has passed but no monthly income is recorded',
        sub:'Tap to review Income'
      });
    }
    if(Number(dash.monthly_income||0)>0&&Number(dash.monthly_savings||0)<=0){
      out.push({
        id:`savings-missing:${monthToken}`,
        page:'savings',
        text:'No monthly savings recorded yet',
        sub:'Tap to add this month’s saving'
      });
    }

    readList('bills').forEach(x=>{
      const dueDay=Math.max(1,Math.min(31,Number(x.day)||1));
      let due=new Date(year,month,Math.min(dueDay,new Date(year,month+1,0).getDate()),23,59,59);
      if(due<now){
        const nextMonth=month+1,nextYear=year+Math.floor(nextMonth/12),normalizedMonth=nextMonth%12;
        due=new Date(nextYear,normalizedMonth,Math.min(dueDay,new Date(nextYear,normalizedMonth+1,0).getDate()),23,59,59);
      }
      const delta=daysFromToday(due,now);
      if(delta>=0&&delta<=3){
        out.push({
          id:`bill:${String(x.name||'')}|${String(x.kind||'')}|${String(x.amount||0)}|${localDateKey(due)}`,
          page:'bills',
          text:`${x.name} is due ${delta===0?'today':`in ${delta} day${delta===1?'':'s'}`}`,
          sub:`${money(x.amount,x.cur||suiteCurrency())} • ${x.kind}`
        });
      }
    });

    readList('calendar').forEach(x=>{
      const d=new Date(x.date+'T12:00:00'),days=daysFromToday(d,now);
      if(days>=0&&days<=5){
        out.push({
          id:`calendar:${String(x.title||'')}|${String(x.type||'')}|${String(x.date||'')}`,
          page:'financial-calendar',
          text:`${x.title} ${days===0?'is today':`in ${days} days`}`,
          sub:x.type
        });
      }
    });

    if(!readList('gold_savings').some(x=>{
      const d=x.localDate?new Date(x.localDate+'T12:00:00'):new Date(x.date);
      return !isNaN(d)&&d.getMonth()===month&&d.getFullYear()===year;
    })){
      out.push({
        id:`gold-missing:${monthToken}`,
        page:'gold-saver',
        text:'No Gold Saver contribution recorded this month',
        sub:'Tap to review your gold goal'
      });
    }

    const g=read('gold_rate',{}),cc=read('gold_country','AE');
    const cur=(countryMap[cc]||countryMap.AE).currency,target=goldTargetFor(cur);
    if(target>0&&g.perGram>0&&g.cc===cc&&g.cur===cur&&g.perGram<=target){
      out.push({
        id:`gold-target:${cc}:${cur}:${localDateKey(now)}:${Number(target).toFixed(4)}`,
        page:'gold-saver',
        text:'Gold target price reached',
        sub:`Current reference ${money(g.perGram,g.cur)} / g`
      });
    }

    return out;
  }
  const notificationKey = x => String(x.id||`${String(x.page||'general')}|${String(x.text||'')}`);
  function notificationReadSet(){const a=read('notification_read',[]);return new Set(Array.isArray(a)?a.map(String):[]);}
  function saveNotificationReadSet(set){rawWrite('notification_read',Array.from(set).slice(-1000));}
  function closeNotifications(){const panel=$('financeNotifPanel'),btn=$('financeNotifBtn');if(!panel)return;panel.hidden=true;document.body.classList.remove('notification-modal-open');btn?.setAttribute('aria-expanded','false');}
  function openNotifications(){const panel=$('financeNotifPanel'),btn=$('financeNotifBtn');if(!panel)return;refreshNotifications();panel.hidden=false;document.body.classList.add('notification-modal-open');btn?.setAttribute('aria-expanded','true');requestAnimationFrame(()=>$('financeNotifClose')?.focus());}
  function bindNotifications(){
    $('financeNotifBtn')?.addEventListener('click',()=>{const panel=$('financeNotifPanel');if(!panel)return;panel.hidden?openNotifications():closeNotifications();});
    $('financeNotifClose')?.addEventListener('click',closeNotifications);
    $('financeNotifPanel')?.addEventListener('click',e=>{if(e.target===$('financeNotifPanel'))closeNotifications();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('financeNotifPanel')?.hidden)closeNotifications();});
  }
  function refreshNotifications(){
    const count=$('financeNotifCount'),list=$('financeNotifList');if(!count||!list)return;
    const a=notifications(),readSet=notificationReadSet(),unread=a.filter(x=>!readSet.has(notificationKey(x))).length,visible=a.slice(0,100);
    count.textContent=String(unread);count.hidden=unread===0;
    $('financeNotifBtn')?.classList.toggle('has-unread',unread>0);
    if(!a.length){
      list.innerHTML='<div class="v54-notif-empty"><span>✓</span><strong>You are all caught up.</strong><small>No financial reminders need your attention right now.</small></div>';
    }else{
      list.innerHTML=visible.map((x,i)=>{const isRead=readSet.has(notificationKey(x));return `<button class="v54-notif-item ${isRead?'is-read':'is-unread'}" data-v54-notif="${i}"><span class="v54-notif-dot" aria-hidden="true"></span><span class="v54-notif-copy"><strong>${h(x.text)}</strong><small>${h(x.sub)}</small></span><span class="v54-notif-arrow" aria-hidden="true">›</span></button>`;}).join('')+(a.length>visible.length?`<div class="v54-notif-limit-note">Showing the first ${visible.length} of ${a.length} active reminders.</div>`:'');
    }
    document.querySelectorAll('[data-v54-notif]').forEach(b=>b.onclick=()=>{const x=visible[Number(b.dataset.v54Notif)];if(!x)return;const seen=notificationReadSet();seen.add(notificationKey(x));saveNotificationReadSet(seen);refreshNotifications();document.querySelector(`.nav-item[data-page="${x.page}"]`)?.click();closeNotifications();});
  }
  function renderAll(){document.querySelectorAll('.suite-cur-unit').forEach(el=>el.textContent=suiteCurrency());renderGold();renderCalendar();renderNetWorth();renderBills();renderVault();renderHealth();refreshNotifications();}

  window.refreshYarinFinanceSuite=()=>{if(suiteReady)renderAll();};
  window.prepareYarinSuiteServerAction=async({flush=false}={})=>{
    clearTimeout(suiteSyncTimer); suiteSyncTimer=null;
    if(!flush){
      suiteReady=false; suiteDirty=false;
      if(suitePushPromise) await suitePushPromise;
      return true;
    }
    // Backups should include the latest local suite changes. Drain an in-flight
    // write first, then make one follow-up write if a newer edit arrived.
    let ok=true;
    if(suitePushPromise) ok=(await suitePushPromise)!==false;
    if(suiteDirty && suiteReady) ok=((await pushSuiteToServer())!==false)&&ok;
    return ok && !suiteDirty;
  };
  window.resumeYarinFinanceSuite=()=>{suiteReady=true;renderAll();};
  window.clearYarinLocalFinanceSuite=async()=>{
    clearTimeout(suiteSyncTimer); suiteSyncTimer=null; suiteDirty=false; suiteReady=false;
    [...SUITE_SYNC_KEYS,...SUITE_LOCAL_KEYS,'_updated_at'].forEach(k=>localStorage.removeItem(scopedKey(k)));
    try{
      if(window.indexedDB){const db=await vaultDb();await new Promise(resolve=>{const tx=db.transaction('docs','readwrite');tx.objectStore('docs').clear();tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();resolve();};});}
    }catch(_){}
    suiteReady=true; renderAll();
  };
  window.reloadYarinFinanceSuite=async(forceRemote=false)=>{
    if(!suiteScope)return;
    suiteReady=false;
    await hydrateSuite(!!forceRemote);
    suiteReady=true;
    renderAll();
  };
  window.addEventListener('yarin-suite-refresh',e=>{window.reloadYarinFinanceSuite?.(!!e.detail?.forceRemote);});

  // Add personal coach context from the new suite to every AI request without exposing files.
  const originalFetch=window.fetch.bind(window);window.fetch=async function(input,init){try{if(typeof input==='string'&&input==='/api/ai-assistant'&&init?.body){const body=JSON.parse(init.body);const h=healthData();body.coach_context={financial_health_score:h.score,net_worth:h.assets-h.liab,goal_count:Number((state.dashboard||{}).savings_goal)>0?1:0,bill_count:readList('bills').length,gold_saved_grams:Number(readList('gold_savings').reduce((s,x)=>s+Number(x.grams||0),0).toFixed(3)),upcoming_alerts:notifications().slice(0,5).map(x=>x.text)};init={...init,body:JSON.stringify(body)};}}catch(_){}return originalFetch(input,init);};

  document.addEventListener('DOMContentLoaded',initSuite);
})();
