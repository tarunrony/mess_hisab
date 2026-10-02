/**
 * Google Sheet-কে ডাটাবেস হিসেবে ব্যবহারের সহায়ক ফাংশন।
 * প্রতিটি শিটের প্রথম সারি হেডার; প্রথম কলাম ফাঁকা থাকলে সারিটি উপেক্ষা করা হয়।
 */

const SCHEMA_VERSION = '1';

const SCHEMA = {
  Users:    ['id', 'name', 'username', 'passHash', 'salt', 'role', 'phone', 'room', 'active', 'autoLunch', 'autoDinner', 'createdAt'],
  Meals:    ['key', 'date', 'userId', 'lunch', 'dinner', 'updatedBy', 'updatedAt'],
  Expenses: ['id', 'date', 'type', 'amount', 'description', 'paidBy', 'fileId', 'memoId', 'addedBy', 'createdAt'],
  Deposits: ['id', 'date', 'userId', 'amount', 'note', 'addedBy', 'createdAt'],
  Duties:   ['id', 'type', 'date', 'userId', 'area', 'status', 'note', 'updatedBy'],
  Memos:    ['id', 'date', 'userId', 'amount', 'note', 'fileId', 'status', 'expenseId', 'reviewedBy', 'createdAt'],
  Settings: ['key', 'value']
};

// সংখ্যা হিসেবে রাখা কলাম; বাকি সব টেক্সট (যাতে ফোন নম্বর, তারিখ, সময় বদলে না যায়)
const NUMERIC_FORMAT = { lunch: '0', dinner: '0', amount: '#,##0.00' };

const DEFAULT_SETTINGS = {
  messName: 'আমাদের মেস',
  lunchCutoff: '10:00',
  dinnerCutoff: '17:00',
  maxGuestMeal: '5'
};

let _ss = null;
let _tableCache = {};

function getSS_() {
  if (_ss) return _ss;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) throw new Error('ডাটাবেস (Google Sheet) পাওয়া যায়নি। Apps Script এডিটর থেকে setup() চালান।');
  if (!id) props.setProperty('SHEET_ID', _ss.getId());
  if (props.getProperty('SCHEMA_V') !== SCHEMA_VERSION) {
    ensureSheets_(_ss);
    props.setProperty('SCHEMA_V', SCHEMA_VERSION);
  }
  return _ss;
}

function ensureSheets_(ss) {
  Object.keys(SCHEMA).forEach(function (name) {
    const cols = SCHEMA[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length)
      .setValues([cols])
      .setFontWeight('bold')
      .setBackground('#0f766e')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  // নতুন শিটের ফাঁকা ডিফল্ট ট্যাব মুছে ফেলি
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function sheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('শিট পাওয়া যায়নি: ' + name + ' — setup() চালান');
  return sh;
}

/** পুরো টেবিল অবজেক্টের তালিকা হিসেবে পড়ে (_row = শিটের সারি নম্বর) */
function readAll_(name) {
  if (_tableCache[name]) return _tableCache[name];
  const sh = sheet_(name);
  const cols = SCHEMA[name];
  const last = sh.getLastRow();
  const out = [];
  if (last >= 2) {
    const values = sh.getRange(2, 1, last - 1, cols.length).getValues();
    const tz = tz_();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row[0] === '' || row[0] === null) continue;
      const o = { _row: i + 2 };
      for (let c = 0; c < cols.length; c++) o[cols[c]] = normalize_(row[c], cols[c], tz);
      out.push(o);
    }
  }
  _tableCache[name] = out;
  return out;
}

function normalize_(v, col, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, col === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  if (NUMERIC_FORMAT[col]) return Number(v) || 0;
  if (v === null || v === undefined) return '';
  return String(v);
}

function toRow_(name, obj) {
  return SCHEMA[name].map(function (c) {
    const v = obj[c];
    return v === undefined || v === null ? '' : v;
  });
}

function formatRow_(name) {
  return SCHEMA[name].map(function (c) { return NUMERIC_FORMAT[c] || '@'; });
}

function insertRows_(name, objs) {
  if (!objs || !objs.length) return;
  const sh = sheet_(name);
  const cols = SCHEMA[name].length;
  const range = sh.getRange(sh.getLastRow() + 1, 1, objs.length, cols);
  const fmt = formatRow_(name);
  range.setNumberFormats(objs.map(function () { return fmt; }));
  range.setValues(objs.map(function (o) { return toRow_(name, o); }));
  delete _tableCache[name];
}

function updateRow_(name, rowIndex, obj) {
  if (!rowIndex) throw new Error('সারি পাওয়া যায়নি');
  sheet_(name).getRange(rowIndex, 1, 1, SCHEMA[name].length).setValues([toRow_(name, obj)]);
  delete _tableCache[name];
}

function deleteRow_(name, rowIndex) {
  if (!rowIndex) throw new Error('সারি পাওয়া যায়নি');
  sheet_(name).deleteRow(rowIndex);
  delete _tableCache[name];
}

function findById_(name, id) {
  const rows = readAll_(name);
  for (let i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

/* ---------- সেটিংস ---------- */

function getSettings_() {
  const s = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { s[k] = DEFAULT_SETTINGS[k]; });
  readAll_('Settings').forEach(function (r) { if (r.value !== '') s[r.key] = r.value; });
  return s;
}

function settingsSave_(d) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const rows = readAll_('Settings');
  const inserts = [];
  allowed.forEach(function (k) {
    if (d[k] === undefined) return;
    let v = String(d[k]).trim();
    if ((k === 'lunchCutoff' || k === 'dinnerCutoff') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      throw new Error('সময় HH:MM ফরম্যাটে দিন (যেমন 10:00)');
    }
    if (k === 'maxGuestMeal') v = String(Math.max(1, Math.min(20, parseInt(v, 10) || 1)));
    if (k === 'messName' && !v) throw new Error('মেসের নাম দিন');
    const ex = rows.filter(function (r) { return r.key === k; })[0];
    if (ex) updateRow_('Settings', ex._row, { key: k, value: v });
    else inserts.push({ key: k, value: v });
  });
  insertRows_('Settings', inserts);
  return getSettings_();
}

/* ---------- তারিখ ও সাধারণ সহায়ক ---------- */

function tz_() { return APP_TZ; }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function nowHM_() { return Utilities.formatDate(new Date(), tz_(), 'HH:mm'); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

function isYMD_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isMonth_(s) { return /^\d{4}-\d{2}$/.test(String(s || '')); }

function parseYMD_(s) {
  const p = String(s).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
}
function addDays_(s, n) {
  const d = parseYMD_(s);
  d.setUTCDate(d.getUTCDate() + n);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
function daysBetween_(a, b) { return Math.round((parseYMD_(b) - parseYMD_(a)) / 864e5); }

function requireDate_(s, label) {
  if (!isYMD_(s)) throw new Error((label || 'তারিখ') + ' সঠিক নয়');
  return s;
}
function requireMonth_(s) {
  if (!s) return today_().slice(0, 7);
  if (!isMonth_(s)) throw new Error('মাস সঠিক নয়');
  return s;
}
function requireAmount_(v) {
  const n = Math.round(Number(v) * 100) / 100;
  if (!isFinite(n) || n === 0) throw new Error('সঠিক টাকার পরিমাণ দিন');
  return n;
}
function clean_(s, max) { return String(s === undefined || s === null ? '' : s).trim().slice(0, max || 200); }
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
