/* =========================================================================
   SBG-Warehouse RTVB2S — app.js
   Vanilla JS, ไม่มี Framework, รองรับ 3 โหมด: MOCKUP / SETUP / REAL
   ========================================================================= */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     0. CONFIG & USERS
  ---------------------------------------------------------------------- */
  const COLLECTIONS = {
    JOBS: 'ชื่องานs',
    CARTONS: 'cartons',
    CARTON_DETAILS: 'cartonDetails',
    SCAN_LOGS: 'scanLogs',
    USERS: 'users',
    PRESENCE: 'presence',
    SETTINGS: 'settings',
    AUDIT_LOGS: 'auditLogs',
    FCM_TOKENS: 'fcmTokens',
    SETUP_ACCESS_LOGS: 'setupAccessLogs',
    REOPEN_LOGS: 'reopenLogs',
  };

  // Feedback 1.1 — Carton lifecycle: มีแค่ 2 สถานะ draft/closed (ยกเลิก = draft ชนิดหนึ่ง)
  const CARTON_STATUS = { DRAFT: 'draft', CLOSED: 'closed' };
  const CARTON_AUTOSAVE_DEBOUNCE_MS = 3000;

  const DEFAULT_USERS = [
    { id: 'u_nooey', name: 'หนุ่ย', color: '#3b82f6' },
    { id: 'u_yok', name: 'หยก', color: '#22c55e' },
    { id: 'u_zig', name: 'ซิก', color: '#f59e0b' },
    { id: 'u_phu', name: 'ภู', color: '#a855f7' },
    { id: 'u_por', name: 'ปอ', color: '#ef4444' },
  ];

  const LS_KEYS = {
    FIREBASE_CFG: 'sbg_wh_firebase_cfg_b64',
    CURRENT_USER: 'sbg_wh_current_user',
    CURRENT_JOB: 'sbg_wh_current_job',
    THEME: 'sbg_wh_theme',
    MASTER_CONFIG: 'sbg_wh_master_config',
    MASTER_DATA: 'sbg_wh_master_data',
    MASTER_UPDATED: 'sbg_wh_master_updated',
    SOUND: 'sbg_wh_sound_enabled',
    SPEECH: 'sbg_wh_speech_enabled',
    NOTIFY: 'sbg_wh_notify_enabled',
    LANG: 'sbg_wh_lang',
    USERS_LIST: 'sbg_wh_users_list',
    USERS_UPDATED: 'sbg_wh_users_updated',
    NOTIFY_TEMPLATES: 'sbg_wh_notify_templates',
    REPORT_VISIBILITY: 'sbg_wh_report_visibility',
    THRESHOLDS: 'sbg_wh_thresholds',
  };

  const PIN_SESSION_KEY = 'sbg_wh_pin_verified'; // เก็บใน sessionStorage เท่านั้น (หายเมื่อปิดแท็บ)

  /* ----------------------------------------------------------------------
     1. APP STATE
  ---------------------------------------------------------------------- */
  const state = {
    mode: 'mockup', // 'mockup' | 'real'
    currentUser: null, // { id, name, color }
    currentJob: null, // { id, name, date, status, ... }
    currentCarton: null, // { id (temp), cartonNo, ... }
    sbcMode: 'scanonly', // 'scanonly' | 'scanqty'
    scanBuffer: [], // scans for the carton currently being built
    unsubscribers: [], // active onSnapshot unsubscribe fns
    reportMode: 'summary', // 'summary' | 'detail'
    reportFilter: '',
    activeCamera: null, // { html5QrcodeInstance, targetInputId, boxId, btnId }
    barcodeMaster: {}, // { [barcode]: { name, sku } } — imported from Excel
    masterUpdatedAt: null,
    masterFile: null, // File object currently selected (not yet imported)
    soundEnabled: true,
    speechEnabled: false,
    presenceHeartbeatTimer: null,
    presenceListenUnsub: null,
    masterListenUnsub: null,
    notifyEnabled: false,
    lang: 'th',
    knownCartonIds: null, // Set — ใช้เทียบว่า carton ไหน "ใหม่" เพื่อแจ้งเตือน
    pinPendingCallback: null,
    usersList: DEFAULT_USERS.slice(), // B1 — รายชื่อผู้ใช้ที่แก้ไขได้ผ่าน Settings
    usersListUpdatedAt: null,
    usersListUnsub: null,
    editingUserId: null, // กำลังแก้ไขผู้ใช้คนไหนอยู่ในฟอร์ม (null = กำลังจะเพิ่มใหม่)
    editingMasterBarcode: null, // กำลังแก้ไขสินค้า barcode ไหนอยู่ในฟอร์ม
    activeSettingsPanel: 'firebase',
    notifyTemplates: { jobClosed: '', cartonNew: '' },
    rapidFireMode: true, // F1 — ล็อกโฟกัสช่องสแกนตลอดเวลา (เปิดโดย default)
    lastScanSnapshot: null, // F7 — ใช้ทำ Undo สแกนล่าสุด

    // ---- Feedback 1.1: Carton Lifecycle (draft/closed) ----
    cartonAutosaveTimer: null,
    cartonAutosaveDirty: false,
    resumingDraft: false, // true เมื่อกำลังทำ draft เดิมต่อ (ไม่ใช่เริ่มใหม่)

    // ---- Feedback 1.1 กลุ่ม C: Reopen Carton editor (Settings) ----
    reopenEditingCarton: null, // { id, cartonNo, ชื่องานId, ชื่องานName, ... }
    reopenEditItems: [], // [{barcode, name, sku, qty}]
    reopenEditItemsOriginal: [], // snapshot ก่อนแก้ไข ไว้ทำ diff สำหรับ log
    currentJobCartons: [], // เก็บ cartons ล่าสุดของงานนี้ไว้ใช้ตอน filter
    reportVisibility: { performance: true, stocktake: true, exportExcel: true }, // สิทธิ์การมองเห็น
    thresholds: { autoclose: 8, autosave: 3 }, // ค่าตั้งต้น B2
    _cartonSyncUnsub: null, // F8: Real-time multiplayer unsub
  };

  /* ----------------------------------------------------------------------
     2. TOAST NOTIFICATIONS
  ---------------------------------------------------------------------- */
  function toast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
    el.innerHTML = '<span>' + icon + '</span><span>' + escapeHtml(message) + '</span>';
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s ease';
      setTimeout(() => el.remove(), 200);
    }, 2600);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  /* ----------------------------------------------------------------------
     2b. SOUND FEEDBACK (Web Audio API — ไม่ต้องใช้ไฟล์เสียงภายนอก)
  ---------------------------------------------------------------------- */
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, durationMs, volume, type) {
    const ctx = getAudioCtx();
    if (!ctx || !state.soundEnabled) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'square'; // square/triangle ดังและคมกว่า sine เดิม ได้ยินชัดในที่มีเสียงรบกวน
      osc.frequency.value = freq;
      gain.gain.value = volume || 0.35;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
    } catch (e) { /* ignore audio errors */ }
  }

  function playScanSound(kind) {
    // kind: 'success' | 'duplicate' | 'notfound' | 'error'
    // ปรับให้ดังขึ้นและแยกจังหวะชัดเจนกว่าเดิม เพื่อให้ได้ยินแม้ในโกดังที่มีเสียงรบกวน
    if (kind === 'success') {
      beep(1500, 90, 0.32, 'triangle');
    } else if (kind === 'duplicate') {
      beep(1000, 80, 0.3); setTimeout(() => beep(1000, 80, 0.3), 120);
    } else if (kind === 'notfound') {
      beep(700, 150, 0.3, 'triangle');
    } else if (kind === 'error') {
      // เสียง error ดังรัว 3 จังหวะ ให้รู้สึกเด่นชัดว่าห้ามผ่าน
      beep(320, 130, 0.4); setTimeout(() => beep(320, 130, 0.4), 160); setTimeout(() => beep(320, 190, 0.4), 320);
      if (navigator.vibrate) { try { navigator.vibrate([80, 60, 80, 60, 120]); } catch (e) {} }
    }
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem(LS_KEYS.SOUND, state.soundEnabled ? '1' : '0');
    updateSoundBtn();
    if (state.soundEnabled) playScanSound('success');
  }

  function updateSoundBtn() {
    const btn = document.getElementById('btn-sound');
    if (btn) btn.textContent = state.soundEnabled ? '🔊' : '🔇';
  }

  /* ----------------------------------------------------------------------
     2d. เสียงพูด (Text-to-Speech) — พูดผลลัพธ์สำคัญเป็นภาษาไทย
     ใช้ Web Speech API (ในตัวเบราว์เซอร์ ไม่ต้องโหลดไฟล์เสียงเพิ่ม)
  ---------------------------------------------------------------------- */
  let thaiVoice = null;

  function loadThaiVoice() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      thaiVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('th')) || null;
    };
    pick();
    if (!thaiVoice && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }

  function speak(text) {
    if (!state.speechEnabled || !('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel(); // ตัดเสียงพูดก่อนหน้าที่ค้างอยู่ กันพูดซ้อนตอนสแกนรัวๆ
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'th-TH';
      if (thaiVoice) utter.voice = thaiVoice;
      utter.rate = 1.05;
      utter.volume = 1;
      window.speechSynthesis.speak(utter);
    } catch (e) { /* ignore speech errors */ }
  }

  function toggleSpeech() {
    state.speechEnabled = !state.speechEnabled;
    localStorage.setItem(LS_KEYS.SPEECH, state.speechEnabled ? '1' : '0');
    updateSpeechBtn();
    if (state.speechEnabled) speak('เปิดเสียงพูดแล้ว');
  }

  function updateSpeechBtn() {
    const btn = document.getElementById('btn-speech');
    if (btn) btn.classList.toggle('on', state.speechEnabled);
  }

  /* ----------------------------------------------------------------------
     2c. LANGUAGE (i18n) — สลับไทย/อังกฤษสำหรับข้อความหลักของหน้าจอ
     หมายเหตุ: ครอบคลุมข้อความคงที่หลักๆ (หัวข้อ, ปุ่ม, แท็บ, placeholder)
     ข้อความที่สร้างจากข้อมูลจริง (ชื่องาน, barcode, toast แจ้งเตือนผล) ยังเป็นภาษาไทยอยู่
  ---------------------------------------------------------------------- */
  const TRANSLATIONS = {
    app_subtitle: { th: 'RTVB2S — Scan Carton / SBC', en: 'RTVB2S — Carton / SBC Scanning' },
    nav_dashboard: { th: 'Dashboard', en: 'Dashboard' },
    nav_scan: { th: 'สแกน', en: 'Scan' },
    nav_report: { th: 'รายงาน', en: 'Report' },
    nav_changejob: { th: 'เปลี่ยนงาน', en: 'Change Job' },
    nav_changeuser: { th: 'เปลี่ยนคน', en: 'Change User' },
    title_user: { th: '👋 เลือกผู้ใช้งาน', en: '👋 Select User' },
    sub_user: { th: 'เลือกชื่อของคุณเพื่อเริ่มใช้งาน (ไม่ต้องใส่รหัสผ่าน)', en: 'Select your name to get started (no password needed)' },
    title_job: { th: '📋 เลือกชื่องาน', en: '📋 Select Job' },
    sub_job: { th: 'ต้องเลือกหรือสร้างชื่องานก่อน ถึงจะเริ่มสแกนได้', en: 'You must select or create a job before scanning' },
    job_list_title: { th: 'ชื่องานล่าสุด', en: 'Recent Jobs' },
    new_job_card_title: { th: 'สร้างชื่องานใหม่', en: 'Create New Job' },
    new_job_placeholder: { th: 'เช่น "เช้า 18/07", "บ่าย 18/07"', en: 'e.g. "Morning 18/07", "Afternoon 18/07"' },
    btn_create_job: { th: '+ สร้างชื่องาน', en: '+ Create Job' },
    title_carton: { th: '📦 สแกน Carton', en: '📦 Scan Carton' },
    carton_input_label: { th: 'สแกนหรือพิมพ์เลข Carton', en: 'Scan or type Carton No.' },
    carton_placeholder: { th: 'สแกน Carton No.', en: 'Scan Carton No.' },
    btn_start_carton: { th: 'เริ่มสแกน Carton นี้ →', en: 'Start scanning this Carton →' },
    carton_history_title: { th: 'Carton ที่ทำวันนี้ในงานนี้', en: "Today's Cartons in this Job" },
    title_sbc: { th: '🏷️ สแกน SBC', en: '🏷️ Scan SBC' },
    tab_scanonly: { th: 'Scan Only', en: 'Scan Only' },
    tab_scanqty: { th: 'Scan + Qty', en: 'Scan + Qty' },
    sbc_qty_label: { th: 'จำนวน (Qty)', en: 'Quantity' },
    sbc_input_label: { th: 'สแกนบาร์โค้ด SBC', en: 'Scan SBC Barcode' },
    sbc_placeholder: { th: 'สแกน Barcode...', en: 'Scan Barcode...' },
    sbc_list_title: { th: 'รายการที่สแกนใน Carton นี้', en: 'Items scanned in this Carton' },
    btn_finish_carton: { th: '✅ บันทึก / ปิด Carton นี้', en: '✅ Save / Close this Carton' },
    title_dashboard: { th: '📊 Dashboard', en: '📊 Dashboard' },
    btn_goto_carton: { th: '+ สแกน Carton ใหม่', en: '+ Scan New Carton' },
    btn_close_job: { th: '🔒 ปิดชื่องาน', en: '🔒 Close Job' },
    btn_reopen_job: { th: '↩️ เปิดชื่องานอีกครั้ง (Undo)', en: '↩️ Reopen Job (Undo)' },
    dash_carton_list_title: { th: 'Carton ล่าสุดในงานนี้', en: 'Recent Cartons in this Job' },
    title_report: { th: '📑 รายงาน (Report)', en: '📑 Report' },
    btn_report_changejob: { th: '📋 เลือกงาน', en: '📋 Select Job' },
    btn_report_export: { th: '📤 Export Excel', en: '📤 Export Excel' },
    btn_report_search_all: { th: '🔎 ค้นหาข้ามทุกงาน', en: '🔎 Search All Jobs' },
    btn_report_audit: { th: '📜 Audit Log', en: '📜 Audit Log' },
    tab_summary: { th: 'Summary', en: 'Summary' },
    tab_detail: { th: 'Details', en: 'Details' },
    tab_performance: { th: '🏆 ผลงาน', en: '🏆 Performance' },
    tab_stocktake: { th: '🧮 นับสต๊อก', en: '🧮 Stock Take' },
    report_filter_placeholder: { th: '🔍 ค้นหา Barcode / ชื่อ / เลข Carton ...', en: '🔍 Search Barcode / Name / Carton No...' },
    title_search_all: { th: '🔎 ค้นหาข้ามทุกงาน', en: '🔎 Search Across All Jobs' },
    sub_search_all: { th: 'ค้นหา Barcode / ชื่อสินค้า / SKU / เลข Carton ได้จากทุกชื่องานย้อนหลังทั้งหมด', en: 'Search Barcode / Name / SKU / Carton No. across all past jobs' },
    search_all_placeholder: { th: '🔍 พิมพ์ Barcode / ชื่อ / SKU / เลข Carton...', en: '🔍 Type Barcode / Name / SKU / Carton No...' },
    btn_back_to_report: { th: '← กลับไปหน้ารายงาน', en: '← Back to Report' },
    title_audit: { th: '📜 Audit Log', en: '📜 Audit Log' },
    audit_filter_placeholder: { th: '🔍 ค้นหาตามคน / ประเภท / รายละเอียด...', en: '🔍 Search by user / type / detail...' },
    title_master: { th: '📇 ตั้งค่าข้อมูลสินค้า (Excel)', en: '📇 Product Data Setup (Excel)' },
    btn_import_master: { th: '📥 นำเข้าข้อมูล (Import)', en: '📥 Import Data' },
    btn_clear_master: { th: '🗑️ ล้างข้อมูล Master', en: '🗑️ Clear Master Data' },
    btn_back: { th: '← ย้อนกลับ', en: '← Back' },
    title_setup: { th: '⚙️ ตั้งค่า Firebase', en: '⚙️ Firebase Setup' },
    btn_save_config: { th: 'บันทึกและเชื่อมต่อ', en: 'Save & Connect' },
    btn_clear_config: { th: 'ล้างค่า / กลับ Mockup', en: 'Clear / Back to Mockup' },
    btn_backup_export: { th: '📤 Export การตั้งค่า', en: '📤 Export Settings' },
    btn_backup_import: { th: '📥 Import การตั้งค่า', en: '📥 Import Settings' },
  };

  // { elementSelector, prop: 'textContent' | 'placeholder', key }
  const I18N_BINDINGS = [
    { sel: '.topbar .title small', prop: 'textContent', key: 'app_subtitle' },
    { sel: '#nav-dashboard .nav-label', prop: 'textContent', key: 'nav_dashboard' },
    { sel: '#nav-carton .nav-label', prop: 'textContent', key: 'nav_scan' },
    { sel: '#nav-report .nav-label', prop: 'textContent', key: 'nav_report' },
    { sel: '#nav-changejob .nav-label', prop: 'textContent', key: 'nav_changejob' },
    { sel: '#nav-changeuser .nav-label', prop: 'textContent', key: 'nav_changeuser' },
    { sel: '#screen-user .page-title', prop: 'textContent', key: 'title_user' },
    { sel: '#screen-user .page-sub', prop: 'textContent', key: 'sub_user' },
    { sel: '#screen-job .page-title', prop: 'textContent', key: 'title_job' },
    { sel: '#screen-job .page-sub', prop: 'textContent', key: 'sub_job' },
    { sel: '#screen-job .card-title', prop: 'textContent', key: 'new_job_card_title' },
    { sel: '#new-job-name', prop: 'placeholder', key: 'new_job_placeholder' },
    { sel: '#btn-create-job', prop: 'textContent', key: 'btn_create_job' },
    { sel: '#screen-carton .page-title', prop: 'textContent', key: 'title_carton' },
    { sel: '#carton-input', prop: 'placeholder', key: 'carton_placeholder' },
    { sel: '#btn-start-carton', prop: 'textContent', key: 'btn_start_carton' },
    { sel: '#screen-sbc .page-title', prop: 'textContent', key: 'title_sbc' },
    { sel: '#tab-scanonly', prop: 'textContent', key: 'tab_scanonly' },
    { sel: '#tab-scanqty', prop: 'textContent', key: 'tab_scanqty' },
    { sel: '#sbc-input', prop: 'placeholder', key: 'sbc_placeholder' },
    { sel: '#btn-finish-carton', prop: 'textContent', key: 'btn_finish_carton' },
    { sel: '#screen-dashboard .page-title', prop: 'textContent', key: 'title_dashboard' },
    { sel: '#btn-goto-carton', prop: 'textContent', key: 'btn_goto_carton' },
    { sel: '#btn-close-job', prop: 'textContent', key: 'btn_close_job' },
    { sel: '#btn-reopen-job', prop: 'textContent', key: 'btn_reopen_job' },
    { sel: '#screen-report .page-title', prop: 'textContent', key: 'title_report' },
    { sel: '#btn-report-changejob', prop: 'textContent', key: 'btn_report_changejob' },
    { sel: '#btn-report-export', prop: 'textContent', key: 'btn_report_export' },
    { sel: '#btn-report-search-all', prop: 'textContent', key: 'btn_report_search_all' },
    { sel: '#btn-report-audit', prop: 'textContent', key: 'btn_report_audit' },
    { sel: '#tab-report-summary', prop: 'textContent', key: 'tab_summary' },
    { sel: '#tab-report-detail', prop: 'textContent', key: 'tab_detail' },
    { sel: '#tab-report-performance', prop: 'textContent', key: 'tab_performance' },
    { sel: '#tab-report-stocktake', prop: 'textContent', key: 'tab_stocktake' },
    { sel: '#report-filter', prop: 'placeholder', key: 'report_filter_placeholder' },
    { sel: '#screen-search-all .page-title', prop: 'textContent', key: 'title_search_all' },
    { sel: '#screen-search-all .page-sub', prop: 'textContent', key: 'sub_search_all' },
    { sel: '#search-all-input', prop: 'placeholder', key: 'search_all_placeholder' },
    { sel: '#btn-search-all-back', prop: 'textContent', key: 'btn_back_to_report' },
    { sel: '#screen-audit .page-title', prop: 'textContent', key: 'title_audit' },
    { sel: '#audit-filter', prop: 'placeholder', key: 'audit_filter_placeholder' },
    { sel: '#btn-audit-back', prop: 'textContent', key: 'btn_back_to_report' },
    { sel: '#btn-import-master', prop: 'textContent', key: 'btn_import_master' },
    { sel: '#btn-clear-master', prop: 'textContent', key: 'btn_clear_master' },
    { sel: '#btn-master-back', prop: 'textContent', key: 'btn_back' },
    { sel: '#screen-setup .page-title', prop: 'textContent', key: 'title_setup' },
    { sel: '#btn-save-config', prop: 'textContent', key: 'btn_save_config' },
    { sel: '#btn-clear-config', prop: 'textContent', key: 'btn_clear_config' },
    { sel: '#btn-setup-back', prop: 'textContent', key: 'btn_back' },
    { sel: '#btn-backup-export', prop: 'textContent', key: 'btn_backup_export' },
    { sel: '#btn-backup-import', prop: 'textContent', key: 'btn_backup_import' },
  ];

  function applyLanguage(lang) {
    state.lang = lang;
    localStorage.setItem(LS_KEYS.LANG, lang);
    I18N_BINDINGS.forEach((b) => {
      const el = document.querySelector(b.sel);
      const entry = TRANSLATIONS[b.key];
      if (!el || !entry) return;
      el[b.prop] = entry[lang] || entry.th;
    });
    const btn = document.getElementById('btn-lang');
    if (btn) btn.textContent = lang === 'en' ? '🌐 EN' : '🌐 TH';
  }

  function toggleLanguage() {
    applyLanguage(state.lang === 'th' ? 'en' : 'th');
  }

  /* ----------------------------------------------------------------------
     3. MOCK DATABASE (in-memory, used when no Firebase config present)
  ---------------------------------------------------------------------- */
  const MockDB = (function () {
    let idCounter = 1;
    const store = {
      [COLLECTIONS.JOBS]: {},
      [COLLECTIONS.CARTONS]: {},
      [COLLECTIONS.CARTON_DETAILS]: {},
      [COLLECTIONS.SCAN_LOGS]: {},
      [COLLECTIONS.USERS]: {},
      [COLLECTIONS.PRESENCE]: {},
      [COLLECTIONS.SETTINGS]: {},
    };
    const listeners = {}; // collection -> [{filterJobId, cb}]

    function ensureCollection(collection) {
      if (!store[collection]) store[collection] = {};
      return store[collection];
    }

    function nextId(prefix) {
      return prefix + '_' + Date.now().toString(36) + '_' + (idCounter++);
    }

    function seedDemoData() {
      const today = new Date().toISOString().slice(0, 10);
      const jobId = nextId('job');
      store[COLLECTIONS.JOBS][jobId] = {
        id: jobId,
        name: 'เดโม เช้า ' + today,
        date: today,
        status: 'active',
        createdBy: 'u_nooey',
        createdByName: 'หนุ่ย',
        createdAt: new Date(Date.now() - 3600 * 1000),
      };

      const cartonId = nextId('carton');
      store[COLLECTIONS.CARTONS][cartonId] = {
        id: cartonId,
        cartonNo: 'CTN-DEMO-001',
        ชื่องานId: jobId,
        ชื่องานName: store[COLLECTIONS.JOBS][jobId].name,
        userId: 'u_yok',
        userName: 'หยก',
        totalSku: 2,
        totalQty: 5,
        status: 'closed', // ให้ตรงกับ CARTON_STATUS.CLOSED ของ lifecycle ใหม่ (Feedback 1.1)
        createdAt: new Date(Date.now() - 1800 * 1000),
      };

      ['SKU-DEMO-A', 'SKU-DEMO-B'].forEach((sku, i) => {
        const detId = nextId('det');
        store[COLLECTIONS.CARTON_DETAILS][detId] = {
          id: detId,
          cartonId: cartonId,
          ชื่องานId: jobId,
          sku: sku,
          barcode: sku,
          qty: i === 0 ? 3 : 2,
          createdAt: new Date(Date.now() - 1700 * 1000),
        };
      });
    }

    function notify(collection) {
      const subs = listeners[collection] || [];
      const rowsAll = Object.values(ensureCollection(collection));
      subs.forEach((sub) => {
        let rows = rowsAll;
        if (sub.filterJobId) {
          rows = rows.filter((r) => r.ชื่องานId === sub.filterJobId || r.id === sub.filterJobId);
        }
        sub.cb(rows);
      });
    }

    return {
      seedDemoData,
      add(collection, data) {
        const id = nextId(collection.slice(0, 3));
        ensureCollection(collection)[id] = Object.assign({ id }, data);
        notify(collection);
        return Promise.resolve(id);
      },
      addBatch(collection, dataArray) {
        const coll = ensureCollection(collection);
        dataArray.forEach((data) => {
          const id = nextId(collection.slice(0, 3));
          coll[id] = Object.assign({ id }, data);
        });
        notify(collection);
        return Promise.resolve();
      },
      update(collection, id, patch) {
        const coll = ensureCollection(collection);
        if (coll[id]) {
          Object.assign(coll[id], patch);
          notify(collection);
        }
        return Promise.resolve();
      },
      set(collection, id, data) {
        // upsert (merge) — ใช้กับ presence / settings ที่ต้องการ id คงที่
        const coll = ensureCollection(collection);
        coll[id] = Object.assign({}, coll[id] || {}, data, { id });
        notify(collection);
        const docKey = '__doc__' + collection + ':' + id;
        (listeners[docKey] || []).forEach((cb) => cb(Object.assign({}, coll[id])));
        return Promise.resolve();
      },
      getDoc(collection, id) {
        const coll = ensureCollection(collection);
        return Promise.resolve(coll[id] ? Object.assign({}, coll[id]) : null);
      },
      remove(collection, id) {
        const coll = ensureCollection(collection);
        delete coll[id];
        notify(collection);
        return Promise.resolve();
      },
      removeBatch(collection, ids) {
        const coll = ensureCollection(collection);
        ids.forEach((id) => delete coll[id]);
        notify(collection);
        return Promise.resolve();
      },
      getAll(collection) {
        return Promise.resolve(Object.values(ensureCollection(collection)));
      },
      listen(collection, filterJobId, cb) {
        listeners[collection] = listeners[collection] || [];
        const sub = { filterJobId, cb };
        listeners[collection].push(sub);
        // fire immediately
        let rows = Object.values(ensureCollection(collection));
        if (filterJobId) {
          rows = rows.filter((r) => r.ชื่องานId === filterJobId || r.id === filterJobId);
        }
        cb(rows);
        return function unsubscribe() {
          listeners[collection] = (listeners[collection] || []).filter((s) => s !== sub);
        };
      },
      listenDoc(collection, id, cb) {
        // สำหรับ mock: fire ทันทีครั้งเดียว แล้วอัพเดทเมื่อมีการ set() ทับ id เดิม
        listeners['__doc__' + collection + ':' + id] = listeners['__doc__' + collection + ':' + id] || [];
        const key = '__doc__' + collection + ':' + id;
        listeners[key].push(cb);
        const coll = ensureCollection(collection);
        cb(coll[id] ? Object.assign({}, coll[id]) : null);
        return function unsubscribe() {
          listeners[key] = (listeners[key] || []).filter((c) => c !== cb);
        };
      },
    };
  })();

  /* ----------------------------------------------------------------------
     4. FIREBASE (REAL MODE) WRAPPER
  ---------------------------------------------------------------------- */
  let firestoreDb = null;

  function initFirebaseIfPossible() {
    const cfg = getFirebaseConfig();
    if (!cfg) return false;
    try {
      if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK ไม่ถูกโหลด (อาจไม่มีอินเทอร์เน็ต) → ใช้ MOCKUP MODE แทน');
        return false;
      }
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      firestoreDb = firebase.firestore();
      return true;
    } catch (err) {
      console.error('Firebase init error:', err);
      return false;
    }
  }

  function getFirebaseConfig() {
    // Priority 1: js/env.js (generated from .env)
    if (window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.apiKey) {
      return window.__FIREBASE_CONFIG__;
    }
    // Priority 2: localStorage (set via Setup screen)
    const b64 = localStorage.getItem(LS_KEYS.FIREBASE_CFG);
    if (b64) {
      try {
        const json = decodeURIComponent(escape(atob(b64)));
        const cfg = JSON.parse(json);
        if (cfg && cfg.apiKey) return cfg;
      } catch (e) { /* ignore corrupt config */ }
    }
    return null;
  }

  function saveFirebaseConfigToLocalStorage(cfg) {
    const json = JSON.stringify(cfg);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    localStorage.setItem(LS_KEYS.FIREBASE_CFG, b64);
  }

  function clearFirebaseConfig() {
    localStorage.removeItem(LS_KEYS.FIREBASE_CFG);
  }

  /* ----------------------------------------------------------------------
     5. DATA ACCESS LAYER (routes to Mock or Real Firestore)
  ---------------------------------------------------------------------- */
  const DB = {
    async add(collection, data) {
      if (state.mode === 'real') {
        const ref = await firestoreDb.collection(collection).add(data);
        return ref.id;
      }
      return MockDB.add(collection, data);
    },
    async addBatch(collection, dataArray) {
      if (state.mode === 'real') {
        const batch = firestoreDb.batch();
        dataArray.forEach((data) => {
          const ref = firestoreDb.collection(collection).doc();
          batch.set(ref, data);
        });
        await batch.commit();
        return;
      }
      return MockDB.addBatch(collection, dataArray);
    },
    async update(collection, id, patch) {
      if (state.mode === 'real') {
        await firestoreDb.collection(collection).doc(id).update(patch);
        return;
      }
      return MockDB.update(collection, id, patch);
    },
    async getAll(collection) {
      if (state.mode === 'real') {
        const snap = await firestoreDb.collection(collection).get();
        return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      }
      return MockDB.getAll(collection);
    },
    listen(collection, filterJobId, cb) {
      if (state.mode === 'real') {
        let q = firestoreDb.collection(collection);
        if (filterJobId) q = q.where('ชื่องานId', '==', filterJobId);
        const unsub = q.onSnapshot(
          (snap) => cb(snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))),
          (err) => { console.error('onSnapshot error:', err); toast('เชื่อมต่อ Realtime ผิดพลาด: ' + err.message, 'error'); }
        );
        return unsub;
      }
      return MockDB.listen(collection, filterJobId, cb);
    },
    async set(collection, id, data) {
      // upsert (merge) — ใช้กับ presence / settings
      if (state.mode === 'real') {
        await firestoreDb.collection(collection).doc(id).set(data, { merge: true });
        return;
      }
      return MockDB.set(collection, id, data);
    },
    async getDoc(collection, id) {
      if (state.mode === 'real') {
        const snap = await firestoreDb.collection(collection).doc(id).get();
        return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
      }
      return MockDB.getDoc(collection, id);
    },
    async delete(collection, id) {
      if (state.mode === 'real') {
        await firestoreDb.collection(collection).doc(id).delete();
        return;
      }
      return MockDB.remove(collection, id);
    },
    async deleteBatch(collection, ids) {
      if (!ids.length) return;
      if (state.mode === 'real') {
        const batch = firestoreDb.batch();
        ids.forEach((id) => batch.delete(firestoreDb.collection(collection).doc(id)));
        await batch.commit();
        return;
      }
      return MockDB.removeBatch(collection, ids);
    },
    listenDoc(collection, id, cb) {
      if (state.mode === 'real') {
        const unsub = firestoreDb.collection(collection).doc(id).onSnapshot(
          (snap) => cb(snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null),
          (err) => { console.error('onSnapshot(doc) error:', err); }
        );
        return unsub;
      }
      return MockDB.listenDoc(collection, id, cb);
    },
  };

  function clearListeners() {
    state.unsubscribers.forEach((u) => { try { u(); } catch (e) {} });
    state.unsubscribers = [];
  }

  /* ----------------------------------------------------------------------
     5b. PRESENCE — ใครกำลังใช้งานในชื่องานเดียวกัน (Realtime)
  ---------------------------------------------------------------------- */
  const PRESENCE_HEARTBEAT_MS = 15000;
  const PRESENCE_STALE_MS = 40000; // ถือว่า offline ถ้าไม่อัพเดทเกิน 40 วิ
  const REOPEN_WINDOW_MS = 5 * 60 * 1000; // Undo ปิดชื่องานได้ภายใน 5 นาที

  function presenceDocId(jobId, userId) {
    return jobId + '__' + userId;
  }

  async function sendPresenceHeartbeat() {
    if (!state.currentUser || !state.currentJob) return;
    try {
      await DB.set(COLLECTIONS.PRESENCE, presenceDocId(state.currentJob.id, state.currentUser.id), {
        ชื่องานId: state.currentJob.id,
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        color: state.currentUser.color,
        lastSeen: Date.now(),
        // Feedback 1.1 ฟีเจอร์เสริม #5 — บอกให้ทีมรู้ว่ากำลังล็อกอยู่ที่ Carton ไหน (ถ้ามี)
        lockedCartonNo: isScanLocked() && state.currentCarton ? state.currentCarton.cartonNo : null,
      });
    } catch (e) { /* เงียบไว้ ไม่ต้องรบกวนผู้ใช้ถ้า heartbeat ล้มเหลวชั่วคราว */ }
  }

  function startPresenceTracking(job) {
    stopPresenceTracking();
    if (!job || !state.currentUser) return;
    sendPresenceHeartbeat();
    state.presenceHeartbeatTimer = setInterval(sendPresenceHeartbeat, PRESENCE_HEARTBEAT_MS);
    state.presenceListenUnsub = DB.listen(COLLECTIONS.PRESENCE, job.id, renderPresence);
  }

  function stopPresenceTracking() {
    if (state.presenceHeartbeatTimer) {
      clearInterval(state.presenceHeartbeatTimer);
      state.presenceHeartbeatTimer = null;
    }
    if (state.presenceListenUnsub) {
      try { state.presenceListenUnsub(); } catch (e) {}
      state.presenceListenUnsub = null;
    }
    const bar = document.getElementById('presence-bar');
    if (bar) bar.style.display = 'none';
  }

  function renderPresence(rows) {
    const bar = document.getElementById('presence-bar');
    const avatarsEl = document.getElementById('presence-avatars');
    if (!bar || !avatarsEl) return;

    const now = Date.now();
    const online = rows.filter((r) => r.lastSeen && (now - r.lastSeen) < PRESENCE_STALE_MS);
    // เอาแค่ 1 รายการต่อคน (กันซ้ำ)
    const byUser = {};
    online.forEach((r) => { byUser[r.userId] = r; });
    const list = Object.values(byUser).sort((a, b) => (a.userId === state.currentUser.id ? -1 : 1));

    if (!list.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    document.querySelector('.presence-label').textContent =
      '🟢 กำลังใช้งานในงานนี้ (' + list.length + ' คน):';
    avatarsEl.innerHTML = list.map((u) => {
      const isMe = state.currentUser && u.userId === state.currentUser.id;
      const lockNote = u.lockedCartonNo ? ' — 🔒 กำลังล็อกอยู่ที่ Carton ' + escapeHtml(u.lockedCartonNo) : '';
      return `
        <div class="presence-avatar" data-me="${isMe ? '1' : '0'}" style="background:${u.color || '#3b82f6'};">
          ${escapeHtml((u.userName || '?').charAt(0))}${u.lockedCartonNo ? '<span class="presence-lock-dot">🔒</span>' : ''}
          <span class="presence-tooltip">${escapeHtml(u.userName)}${isMe ? ' (คุณ)' : ''}${lockNote}</span>
        </div>
      `;
    }).join('');
  }

  /* ----------------------------------------------------------------------
     5c. AUDIT LOG — บันทึกประวัติการทำงานสำคัญ
  ---------------------------------------------------------------------- */
  function writeAuditLog(action, detail) {
    if (!state.currentJob || !state.currentUser) return;
    DB.add(COLLECTIONS.AUDIT_LOGS, {
      ชื่องานId: state.currentJob.id,
      action,
      detail: detail || '',
      userId: state.currentUser.id,
      userName: state.currentUser.name,
      createdAt: nowValue(),
    }).catch((err) => console.error('writeAuditLog error:', err));
  }

  /* ----------------------------------------------------------------------
     5d. BROWSER NOTIFICATIONS (local, ไม่ใช่ push แจ้งเตือนแบบปิดแอปแล้วยังได้รับ)
     ทำงานเฉพาะตอนแท็บ/แอปเปิดอยู่เบื้องหลัง (background tab) ผ่าน Notification API
  ---------------------------------------------------------------------- */
  function updateNotifyUI() {
    const btn = document.getElementById('btn-notify-toggle');
    const status = document.getElementById('notify-status');
    if (!btn || !status) return;
    if (!('Notification' in window)) {
      btn.disabled = true;
      status.textContent = 'สถานะ: เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน';
      return;
    }
    if (state.notifyEnabled && Notification.permission === 'granted') {
      btn.textContent = '🔕 ปิดการแจ้งเตือน';
      status.textContent = 'สถานะ: เปิดอยู่ ✅';
    } else {
      btn.textContent = '🔔 เปิดการแจ้งเตือน';
      status.textContent = 'สถานะ: ปิดอยู่' + (Notification.permission === 'denied' ? ' (ถูกบล็อกสิทธิ์ — ต้องไปเปิดในตั้งค่าเบราว์เซอร์)' : '');
    }
  }

  async function toggleNotify() {
    if (!('Notification' in window)) {
      toast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน', 'error');
      return;
    }
    if (state.notifyEnabled) {
      state.notifyEnabled = false;
      localStorage.setItem(LS_KEYS.NOTIFY, '0');
      updateNotifyUI();
      toast('ปิดการแจ้งเตือนแล้ว', 'info');
      clearFcmToken();
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      state.notifyEnabled = true;
      localStorage.setItem(LS_KEYS.NOTIFY, '1');
      toast('เปิดการแจ้งเตือนสำเร็จ 🔔', 'success');
      sendLocalNotification('SBG-Warehouse', 'เปิดการแจ้งเตือนเรียบร้อย — จะแจ้งเมื่อมีคนปิดงาน หรือสแกน Carton ใหม่');
      registerFcmToken();
    } else {
      toast('ไม่ได้รับอนุญาตให้แจ้งเตือน', 'error');
    }
    updateNotifyUI();
  }

  function sendLocalNotification(title, body) {
    if (!state.notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg && reg.showNotification) {
            reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
          } else {
            new Notification(title, { body, icon: 'icons/icon-192.png' });
          }
        }).catch(() => new Notification(title, { body, icon: 'icons/icon-192.png' }));
      } else {
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      }
    } catch (e) { /* ignore notification errors */ }
  }

  /* ----------------------------------------------------------------------
     5e. FIREBASE CLOUD MESSAGING (FCM) — Push แม้ปิดแอป
     ทำงานร่วมกับ Backend บน Render ที่ฟัง Firestore แล้วยิง push ผ่าน token เหล่านี้
  ---------------------------------------------------------------------- */
  async function registerFcmToken() {
    if (state.mode !== 'real') {
      toast('Push แบบปิดแอปได้ ใช้ได้เฉพาะ REAL MODE (ต้องเชื่อม Firebase จริง) — ตอนนี้ยังเป็นแค่แจ้งเตือนตอนเปิดแอปทิ้งไว้', 'info');
      return;
    }
    const vapidKey = window.__FIREBASE_VAPID_KEY__;
    if (!vapidKey) {
      console.warn('[FCM] ไม่พบ FIREBASE_VAPID_KEY — ข้ามการลงทะเบียน push token (ยังใช้ local notification ได้ตามปกติ)');
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      console.warn('[FCM] firebase-messaging SDK ไม่พร้อมใช้งาน');
      return;
    }
    if (!state.currentUser) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: reg });
      if (!token) return;

      await DB.set(COLLECTIONS.FCM_TOKENS, state.currentUser.id, {
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        token,
        jobId: state.currentJob ? state.currentJob.id : null,
        updatedAt: Date.now(),
      });
      console.log('[FCM] ลงทะเบียน push token สำเร็จ');
    } catch (err) {
      console.error('[FCM] registerFcmToken error:', err);
      toast('ลงทะเบียน Push Notification ไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  function clearFcmToken() {
    if (state.mode !== 'real' || !state.currentUser) return;
    DB.set(COLLECTIONS.FCM_TOKENS, state.currentUser.id, { token: null, updatedAt: Date.now() })
      .catch((err) => console.error('[FCM] clearFcmToken error:', err));
  }

  function updateFcmTokenJobId() {
    // เรียกทุกครั้งที่เปลี่ยนชื่องาน เพื่อให้ Backend รู้ว่าตอนนี้ควรส่ง push ของงานไหนมาหาใคร
    if (state.mode !== 'real' || !state.notifyEnabled || !state.currentUser) return;
    DB.set(COLLECTIONS.FCM_TOKENS, state.currentUser.id, {
      jobId: state.currentJob ? state.currentJob.id : null,
      updatedAt: Date.now(),
    }).catch((err) => console.error('[FCM] updateFcmTokenJobId error:', err));
  }

  function initFcmForegroundHandler() {
    // รับ push ตอนแอปเปิดอยู่เบื้องหน้า (background message จะถูกจัดการใน service-worker.js แทน)
    if (state.mode !== 'real' || typeof firebase === 'undefined' || !firebase.messaging) return;
    try {
      const messaging = firebase.messaging();
      messaging.onMessage((payload) => {
        const title = (payload.notification && payload.notification.title) || 'SBG-Warehouse';
        const body = (payload.notification && payload.notification.body) || '';
        toast(title + (body ? ' — ' + body : ''), 'info');
        playScanSound('notfound'); // ใช้เสียงเดียวกับแจ้งเตือนทั่วไป
      });
    } catch (e) { console.warn('[FCM] initFcmForegroundHandler error:', e); }
  }


  const SCREEN_TO_NAV = {
    'screen-dashboard': 'dashboard',
    'screen-carton': 'carton',
    'screen-sbc': 'carton',
    'screen-report': 'report',
    'screen-job': 'job',
    'screen-user': 'user',
  };

  function showScreen(id) {
    stopCamera();
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    updateFooterNav();
    setActiveNav(SCREEN_TO_NAV[id] || null);
    autoFocus(id);
  }

  /* ----------------------------------------------------------------------
     6b. REUSABLE CONFIRM MODAL ENGINE (Feedback 1.1 ฟีเจอร์เสริม #3)
     ใช้แทน confirm()/alert() ของเบราว์เซอร์ทุกจุดที่เกี่ยวกับ Carton/Job lifecycle
     คืนค่าเป็น Promise<boolean> — true = กดปุ่มยืนยัน, false = กดยกเลิก/ปิด
  ---------------------------------------------------------------------- */
  function showConfirmModal(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-modal-title');
      const msgEl = document.getElementById('confirm-modal-message');
      const listEl = document.getElementById('confirm-modal-list');
      const cancelBtn = document.getElementById('confirm-modal-cancel');
      const confirmBtn = document.getElementById('confirm-modal-confirm');

      titleEl.textContent = opts.title || '';
      msgEl.innerHTML = escapeHtml(opts.message || '').replace(/\n/g, '<br>');

      if (opts.listItems && opts.listItems.length) {
        listEl.style.display = 'block';
        listEl.innerHTML = opts.listItems.map((li) => '<div class="cm-list-item">' + escapeHtml(li) + '</div>').join('');
      } else {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
      }

      cancelBtn.style.display = opts.hideCancel ? 'none' : 'inline-flex';
      cancelBtn.textContent = opts.cancelText || 'ยกเลิก';
      confirmBtn.textContent = opts.confirmText || 'ตกลง';
      confirmBtn.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
      overlay.style.display = 'flex';

      function cleanup(result) {
        overlay.style.display = 'none';
        cancelBtn.removeEventListener('click', onCancel);
        confirmBtn.removeEventListener('click', onConfirm);
        overlay.removeEventListener('click', onOverlayClick);
        resolve(result);
      }
      function onCancel() { cleanup(false); }
      function onConfirm() { cleanup(true); }
      function onOverlayClick(e) { if (e.target === overlay && !opts.hideCancel) cleanup(false); }
      cancelBtn.addEventListener('click', onCancel);
      confirmBtn.addEventListener('click', onConfirm);
      overlay.addEventListener('click', onOverlayClick);
    });
  }

  /* ----------------------------------------------------------------------
     6c. NAVIGATION LOCK (Feedback 1.1 #9) — ล็อกหน้า Scan SBC 100%
     ไม่มีทางออกฉุกเฉิน จนกว่าจะกด "บันทึก/ปิด Carton" หรือ "ยกเลิก (เก็บ Draft)"
  ---------------------------------------------------------------------- */
  function isScanLocked() {
    const sbcScreen = document.getElementById('screen-sbc');
    return !!(state.currentCarton && sbcScreen && sbcScreen.classList.contains('active'));
  }

  async function guardNavigation(action) {
    if (!isScanLocked()) { action(); return; }
    await showConfirmModal({
      title: '🔒 กำลังสแกนอยู่ ออกจากหน้านี้ไม่ได้',
      message: 'คุณกำลังสแกน Carton "' + (state.currentCarton ? state.currentCarton.cartonNo : '') +
        '" อยู่\n\nกรุณากด "✅ บันทึก / ปิด Carton นี้" หรือ "🚫 ยกเลิก (เก็บ Draft)" ที่ด้านล่างของหน้าสแกนก่อน จึงจะไปหน้าอื่นได้',
      confirmText: 'เข้าใจแล้ว',
      hideCancel: true,
    });
  }

  function updateFooterNav() {
    const footer = document.getElementById('footer-nav');
    footer.style.display = state.currentUser ? 'flex' : 'none';
  }

  function setActiveNav(navKey) {
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', navKey !== null && tab.dataset.nav === navKey);
    });
  }

  function autoFocus(screenId) {
    setTimeout(() => {
      const map = {
        'screen-job': 'new-job-name',
        'screen-carton': 'carton-input',
        'screen-sbc': 'sbc-input',
      };
      const fieldId = map[screenId];
      if (fieldId) {
        const el = document.getElementById(fieldId);
        if (el) el.focus();
      }
    }, 80);
  }

  /* ----------------------------------------------------------------------
     7. MODE BADGE UI
  ---------------------------------------------------------------------- */
  function updateModeBadge() {
    const badge = document.getElementById('mode-badge');
    badge.classList.remove('mock', 'setup', 'real');
    if (state.mode === 'real') {
      badge.textContent = 'REAL';
      badge.classList.add('real');
    } else {
      badge.textContent = 'MOCKUP';
      badge.classList.add('mock');
    }
    const banner = document.getElementById('mockup-banner-user');
    if (banner) banner.style.display = state.mode === 'mockup' ? 'flex' : 'none';
  }

  function updateUserChip() {
    const chip = document.getElementById('chip-user');
    const chipName = document.getElementById('chip-user-name');
    if (state.currentUser) {
      chip.style.display = 'flex';
      chipName.textContent = state.currentUser.name;
      chip.querySelector('.dot').style.background = state.currentUser.color;
    } else {
      chip.style.display = 'none';
    }
  }

  /* ----------------------------------------------------------------------
     7b. THEME (Dark / Light)
  ---------------------------------------------------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
    localStorage.setItem(LS_KEYS.THEME, theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  function initTheme() {
    const saved = localStorage.getItem(LS_KEYS.THEME);
    if (saved) { applyTheme(saved); return; }
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  }

  /* ----------------------------------------------------------------------
     7c. JOB BANNER (big, always-visible current job name)
  ---------------------------------------------------------------------- */
  function updateJobBanner() {
    const banner = document.getElementById('job-banner');
    const nameEl = document.getElementById('job-banner-name');
    const labelEl = banner.querySelector('.job-banner-label');
    if (state.currentJob) {
      banner.style.display = 'block';
      nameEl.textContent = state.currentJob.name;
      labelEl.textContent = state.currentJob.status === 'closed' ? 'ปิดงานแล้ว' : 'กำลังทำงาน';
    } else {
      banner.style.display = 'none';
    }
  }

  /* ----------------------------------------------------------------------
     8. SCREEN: USER SELECT
  ---------------------------------------------------------------------- */
  function renderUserGrid() {
    const grid = document.getElementById('user-grid');
    grid.innerHTML = state.usersList.map((u) => `
      <div class="user-card" data-user-id="${u.id}" style="border-color:${u.color}22;">
        <div class="user-avatar" style="background:${u.color};">${escapeHtml(u.name.charAt(0))}</div>
        <div class="user-name">${escapeHtml(u.name)}</div>
      </div>
    `).join('');
    grid.querySelectorAll('.user-card').forEach((card) => {
      card.addEventListener('click', () => {
        const user = state.usersList.find((u) => u.id === card.dataset.userId);
        selectUser(user);
      });
    });
  }

  function selectUser(user) {
    state.currentUser = user;
    localStorage.setItem(LS_KEYS.CURRENT_USER, JSON.stringify(user));
    updateUserChip();
    toast('สวัสดี ' + user.name + ' 👋', 'success');
    goToJobScreen();
  }

  /* ----------------------------------------------------------------------
     9. SCREEN: JOB (ชื่องาน) LIST
  ---------------------------------------------------------------------- */
  function goToJobScreen() {
    clearListeners();
    showScreen('screen-job');
    const unsub = DB.listen(COLLECTIONS.JOBS, null, renderJobList);
    state.unsubscribers.push(unsub);
  }

  function renderJobList(jobs) {
    jobs.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    const list = document.getElementById('job-list');
    if (!jobs.length) {
      list.innerHTML = '<div class="empty-state"><div class="emoji">📭</div>ยังไม่มีชื่องาน<br>สร้างชื่องานใหม่ด้านบนเพื่อเริ่มต้น</div>';
      return;
    }
    list.innerHTML = jobs.map((job) => `
      <div class="job-item" data-job-id="${job.id}">
        <div>
          <div class="job-name">${escapeHtml(job.name)}</div>
          <div class="job-meta">โดย ${escapeHtml(job.createdByName || '-')} · ${formatDate(job.createdAt)}</div>
        </div>
        <span class="status-pill ${job.status === 'active' ? 'active' : 'closed'}">
          ${job.status === 'active' ? '🟢 กำลังทำงาน' : '⚪ ปิดแล้ว'}
        </span>
      </div>
    `).join('');
    list.querySelectorAll('.job-item').forEach((item) => {
      item.addEventListener('click', () => {
        const job = jobs.find((j) => j.id === item.dataset.jobId);
        selectJob(job);
      });
    });
  }

  async function createJob() {
    const input = document.getElementById('new-job-name');
    const name = input.value.trim();
    if (!name) { toast('กรุณาใส่ชื่องาน', 'error'); return; }
    if (!state.currentUser) { toast('กรุณาเลือกผู้ใช้งานก่อน', 'error'); return; }
    try {
      // Feedback 1.1 #8 — ชื่องานห้ามซ้ำ (ตรวจแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และเว้นวรรคหัวท้าย)
      const existingJobs = await DB.getAll(COLLECTIONS.JOBS);
      const dup = existingJobs.find((j) => (j.name || '').trim().toLowerCase() === name.toLowerCase());
      if (dup) {
        toast('มีชื่องาน "' + name + '" อยู่แล้ว กรุณาตั้งชื่ออื่น', 'error');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const jobData = {
        name,
        date: today,
        status: 'active',
        createdBy: state.currentUser.id,
        createdByName: state.currentUser.name,
        createdAt: nowValue(),
        lastActivityAt: nowValue(),
      };
      const id = await DB.add(COLLECTIONS.JOBS, jobData);
      input.value = '';
      toast('สร้างชื่องาน "' + name + '" สำเร็จ', 'success');
      const newJob = Object.assign({ id }, jobData);
      selectJob(newJob);
      writeAuditLog('สร้างชื่องาน', 'สร้างโดย ' + state.currentUser.name);
    } catch (err) {
      console.error(err);
      toast('สร้างชื่องานไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  function selectJob(job) {
    if (job.status === 'closed') {
      toast('ชื่องานนี้ปิดแล้ว ไม่สามารถสแกนเพิ่มได้ — ดูได้ที่ Dashboard', 'info');
    }
    state.currentJob = job;
    localStorage.setItem(LS_KEYS.CURRENT_JOB, JSON.stringify(job));
    updateJobBanner();
    startPresenceTracking(job);
    updateFcmTokenJobId();
    goToDashboard();
  }

  /* ----------------------------------------------------------------------
     10. SCREEN: DASHBOARD
  ---------------------------------------------------------------------- */
  function goToDashboard() {
    clearListeners();
    if (!state.currentJob) { goToJobScreen(); return; }
    showScreen('screen-dashboard');
    document.getElementById('dash-job-name').textContent = state.currentJob.name;
    state.knownCartonIds = null; // reset baseline สำหรับตรวจจับ Carton ใหม่รอบนี้

    const unsubCartons = DB.listen(COLLECTIONS.CARTONS, state.currentJob.id, (cartons) => {
      state.currentJobCartons = cartons;
      renderDashboard(cartons);
    });
    state.unsubscribers.push(unsubCartons);

    // keep job status live
    let lastKnownStatus = state.currentJob.status;
    const unsubJobs = DB.listen(COLLECTIONS.JOBS, null, (jobs) => {
      const fresh = jobs.find((j) => j.id === state.currentJob.id);
      if (fresh) {
        const statusChanged = fresh.status !== lastKnownStatus;
        state.currentJob = fresh;
        const pill = document.getElementById('dash-job-status');
        pill.textContent = fresh.status === 'active' ? '🟢 กำลังทำงาน' : '⚪ ปิดแล้ว';
        pill.className = 'status-pill ' + (fresh.status === 'active' ? 'active' : 'closed');
        document.getElementById('btn-close-job').disabled = fresh.status !== 'active';
        document.getElementById('btn-goto-carton').disabled = fresh.status !== 'active';
        updateJobBanner();
        updateReopenButton(fresh);

        if (statusChanged && fresh.status === 'closed' && (!state.currentUser || fresh.closedByUserId !== state.currentUser.id)) {
          sendLocalNotification('📋 ' + fresh.name, 'ชื่องานถูกปิดแล้ว โดย ' + (fresh.closedByName || '-'));
        }
        lastKnownStatus = fresh.status;
      }
    });
    state.unsubscribers.push(unsubJobs);
  }

  function updateReopenButton(job) {
    const btn = document.getElementById('btn-reopen-job');
    if (!btn) return;
    const closedMs = toMillis(job.closedAt);
    const withinWindow = job.status === 'closed' && closedMs && (Date.now() - closedMs) < REOPEN_WINDOW_MS;
    btn.style.display = withinWindow ? 'block' : 'none';
  }

  function getActiveFilter(prefix) {
    const activeChip = document.querySelector(`#screen-${prefix === 'dash' ? 'dashboard' : 'carton'} .filter-chip.active`);
    return activeChip ? activeChip.dataset.filter : 'all';
  }

  function setupFilterListeners() {
    ['dash', 'carton-history'].forEach(prefix => {
      const container = prefix === 'dash' ? document.getElementById('screen-dashboard') : document.getElementById('screen-carton');
      if (!container) return;
      container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          if (prefix === 'dash') renderDashboard(state.currentJobCartons);
          else renderCartonHistory(state.currentJobCartons);
        });
      });
      const searchInput = document.getElementById(`${prefix}-search`);
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          if (prefix === 'dash') renderDashboard(state.currentJobCartons);
          else renderCartonHistory(state.currentJobCartons);
        });
      }
    });
  }

  function renderDashboard(cartons) {
    if (!cartons) cartons = [];
    const closedCartons = cartons.filter((c) => (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED);
    const totalSku = closedCartons.reduce((s, c) => s + (c.totalSku || 0), 0);
    const totalQty = closedCartons.reduce((s, c) => s + (c.totalQty || 0), 0);
    document.getElementById('dash-cartons').textContent = closedCartons.length;
    document.getElementById('dash-sku').textContent = totalSku;
    document.getElementById('dash-qty').textContent = totalQty;

    const currentIds = new Set(closedCartons.map((c) => c.id));
    if (state.knownCartonIds) {
      closedCartons.forEach((c) => {
        if (!state.knownCartonIds.has(c.id) && (!state.currentUser || c.userId !== state.currentUser.id)) {
          sendLocalNotification('📦 Carton ใหม่: ' + c.cartonNo, (c.userName || '-') + ' สแกน ' + (c.totalSku || 0) + ' SKU / ' + (c.totalQty || 0) + ' ชิ้น');
        }
      });
    }
    state.knownCartonIds = currentIds;

    const list = document.getElementById('dash-carton-list');
    const filter = getActiveFilter('dash');
    const search = (document.getElementById('dash-carton-search').value || '').trim().toLowerCase();

    const sorted = cartons.slice().sort((a, b) => {
      const aIsClosed = (a.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED;
      const bIsClosed = (b.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED;
      const aTime = aIsClosed ? toMillis(a.closedAt || a.createdAt) : toMillis(a.createdAt);
      const bTime = bIsClosed ? toMillis(b.closedAt || b.createdAt) : toMillis(b.createdAt);
      return bTime - aTime;
    });

    const filtered = sorted.filter(c => {
      const isDraft = (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.DRAFT;
      const isMe = state.currentUser && c.userId === state.currentUser.id;
      if (filter === 'draft' && !isDraft) return false;
      if (filter === 'closed' && isDraft) return false;
      if (filter === 'my' && !isMe) return false;
      if (search && !(c.cartonNo || '').toLowerCase().includes(search)) return false;
      return true;
    });

    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state"><div class="emoji">📦</div>ยังไม่มี Carton ที่ตรงเงื่อนไข</div>';
      return;
    }

    list.innerHTML = filtered.map((c) => {
      const isMe = state.currentUser && c.userId === state.currentUser.id;
      const isDraft = (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.DRAFT;
      const isClosed = !isDraft;
      const closedAtMs = isClosed ? toMillis(c.closedAt || c.createdAt) : 0;
      const isRecent = isClosed && (Date.now() - closedAtMs) < 7 * 24 * 60 * 60 * 1000;
      
      const editedBadge = c.lastReopenEditAt 
        ? `<span class="qty-badge" title="แก้ไขล่าสุดโดย ${escapeHtml(c.lastReopenEditBy || '?')} เมื่อ ${formatTime(c.lastReopenEditAt)}">✏️ แก้ไขแล้ว</span>` 
        : '';
        
      const editBtn = isRecent 
        ? `<button class="btn small ghost btn-inline-edit" data-carton-id="${escapeHtml(c.id)}" style="margin-left: 8px;">✏️ แก้ไข</button>` 
        : '';

      return `
        <div class="scan-row ${isMe ? 'by-me' : ''} ${isDraft ? 'draft-row' : ''}" data-carton-id="${escapeHtml(c.id)}" data-status="${isDraft ? 'draft' : 'closed'}">
          <div style="flex:1;">
            <div class="barcode">${escapeHtml(c.cartonNo)} ${isDraft ? '<span class="status-pill draft">📝 Draft</span>' : ''}</div>
            <div class="meta">${escapeHtml(c.userName)}${isMe ? ' (คุณ)' : ''} · ${c.totalSku || 0} SKU / ${c.totalQty || 0} Qty</div>
          </div>
          <div style="display: flex; align-items: center;">
            ${editedBadge}
            <span class="qty-badge" style="margin-left: 6px;">${formatTime(isClosed ? (c.closedAt || c.createdAt) : c.createdAt)}</span>
            ${editBtn}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.scan-row[data-status="draft"]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-inline-edit')) return;
        const carton = cartons.find((c) => c.id === row.dataset.cartonId);
        if (carton) resumeDraftCarton(carton);
      });
    });
    
    list.querySelectorAll('.btn-inline-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const carton = cartons.find((c) => c.id === btn.dataset.cartonId);
        if (carton) initInlineEditCarton(carton);
      });
    });
  }

  async function closeJob() {
    if (!state.currentJob) return;
    const confirmed = await showConfirmModal({
      title: '🔒 ยืนยันปิดชื่องาน',
      message: 'ยืนยันปิดชื่องาน "' + state.currentJob.name + '" ใช่หรือไม่?\nหลังปิดแล้วจะสแกนเพิ่มไม่ได้ (สามารถกด Undo เปิดกลับได้ภายใน ' + Math.round(REOPEN_WINDOW_MS / 60000) + ' นาทีที่ Dashboard)',
      confirmText: 'ยืนยันปิดงาน',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await DB.update(COLLECTIONS.JOBS, state.currentJob.id, {
        status: 'closed',
        closedAt: nowValue(),
        closedByUserId: state.currentUser.id,
        closedByName: state.currentUser.name,
      });
      writeAuditLog('ปิดชื่องาน', 'ปิดโดย ' + state.currentUser.name);
      toast('ปิดชื่องานเรียบร้อย', 'success');
      speak('ปิดชื่องานเรียบร้อย');
    } catch (err) {
      toast('ปิดชื่องานไม่สำเร็จ: ' + err.message, 'error');
      speak('ปิดชื่องานไม่สำเร็จ');
    }
  }

  async function reopenJob() {
    if (!state.currentJob) return;
    const confirmed = await showConfirmModal({
      title: '↩️ เปิดชื่องานอีกครั้ง',
      message: 'เปิดชื่องาน "' + state.currentJob.name + '" กลับมาใช้งานอีกครั้งใช่หรือไม่?',
      confirmText: 'เปิดอีกครั้ง',
    });
    if (!confirmed) return;
    try {
      await DB.update(COLLECTIONS.JOBS, state.currentJob.id, {
        status: 'active',
        closedAt: null,
        closedByUserId: null,
        closedByName: null,
        reopenedAt: nowValue(),
        reopenedByName: state.currentUser.name,
      });
      writeAuditLog('เปิดชื่องานอีกครั้ง (Undo)', 'เปิดโดย ' + state.currentUser.name);
      toast('เปิดชื่องานอีกครั้งเรียบร้อย', 'success');
      speak('เปิดชื่องานอีกครั้งเรียบร้อย');
    } catch (err) {
      toast('เปิดชื่องานไม่สำเร็จ: ' + err.message, 'error');
      speak('เปิดชื่องานไม่สำเร็จ');
    }
  }

  /* ----------------------------------------------------------------------
     11. SCREEN: SCAN CARTON
  ---------------------------------------------------------------------- */
  function goToCartonScreen() {
    if (!state.currentJob) { goToJobScreen(); return; }
    if (state.currentJob.status === 'closed') {
      toast('ชื่องานนี้ปิดแล้ว ไม่สามารถสแกนเพิ่มได้', 'error');
      return;
    }
    clearListeners();
    showScreen('screen-carton');
    document.getElementById('carton-job-name').textContent = state.currentJob.name;
    document.getElementById('carton-input').value = '';

    const unsub = DB.listen(COLLECTIONS.CARTONS, state.currentJob.id, (cartons) => {
      state.currentJobCartons = cartons;
      renderCartonHistory(cartons);
    });
    state.unsubscribers.push(unsub);
  }

  function renderCartonHistory(cartons) {
    if (!cartons) cartons = [];
    const list = document.getElementById('carton-history');
    const filter = getActiveFilter('carton-history');
    const search = (document.getElementById('carton-history-search').value || '').trim().toLowerCase();

    const sorted = cartons.slice().sort((a, b) => {
      const aIsClosed = (a.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED;
      const bIsClosed = (b.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED;
      const aTime = aIsClosed ? toMillis(a.closedAt || a.createdAt) : toMillis(a.createdAt);
      const bTime = bIsClosed ? toMillis(b.closedAt || b.createdAt) : toMillis(b.createdAt);
      return bTime - aTime;
    });

    const filtered = sorted.filter(c => {
      const isDraft = (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.DRAFT;
      const isMe = state.currentUser && c.userId === state.currentUser.id;
      if (filter === 'draft' && !isDraft) return false;
      if (filter === 'closed' && isDraft) return false;
      if (filter === 'my' && !isMe) return false;
      if (search && !(c.cartonNo || '').toLowerCase().includes(search)) return false;
      return true;
    });

    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state"><div class="emoji">📦</div>ยังไม่มี Carton ที่ตรงเงื่อนไข</div>';
      return;
    }
    
    // limit to 30 for performance in history view
    list.innerHTML = filtered.slice(0, 30).map((c) => {
      const isMe = state.currentUser && c.userId === state.currentUser.id;
      const isDraft = (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.DRAFT;
      const isClosed = !isDraft;
      const closedAtMs = isClosed ? toMillis(c.closedAt || c.createdAt) : 0;
      const isRecent = isClosed && (Date.now() - closedAtMs) < 7 * 24 * 60 * 60 * 1000;
      
      const editedBadge = c.lastReopenEditAt 
        ? `<span class="qty-badge" title="แก้ไขล่าสุดโดย ${escapeHtml(c.lastReopenEditBy || '?')} เมื่อ ${formatTime(c.lastReopenEditAt)}">✏️ แก้ไขแล้ว</span>` 
        : '';
        
      const editBtn = isRecent 
        ? `<button class="btn small ghost btn-inline-edit" data-carton-id="${escapeHtml(c.id)}" style="margin-left: 8px;">✏️ แก้ไข</button>` 
        : '';

      return `
        <div class="scan-row ${isMe ? 'by-me' : ''} ${isDraft ? 'draft-row' : ''}" data-carton-id="${escapeHtml(c.id)}" data-status="${isDraft ? 'draft' : 'closed'}">
          <div style="flex:1;">
            <div class="barcode">${escapeHtml(c.cartonNo)} ${isDraft ? '<span class="status-pill draft">📝 Draft</span>' : ''}</div>
            <div class="meta">${escapeHtml(c.userName)}${isMe ? ' (คุณ)' : ''} · ${c.totalSku || 0} SKU / ${c.totalQty || 0} Qty</div>
          </div>
          <div style="display: flex; align-items: center;">
            ${editedBadge}
            <span class="qty-badge" style="margin-left: 6px;">${formatTime(isClosed ? (c.closedAt || c.createdAt) : c.createdAt)}</span>
            ${editBtn}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.scan-row[data-status="draft"]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-inline-edit')) return;
        const carton = cartons.find((c) => c.id === row.dataset.cartonId);
        if (carton) resumeDraftCarton(carton);
      });
    });
    
    list.querySelectorAll('.btn-inline-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const carton = cartons.find((c) => c.id === btn.dataset.cartonId);
        if (carton) initInlineEditCarton(carton);
      });
    });
  }

  async function startCarton() {
    const input = document.getElementById('carton-input');
    const btn = document.getElementById('btn-start-carton');
    const cartonNo = input.value.trim();
    if (!cartonNo) { toast('กรุณาสแกนหรือใส่เลข Carton', 'error'); return; }
    if (!state.currentJob) { toast('กรุณาเลือกชื่องานก่อน', 'error'); return; }

    btn.disabled = true;
    try {
      // Feedback 1.1 #6/#7 — ห้ามยิงเลข Carton ที่ closed แล้ว หรือที่เป็น draft ผ่านหน้าสแกนปกติ
      // (draft ต้องเข้าทาง Dashboard → "Carton ล่าสุดในงานนี้" เท่านั้น ใช้กับทุกคนรวมเจ้าของ draft เอง)
      const allCartons = await DB.getAll(COLLECTIONS.CARTONS);
      const clash = allCartons.find((c) => c.ชื่องานId === state.currentJob.id && c.cartonNo === cartonNo);
      if (clash) {
        if ((clash.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED) {
          toast('❌ Carton "' + cartonNo + '" ถูกปิดไปแล้ว ยิงซ้ำไม่ได้', 'error');
          playScanSound('error');
          input.value = '';
          input.focus();
          return;
        } else {
          // F12: Draft อยู่แล้ว — ถามว่าจะเข้าร่วมหรือไม่
          btn.disabled = false;
          const owner = clash.userName || 'คนอื่น';
          const joinConfirmed = await showConfirmModal({
            title: '📊 Carton "' + cartonNo + '" กำลังถูกสแกนอยู่',
            message: '👥 ' + owner + ' เปิดกล่องนี้เป็น Draft อยู่\n\nต้องการเข้าร่วมสแกนกล่องเดียวกันแบบ Real-time หรือไม่?\n(ข้อมูลที่สแกนจะซิงค์สดและไม่ทับกัน)',
            confirmText: '✅ เข้าร่วมสแกน',
            cancelText: '❌ ยกเลิก',
          });
          if (!joinConfirmed) {
            input.value = '';
            input.focus();
            return;
          }
          // F8: Join existing draft — ใช้ข้อมูลจาก Firestore โดยตรง
          resumeDraftCarton(clash);
          input.value = '';
          return;
        }
      }

      // สร้างเอกสาร Carton สถานะ draft ใน Firestore ทันที กันข้อมูลหายถ้าแอปปิด/เน็ตหลุดกลางคัน
      const cartonId = await DB.add(COLLECTIONS.CARTONS, {
        cartonNo,
        ชื่องานId: state.currentJob.id,
        ชื่องานName: state.currentJob.name,
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        totalSku: 0,
        totalQty: 0,
        status: CARTON_STATUS.DRAFT,
        draftItems: [],
        createdAt: nowValue(),
        updatedAt: nowValue(),
      });

      state.currentCarton = { id: cartonId, cartonNo, startedAt: Date.now() };
      state.scanBuffer = [];
      state.resumingDraft = false;
      goToSbcScreen();
      sendPresenceHeartbeat(); // อัพเดทสถานะล็อกให้ทีมเห็นทันที (ฟีเจอร์เสริม #5)
    } catch (err) {
      console.error(err);
      toast('เริ่มสแกน Carton ไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // Feedback 1.1 #3 — เปิด Draft เดิมจาก Dashboard มาทำต่อ (ทางเดียวที่เข้าถึง draft ได้)
  function resumeDraftCarton(carton) {
    state.currentCarton = { id: carton.id, cartonNo: carton.cartonNo, startedAt: Date.now() };
    state.scanBuffer = Array.isArray(carton.draftItems) ? JSON.parse(JSON.stringify(carton.draftItems)) : [];
    state.resumingDraft = true;
    clearListeners();
    goToSbcScreen();
    sendPresenceHeartbeat();
    toast('เปิด Carton "' + carton.cartonNo + '" (Draft) มาทำต่อ', 'info');

    // F8: Real-time Multiplayer — ติดตามการเปลี่ยนแปลงบน Carton Draft นี้แบบ real-time
    startCartonRealTimeSync(carton.id);
  }

  /* --- F8: Real-time Multiplayer Sync ---
   * ติดตาม draftItems ของ Carton ที่กำลังสแกนอยู่
   * เมื่อมีคนอื่นสแกนเพิ่มด้วย จะ Merge rItems เข้า scanBuffer โดยไม่ทับสิ่งที่มีอยู่แล้ว
   * (ใช้ scanId field ในแต่ละ item เป็นตัวแยกแยก)
  */
  function startCartonRealTimeSync(cartonId) {
    if (state._cartonSyncUnsub) {
      state._cartonSyncUnsub();
      state._cartonSyncUnsub = null;
    }
    const unsub = DB.listen(COLLECTIONS.CARTONS, state.currentJob.id, (cartons) => {
      if (!state.currentCarton || state.currentCarton.id !== cartonId) return;
      const latest = cartons.find(c => c.id === cartonId);
      if (!latest || !Array.isArray(latest.draftItems)) return;
      
      // Merge: หารายการใหม่ที่ยังไม่มีใน scanBuffer ของเรา
      const existingIds = new Set(state.scanBuffer.map(i => i.scanId));
      const remoteItems = latest.draftItems.filter(i => i.scanId && !existingIds.has(i.scanId));
      if (remoteItems.length > 0) {
        state.scanBuffer.push(...remoteItems);
        renderSbcScanList(); // this already updates stat-sku, stat-qty
        toast('👥 คนอื่นสแกนเพิ่ม ' + remoteItems.length + ' รายการ', 'info');
      }
    });
    state._cartonSyncUnsub = unsub;
    state.unsubscribers.push(unsub);
  }

  /* --- F9: Carton Switch Dropdown --- */
  let cartonPickerDrafts = [];

  function openCartonPickerDropdown() {
    const btn = document.getElementById('btn-scan-changecarton');
    const dropdown = document.getElementById('scan-carton-picker');
    btn.setAttribute('aria-expanded', 'true');
    dropdown.style.display = 'block';
    document.getElementById('scan-carton-picker-search').value = '';

    // โหลดรายการ Draft ทั้งหมดในงานนี้
    DB.getAll(COLLECTIONS.CARTONS).then(all => {
      cartonPickerDrafts = all.filter(c =>
        c.ชื่องานId === state.currentJob.id &&
        (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.DRAFT &&
        (!state.currentCarton || c.id !== state.currentCarton.id)
      );
      renderCartonPickerList();
    });

    document.addEventListener('click', closeCartonPickerOutside);
  }

  function closeCartonPickerDropdown() {
    const btn = document.getElementById('btn-scan-changecarton');
    const dropdown = document.getElementById('scan-carton-picker');
    btn.setAttribute('aria-expanded', 'false');
    dropdown.style.display = 'none';
    document.removeEventListener('click', closeCartonPickerOutside);
  }

  function closeCartonPickerOutside(e) {
    if (!e.target.closest('#scan-carton-picker-wrap')) closeCartonPickerDropdown();
  }

  function renderCartonPickerList() {
    const list = document.getElementById('scan-carton-picker-list');
    const filter = (document.getElementById('scan-carton-picker-search').value || '').trim().toLowerCase();
    let items = cartonPickerDrafts;
    if (filter) items = items.filter(c => (c.cartonNo || '').toLowerCase().includes(filter));

    if (!items.length) {
      list.innerHTML = '<div class="job-picker-empty">ไม่มี Carton Draft อื่นในงานนี้</div>';
      return;
    }

    list.innerHTML = items.map(c => `
      <div class="job-picker-item" data-id="${c.id}">
        <div class="job-picker-item-info">
          <div class="job-picker-item-name">Carton: ${escapeHtml(c.cartonNo)}</div>
          <div class="job-picker-item-meta">${c.userName || '?'} &middot; ${c.totalSku || 0} SKU / ${c.totalQty || 0} ชิ้น</div>
        </div>
        <span class="status-pill active">🟡 Draft</span>
      </div>
    `).join('');

    list.querySelectorAll('.job-picker-item').forEach(el => {
      el.addEventListener('click', async () => {
        const carton = cartonPickerDrafts.find(c => c.id === el.dataset.id);
        if (!carton) return;
        closeCartonPickerDropdown();
        // เซฟ Autosave กล่องเดิมก่อน
        await saveCartonDraftNow();
        resumeDraftCarton(carton);
      });
    });
  }

  /* ----------------------------------------------------------------------
     12. SCREEN: SCAN SBC
  ---------------------------------------------------------------------- */
  function goToSbcScreen() {
    showScreen('screen-sbc');
    document.getElementById('sbc-carton-no').textContent = state.currentCarton.cartonNo;
    document.getElementById('sbc-job-name').textContent = state.currentJob.name;
    document.getElementById('sbc-input').value = '';
    document.getElementById('sbc-qty').value = 1;
    document.getElementById('quick-search-input').value = '';
    document.getElementById('quick-search-results').style.display = 'none';
    document.getElementById('chk-rapidfire').checked = state.rapidFireMode;
    state.lastScanSnapshot = null;
    updateUndoButton();
    setSbcMode('scanonly');
    renderSbcScanList();
    document.getElementById('no-master-banner').style.display =
      Object.keys(state.barcodeMaster).length === 0 ? 'flex' : 'none';
  }

  function setSbcMode(mode) {
    state.sbcMode = mode;
    document.getElementById('tab-scanonly').classList.toggle('active', mode === 'scanonly');
    document.getElementById('tab-scanqty').classList.toggle('active', mode === 'scanqty');
    document.getElementById('qty-field').style.display = mode === 'scanqty' ? 'block' : 'none';
  }

  function handleSbcScan() {
    const input = document.getElementById('sbc-input');
    const barcode = input.value.trim();
    if (!barcode) return;

    let qty = 1;
    if (state.sbcMode === 'scanqty') {
      const qtyInput = document.getElementById('sbc-qty');
      const raw = qtyInput.value.trim();
      qty = parseInt(raw, 10);
      // Feedback 1.1 #7 — บล็อกสแกนถ้า Qty=0 (หรือใส่ไม่ถูกต้อง) เฉพาะโหมด Scan+Qty
      if (!raw || isNaN(qty) || qty <= 0) {
        toast('❌ กรุณาใส่จำนวน (Qty) มากกว่า 0 ก่อนสแกน', 'error');
        playScanSound('error');
        flashScreen('error');
        qtyInput.focus();
        return;
      }
    }

    const ok = addScannedBarcode(barcode, qty);
    input.value = '';
    if (ok && state.sbcMode === 'scanqty') {
      // รีเซ็ต Qty กลับเป็น 0 หลังสแกนสำเร็จทุกครั้ง กันค้างจาก barcode ก่อนหน้า (Feedback 1.1 #7)
      document.getElementById('sbc-qty').value = 0;
    }
    if (state.rapidFireMode) input.focus(); // F1 — ล็อกโฟกัสไว้ที่ช่องสแกนตลอดเวลา
  }

  function addScannedBarcode(barcode, qty) {
    qty = qty || 1;
    const matched = state.barcodeMaster[barcode] || null;

    // บล็อกไม่ให้สแกนเข้ารายการ ถ้า Barcode นี้ไม่มีอยู่จริงในฐานข้อมูลสินค้า (Barcode Master)
    if (!matched) {
      const hasMasterData = Object.keys(state.barcodeMaster).length > 0;
      toast(
        hasMasterData
          ? '❌ ไม่พบ Barcode "' + barcode + '" ในฐานข้อมูลสินค้า — สแกนไม่ผ่าน'
          : '❌ ยังไม่มีข้อมูลสินค้า (Barcode Master) กรุณา Import จากหน้า 📇 ก่อนเริ่มสแกน',
        'error'
      );
      playScanSound('error');
      speak('สแกนไม่ผ่าน ไม่พบสินค้านี้');
      flashScreen('error'); // F8
      return false;
    }

    // F7 — เก็บ snapshot ก่อนแก้ไข ไว้ทำ Undo แบบเร็ว (จำแค่ระดับล่าสุด)
    state.lastScanSnapshot = JSON.parse(JSON.stringify(state.scanBuffer));

    const existing = state.scanBuffer.find((s) => s.barcode === barcode);
    if (existing) {
      existing.qty += qty;
      existing.scanCount += 1;
    } else {
      state.scanBuffer.push({
        barcode,
        sku: matched.sku || barcode,
        name: matched.name || '',
        imageUrl: matched.imageUrl || '',
        qty,
        scanCount: 1,
        mode: state.sbcMode,
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        ts: Date.now(),
        scanId: state.currentUser.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2), // F8: unique ID for merge
      });
    }
    renderSbcScanList();
    updateUndoButton();
    scheduleCartonAutosave(); // Feedback 1.1 (ฟีเจอร์เสริม #2) — autosave debounced
    const label = matched.name || barcode;
    toast('สแกน ' + label + (qty > 1 ? ' x' + qty : '') + ' สำเร็จ', 'success');
    playScanSound('success');
    speak(label + (qty > 1 ? ' จำนวน ' + qty : ''));
    flashScreen('success'); // F8
    return true;
  }

  /* ----------------------------------------------------------------------
     11a-2. AUTOSAVE DRAFT แบบ debounced (Feedback 1.1 ฟีเจอร์เสริม #2)
     sync scanBuffer ปัจจุบันขึ้น Firestore ทุก ~3 วิ ระหว่างสแกน กันข้อมูลหายถ้าแอปเด้งกลางคัน
  ---------------------------------------------------------------------- */
  function scheduleCartonAutosave() {
    if (!state.currentCarton || !state.currentCarton.id) return;
    state.cartonAutosaveDirty = true;
    if (state.cartonAutosaveTimer) clearTimeout(state.cartonAutosaveTimer);
    state.cartonAutosaveTimer = setTimeout(saveCartonDraftNow, CARTON_AUTOSAVE_DEBOUNCE_MS);
  }

  async function saveCartonDraftNow() {
    if (state.cartonAutosaveTimer) { clearTimeout(state.cartonAutosaveTimer); state.cartonAutosaveTimer = null; }
    if (!state.currentCarton || !state.currentCarton.id || !state.cartonAutosaveDirty) return;
    state.cartonAutosaveDirty = false;
    const totalSku = state.scanBuffer.length;
    const totalQty = state.scanBuffer.reduce((s, x) => s + x.qty, 0);
    try {
      await DB.update(COLLECTIONS.CARTONS, state.currentCarton.id, {
        draftItems: state.scanBuffer,
        totalSku,
        totalQty,
        updatedAt: nowValue(),
      });
    } catch (err) {
      console.error('[autosave] saveCartonDraftNow error:', err);
      // เงียบไว้ ไม่รบกวนผู้ใช้ระหว่างสแกน — ลองใหม่รอบถัดไปที่มีการสแกนเพิ่ม
      state.cartonAutosaveDirty = true;
    }
  }

  /* ----------------------------------------------------------------------
     11b. UNDO สแกนล่าสุดแบบเร็ว (F7)
  ---------------------------------------------------------------------- */
  function undoLastScan() {
    if (!state.lastScanSnapshot) return;
    state.scanBuffer = state.lastScanSnapshot;
    state.lastScanSnapshot = null;
    renderSbcScanList();
    updateUndoButton();
    scheduleCartonAutosave();
    toast('เลิกทำรายการสแกนล่าสุดแล้ว', 'info');
    playScanSound('duplicate');
  }

  function updateUndoButton() {
    const btn = document.getElementById('btn-undo-scan');
    if (btn) btn.style.display = state.lastScanSnapshot ? 'flex' : 'none';
  }

  /* ----------------------------------------------------------------------
     11c. FLASH แจ้งเตือนเต็มจอ (F8)
  ---------------------------------------------------------------------- */
  function flashScreen(kind) {
    const el = document.getElementById('flash-overlay');
    if (!el) return;
    el.className = 'flash-overlay ' + kind;
    el.style.display = 'block';
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 180);
    }, 120);
  }

  /* ----------------------------------------------------------------------
     11d. ค้นหาสินค้าด่วน — พิมพ์แทนสแกน (F6)
  ---------------------------------------------------------------------- */
  function handleQuickSearchInput() {
    const query = document.getElementById('quick-search-input').value.trim().toLowerCase();
    const resultsBox = document.getElementById('quick-search-results');
    if (!query) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; return; }

    const matches = Object.entries(state.barcodeMaster).filter(([barcode, info]) =>
      barcode.toLowerCase().includes(query) ||
      (info.name || '').toLowerCase().includes(query) ||
      (info.sku || '').toLowerCase().includes(query)
    ).slice(0, 8);

    if (!matches.length) {
      resultsBox.style.display = 'block';
      resultsBox.innerHTML = '<div class="qs-empty">ไม่พบสินค้าที่ตรงกับคำค้นหา</div>';
      return;
    }

    resultsBox.style.display = 'block';
    resultsBox.innerHTML = matches.map(([barcode, info]) => `
      <div class="qs-result-row" data-barcode="${escapeHtml(barcode)}">
        ${info.imageUrl ? `<img class="qs-thumb" src="${escapeHtml(info.imageUrl)}" onerror="this.style.display='none'">` : '<div class="qs-thumb placeholder">📦</div>'}
        <div class="qs-info">
          <div class="qs-name">${escapeHtml(info.name || barcode)}</div>
          <div class="qs-barcode">${escapeHtml(barcode)}${info.sku ? ' · SKU ' + escapeHtml(info.sku) : ''}</div>
        </div>
      </div>
    `).join('');

    resultsBox.querySelectorAll('.qs-result-row').forEach((row) => {
      row.addEventListener('click', () => {
        const qty = state.sbcMode === 'scanqty'
          ? Math.max(1, parseInt(document.getElementById('sbc-qty').value, 10) || 1)
          : 1;
        addScannedBarcode(row.dataset.barcode, qty);
        document.getElementById('quick-search-input').value = '';
        resultsBox.style.display = 'none';
        resultsBox.innerHTML = '';
      });
    });
  }



  function renderSbcScanList() {
    const list = document.getElementById('sbc-scan-list');
    const items = state.scanBuffer.slice().reverse();
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><div class="emoji">🏷️</div>ยังไม่มีรายการสแกน</div>';
    } else {
      list.innerHTML = items.map((s) => `
        <div class="scan-row by-me" data-barcode="${escapeHtml(s.barcode)}">
          <div>
            <div class="barcode">${escapeHtml(s.barcode)}</div>
            ${s.name ? `<span class="prod-name-tag">${escapeHtml(s.name)}${s.sku && s.sku !== s.barcode ? ' · SKU ' + escapeHtml(s.sku) : ''}</span>` : ''}
            <div class="meta">${escapeHtml(s.userName)} (คุณ) · สแกน ${s.scanCount} ครั้ง</div>
          </div>
          <div class="scan-row-actions">
            <button class="row-action-btn" data-action="dec" title="ลด 1">−</button>
            <span class="qty-badge">Qty ${s.qty}</span>
            <button class="row-action-btn" data-action="inc" title="เพิ่ม 1">+</button>
            <button class="row-action-btn danger" data-action="del" title="ลบรายการนี้">🗑️</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.scan-row').forEach((row) => {
        const barcode = row.dataset.barcode;
        row.querySelector('[data-action="inc"]').addEventListener('click', () => adjustScanQty(barcode, 1));
        row.querySelector('[data-action="dec"]').addEventListener('click', () => adjustScanQty(barcode, -1));
        row.querySelector('[data-action="del"]').addEventListener('click', () => removeScanItem(barcode));
        attachSwipeToDelete(row, barcode); // F3
      });
    }
    document.getElementById('stat-sku').textContent = state.scanBuffer.length;
    document.getElementById('stat-qty').textContent = state.scanBuffer.reduce((s, x) => s + x.qty, 0);
    document.getElementById('stat-scans').textContent = state.scanBuffer.reduce((s, x) => s + x.scanCount, 0);
  }

  /* ----------------------------------------------------------------------
     11e. SWIPE ปัดลบรายการที่สแกน (F3)
  ---------------------------------------------------------------------- */
  function attachSwipeToDelete(row, barcode) {
    let startX = 0, currentX = 0, dragging = false;
    const THRESHOLD = -80;

    row.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      dragging = true;
      row.classList.add('swiping');
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      currentX = e.touches[0].clientX - startX;
      if (currentX > 0) currentX = 0; // ปัดขวาไม่มีผล เอาแค่ปัดซ้าย
      row.style.transform = `translateX(${currentX}px)`;
      row.classList.toggle('swipe-delete-hint', currentX < THRESHOLD);
    }, { passive: true });

    row.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      row.classList.remove('swiping');
      if (currentX < THRESHOLD) {
        row.style.transform = 'translateX(-100%)';
        row.style.opacity = '0';
        setTimeout(() => removeScanItem(barcode), 180);
      } else {
        row.style.transform = '';
        row.classList.remove('swipe-delete-hint');
      }
      currentX = 0;
    });
  }

  function adjustScanQty(barcode, delta) {
    const item = state.scanBuffer.find((s) => s.barcode === barcode);
    if (!item) return;
    item.qty = Math.max(1, item.qty + delta);
    renderSbcScanList();
    scheduleCartonAutosave();
  }

  async function removeScanItem(barcode) {
    const confirmed = await showConfirmModal({
      title: '🗑️ ลบรายการ',
      message: 'ลบรายการ ' + barcode + ' ออกจากลิสต์ที่กำลังสแกนใช่หรือไม่?',
      confirmText: 'ลบรายการ',
      danger: true,
    });
    if (!confirmed) return;
    state.scanBuffer = state.scanBuffer.filter((s) => s.barcode !== barcode);
    renderSbcScanList();
    scheduleCartonAutosave();
    toast('ลบรายการแล้ว', 'info');
  }

  /* ----------------------------------------------------------------------
     11f. TODO: ฟีเจอร์สำหรับอนาคต ยังไม่เปิดใช้งาน (F9)
     ถ่ายรูปประกอบ Carton ตอนบันทึก — เขียนโครงไว้ก่อน รอเปิดใช้งานภายหลัง
     วิธีเปิดใช้งานจริงในอนาคต:
       1. เพิ่ม <input type="file" accept="image/*" capture="environment"> ในหน้า screen-sbc
       2. เรียก captureCartonPhoto(file) ตอนเลือกรูป แล้วเก็บผลลัพธ์ไว้ใน state.currentCarton.photoDataUrl
       3. ตอน finishCarton() แนบ photoDataUrl ไปกับ cartonData ก่อน DB.add(COLLECTIONS.CARTONS, ...)
       4. ควร resize/compress รูปก่อนอัพโหลด (Firestore จำกัดขนาดเอกสาร 1MB) หรือใช้ Firebase Storage แทนการฝังเป็น base64
  ---------------------------------------------------------------------- */
  function captureCartonPhoto(file) {
    // ยังไม่เปิดใช้งาน — เตรียมโครงไว้สำหรับอนาคตเท่านั้น
    console.warn('[F9] captureCartonPhoto() ยังไม่เปิดใช้งาน — ฟีเจอร์สำหรับอนาคต');
    return null;
  }

  async function finishCarton() {
    if (!state.scanBuffer.length) {
      toast('ยังไม่มีรายการสแกน กรุณาสแกน SBC อย่างน้อย 1 รายการ', 'error');
      return;
    }
    if (!state.currentCarton || !state.currentCarton.id) {
      toast('ไม่พบ Carton ที่กำลังทำอยู่ กรุณาเริ่มใหม่', 'error');
      return;
    }

    const totalSku = state.scanBuffer.length;
    const totalQty = state.scanBuffer.reduce((s, x) => s + x.qty, 0);

    document.getElementById('finish-carton-no').textContent = state.currentCarton.cartonNo;
    document.getElementById('finish-carton-sku').textContent = totalSku;
    document.getElementById('finish-carton-qty').textContent = totalQty;
    document.getElementById('modal-confirm-finish').style.display = 'flex';
  }

  async function confirmFinishCartonSubmit() {
    const totalSku = state.scanBuffer.length;
    const totalQty = state.scanBuffer.reduce((s, x) => s + x.qty, 0);

    document.getElementById('modal-confirm-finish').style.display = 'none';

    const btn = document.getElementById('btn-finish-carton');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';
    try {
      if (state.cartonAutosaveTimer) { clearTimeout(state.cartonAutosaveTimer); state.cartonAutosaveTimer = null; }

      // ปิด Carton doc (draft -> closed) แทนการสร้างใหม่ เพราะ doc นี้ถูกสร้างไว้แล้วตั้งแต่เริ่มสแกน
      await DB.update(COLLECTIONS.CARTONS, state.currentCarton.id, {
        totalSku,
        totalQty,
        status: CARTON_STATUS.CLOSED,
        draftItems: [], // ล้าง draftItems ทิ้งหลังปิด — รายละเอียดจริงอยู่ใน cartonDetails แล้ว
        closedAt: nowValue(),
        closedByUserId: state.currentUser.id,
        closedByName: state.currentUser.name,
      });
      DB.update(COLLECTIONS.JOBS, state.currentJob.id, { lastActivityAt: nowValue() }).catch((err) => console.error('touch lastActivityAt error:', err));

      const details = state.scanBuffer.map((s) => ({
        cartonId: state.currentCarton.id,
        ชื่องานId: state.currentJob.id,
        sku: s.sku,
        name: s.name || '',
        barcode: s.barcode,
        qty: s.qty,
        createdAt: nowValue(),
      }));
      const logs = state.scanBuffer.map((s) => ({
        ชื่องานId: state.currentJob.id,
        cartonNo: state.currentCarton.cartonNo,
        barcode: s.barcode,
        qty: s.qty,
        mode: s.mode,
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        createdAt: nowValue(),
      }));

      await DB.addBatch(COLLECTIONS.CARTON_DETAILS, details);
      await DB.addBatch(COLLECTIONS.SCAN_LOGS, logs);
      writeAuditLog('บันทึก Carton', state.currentCarton.cartonNo + ' (' + totalSku + ' SKU / ' + totalQty + ' ชิ้น) โดย ' + state.currentUser.name);

      toast('บันทึก Carton ' + state.currentCarton.cartonNo + ' สำเร็จ (' + totalSku + ' SKU / ' + totalQty + ' Qty)', 'success');
      playScanSound('success');
      speak('บันทึก Carton สำเร็จ ' + totalSku + ' รายการ');
      state.currentCarton = null;
      state.scanBuffer = [];
      state.resumingDraft = false;
      goToDashboard();
      sendPresenceHeartbeat();
    } catch (err) {
      console.error(err);
      toast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
      playScanSound('error');
      speak('บันทึกไม่สำเร็จ');
    } finally {
      btn.disabled = false;
      btn.textContent = '✅ บันทึก / ปิด Carton นี้';
    }
  }

  /* ----------------------------------------------------------------------
     11g. ยกเลิกรายการ Carton นี้ (Feedback 1.1 #4)
     ยกเลิก ≠ ลบทิ้ง — เก็บเป็น draft ไว้ (โผล่ที่ Dashboard กรอบแดง) ทำต่อได้ภายหลัง
  ---------------------------------------------------------------------- */
  async function cancelCarton() {
    if (!state.currentCarton || !state.currentCarton.id) return;
    const confirmed = await showConfirmModal({
      title: '🚫 ยกเลิกรายการ Carton นี้',
      message: 'ยกเลิกรายการ Carton "' + state.currentCarton.cartonNo + '" ตอนนี้ใช่หรือไม่?\n\nข้อมูลที่สแกนไว้ (' + state.scanBuffer.length + ' รายการ) จะไม่หาย — จะถูกเก็บเป็นสถานะ "Draft" ให้กลับมาทำต่อได้ที่หน้า Dashboard',
      confirmText: 'ยืนยันยกเลิก',
      cancelText: 'กลับไปสแกนต่อ',
      danger: true,
    });
    if (!confirmed) return;

    try {
      if (state.cartonAutosaveTimer) { clearTimeout(state.cartonAutosaveTimer); state.cartonAutosaveTimer = null; }
      const totalSku = state.scanBuffer.length;
      const totalQty = state.scanBuffer.reduce((s, x) => s + x.qty, 0);
      await DB.update(COLLECTIONS.CARTONS, state.currentCarton.id, {
        draftItems: state.scanBuffer,
        totalSku,
        totalQty,
        status: CARTON_STATUS.DRAFT,
        updatedAt: nowValue(),
      });
      toast('เก็บ Carton "' + state.currentCarton.cartonNo + '" ไว้เป็น Draft แล้ว — ทำต่อได้จาก Dashboard', 'info');
      state.currentCarton = null;
      state.scanBuffer = [];
      state.resumingDraft = false;
      goToDashboard();
      sendPresenceHeartbeat();
    } catch (err) {
      console.error(err);
      toast('ยกเลิกไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  /* ----------------------------------------------------------------------
     12b. CAMERA SCANNER (Barcode / QR Code) — toggle เปิด-ปิด
  ---------------------------------------------------------------------- */
  function isCameraLibraryReady() {
    return typeof Html5Qrcode !== 'undefined';
  }

  async function toggleCamera(targetInputId, boxId, readerId, btnId) {
    // ถ้ากล้องตัวอื่นเปิดอยู่ ให้ปิดก่อนเสมอ (เปิดได้ทีละกล้อง)
    if (state.activeCamera && state.activeCamera.readerId !== readerId) {
      await stopCamera();
    }
    if (state.activeCamera && state.activeCamera.readerId === readerId) {
      await stopCamera();
      return;
    }
    if (!isCameraLibraryReady()) {
      toast('ไม่สามารถโหลดไลบรารีกล้องได้ (ต้องมีอินเทอร์เน็ต) — กรุณาใช้เครื่องสแกนหรือพิมพ์แทน', 'error');
      return;
    }

    const box = document.getElementById(boxId);
    const btn = document.getElementById(btnId);
    box.style.display = 'block';
    btn.classList.add('on');

    try {
      const instance = new Html5Qrcode(readerId, { verbose: false });
      const config = {
        fps: 12,
        qrbox: { width: 260, height: 150 },
        aspectRatio: 1.6,
        formatsToSupport: window.Html5QrcodeSupportedFormats ? [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.ITF,
        ] : undefined,
      };

      await instance.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => onCameraDecoded(targetInputId, decodedText),
        () => { /* per-frame scan failure — ignore, this fires very often */ }
      );

      state.activeCamera = { instance, readerId, targetInputId, boxId, btnId };
    } catch (err) {
      console.error('Camera start error:', err);
      toast('เปิดกล้องไม่สำเร็จ: กรุณาอนุญาตสิทธิ์กล้อง (' + (err.message || err) + ')', 'error');
      box.style.display = 'none';
      btn.classList.remove('on');
    }
  }

  let lastCameraDecodeAt = 0;
  let lastCameraDecodeValue = '';

  function onCameraDecoded(targetInputId, decodedText) {
    // กันสแกนซ้ำรัวๆ จากเฟรมต่อเนื่อง (debounce 1.2 วิ ต่อค่าซ้ำเดิม)
    const now = Date.now();
    if (decodedText === lastCameraDecodeValue && now - lastCameraDecodeAt < 1200) return;
    lastCameraDecodeValue = decodedText;
    lastCameraDecodeAt = now;

    const input = document.getElementById(targetInputId);
    if (!input) return;
    input.value = decodedText;

    if (targetInputId === 'carton-input') {
      startCarton();
    } else if (targetInputId === 'sbc-input') {
      handleSbcScan();
    }

    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
  }

  async function stopCamera() {
    if (!state.activeCamera) return;
    const { instance, boxId, btnId } = state.activeCamera;
    try {
      await instance.stop();
      instance.clear();
    } catch (e) { /* already stopped */ }
    const box = document.getElementById(boxId);
    const btn = document.getElementById(btnId);
    if (box) box.style.display = 'none';
    if (btn) btn.classList.remove('on');
    state.activeCamera = null;
  }

  /* ----------------------------------------------------------------------
     12d. REPORT SCREEN (Summary / Details)
  ---------------------------------------------------------------------- */
  let reportCartons = [];
  let reportDetails = [];

  function goToReportScreen() {
    if (!state.currentJob) { goToJobScreen(); return; }
    clearListeners();
    showScreen('screen-report');
    const jobNameEl = document.getElementById('report-job-name');
    if (jobNameEl) jobNameEl.textContent = state.currentJob.name;
    const filterEl = document.getElementById('report-filter');
    if (filterEl) filterEl.value = state.reportFilter || '';
    setReportMode(state.reportMode);

    const unsubC = DB.listen(COLLECTIONS.CARTONS, state.currentJob.id, (rows) => {
      reportCartons = rows;
      renderReport();
    });
    const unsubD = DB.listen(COLLECTIONS.CARTON_DETAILS, state.currentJob.id, (rows) => {
      reportDetails = rows;
      renderReport();
    });
    state.unsubscribers.push(unsubC, unsubD);
  }

  function setReportMode(mode) {
    state.reportMode = mode;
    const tabSum = document.getElementById('tab-report-summary');
    const tabDet = document.getElementById('tab-report-detail');
    const tabPerf = document.getElementById('tab-report-performance');
    const tabStock = document.getElementById('tab-report-stocktake');
    if (tabSum) tabSum.classList.toggle('active', mode === 'summary');
    if (tabDet) tabDet.classList.toggle('active', mode === 'detail');
    if (tabPerf) tabPerf.classList.toggle('active', mode === 'performance');
    if (tabStock) tabStock.classList.toggle('active', mode === 'stocktake');
    renderReport();
  }

  /* ----------------------------------------------------------------------
     REPORT JOB PICKER (Feedback 1.3)
  ---------------------------------------------------------------------- */
  let jobPickerJobs = [];
  function openJobPickerDropdown() {
    const btn = document.getElementById('btn-report-changejob');
    const dropdown = document.getElementById('report-job-picker');
    if (!dropdown) return;
    if (btn) {
      btn.classList.add('picker-open');
      btn.setAttribute('aria-expanded', 'true');
    }
    dropdown.style.display = 'block';
    const searchEl = document.getElementById('report-job-picker-search');
    if (searchEl) searchEl.value = '';
    
    DB.getAll(COLLECTIONS.JOBS).then(jobs => {
      jobs.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      jobPickerJobs = jobs;
      renderJobPickerList();
    });
    
    document.addEventListener('click', closeJobPickerOutside);
  }

  function closeJobPickerDropdown() {
    const btn = document.getElementById('btn-report-changejob');
    const dropdown = document.getElementById('report-job-picker');
    if (btn) {
      btn.classList.remove('picker-open');
      btn.setAttribute('aria-expanded', 'false');
    }
    if (dropdown) dropdown.style.display = 'none';
    document.removeEventListener('click', closeJobPickerOutside);
  }

  function closeJobPickerOutside(e) {
    if (!e.target.closest('#report-job-picker-wrap')) {
      closeJobPickerDropdown();
    }
  }

  function renderJobPickerList() {
    const list = document.getElementById('report-job-picker-list');
    const searchEl = document.getElementById('report-job-picker-search');
    const filter = searchEl ? searchEl.value.trim().toLowerCase() : '';
    
    let filtered = jobPickerJobs;
    if (filter) {
      filtered = filtered.filter(j => (j.name || '').toLowerCase().includes(filter));
    }
    
    if (!filtered.length) {
      list.innerHTML = '<div class="job-picker-empty">ไม่พบชื่องาน</div>';
      return;
    }
    
    list.innerHTML = filtered.map(job => `
      <div class="job-picker-item ${state.currentJob && state.currentJob.id === job.id ? 'active' : ''}" data-id="${job.id}">
        <div class="job-picker-item-info">
          <div class="job-picker-item-name">${escapeHtml(job.name)}</div>
          <div class="job-picker-item-meta">${formatDate(job.createdAt)}</div>
        </div>
        <span class="status-pill ${job.status === 'active' ? 'active' : 'closed'}">
          ${job.status === 'active' ? '🟢' : '⚪'}
        </span>
      </div>
    `).join('');
    
    list.querySelectorAll('.job-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const job = jobPickerJobs.find(j => j.id === item.dataset.id);
        if (job) {
          selectJob(job);
          closeJobPickerDropdown();
          goToReportScreen(); 
        }
      });
    });
  }

  /* ----------------------------------------------------------------------
     REPORT ACCESS CONTROL (Feedback 1.3)
  ---------------------------------------------------------------------- */
  function applyReportTabVisibility() {
    const vis = state.reportVisibility || { performance: true, stocktake: true, exportExcel: true };
    const tabPerf = document.getElementById('tab-report-performance');
    const tabStock = document.getElementById('tab-report-stocktake');
    const btnExport = document.getElementById('btn-report-export');
    if (tabPerf) tabPerf.style.display = vis.performance ? '' : 'none';
    if (tabStock) tabStock.style.display = vis.stocktake ? '' : 'none';
    if (btnExport) btnExport.style.display = vis.exportExcel ? '' : 'none';
    
    const togglePerf = document.getElementById('toggle-tab-performance');
    const toggleStock = document.getElementById('toggle-tab-stocktake');
    const toggleExport = document.getElementById('toggle-export-excel');
    if (togglePerf) togglePerf.checked = vis.performance;
    if (toggleStock) toggleStock.checked = vis.stocktake;
    if (toggleExport) toggleExport.checked = vis.exportExcel;
    
    if ((state.reportMode === 'performance' && !vis.performance) || (state.reportMode === 'stocktake' && !vis.stocktake)) {
      setReportMode('summary');
    }
  }

  function updateReportVisibilityFromForm() {
    const togglePerf = document.getElementById('toggle-tab-performance');
    const toggleStock = document.getElementById('toggle-tab-stocktake');
    const toggleExport = document.getElementById('toggle-export-excel');
    state.reportVisibility = {
      performance: togglePerf ? togglePerf.checked : true,
      stocktake: toggleStock ? toggleStock.checked : true,
      exportExcel: toggleExport ? toggleExport.checked : true
    };
    localStorage.setItem(LS_KEYS.REPORT_VISIBILITY, JSON.stringify(state.reportVisibility));
    applyReportTabVisibility();
  }

  function matchFilter(text, filter) {
    if (!filter) return true;
    return String(text || '').toLowerCase().includes(filter.toLowerCase());
  }

  function renderReport() {
    const filter = (state.reportFilter || '').trim();
    const cartonById = {};
    reportCartons.forEach((c) => { cartonById[c.id] = c; });
    // Feedback 1.1 — รายงานนับเฉพาะ Carton ที่ closed แล้ว (draft ยังไม่ใช่ผลงานที่เสร็จจริง)
    const closedReportCartons = reportCartons.filter((c) => (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED);

    // ภาพรวมสถิติทั้งงาน (ไม่ขึ้นกับ filter)
    const totalCartonsEl = document.getElementById('report-total-cartons');
    if (totalCartonsEl) totalCartonsEl.textContent = closedReportCartons.length;
    const totalSkuEl = document.getElementById('report-total-sku');
    if (totalSkuEl) {
      totalSkuEl.textContent = new Set(reportDetails.map((d) => d.barcode)).size;
    }
    const totalQtyEl = document.getElementById('report-total-qty');
    if (totalQtyEl) {
      totalQtyEl.textContent = reportDetails.reduce((s, d) => s + (d.qty || 0), 0);
    }

    const body = document.getElementById('report-body');
    if (!body) return;

    if (!reportDetails.length && state.reportMode !== 'stocktake') {
      body.innerHTML = '<div class="empty-state"><div class="emoji">📑</div>ยังไม่มีข้อมูลสแกนในงานนี้</div>';
      return;
    }

    if (state.reportMode === 'summary') {
      renderReportSummary(body, cartonById, filter);
    } else if (state.reportMode === 'detail') {
      renderReportDetail(body, cartonById, filter);
    } else if (state.reportMode === 'performance') {
      renderReportPerformance(body, filter);
    } else if (state.reportMode === 'stocktake') {
      renderReportStockTake(body, filter);
    }
  }

  function renderReportPerformance(body, filter) {
    // สรุปผลงานรายคน: จำนวน Carton, SKU, Qty ที่แต่ละคนสแกนในงานนี้
    const byUser = {}; // userId -> { userName, cartons: 0, qty: 0, skuSet: Set }
    reportCartons.forEach((c) => {
      if (!byUser[c.userId]) byUser[c.userId] = { userName: c.userName, cartons: 0, qty: 0, skuSet: new Set() };
      byUser[c.userId].cartons += 1;
      byUser[c.userId].qty += (c.totalQty || 0);
    });
    reportDetails.forEach((d) => {
      const carton = reportCartons.find((c) => c.id === d.cartonId);
      if (!carton) return;
      if (!byUser[carton.userId]) byUser[carton.userId] = { userName: carton.userName, cartons: 0, qty: 0, skuSet: new Set() };
      byUser[carton.userId].skuSet.add(d.barcode);
    });

    let rows = Object.entries(byUser).map(([userId, u]) => ({
      userId, userName: u.userName, cartons: u.cartons, qty: u.qty, skuCount: u.skuSet.size,
    }));
    if (filter) rows = rows.filter((r) => matchFilter(r.userName, filter));
    rows.sort((a, b) => b.qty - a.qty);

    if (!rows.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">🏆</div>ยังไม่มีข้อมูลผลงานในงานนี้</div>';
      return;
    }

    const medal = ['🥇', '🥈', '🥉'];
    body.innerHTML = rows.map((r, i) => {
      const isMe = state.currentUser && r.userId === state.currentUser.id;
      const userColor = (state.usersList.find((u) => u.id === r.userId) || {}).color || '#3b82f6';
      return `
        <div class="scan-row ${isMe ? 'by-me' : ''}">
          <div>
            <div class="barcode">${medal[i] || '▪️'} ${escapeHtml(r.userName)}${isMe ? ' (คุณ)' : ''}</div>
            <div class="meta">${r.cartons} Carton · ${r.skuCount} SKU</div>
          </div>
          <span class="qty-badge" style="background:${userColor}22; color:${userColor};">${r.qty} ชิ้น</span>
        </div>
      `;
    }).join('');
  }

  function renderReportStockTake(body, filter) {
    // เทียบยอดสแกนจริง (reportDetails) กับ "จำนวนที่ควรมี" ใน Barcode Master
    const hasExpectedQty = Object.values(state.barcodeMaster).some((m) => m.expectedQty !== null && m.expectedQty !== undefined);
    if (!hasExpectedQty) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🧮</div>
          ยังไม่ได้ตั้งค่า "จำนวนที่ควรมี" ในข้อมูล Barcode Master<br>
          ไปที่ 📇 ตั้งค่าข้อมูลสินค้า แล้วกำหนดคอลัมน์ "จำนวนที่ควรมี" ก่อนใช้โหมดนับสต๊อก
        </div>`;
      return;
    }

    const actualByBarcode = {};
    reportDetails.forEach((d) => {
      actualByBarcode[d.barcode] = (actualByBarcode[d.barcode] || 0) + (d.qty || 0);
    });

    let entries = Object.entries(state.barcodeMaster).filter(([, m]) => m.expectedQty !== null && m.expectedQty !== undefined);
    if (filter) {
      entries = entries.filter(([barcode, m]) => matchFilter(barcode, filter) || matchFilter(m.name, filter) || matchFilter(m.sku, filter));
    }

    const rows = entries.map(([barcode, m]) => {
      const actual = actualByBarcode[barcode] || 0;
      const diff = actual - m.expectedQty;
      return { barcode, name: m.name, sku: m.sku, expected: m.expectedQty, actual, diff };
    });
    rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    if (!rows.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">🔍</div>ไม่พบข้อมูลที่ค้นหา</div>';
      return;
    }

    const diffCount = rows.filter((r) => r.diff !== 0).length;
    body.innerHTML =
      '<div class="hint" style="margin-bottom:10px;">พบรายการที่ยอดไม่ตรง ' + diffCount + ' / ' + rows.length + ' รายการ</div>' +
      rows.map((r) => {
        const diffClass = r.diff === 0 ? 'st-diff-ok' : (r.diff > 0 ? 'st-diff-surplus' : 'st-diff-shortage');
        const diffLabel = r.diff === 0 ? 'ตรง' : (r.diff > 0 ? '+' + r.diff + ' เกิน' : r.diff + ' ขาด');
        return `
          <div class="stocktake-row">
            <div>
              <div class="st-name">${r.name ? escapeHtml(r.name) : escapeHtml(r.barcode)}</div>
              <div class="st-barcode">${escapeHtml(r.barcode)}${r.sku ? ' · SKU ' + escapeHtml(r.sku) : ''}</div>
            </div>
            <div class="st-nums">
              <div><div class="n">${r.expected}</div><div class="l">ควรมี</div></div>
              <div><div class="n">${r.actual}</div><div class="l">สแกนได้</div></div>
              <div><div class="n ${diffClass}">${diffLabel}</div><div class="l">ผลต่าง</div></div>
            </div>
          </div>
        `;
      }).join('');
  }

  function renderReportSummary(body, cartonById, filter) {
    // รวมยอดตาม barcode เดียวกัน: จำนวนชิ้นรวม + carton ที่พบ
    const groups = {}; // barcode -> { barcode, sku, name, totalQty, cartonMap: {cartonId: qty} }
    reportDetails.forEach((d) => {
      if (!groups[d.barcode]) {
        groups[d.barcode] = { barcode: d.barcode, sku: d.sku, name: d.name || '', totalQty: 0, cartonMap: {} };
      }
      const g = groups[d.barcode];
      g.totalQty += (d.qty || 0);
      g.cartonMap[d.cartonId] = (g.cartonMap[d.cartonId] || 0) + (d.qty || 0);
    });

    let rows = Object.values(groups);
    if (filter) {
      rows = rows.filter((g) => {
        if (matchFilter(g.barcode, filter) || matchFilter(g.sku, filter) || matchFilter(g.name, filter)) return true;
        return Object.keys(g.cartonMap).some((cid) => matchFilter(cartonById[cid] && cartonById[cid].cartonNo, filter));
      });
    }
    // Feedback 1.1 #5 — เรียงตามชื่อสินค้าเป็นหลัก (สินค้าที่ไม่มีชื่อให้ไปอยู่ท้ายสุด เรียงตาม barcode แทน)
    rows.sort((a, b) => {
      if (a.name && b.name) return a.name.localeCompare(b.name, 'th');
      if (a.name && !b.name) return -1;
      if (!a.name && b.name) return 1;
      return a.barcode.localeCompare(b.barcode);
    });

    if (!rows.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">🔍</div>ไม่พบข้อมูลที่ค้นหา</div>';
      return;
    }

    body.innerHTML = rows.map((g, idx) => {
      const cartonEntries = Object.entries(g.cartonMap);
      const chipsHtml = cartonEntries.map(([cid, qty]) => {
        const c = cartonById[cid];
        const label = c ? c.cartonNo : '(ไม่พบ Carton)';
        return `<span class="report-carton-chip">📦 ${escapeHtml(label)} · x${qty}</span>`;
      }).join('');
      return `
        <div class="report-group">
          <div class="report-group-head" data-idx="${idx}">
            <div>
              <div class="rg-barcode">${g.name ? escapeHtml(g.name) : escapeHtml(g.barcode)}</div>
              <div class="rg-meta">${g.name ? escapeHtml(g.barcode) + (g.sku && g.sku !== g.barcode ? ' · SKU ' + escapeHtml(g.sku) : '') : (g.sku ? 'SKU ' + escapeHtml(g.sku) : '')}</div>
            </div>
            <div class="report-group-stats">
              <div class="rg-num"><div class="n">${g.totalQty}</div><div class="l">ชิ้น</div></div>
              <div class="rg-num"><div class="n">${cartonEntries.length}</div><div class="l">Carton</div></div>
              <span class="chevron">▾</span>
            </div>
          </div>
          <div class="report-group-detail">${chipsHtml}</div>
        </div>
      `;
    }).join('');

    body.querySelectorAll('.report-group-head').forEach((head) => {
      head.addEventListener('click', () => {
        const detail = head.nextElementSibling;
        const chevron = head.querySelector('.chevron');
        detail.classList.toggle('open');
        chevron.classList.toggle('open');
      });
    });
  }

  function renderReportDetail(body, cartonById, filter) {
    // จัดกลุ่มตาม Carton แล้วแสดงรายการ item ข้างใน พร้อม filter ทุกหัวข้อ
    const detailsByCarton = {};
    reportDetails.forEach((d) => {
      if (!detailsByCarton[d.cartonId]) detailsByCarton[d.cartonId] = [];
      detailsByCarton[d.cartonId].push(d);
    });

    let cartons = reportCartons.filter((c) => (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.CLOSED);
    cartons.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    const blocks = [];
    cartons.forEach((c) => {
      let items = detailsByCarton[c.id] || [];
      if (filter) {
        const cartonMatches = matchFilter(c.cartonNo, filter) || matchFilter(c.userName, filter);
        if (!cartonMatches) {
          items = items.filter((it) => matchFilter(it.barcode, filter) || matchFilter(it.sku, filter) || matchFilter(it.name, filter));
        }
        if (!cartonMatches && !items.length) return; // ไม่มีอะไร match เลย ข้าม carton นี้
      }
      blocks.push({ carton: c, items });
    });

    if (!blocks.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">🔍</div>ไม่พบข้อมูลที่ค้นหา</div>';
      return;
    }

    body.innerHTML = blocks.map(({ carton, items }) => `
      <div class="report-carton-block">
        <div class="rc-title">📦 ${escapeHtml(carton.cartonNo)} <span class="status-pill closed">⚪ Closed</span></div>
        <div class="rc-meta">${escapeHtml(carton.userName)} · ${formatDate(carton.createdAt)} · ${items.length} SKU / ${items.reduce((s, i) => s + (i.qty || 0), 0)} Qty</div>
        ${items.map((it) => `
          <div class="report-item-row">
            <span>${escapeHtml(it.barcode)}${it.name ? '<span class="prod-name-tag">' + escapeHtml(it.name) + '</span>' : ''}</span>
            <span class="qty-badge">x${it.qty}</span>
          </div>
        `).join('') || '<div class="hint">ไม่มีรายการที่ตรงกับตัวกรอง</div>'}
      </div>
    `).join('');
  }

  /* ----------------------------------------------------------------------
     12f. EXPORT REPORT TO EXCEL (.xlsx)
  ---------------------------------------------------------------------- */
  function exportReportToExcel() {
    if (typeof XLSX === 'undefined') {
      toast('ไม่สามารถโหลดไลบรารี Excel ได้ (ต้องมีอินเทอร์เน็ต)', 'error');
      return;
    }
    if (!reportDetails.length) {
      toast('ไม่มีข้อมูลให้ Export', 'error');
      return;
    }
    const cartonById = {};
    reportCartons.forEach((c) => { cartonById[c.id] = c; });
    const filter = (state.reportFilter || '').trim();
    const wb = XLSX.utils.book_new();

    if (state.reportMode === 'summary') {
      const groups = {};
      reportDetails.forEach((d) => {
        if (!groups[d.barcode]) groups[d.barcode] = { barcode: d.barcode, sku: d.sku, name: d.name || '', totalQty: 0, cartonMap: {} };
        const g = groups[d.barcode];
        g.totalQty += (d.qty || 0);
        g.cartonMap[d.cartonId] = (g.cartonMap[d.cartonId] || 0) + (d.qty || 0);
      });
      let rows = Object.values(groups);
      if (filter) {
        rows = rows.filter((g) => matchFilter(g.barcode, filter) || matchFilter(g.sku, filter) || matchFilter(g.name, filter) ||
          Object.keys(g.cartonMap).some((cid) => matchFilter(cartonById[cid] && cartonById[cid].cartonNo, filter)));
      }
      rows.sort((a, b) => {
        if (a.name && b.name) return a.name.localeCompare(b.name, 'th');
        if (a.name && !b.name) return -1;
        if (!a.name && b.name) return 1;
        return a.barcode.localeCompare(b.barcode);
      });

      const sheetData = rows.map((g) => ({
        'Barcode': g.barcode,
        'ชื่อสินค้า': g.name || '',
        'SKU': g.sku || '',
        'จำนวนชิ้นรวม': g.totalQty,
        'จำนวน Carton': Object.keys(g.cartonMap).length,
        'อยู่ใน Carton': Object.entries(g.cartonMap).map(([cid, qty]) => (cartonById[cid] ? cartonById[cid].cartonNo : cid) + ' (x' + qty + ')').join(', '),
      }));
      const ws = XLSX.utils.json_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    } else {
      const sheetData = [];
      reportCartons.forEach((c) => {
        const items = reportDetails.filter((d) => d.cartonId === c.id);
        items.forEach((it) => {
          if (filter) {
            const match = matchFilter(c.cartonNo, filter) || matchFilter(c.userName, filter) ||
              matchFilter(it.barcode, filter) || matchFilter(it.sku, filter) || matchFilter(it.name, filter);
            if (!match) return;
          }
          sheetData.push({
            'Carton No.': c.cartonNo,
            'สแกนโดย': c.userName,
            'วันที่': formatDate(c.createdAt),
            'Barcode': it.barcode,
            'ชื่อสินค้า': it.name || '',
            'SKU': it.sku || '',
            'Qty': it.qty,
          });
        });
      });
      const ws = XLSX.utils.json_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, 'Details');
    }

    const jobLabel = (state.currentJob ? state.currentJob.name : 'report').replace(/[\\/:*?"<>|]/g, '_');
    const fileName = 'SBG-Report-' + jobLabel + '-' + state.reportMode + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, fileName);
    toast('Export ไฟล์ ' + fileName + ' สำเร็จ', 'success');
  }

  /* ----------------------------------------------------------------------
     12e. BARCODE MASTER — นำเข้าข้อมูลสินค้าจาก Excel (.xlsx)
  ---------------------------------------------------------------------- */
  function colLetterToIndex(letter) {
    letter = String(letter || '').trim().toUpperCase();
    if (!letter) return -1;
    let idx = 0;
    for (let i = 0; i < letter.length; i++) {
      const code = letter.charCodeAt(i) - 64; // 'A' -> 1
      if (code < 1 || code > 26) return -1;
      idx = idx * 26 + code;
    }
    return idx - 1; // zero-based
  }

  function getMasterConfigFromForm() {
    return {
      barcodeCol: document.getElementById('mf-barcode-col').value.trim() || 'A',
      barcodeRow: parseInt(document.getElementById('mf-barcode-row').value, 10) || 2,
      nameCol: document.getElementById('mf-name-col').value.trim() || 'B',
      nameRow: parseInt(document.getElementById('mf-name-row').value, 10) || 2,
      skuCol: document.getElementById('mf-sku-col').value.trim() || 'C',
      skuRow: parseInt(document.getElementById('mf-sku-row').value, 10) || 2,
      expQtyCol: document.getElementById('mf-expqty-col').value.trim() || '',
      expQtyRow: parseInt(document.getElementById('mf-expqty-row').value, 10) || 2,
    };
  }

  function applyMasterConfigToForm(cfg) {
    document.getElementById('mf-barcode-col').value = cfg.barcodeCol || 'A';
    document.getElementById('mf-barcode-row').value = cfg.barcodeRow || 2;
    document.getElementById('mf-name-col').value = cfg.nameCol || 'B';
    document.getElementById('mf-name-row').value = cfg.nameRow || 2;
    document.getElementById('mf-sku-col').value = cfg.skuCol || 'C';
    document.getElementById('mf-sku-row').value = cfg.skuRow || 2;
    document.getElementById('mf-expqty-col').value = cfg.expQtyCol || '';
    document.getElementById('mf-expqty-row').value = cfg.expQtyRow || 2;
  }

  function renderMasterStatus() {
    const count = Object.keys(state.barcodeMaster).length;
    const countEl = document.getElementById('master-count');
    const updatedEl = document.getElementById('master-updated');
    if (countEl) countEl.textContent = count;
    if (updatedEl) {
      updatedEl.textContent = state.masterUpdatedAt ? formatDate(new Date(state.masterUpdatedAt)) : '-';
    }
    renderMasterTable();
  }

  function importMasterFromFile() {
    const fileInput = document.getElementById('master-file-input');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { toast('กรุณาเลือกไฟล์ .xlsx ก่อน', 'error'); return; }
    if (typeof XLSX === 'undefined') {
      toast('ไม่สามารถโหลดไลบรารีอ่าน Excel ได้ (ต้องมีอินเทอร์เน็ต)', 'error');
      return;
    }

    const cfg = getMasterConfigFromForm();
    const barcodeColIdx = colLetterToIndex(cfg.barcodeCol);
    const nameColIdx = colLetterToIndex(cfg.nameCol);
    const skuColIdx = colLetterToIndex(cfg.skuCol);
    const expQtyColIdx = cfg.expQtyCol ? colLetterToIndex(cfg.expQtyCol) : -1;

    if (barcodeColIdx < 0) {
      toast('คอลัมน์ Barcode ไม่ถูกต้อง กรุณาใส่ตัวอักษร เช่น A, B, C', 'error');
      return;
    }

    const btn = document.getElementById('btn-import-master');
    btn.disabled = true;
    btn.textContent = 'กำลังอ่านไฟล์...';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // header:1 -> array-of-arrays, index 0 = แถวที่ 1 ใน Excel
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // ใช้แถวเริ่มต้นที่มากที่สุดในทุกฟิลด์ เพื่อให้ข้อมูลตรงแถวกันเสมอ (แบบตาราง 1 แถว = 1 สินค้า)
        const startRow = Math.max(cfg.barcodeRow, cfg.nameRow, cfg.skuRow, expQtyColIdx >= 0 ? cfg.expQtyRow : 1, 1);
        const startIdx = startRow - 1;

        const master = {};
        let imported = 0;
        for (let r = startIdx; r < rows.length; r++) {
          const row = rows[r] || [];
          const barcodeVal = row[barcodeColIdx];
          const barcode = barcodeVal === undefined || barcodeVal === null ? '' : String(barcodeVal).trim();
          if (!barcode) continue;
          const name = nameColIdx >= 0 && row[nameColIdx] !== undefined ? String(row[nameColIdx]).trim() : '';
          const sku = skuColIdx >= 0 && row[skuColIdx] !== undefined ? String(row[skuColIdx]).trim() : '';
          let expectedQty = null;
          if (expQtyColIdx >= 0 && row[expQtyColIdx] !== undefined && row[expQtyColIdx] !== '') {
            const n = parseFloat(row[expQtyColIdx]);
            expectedQty = isNaN(n) ? null : n;
          }
          master[barcode] = { name, sku, expectedQty };
          imported++;
        }

        if (!imported) {
          toast('ไม่พบข้อมูล Barcode ในไฟล์ ตรวจสอบคอลัมน์/แถวอีกครั้ง', 'error');
          return;
        }

        state.barcodeMaster = master;
        state.masterUpdatedAt = Date.now();
        localStorage.setItem(LS_KEYS.MASTER_CONFIG, JSON.stringify(cfg));
        localStorage.setItem(LS_KEYS.MASTER_DATA, JSON.stringify(master));
        localStorage.setItem(LS_KEYS.MASTER_UPDATED, String(state.masterUpdatedAt));

        renderMasterStatus();

        if (state.mode === 'real') {
          syncMasterToFirebase(cfg, master).then(() => {
            toast('นำเข้าข้อมูลสำเร็จ ' + imported + ' รายการ และซิงค์ขึ้น Firebase แล้ว (ทุกคนเห็นข้อมูลเดียวกัน)', 'success');
          }).catch((err) => {
            console.error(err);
            toast('นำเข้าสำเร็จ ' + imported + ' รายการ แต่ซิงค์ขึ้น Firebase ไม่สำเร็จ: ' + err.message, 'error');
          });
        } else {
          toast('นำเข้าข้อมูลสำเร็จ ' + imported + ' รายการ จากชีท "' + sheetName + '" (โหมด Mockup — ไม่ซิงค์ขึ้น Firebase)', 'success');
        }
      } catch (err) {
        console.error(err);
        toast('อ่านไฟล์ไม่สำเร็จ: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '📥 นำเข้าข้อมูล (Import)';
      }
    };
    reader.onerror = () => {
      toast('อ่านไฟล์ไม่สำเร็จ', 'error');
      btn.disabled = false;
      btn.textContent = '📥 นำเข้าข้อมูล (Import)';
    };
    reader.readAsArrayBuffer(file);
  }

  async function syncMasterToFirebase(cfg, master) {
    await DB.set(COLLECTIONS.SETTINGS, 'barcodeMaster', {
      config: cfg,
      data: master,
      updatedAt: Date.now(),
      updatedBy: state.currentUser ? state.currentUser.name : '-',
    });
  }

  function listenMasterFromFirebase() {
    // ทำงานเฉพาะ REAL MODE — ทำให้ข้อมูล Master sync ข้ามเครื่อง/ผู้ใช้แบบ Realtime
    // ใช้ unsubscriber แยกต่างหาก ไม่ผูกกับ clearListeners() ของแต่ละหน้า เพราะต้องฟังตลอดทั้งเซสชัน
    if (state.mode !== 'real') return;
    if (state.masterListenUnsub) { try { state.masterListenUnsub(); } catch (e) {} }
    state.masterListenUnsub = DB.listenDoc(COLLECTIONS.SETTINGS, 'barcodeMaster', (doc) => {
      if (!doc || !doc.data) return;
      state.barcodeMaster = doc.data;
      state.masterUpdatedAt = doc.updatedAt || Date.now();
      localStorage.setItem(LS_KEYS.MASTER_DATA, JSON.stringify(doc.data));
      localStorage.setItem(LS_KEYS.MASTER_UPDATED, String(state.masterUpdatedAt));
      if (doc.config) localStorage.setItem(LS_KEYS.MASTER_CONFIG, JSON.stringify(doc.config));
      const masterPanel = document.getElementById('panel-master');
      if (masterPanel && masterPanel.classList.contains('active')) {
        renderMasterStatus();
      }
      renderSettingsOverview();
    });
  }

  function clearMasterData() {
    if (!confirm('ล้างข้อมูล Master สินค้าทั้งหมดใช่หรือไม่?' + (state.mode === 'real' ? ' (จะล้างบน Firebase ที่ทุกคนใช้ร่วมกันด้วย)' : ''))) return;
    state.barcodeMaster = {};
    state.masterUpdatedAt = null;
    localStorage.removeItem(LS_KEYS.MASTER_DATA);
    localStorage.removeItem(LS_KEYS.MASTER_UPDATED);
    renderMasterStatus();
    if (state.mode === 'real') {
      DB.set(COLLECTIONS.SETTINGS, 'barcodeMaster', { data: {}, updatedAt: Date.now(), updatedBy: state.currentUser ? state.currentUser.name : '-' })
        .catch((err) => console.error(err));
    }
    toast('ล้างข้อมูล Master เรียบร้อย', 'info');
  }

  function loadMasterFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_KEYS.MASTER_DATA) || 'null');
      if (data) state.barcodeMaster = data;
      const updated = localStorage.getItem(LS_KEYS.MASTER_UPDATED);
      if (updated) state.masterUpdatedAt = parseInt(updated, 10);
    } catch (e) { /* ignore corrupt data */ }
  }

  /* ----------------------------------------------------------------------
     12g. SEARCH ACROSS ALL JOBS
  ---------------------------------------------------------------------- */
  let searchAllCartons = [];
  let searchAllDetails = [];

  function goToSearchAllScreen() {
    clearListeners();
    showScreen('screen-search-all');
    document.getElementById('search-all-input').value = '';

    const unsubC = DB.listen(COLLECTIONS.CARTONS, null, (rows) => {
      searchAllCartons = rows;
      renderSearchAll();
    });
    const unsubD = DB.listen(COLLECTIONS.CARTON_DETAILS, null, (rows) => {
      searchAllDetails = rows;
      renderSearchAll();
    });
    state.unsubscribers.push(unsubC, unsubD);
  }

  function renderSearchAll() {
    const filter = document.getElementById('search-all-input').value.trim();
    const body = document.getElementById('search-all-body');
    const cartonById = {};
    searchAllCartons.forEach((c) => { cartonById[c.id] = c; });

    if (!filter) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">🔎</div>พิมพ์คำค้นหาด้านบนเพื่อเริ่มค้นหา</div>';
      document.getElementById('search-all-count').textContent = 0;
      return;
    }

    const matches = searchAllDetails.filter((d) => {
      const c = cartonById[d.cartonId];
      return matchFilter(d.barcode, filter) || matchFilter(d.sku, filter) || matchFilter(d.name, filter) ||
        (c && (matchFilter(c.cartonNo, filter) || matchFilter(c.ชื่องานName, filter)));
    });

    matches.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    document.getElementById('search-all-count').textContent = matches.length;

    if (!matches.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">🔍</div>ไม่พบข้อมูลที่ค้นหา</div>';
      return;
    }

    body.innerHTML = matches.slice(0, 200).map((d) => {
      const c = cartonById[d.cartonId];
      return `
        <div class="report-carton-block">
          <div class="rc-title">${escapeHtml(d.barcode)}${d.name ? '<span class="prod-name-tag">' + escapeHtml(d.name) + (d.sku && d.sku !== d.barcode ? ' · SKU ' + escapeHtml(d.sku) : '') + '</span>' : ''}</div>
          <div class="rc-meta">
            📋 ${escapeHtml(c ? c.ชื่องานName : '-')} · 📦 ${escapeHtml(c ? c.cartonNo : '-')} · ${escapeHtml(c ? c.userName : '-')} · ${formatDate(d.createdAt)}
          </div>
          <div class="report-item-row" style="border-top:none;">
            <span>จำนวน</span>
            <span class="qty-badge">x${d.qty}</span>
          </div>
        </div>
      `;
    }).join('');
    if (matches.length > 200) {
      body.innerHTML += '<div class="hint" style="text-align:center;">แสดง 200 รายการแรก จากทั้งหมด ' + matches.length + ' รายการ — พิมพ์คำค้นหาให้เจาะจงขึ้นเพื่อผลลัพธ์ที่แม่นยำกว่านี้</div>';
    }
  }

  /* ----------------------------------------------------------------------
     12h. AUDIT LOG SCREEN
  ---------------------------------------------------------------------- */
  let auditLogRows = [];
  const AUDIT_ICONS = {
    'สร้างชื่องาน': '📋',
    'ปิดชื่องาน': '🔒',
    'เปิดชื่องานอีกครั้ง (Undo)': '↩️',
    'บันทึก Carton': '📦',
  };

  let settingsAuditUnsub = null;
  async function populateSettingsAuditJobs() {
    const select = document.getElementById('audit-job-select');
    const jobs = await DB.getAll(COLLECTIONS.JOBS);
    jobs.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    
    let html = '<option value="">-- เลือกชื่องาน --</option>';
    html += jobs.map(j => `<option value="${j.id}">${escapeHtml(j.name)}</option>`).join('');
    select.innerHTML = html;
    
    if (state.currentJob) {
      select.value = state.currentJob.id;
      loadSettingsAuditLog();
    }
  }

  function loadSettingsAuditLog() {
    const jobId = document.getElementById('audit-job-select').value;
    if (settingsAuditUnsub) {
      settingsAuditUnsub();
      settingsAuditUnsub = null;
    }
    
    if (!jobId) {
      auditLogRows = [];
      renderSettingsAuditLog();
      return;
    }
    
    settingsAuditUnsub = DB.listen(COLLECTIONS.AUDIT_LOGS, jobId, (rows) => {
      auditLogRows = rows;
      renderSettingsAuditLog();
    });
  }

  function renderSettingsAuditLog() {
    const filter = document.getElementById('audit-filter').value.trim();
    const body = document.getElementById('audit-body');
    let rows = auditLogRows.slice();
    
    if (!document.getElementById('audit-job-select').value) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">👆</div>กรุณาเลือกชื่องานเพื่อดูประวัติ</div>';
      return;
    }
    
    if (filter) {
      rows = rows.filter((r) => matchFilter(r.userName, filter) || matchFilter(r.action, filter) || matchFilter(r.detail, filter));
    }
    rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    if (!rows.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">📜</div>ยังไม่มีประวัติในงานนี้</div>';
      return;
    }

    body.innerHTML = rows.map((r) => `
      <div class="audit-entry">
        <div class="ae-icon">${AUDIT_ICONS[r.action] || '📝'}</div>
        <div class="ae-body">
          <div class="ae-action">${escapeHtml(r.action)}</div>
          ${r.detail ? '<div class="ae-detail">' + escapeHtml(r.detail) + '</div>' : ''}
          <div class="ae-meta">👤 ${escapeHtml(r.userName)} · ${formatDate(r.createdAt)}</div>
        </div>
      </div>
    `).join('');
  }

  /* ----------------------------------------------------------------------
     12i. PIN LOCK — ป้องกันหน้าตั้งค่า (⚙️ Setup) ด้วย PIN ที่ตรวจสอบผ่าน Backend
     PIN จริงเก็บอยู่ที่ ENV ของ Backend (Render) เท่านั้น ไม่ได้ฝังไว้ใน Frontend
  ---------------------------------------------------------------------- */
  function getBackendUrl() {
    return (typeof window !== 'undefined' && window.__PUSH_BACKEND_URL__) || null;
  }

  function requirePin(onSuccess) {
    // PIN removed as per user request 1.2
    onSuccess();
  }



  /* ----------------------------------------------------------------------
     13. SETTINGS DASHBOARD (F14) — แผงควบคุมแอดมิน
  ---------------------------------------------------------------------- */
  function goToSetupScreen() {
    showScreen('screen-setup');
    const cfg = getFirebaseConfig() || {};
    document.getElementById('cfg-apiKey').value = cfg.apiKey || '';
    document.getElementById('cfg-authDomain').value = cfg.authDomain || '';
    document.getElementById('cfg-projectId').value = cfg.projectId || '';
    document.getElementById('cfg-storageBucket').value = cfg.storageBucket || '';
    document.getElementById('cfg-messagingSenderId').value = cfg.messagingSenderId || '';
    document.getElementById('cfg-appId').value = cfg.appId || '';
    updateNotifyUI();

    const savedMasterCfg = JSON.parse(localStorage.getItem(LS_KEYS.MASTER_CONFIG) || 'null');
    applyMasterConfigToForm(savedMasterCfg || {});
    document.getElementById('master-file-name').textContent = 'ยังไม่ได้เลือกไฟล์';
    state.masterFile = null;

    setSettingsPanel(state.activeSettingsPanel || 'firebase');
    renderSettingsOverview();
    renderMasterTable();
    renderUserMgmtList();
    populateSettingsAuditJobs();
    loadNotifyTemplatesIntoForm();
    checkAutoCloseWarning();
    refreshSystemStatus();
    
    // Thresholds
    document.getElementById('cfg-threshold-autoclose').value = state.thresholds.autoclose;
    document.getElementById('cfg-threshold-autosave').value = state.thresholds.autosave;
    
    goToSetupScreen._auditUnsub && goToSetupScreen._auditUnsub();
    goToSetupScreen._auditUnsub = DB.listen(COLLECTIONS.SETUP_ACCESS_LOGS, null, (rows) => {
      setupAccessLogRows = rows;
      renderSetupAccessLog();
    });
  }

  function setSettingsPanel(panelKey) {
    state.activeSettingsPanel = panelKey;
    document.querySelectorAll('.settings-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.panel === panelKey);
    });
    document.querySelectorAll('.settings-panel').forEach((panel) => {
      const isActive = panel.id === 'panel-' + panelKey;
      panel.classList.toggle('active', isActive);
      panel.style.display = isActive ? 'block' : 'none';
    });
    if (panelKey === 'reopen') goToPanelReopenInit();
    if (panelKey === 'audit') populateSettingsAuditJobs();
  }

  function renderSettingsOverview() {
    document.getElementById('ov-users').textContent = state.usersList.length;
    document.getElementById('ov-master').textContent = Object.keys(state.barcodeMaster).length;
    document.getElementById('ov-mode').textContent = state.mode === 'real' ? 'REAL' : 'MOCK';
    const backendUrl = getBackendUrl();
    document.getElementById('ov-backend').textContent = backendUrl ? '⚙️' : '—';
  }

  /* ----------------------------------------------------------------------
     13b. BARCODE MASTER — ตารางแก้ไขทีละรายการ + รูปสินค้า (F2 + B8)
  ---------------------------------------------------------------------- */
  function renderMasterTable() {
    const body = document.getElementById('master-table-body');
    if (!body) return;
    const filter = (document.getElementById('master-table-filter').value || '').trim().toLowerCase();
    let entries = Object.entries(state.barcodeMaster);
    if (filter) {
      entries = entries.filter(([barcode, info]) =>
        barcode.toLowerCase().includes(filter) ||
        (info.name || '').toLowerCase().includes(filter) ||
        (info.sku || '').toLowerCase().includes(filter)
      );
    }
    entries.sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0], 'th'));

    if (!entries.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">📇</div>ยังไม่มีข้อมูลสินค้า</div>';
      return;
    }

    body.innerHTML = entries.map(([barcode, info]) => {
      const thumb = info.imageUrl
        ? `<img class="mt-thumb" src="${escapeHtml(info.imageUrl)}" alt="" onerror="this.style.display='none'">`
        : `<div class="mt-thumb placeholder">📦</div>`;
      return `
        <div class="master-table-row" data-barcode="${escapeHtml(barcode)}">
          ${thumb}
          <div class="mt-info">
            <div class="mt-barcode">${escapeHtml(barcode)}</div>
            <div class="mt-name">${escapeHtml(info.name || '-')}${info.sku ? ' · ' + escapeHtml(info.sku) : ''}${info.expectedQty != null ? ' · ควรมี ' + info.expectedQty : ''}</div>
          </div>
          <div class="mt-actions">
            <button class="row-action-btn" data-action="edit" title="แก้ไข">✏️</button>
            <button class="row-action-btn danger" data-action="del" title="ลบ">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    body.querySelectorAll('.master-table-row').forEach((row) => {
      const barcode = row.dataset.barcode;
      row.querySelector('[data-action="edit"]').addEventListener('click', () => loadMasterRowIntoForm(barcode));
      row.querySelector('[data-action="del"]').addEventListener('click', () => deleteMasterRow(barcode));
    });
  }

  function loadMasterRowIntoForm(barcode) {
    const info = state.barcodeMaster[barcode];
    if (!info) return;
    state.editingMasterBarcode = barcode;
    document.getElementById('me-barcode').value = barcode;
    document.getElementById('me-name').value = info.name || '';
    document.getElementById('me-sku').value = info.sku || '';
    document.getElementById('me-expqty').value = info.expectedQty != null ? info.expectedQty : '';
    document.getElementById('me-image').value = info.imageUrl || '';
    updateMasterImagePreview();
    document.getElementById('me-barcode').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearMasterRowForm() {
    state.editingMasterBarcode = null;
    ['me-barcode', 'me-name', 'me-sku', 'me-expqty', 'me-image'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    updateMasterImagePreview();
  }

  function updateMasterImagePreview() {
    const url = document.getElementById('me-image').value.trim();
    const box = document.getElementById('me-image-preview');
    const img = document.getElementById('me-image-preview-img');
    if (url) {
      img.src = url;
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
      img.src = '';
    }
  }

  async function saveMasterRowFromForm() {
    const barcode = document.getElementById('me-barcode').value.trim();
    if (!barcode) { toast('กรุณาใส่ Barcode', 'error'); return; }

    const name = document.getElementById('me-name').value.trim();
    const sku = document.getElementById('me-sku').value.trim();
    const expQtyRaw = document.getElementById('me-expqty').value.trim();
    const expectedQty = expQtyRaw === '' ? null : (isNaN(parseFloat(expQtyRaw)) ? null : parseFloat(expQtyRaw));
    const imageUrl = document.getElementById('me-image').value.trim();

    // ถ้าแก้ไข barcode เดิมเป็นค่าใหม่ ให้ลบของเก่าออกก่อน
    if (state.editingMasterBarcode && state.editingMasterBarcode !== barcode) {
      delete state.barcodeMaster[state.editingMasterBarcode];
    }

    state.barcodeMaster[barcode] = { name, sku, expectedQty, imageUrl };
    state.masterUpdatedAt = Date.now();
    localStorage.setItem(LS_KEYS.MASTER_DATA, JSON.stringify(state.barcodeMaster));
    localStorage.setItem(LS_KEYS.MASTER_UPDATED, String(state.masterUpdatedAt));

    if (state.mode === 'real') {
      const savedCfg = JSON.parse(localStorage.getItem(LS_KEYS.MASTER_CONFIG) || 'null') || {};
      await syncMasterToFirebase(savedCfg, state.barcodeMaster);
    }

    renderMasterStatus();
    renderMasterTable();
    renderSettingsOverview();
    clearMasterRowForm();
    toast('บันทึกสินค้า "' + (name || barcode) + '" สำเร็จ', 'success');
  }

  function deleteMasterRow(barcode) {
    if (!confirm('ลบสินค้า "' + barcode + '" ออกจากฐานข้อมูลใช่หรือไม่?')) return;
    delete state.barcodeMaster[barcode];
    state.masterUpdatedAt = Date.now();
    localStorage.setItem(LS_KEYS.MASTER_DATA, JSON.stringify(state.barcodeMaster));
    localStorage.setItem(LS_KEYS.MASTER_UPDATED, String(state.masterUpdatedAt));

    if (state.mode === 'real') {
      const savedCfg = JSON.parse(localStorage.getItem(LS_KEYS.MASTER_CONFIG) || 'null') || {};
      syncMasterToFirebase(savedCfg, state.barcodeMaster).catch((err) => console.error(err));
    }

    renderMasterStatus();
    renderMasterTable();
    renderSettingsOverview();
    toast('ลบสินค้าแล้ว', 'info');
  }

  /* ----------------------------------------------------------------------
     13c. USER MANAGEMENT (B1) — เพิ่ม/ลบ/แก้ไขผู้ใช้ 5 คน
  ---------------------------------------------------------------------- */
  function renderUserMgmtList() {
    const body = document.getElementById('user-mgmt-list');
    if (!body) return;
    document.getElementById('um-count').textContent = state.usersList.length;
    body.innerHTML = state.usersList.map((u) => `
      <div class="user-mgmt-row" data-user-id="${escapeHtml(u.id)}">
        <div class="um-dot" style="background:${u.color};">${escapeHtml(u.name.charAt(0))}</div>
        <div class="um-info">
          <div class="um-name">${escapeHtml(u.name)}</div>
          <div class="um-id">${escapeHtml(u.id)}</div>
        </div>
        <div class="mt-actions">
          <button class="row-action-btn" data-action="edit" title="แก้ไข">✏️</button>
          <button class="row-action-btn danger" data-action="del" title="ลบ">🗑️</button>
        </div>
      </div>
    `).join('');

    body.querySelectorAll('.user-mgmt-row').forEach((row) => {
      const id = row.dataset.userId;
      row.querySelector('[data-action="edit"]').addEventListener('click', () => loadUserIntoForm(id));
      row.querySelector('[data-action="del"]').addEventListener('click', () => deleteUser(id));
    });
  }

  function loadUserIntoForm(id) {
    const u = state.usersList.find((x) => x.id === id);
    if (!u) return;
    state.editingUserId = id;
    document.getElementById('um-id').value = u.id;
    document.getElementById('um-id').disabled = true; // แก้ id เดิมไม่ได้ กันชนกับข้อมูลเก่าที่เคยสแกนไว้
    document.getElementById('um-name').value = u.name;
    document.getElementById('um-color').value = u.color;
  }

  function clearUserForm() {
    state.editingUserId = null;
    document.getElementById('um-id').value = '';
    document.getElementById('um-id').disabled = false;
    document.getElementById('um-name').value = '';
    document.getElementById('um-color').value = '#3b82f6';
  }

  async function saveUserFromForm() {
    let id = document.getElementById('um-id').value.trim();
    const name = document.getElementById('um-name').value.trim();
    const color = document.getElementById('um-color').value;

    if (!name) { toast('กรุณาใส่ชื่อผู้ใช้', 'error'); return; }
    if (!state.editingUserId) {
      if (!id) id = 'u_' + name.replace(/\s+/g, '').toLowerCase() + '_' + Date.now().toString(36).slice(-4);
      if (state.usersList.some((u) => u.id === id)) { toast('รหัสผู้ใช้นี้มีอยู่แล้ว กรุณาตั้งใหม่', 'error'); return; }
      state.usersList.push({ id, name, color });
    } else {
      const u = state.usersList.find((x) => x.id === state.editingUserId);
      if (u) { u.name = name; u.color = color; }
    }

    await persistUsersList();
    renderUserGrid();
    renderUserMgmtList();
    renderSettingsOverview();
    clearUserForm();
    toast('บันทึกผู้ใช้ "' + name + '" สำเร็จ', 'success');
  }

  function deleteUser(id) {
    if (state.usersList.length <= 1) { toast('ต้องมีผู้ใช้อย่างน้อย 1 คน', 'error'); return; }
    const u = state.usersList.find((x) => x.id === id);
    if (!u) return;
    if (!confirm('ลบผู้ใช้ "' + u.name + '" ใช่หรือไม่? (ประวัติการสแกนเดิมของคนนี้จะยังอยู่ในระบบ)')) return;
    state.usersList = state.usersList.filter((x) => x.id !== id);
    persistUsersList();
    renderUserGrid();
    renderUserMgmtList();
    renderSettingsOverview();
    toast('ลบผู้ใช้แล้ว', 'info');
  }

  async function persistUsersList() {
    state.usersListUpdatedAt = Date.now();
    localStorage.setItem(LS_KEYS.USERS_LIST, JSON.stringify(state.usersList));
    localStorage.setItem(LS_KEYS.USERS_UPDATED, String(state.usersListUpdatedAt));
    if (state.mode === 'real') {
      try {
        await DB.set(COLLECTIONS.SETTINGS, 'appUsers', {
          data: state.usersList,
          updatedAt: state.usersListUpdatedAt,
          updatedBy: state.currentUser ? state.currentUser.name : '-',
        });
      } catch (err) { console.error('persistUsersList sync error:', err); }
    }
  }

  function loadUsersListFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_KEYS.USERS_LIST) || 'null');
      if (Array.isArray(data) && data.length) state.usersList = data;
    } catch (e) { /* ignore */ }
  }

  function listenUsersListFromFirebase() {
    if (state.mode !== 'real') return;
    if (state.usersListUnsub) { try { state.usersListUnsub(); } catch (e) {} }
    state.usersListUnsub = DB.listenDoc(COLLECTIONS.SETTINGS, 'appUsers', (doc) => {
      if (!doc || !Array.isArray(doc.data) || !doc.data.length) return;
      state.usersList = doc.data;
      localStorage.setItem(LS_KEYS.USERS_LIST, JSON.stringify(state.usersList));
      renderUserGrid();
      const usersPanel = document.getElementById('panel-users');
      if (usersPanel && usersPanel.classList.contains('active')) {
        renderUserMgmtList();
      }
      renderSettingsOverview();
    });
  }

  /* ----------------------------------------------------------------------
     13d. NOTIFICATION TEMPLATES (B4)
  ---------------------------------------------------------------------- */
  function loadNotifyTemplatesIntoForm() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEYS.NOTIFY_TEMPLATES) || 'null');
      if (saved) state.notifyTemplates = saved;
    } catch (e) { /* ignore */ }
    document.getElementById('tpl-job-closed').value = state.notifyTemplates.jobClosed || '';
    document.getElementById('tpl-carton-new').value = state.notifyTemplates.cartonNew || '';
  }

  function saveNotifyTemplates() {
    state.notifyTemplates = {
      jobClosed: document.getElementById('tpl-job-closed').value.trim(),
      cartonNew: document.getElementById('tpl-carton-new').value.trim(),
    };
    localStorage.setItem(LS_KEYS.NOTIFY_TEMPLATES, JSON.stringify(state.notifyTemplates));
    if (state.mode === 'real') {
      DB.set(COLLECTIONS.SETTINGS, 'notifyTemplates', {
        data: state.notifyTemplates,
        updatedAt: Date.now(),
        updatedBy: state.currentUser ? state.currentUser.name : '-',
      }).catch((err) => console.error('sync notifyTemplates error:', err));
    }
    toast('บันทึกแม่แบบข้อความแจ้งเตือนแล้ว' + (state.mode === 'real' ? ' และซิงค์ให้ Backend ใช้แล้ว' : ''), 'success');
  }

  function fillTemplate(tpl, vars) {
    if (!tpl) return null;
    let out = tpl;
    Object.keys(vars).forEach((k) => { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  }

  /* ----------------------------------------------------------------------
     13e. SYSTEM STATUS (B3, B9) — สถานะ Backend + Firestore Quota (โดยประมาณ)
  ---------------------------------------------------------------------- */
  async function refreshSystemStatus() {
    const backendUrl = getBackendUrl();
    const statusEl = document.getElementById('sys-backend-status');
    const pushEl = document.getElementById('sys-push-today');
    const uptimeEl = document.getElementById('sys-backend-uptime');
    if (!backendUrl) {
      statusEl.textContent = 'ไม่ได้ตั้งค่า';
      pushEl.textContent = '-';
      uptimeEl.textContent = '-';
      return;
    }
    statusEl.textContent = 'กำลังเช็ค...';
    try {
      const res = await fetch(backendUrl + '/', { method: 'GET' });
      const data = await res.json();
      statusEl.textContent = data.status === 'ok' ? '🟢 ออนไลน์' : '🔴 มีปัญหา';
      pushEl.textContent = typeof data.pushSentToday === 'number' ? data.pushSentToday : 'ไม่มีข้อมูล';
      uptimeEl.textContent = data.uptimeMinutes != null ? Math.floor(data.uptimeMinutes) + ' นาที' : '-';
    } catch (err) {
      statusEl.textContent = '🔴 เชื่อมต่อไม่ได้ (อาจ sleep อยู่)';
      pushEl.textContent = '-';
      uptimeEl.textContent = '-';
    }
  }

  /* ----------------------------------------------------------------------
     13f. SETUP ACCESS LOG (B6) — ใครใส่ PIN เข้ามาเมื่อไหร่
  ---------------------------------------------------------------------- */
  let setupAccessLogRows = [];

  function writeSetupAccessLog() {
    if (!state.currentUser) return;
    DB.add(COLLECTIONS.SETUP_ACCESS_LOGS, {
      userId: state.currentUser.id,
      userName: state.currentUser.name,
      createdAt: nowValue(),
    }).catch((err) => console.error('writeSetupAccessLog error:', err));
  }

  function renderSetupAccessLog() {
    const body = document.getElementById('setup-access-log-body');
    if (!body) return;
    const filter = (document.getElementById('setup-log-filter').value || '').trim().toLowerCase();
    let rows = setupAccessLogRows.slice();
    if (filter) rows = rows.filter((r) => (r.userName || '').toLowerCase().includes(filter));
    rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    rows = rows.slice(0, 50);

    if (!rows.length) {
      body.innerHTML = '<div class="empty-state"><div class="emoji">📜</div>ยังไม่มีประวัติการเข้าหน้า Settings</div>';
      return;
    }
    body.innerHTML = rows.map((r) => `
      <div class="audit-entry">
        <div class="ae-icon">🔑</div>
        <div class="ae-body">
          <div class="ae-action">${escapeHtml(r.userName)}</div>
          <div class="ae-meta">${formatDate(r.createdAt)}</div>
        </div>
      </div>
    `).join('');
  }

  /* ----------------------------------------------------------------------
     13g. AUTO-CLOSE WARNING (B7 — ฝั่ง Frontend: แจ้งเตือนล่วงหน้า 30 นาที)
     การปิดจริงทำที่ Backend (server.js) — ที่นี่แค่เตือนใน Settings ให้รู้ล่วงหน้า
  ---------------------------------------------------------------------- */
  const AUTO_CLOSE_WARNING_MINUTES = 30;

  async function checkAutoCloseWarning() {
    const banner = document.getElementById('autoclose-warning-banner');
    if (!banner) return;
    try {
      const jobs = await DB.getAll(COLLECTIONS.JOBS);
      const now = Date.now();
      const autoCloseHours = state.thresholds.autoclose;
      const warnMs = autoCloseHours * 3600 * 1000 - AUTO_CLOSE_WARNING_MINUTES * 60 * 1000;
      const closeMs = autoCloseHours * 3600 * 1000;

      const soonToClose = jobs.filter((j) => {
        if (j.status !== 'active') return false;
        const lastActivity = toMillis(j.lastActivityAt || j.createdAt);
        if (!lastActivity) return false;
        const elapsed = now - lastActivity;
        return elapsed >= warnMs && elapsed < closeMs;
      });

      if (!soonToClose.length) { banner.style.display = 'none'; return; }

      banner.style.display = 'block';
      banner.innerHTML = '⏰ ชื่องานต่อไปนี้ไม่มีการสแกนมานาน จะถูก<b>ปิดอัตโนมัติ</b>ภายใน 30 นาที ถ้าไม่มีการสแกนเพิ่ม:<br>' +
        soonToClose.map((j) => {
          const lastActivity = toMillis(j.lastActivityAt || j.createdAt);
          const minsLeft = Math.max(0, Math.round((closeMs - (now - lastActivity)) / 60000));
          return '• ' + escapeHtml(j.name) + ' (เหลือ ~' + minsLeft + ' นาที)';
        }).join('<br>');
    } catch (err) {
      console.error('checkAutoCloseWarning error:', err);
    }
  }

  /* ----------------------------------------------------------------------
     13h. FULL FIRESTORE EXPORT (B5)
  ---------------------------------------------------------------------- */
  async function exportFirestoreFull() {
    const btn = document.getElementById('btn-export-firestore-full');
    btn.disabled = true;
    btn.textContent = 'กำลัง Export...';
    try {
      const collections = [
        COLLECTIONS.JOBS, COLLECTIONS.CARTONS, COLLECTIONS.CARTON_DETAILS,
        COLLECTIONS.SCAN_LOGS, COLLECTIONS.AUDIT_LOGS, COLLECTIONS.PRESENCE,
        COLLECTIONS.SETUP_ACCESS_LOGS, COLLECTIONS.REOPEN_LOGS,
      ];
      const dump = { exportedAt: new Date().toISOString(), mode: state.mode };
      for (const col of collections) {
        dump[col] = await DB.getAll(col);
      }
      dump.usersList = state.usersList;
      dump.barcodeMaster = state.barcodeMaster;

      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sbg-warehouse-full-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Export ฐานข้อมูลทั้งหมดสำเร็จ', 'success');
    } catch (err) {
      console.error(err);
      toast('Export ไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📦 Export ฐานข้อมูลทั้งหมด';
    }
  }

  /* ----------------------------------------------------------------------
     13i. INLINE EDIT MODAL (Reopen Carton)
  ---------------------------------------------------------------------- */
  async function initInlineEditCarton(carton) {
    const confirmed = await showConfirmModal({
      title: '🔓 ยืนยันเข้าแก้ไข Carton',
      message: `คุณกำลังจะแก้ไข Carton "${carton.cartonNo}"\n\nการเปลี่ยนแปลงจะถูกบันทึกลงใน Audit Log พร้อมชื่อของคุณ`,
      confirmText: 'ยืนยันแก้ไข',
    });
    if (!confirmed) return;

    try {
      const allDetails = await DB.getAll(COLLECTIONS.CARTON_DETAILS);
      const items = allDetails
        .filter((d) => d.cartonId === carton.id)
        .map((d) => ({ barcode: d.barcode, name: d.name || '', sku: d.sku || '', qty: d.qty || 0 }));

      state.reopenEditingCarton = carton;
      state.reopenEditItems = JSON.parse(JSON.stringify(items));
      state.reopenEditItemsOriginal = JSON.parse(JSON.stringify(items));

      document.getElementById('inline-edit-label').textContent = carton.cartonNo;
      document.getElementById('inline-edit-barcode').value = '';
      document.getElementById('inline-edit-modal').style.display = 'flex';
      renderInlineEditItemsList();
    } catch (err) {
      console.error(err);
      toast('โหลดรายการไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  function renderInlineEditItemsList() {
    const list = document.getElementById('inline-edit-items-list');
    if (!list) return;
    if (!state.reopenEditItems.length) {
      list.innerHTML = '<div class="empty-state"><div class="emoji">📭</div>ไม่มีรายการ</div>';
      return;
    }
    list.innerHTML = state.reopenEditItems.map((s, idx) => `
      <div class="scan-row by-me swipeable" data-idx="${idx}">
        <div class="swipe-content" style="display:flex; width:100%; justify-content:space-between; align-items:center;">
          <div>
            <div class="barcode">${escapeHtml(s.barcode)}</div>
            ${s.name ? `<span class="prod-name-tag">${escapeHtml(s.name)}</span>` : ''}
          </div>
          <div class="scan-row-actions">
            <button class="row-action-btn" data-action="dec">−</button>
            <span class="qty-badge">Qty ${s.qty}</span>
            <button class="row-action-btn" data-action="inc">+</button>
          </div>
        </div>
        <div class="swipe-delete-bg">🗑️ ลบ</div>
      </div>
    `).join('');
    
    list.querySelectorAll('.scan-row').forEach((row) => {
      const idx = parseInt(row.dataset.idx, 10);
      row.querySelector('[data-action="inc"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.reopenEditItems[idx].qty += 1;
        renderInlineEditItemsList();
      });
      row.querySelector('[data-action="dec"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.reopenEditItems[idx].qty = Math.max(1, state.reopenEditItems[idx].qty - 1);
        renderInlineEditItemsList();
      });
      attachSwipeToDeleteReopen(row, idx);
    });
  }

  function attachSwipeToDeleteReopen(row, idx) {
    let startX = 0, currentX = 0, dragging = false;
    const THRESHOLD = -80;

    row.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      dragging = true;
      row.classList.add('swiping');
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      currentX = e.touches[0].clientX - startX;
      if (currentX > 0) currentX = 0; 
      row.style.transform = `translateX(${currentX}px)`;
      row.classList.toggle('swipe-delete-hint', currentX < THRESHOLD);
    }, { passive: true });

    row.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      row.classList.remove('swiping');
      if (currentX < THRESHOLD) {
        row.style.transform = 'translateX(-100%)';
        row.style.opacity = '0';
        setTimeout(() => {
          state.reopenEditItems.splice(idx, 1);
          renderInlineEditItemsList();
        }, 180);
      } else {
        row.style.transform = '';
        row.classList.remove('swipe-delete-hint');
      }
      currentX = 0;
    });
  }

  function inlineEditAddBarcode() {
    const input = document.getElementById('inline-edit-barcode');
    const barcode = input.value.trim();
    if (!barcode) return;
    const matched = state.barcodeMaster[barcode];
    if (!matched) {
      toast('❌ ไม่พบ Barcode "' + barcode + '" ในฐานข้อมูลสินค้า', 'error');
      playScanSound('error');
      input.value = '';
      return;
    }
    const existing = state.reopenEditItems.find((s) => s.barcode === barcode);
    if (existing) {
      existing.qty += 1;
    } else {
      state.reopenEditItems.push({ barcode, name: matched.name || '', sku: matched.sku || '', qty: 1 });
    }
    playScanSound('success');
    input.value = '';
    renderInlineEditItemsList();
  }

  function cancelInlineEdit() {
    state.reopenEditingCarton = null;
    state.reopenEditItems = [];
    state.reopenEditItemsOriginal = [];
    document.getElementById('inline-edit-modal').style.display = 'none';
  }

  function diffReopenItems(before, after) {
    const beforeMap = {}; before.forEach((i) => { beforeMap[i.barcode] = i.qty; });
    const afterMap = {}; after.forEach((i) => { afterMap[i.barcode] = i.qty; });
    const diffs = [];
    const allBarcodes = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
    allBarcodes.forEach((bc) => {
      const b = beforeMap[bc], a = afterMap[bc];
      if (b === undefined) diffs.push(bc + ': เพิ่มใหม่ (+' + a + ')');
      else if (a === undefined) diffs.push(bc + ': ลบออก (เดิม ' + b + ')');
      else if (a !== b) diffs.push(bc + ': ' + b + ' → ' + a);
    });
    return diffs;
  }

  async function saveInlineEdit() {
    if (!state.reopenEditingCarton) return;
    const carton = state.reopenEditingCarton;
    const diffs = diffReopenItems(state.reopenEditItemsOriginal, state.reopenEditItems);
    if (!diffs.length) { 
      toast('ไม่มีการเปลี่ยนแปลงใดๆ', 'info'); 
      cancelInlineEdit();
      return; 
    }

    const confirmed = await showConfirmModal({
      title: '💾 ยืนยันการเปลี่ยนแปลง',
      message: 'รายละเอียดการแก้ไขของ Carton "' + carton.cartonNo + '":',
      listItems: diffs,
      confirmText: 'บันทึก',
      danger: false,
    });
    if (!confirmed) return;

    const btn = document.getElementById('btn-inline-edit-save');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';
    try {
      const allDetails = await DB.getAll(COLLECTIONS.CARTON_DETAILS);
      const oldDetailIds = allDetails.filter((d) => d.cartonId === carton.id).map((d) => d.id);
      if (oldDetailIds.length) await DB.deleteBatch(COLLECTIONS.CARTON_DETAILS, oldDetailIds);

      const newDetails = state.reopenEditItems.map((s) => ({
        cartonId: carton.id,
        ชื่องานId: carton['ชื่องานId'],
        sku: s.sku,
        name: s.name || '',
        barcode: s.barcode,
        qty: s.qty,
        createdAt: nowValue(),
      }));
      if (newDetails.length) await DB.addBatch(COLLECTIONS.CARTON_DETAILS, newDetails);

      const totalSku = state.reopenEditItems.length;
      const totalQty = state.reopenEditItems.reduce((s, x) => s + x.qty, 0);
      
      const patch = {
        totalSku, totalQty,
        lastReopenEditAt: nowValue(),
        lastReopenEditBy: state.currentUser ? state.currentUser.name : '-',
      };
      await DB.update(COLLECTIONS.CARTONS, carton.id, patch);

      writeAuditLog('CARTON_REOPEN_EDIT', 'แก้ไข Carton ' + carton.cartonNo + '\\n' + diffs.join(', '));

      toast('บันทึกการแก้ไขสำเร็จ', 'success');
      cancelInlineEdit();
    } catch (err) {
      console.error(err);
      toast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 บันทึก';
    }
  }



  function saveConfigFromForm() {
    const cfg = {
      apiKey: document.getElementById('cfg-apiKey').value.trim(),
      authDomain: document.getElementById('cfg-authDomain').value.trim(),
      projectId: document.getElementById('cfg-projectId').value.trim(),
      storageBucket: document.getElementById('cfg-storageBucket').value.trim(),
      messagingSenderId: document.getElementById('cfg-messagingSenderId').value.trim(),
      appId: document.getElementById('cfg-appId').value.trim(),
    };
    if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
      toast('กรุณาใส่ค่าอย่างน้อย API Key, Project ID, App ID', 'error');
      return;
    }
    saveFirebaseConfigToLocalStorage(cfg);
    toast('บันทึกค่า Firebase แล้ว กำลังเชื่อมต่อใหม่...', 'success');
    setTimeout(() => location.reload(), 900);
  }

  function clearConfigAndReload() {
    if (!confirm('ล้างค่า Firebase Config และกลับไปใช้ MOCKUP MODE ใช่หรือไม่?')) return;
    clearFirebaseConfig();
    toast('ล้างค่าเรียบร้อย กำลังกลับสู่ MOCKUP MODE...', 'info');
    setTimeout(() => location.reload(), 900);
  }

  /* ----------------------------------------------------------------------
     13b. BACKUP / RESTORE SETTINGS (JSON)
  ---------------------------------------------------------------------- */
  function exportBackupSettings() {
    const backup = {
      _type: 'sbg-warehouse-backup',
      _version: 1,
      exportedAt: new Date().toISOString(),
      firebaseConfig: getFirebaseConfig(),
      masterConfig: JSON.parse(localStorage.getItem(LS_KEYS.MASTER_CONFIG) || 'null'),
      masterData: state.barcodeMaster,
      masterUpdatedAt: state.masterUpdatedAt,
      theme: localStorage.getItem(LS_KEYS.THEME),
      soundEnabled: state.soundEnabled,
      speechEnabled: state.speechEnabled,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sbg-warehouse-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Export การตั้งค่าสำเร็จ', 'success');
  }

  function importBackupSettings() {
    const fileInput = document.getElementById('backup-file-input');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { toast('กรุณาเลือกไฟล์ Backup (.json) ก่อน', 'error'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (backup._type !== 'sbg-warehouse-backup') {
          toast('ไฟล์นี้ไม่ใช่ไฟล์ Backup ของ SBG-Warehouse', 'error');
          return;
        }
        if (backup.firebaseConfig && backup.firebaseConfig.apiKey) {
          saveFirebaseConfigToLocalStorage(backup.firebaseConfig);
        }
        if (backup.masterConfig) {
          localStorage.setItem(LS_KEYS.MASTER_CONFIG, JSON.stringify(backup.masterConfig));
        }
        if (backup.masterData) {
          localStorage.setItem(LS_KEYS.MASTER_DATA, JSON.stringify(backup.masterData));
          state.barcodeMaster = backup.masterData;
        }
        if (backup.masterUpdatedAt) {
          localStorage.setItem(LS_KEYS.MASTER_UPDATED, String(backup.masterUpdatedAt));
          state.masterUpdatedAt = backup.masterUpdatedAt;
        }
        if (backup.theme) applyTheme(backup.theme);
        if (typeof backup.soundEnabled === 'boolean') {
          state.soundEnabled = backup.soundEnabled;
          localStorage.setItem(LS_KEYS.SOUND, backup.soundEnabled ? '1' : '0');
          updateSoundBtn();
        }
        if (typeof backup.speechEnabled === 'boolean') {
          state.speechEnabled = backup.speechEnabled;
          localStorage.setItem(LS_KEYS.SPEECH, backup.speechEnabled ? '1' : '0');
          updateSpeechBtn();
        }
        toast('Import การตั้งค่าสำเร็จ กำลังโหลดใหม่...', 'success');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        console.error(err);
        toast('อ่านไฟล์ Backup ไม่สำเร็จ: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------------------
     14. UTILITIES
  ---------------------------------------------------------------------- */
  function nowValue() {
    // For mock: plain Date. For real Firestore: server timestamp preferred,
    // but client Date works fine for compat mode and keeps mock/real symmetric.
    if (state.mode === 'real' && typeof firebase !== 'undefined') {
      return firebase.firestore.FieldValue.serverTimestamp
        ? firebase.firestore.Timestamp.now()
        : new Date();
    }
    return new Date();
  }

  function toMillis(val) {
    if (!val) return 0;
    if (val instanceof Date) return val.getTime();
    if (val.toDate) return val.toDate().getTime();
    if (val.seconds) return val.seconds * 1000;
    return new Date(val).getTime() || 0;
  }

  function formatDate(val) {
    const ms = toMillis(val);
    if (!ms) return '-';
    const d = new Date(ms);
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  function formatTime(val) {
    const ms = toMillis(val);
    if (!ms) return '-';
    return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  /* ----------------------------------------------------------------------
     15. EVENT WIRING
  ---------------------------------------------------------------------- */
  function wireEvents() {
    // Theme
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('btn-sound').addEventListener('click', toggleSound);
    document.getElementById('btn-speech').addEventListener('click', toggleSpeech);
    document.getElementById('btn-guide').addEventListener('click', () => {
      window.open('user-guide.html', '_blank');
    });

    // Setup
    document.getElementById('btn-setup').addEventListener('click', () => guardNavigation(() => requirePin(goToSetupScreen)));
    document.getElementById('btn-save-config').addEventListener('click', saveConfigFromForm);
    document.getElementById('btn-clear-config').addEventListener('click', clearConfigAndReload);
    document.getElementById('btn-setup-back').addEventListener('click', () => {
      if (state.currentUser && state.currentJob) goToDashboard();
      else if (state.currentUser) goToJobScreen();
      else showScreen('screen-user');
    });
    document.getElementById('btn-backup-export').addEventListener('click', exportBackupSettings);
    document.getElementById('btn-backup-import').addEventListener('click', importBackupSettings);
    document.getElementById('btn-export-firestore-full').addEventListener('click', exportFirestoreFull);

    // Inline Edit Carton
    document.getElementById('inline-edit-barcode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inlineEditAddBarcode();
    });
    document.getElementById('btn-inline-edit-save').addEventListener('click', saveInlineEdit);
    document.getElementById('btn-inline-edit-cancel').addEventListener('click', cancelInlineEdit);

    // Settings tabs (F14)
    document.querySelectorAll('.settings-tab').forEach((tab) => {
      tab.addEventListener('click', () => setSettingsPanel(tab.dataset.panel));
    });

    // Barcode Master (F13 — ตอนนี้อยู่ในหน้า Settings แล้ว)
    document.getElementById('master-file-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      state.masterFile = file || null;
      document.getElementById('master-file-name').textContent = file ? '📄 ' + file.name : 'ยังไม่ได้เลือกไฟล์';
    });
    document.getElementById('btn-import-master').addEventListener('click', importMasterFromFile);
    document.getElementById('btn-clear-master').addEventListener('click', clearMasterData);
    document.getElementById('master-table-filter').addEventListener('input', renderMasterTable);
    document.getElementById('btn-master-save-row').addEventListener('click', saveMasterRowFromForm);
    document.getElementById('btn-master-clear-form').addEventListener('click', clearMasterRowForm);
    document.getElementById('me-image').addEventListener('input', updateMasterImagePreview);

    // User management (B1)
    document.getElementById('btn-user-save').addEventListener('click', saveUserFromForm);
    document.getElementById('btn-user-clear-form').addEventListener('click', clearUserForm);

    // Notification templates (B4)
    document.getElementById('btn-save-templates').addEventListener('click', saveNotifyTemplates);

    // System panel (B3, B6, B9)
    document.getElementById('btn-refresh-system').addEventListener('click', refreshSystemStatus);
    document.getElementById('setup-log-filter').addEventListener('input', renderSetupAccessLog);

    // Job
    document.getElementById('btn-create-job').addEventListener('click', createJob);
    document.getElementById('new-job-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createJob();
    });

    // Carton
    document.getElementById('btn-start-carton').addEventListener('click', startCarton);
    document.getElementById('carton-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startCarton();
    });
    document.getElementById('btn-cam-carton').addEventListener('click', () => {
      toggleCamera('carton-input', 'camera-box-carton', 'reader-carton', 'btn-cam-carton');
    });

    // SBC tabs
    document.getElementById('tab-scanonly').addEventListener('click', () => setSbcMode('scanonly'));
    document.getElementById('tab-scanqty').addEventListener('click', () => setSbcMode('scanqty'));
    document.getElementById('sbc-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSbcScan();
    });
    document.getElementById('btn-cam-sbc').addEventListener('click', () => {
      toggleCamera('sbc-input', 'camera-box-sbc', 'reader-sbc', 'btn-cam-sbc');
    });
    document.getElementById('btn-finish-carton').addEventListener('click', finishCarton);
    document.getElementById('btn-confirm-finish-submit').addEventListener('click', confirmFinishCartonSubmit);
    document.getElementById('btn-cancel-carton').addEventListener('click', cancelCarton);

    // F9: Carton Switch Dropdown
    document.getElementById('btn-scan-changecarton').addEventListener('click', (e) => {
      const dropdown = document.getElementById('scan-carton-picker');
      if (dropdown.style.display === 'none') openCartonPickerDropdown();
      else closeCartonPickerDropdown();
      e.stopPropagation();
    });
    document.getElementById('scan-carton-picker-search').addEventListener('input', renderCartonPickerList);

    // Feedback 1.1 #18 — ปุ่มลอยย้อนกลับขึ้นบนสุดในหน้า Settings
    const scrollTopBtn = document.getElementById('btn-settings-scrolltop');
    if (scrollTopBtn) {
      scrollTopBtn.addEventListener('click', () => {
        const el = document.getElementById('screen-setup');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      window.addEventListener('scroll', () => {
        const setupScreen = document.getElementById('screen-setup');
        const isSetupActive = setupScreen && setupScreen.classList.contains('active');
        scrollTopBtn.classList.toggle('show', isSetupActive && window.scrollY > 300);
      });
    }
    document.getElementById('quick-search-input').addEventListener('input', handleQuickSearchInput);
    document.getElementById('chk-rapidfire').addEventListener('change', (e) => {
      state.rapidFireMode = e.target.checked;
    });
    document.getElementById('btn-undo-scan').addEventListener('click', undoLastScan);

    // Dashboard
    document.getElementById('btn-goto-carton').addEventListener('click', goToCartonScreen);
    document.getElementById('btn-close-job').addEventListener('click', closeJob);
    document.getElementById('btn-reopen-job').addEventListener('click', reopenJob);

    // Report
    const tabSum = document.getElementById('tab-report-summary');
    if (tabSum) tabSum.addEventListener('click', () => setReportMode('summary'));
    const tabDet = document.getElementById('tab-report-detail');
    if (tabDet) tabDet.addEventListener('click', () => setReportMode('detail'));
    const tabPerf = document.getElementById('tab-report-performance');
    if (tabPerf) tabPerf.addEventListener('click', () => setReportMode('performance'));
    const tabStock = document.getElementById('tab-report-stocktake');
    if (tabStock) tabStock.addEventListener('click', () => setReportMode('stocktake'));
    const repFilter = document.getElementById('report-filter');
    if (repFilter) {
      repFilter.addEventListener('input', (e) => {
        state.reportFilter = e.target.value;
        renderReport();
      });
    }
    const btnReportChangeJob = document.getElementById('btn-report-changejob');
    if (btnReportChangeJob) {
      btnReportChangeJob.addEventListener('click', (e) => {
        const dropdown = document.getElementById('report-job-picker');
        if (dropdown && dropdown.style.display === 'none') openJobPickerDropdown();
        else closeJobPickerDropdown();
        e.stopPropagation();
      });
    }
    const repJobPickerSearch = document.getElementById('report-job-picker-search');
    if (repJobPickerSearch) repJobPickerSearch.addEventListener('input', renderJobPickerList);
    const btnRepExport = document.getElementById('btn-report-export');
    if (btnRepExport) btnRepExport.addEventListener('click', exportReportToExcel);
    const btnRepSearchAll = document.getElementById('btn-report-search-all');
    if (btnRepSearchAll) btnRepSearchAll.addEventListener('click', goToSearchAllScreen);
    const searchAllInput = document.getElementById('search-all-input');
    if (searchAllInput) searchAllInput.addEventListener('input', renderSearchAll);
    const btnSearchAllBack = document.getElementById('btn-search-all-back');
    if (btnSearchAllBack) btnSearchAllBack.addEventListener('click', goToReportScreen);

    // Settings Access Control
    const togglePerf = document.getElementById('toggle-tab-performance');
    if (togglePerf) togglePerf.addEventListener('change', updateReportVisibilityFromForm);
    const toggleStock = document.getElementById('toggle-tab-stocktake');
    if (toggleStock) toggleStock.addEventListener('change', updateReportVisibilityFromForm);
    const toggleExport = document.getElementById('toggle-export-excel');
    if (toggleExport) toggleExport.addEventListener('change', updateReportVisibilityFromForm);
    
    // Settings Audit
    document.getElementById('audit-job-select').addEventListener('change', loadSettingsAuditLog);
    document.getElementById('audit-filter').addEventListener('input', renderSettingsAuditLog);

    // Settings Thresholds (B2)
    document.getElementById('btn-save-thresholds').addEventListener('click', () => {
      const autoclose = parseInt(document.getElementById('cfg-threshold-autoclose').value) || 8;
      const autosave = parseInt(document.getElementById('cfg-threshold-autosave').value) || 3;
      state.thresholds = { autoclose, autosave };
      localStorage.setItem(LS_KEYS.THRESHOLDS, JSON.stringify(state.thresholds));
      toast('บันทึกค่า Threshold สำเร็จ', 'success');
      checkAutoCloseWarning(); // update banner with new time
    });

    // Notifications & Language
    document.getElementById('btn-notify-toggle').addEventListener('click', toggleNotify);
    document.getElementById('btn-lang').addEventListener('click', toggleLanguage);

    // Footer nav — ทุกปุ่มต้องผ่าน guardNavigation() ก่อน (Feedback 1.1 #9: ล็อก 100% ระหว่างสแกน)
    document.getElementById('nav-dashboard').addEventListener('click', () => guardNavigation(() => {
      if (state.currentJob) goToDashboard(); else goToJobScreen();
    }));
    document.getElementById('nav-carton').addEventListener('click', () => guardNavigation(goToCartonScreen));
    document.getElementById('nav-report').addEventListener('click', () => guardNavigation(goToReportScreen));
    document.getElementById('nav-changejob').addEventListener('click', () => guardNavigation(goToJobScreen));
    document.getElementById('nav-changeuser').addEventListener('click', () => guardNavigation(() => {
      state.currentUser = null;
      state.currentJob = null;
      localStorage.removeItem(LS_KEYS.CURRENT_USER);
      localStorage.removeItem(LS_KEYS.CURRENT_JOB);
      updateUserChip();
      updateJobBanner();
      stopCamera();
      stopPresenceTracking();
      clearListeners();
      showScreen('screen-user');
    }));

    // ปุ่ม beforeunload — เตือนถ้าปิดแท็บ/รีเฟรชระหว่างล็อกสแกนอยู่ (เบราว์เซอร์จำกัดข้อความเองไม่ได้ แต่ยังกันพลาดได้)
    window.addEventListener('beforeunload', (e) => {
      if (isScanLocked()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }

  /* ----------------------------------------------------------------------
     16. INIT
  ---------------------------------------------------------------------- */
  function init() {
    initTheme();
    const savedSound = localStorage.getItem(LS_KEYS.SOUND);
    state.soundEnabled = savedSound === null ? true : savedSound === '1';
    updateSoundBtn();
    const savedSpeech = localStorage.getItem(LS_KEYS.SPEECH);
    state.speechEnabled = savedSpeech === '1';
    updateSpeechBtn();
    loadThaiVoice();
    const savedNotify = localStorage.getItem(LS_KEYS.NOTIFY);
    state.notifyEnabled = savedNotify === '1' && ('Notification' in window) && Notification.permission === 'granted';
    wireEvents();
    setupFilterListeners();
    loadUsersListFromStorage();
    
    const savedVis = JSON.parse(localStorage.getItem(LS_KEYS.REPORT_VISIBILITY) || 'null');
    if (savedVis) state.reportVisibility = savedVis;
    applyReportTabVisibility();
    
    const savedThresholds = JSON.parse(localStorage.getItem(LS_KEYS.THRESHOLDS) || 'null');
    if (savedThresholds) state.thresholds = savedThresholds;
    
    renderUserGrid();
    applyLanguage(localStorage.getItem(LS_KEYS.LANG) || 'th');
    loadMasterFromStorage();

    const connected = initFirebaseIfPossible();
    state.mode = connected ? 'real' : 'mockup';
    updateModeBadge();
    listenMasterFromFirebase();
    listenUsersListFromFirebase();
    initFcmForegroundHandler();
    if (state.notifyEnabled) registerFcmToken(); // re-register กันกรณี token หมดอายุ/เปลี่ยนเครื่อง

    if (state.mode === 'mockup') {
      MockDB.seedDemoData();
    }

    // restore session
    try {
      const savedUser = JSON.parse(localStorage.getItem(LS_KEYS.CURRENT_USER) || 'null');
      if (savedUser) {
        state.currentUser = savedUser;
        updateUserChip();
      }
    } catch (e) {}

    if (state.currentUser) {
      // เปิดเว็บมาแต่ละครั้ง ให้เริ่มที่หน้า "เลือกชื่องาน" เสมอ (ไม่ auto กระโดดไป Dashboard)
      try {
        const savedJob = JSON.parse(localStorage.getItem(LS_KEYS.CURRENT_JOB) || 'null');
        if (savedJob) {
          state.currentJob = savedJob;
          updateJobBanner();
        }
      } catch (e) {}
      goToJobScreen();
      checkDraftAutoRecovery(); // Feedback 1.1 ฟีเจอร์เสริม #1
    } else {
      showScreen('screen-user');
    }

    updateFooterNav();
  }

  /* ----------------------------------------------------------------------
     16b. AUTO-RECOVERY DRAFT (Feedback 1.1 ฟีเจอร์เสริม #1)
     ถ้าคนเดิม+งานเดิมมี Carton draft ค้างอยู่ (แอปปิดกะทันหัน) เด้ง popup ถามทันทีตอนเปิดแอปใหม่
  ---------------------------------------------------------------------- */
  async function checkDraftAutoRecovery() {
    if (!state.currentUser || !state.currentJob) return;
    try {
      const allCartons = await DB.getAll(COLLECTIONS.CARTONS);
      const myDrafts = allCartons.filter((c) =>
        c.ชื่องานId === state.currentJob.id &&
        c.userId === state.currentUser.id &&
        (c.status || CARTON_STATUS.CLOSED) === CARTON_STATUS.DRAFT
      );
      if (!myDrafts.length) return;
      myDrafts.sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt));
      const carton = myDrafts[0];
      const itemCount = Array.isArray(carton.draftItems) ? carton.draftItems.length : 0;

      document.getElementById('recovery-modal-message').textContent =
        'พบ Carton "' + carton.cartonNo + '" ที่คุณทำค้างไว้ (' + itemCount + ' รายการที่สแกนแล้ว) — ต้องการทำต่อเลยไหม?';
      const overlay = document.getElementById('recovery-modal');
      const resumeBtn = document.getElementById('recovery-modal-resume');
      const dismissBtn = document.getElementById('recovery-modal-dismiss');
      overlay.style.display = 'flex';

      function cleanup() {
        overlay.style.display = 'none';
        resumeBtn.removeEventListener('click', onResume);
        dismissBtn.removeEventListener('click', onDismiss);
      }
      function onResume() { cleanup(); resumeDraftCarton(carton); }
      function onDismiss() { cleanup(); }
      resumeBtn.addEventListener('click', onResume);
      dismissBtn.addEventListener('click', onDismiss);
    } catch (err) {
      console.error('[auto-recovery] checkDraftAutoRecovery error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // ลงทะเบียน Service Worker เพื่อรองรับ PWA / Add to Home Screen
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
})();
