/**
 * ===================================================================
 *  মেস মিল হিসাব — এক ফাইলে পুরো অ্যাপ (Google Apps Script)
 * ===================================================================
 *
 *  কীভাবে চালু করবেন:
 *   1. Google Sheet খুলুন → Extensions → Apps Script
 *   2. Code.gs-এর সব লেখা মুছে এই ফাইলের পুরোটা পেস্ট করুন → Save (Ctrl+S)
 *   3. উপরের ফাংশন তালিকা থেকে "setup" বেছে Run চাপুন → অনুমতি দিন
 *      (Advanced → Go to ... (unsafe) → Allow)
 *   4. Deploy → New deployment → ⚙️ Web app
 *        Execute as: Me   |   Who has access: Anyone   → Deploy
 *   5. Web app URL খুলে প্রথমে অ্যাডমিন অ্যাকাউন্ট বানান, তারপর সদস্য যোগ করুন
 *
 *  কোড বদলালে: Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 *  (তাহলে URL একই থাকে)
 *
 *  এই ফাইলটি apps-script/ ফোল্ডার থেকে "node tools/build.js" দিয়ে তৈরি।
 * ===================================================================
 */

/* ======================= Code.gs ======================= */

/**
 * মেস মিল হিসাব — Google Apps Script ব্যাকএন্ড
 *
 * ডাটাবেস: এই স্ক্রিপ্ট যে Google Sheet-এর সাথে যুক্ত (Extensions > Apps Script) সেই শিট।
 * প্রথমবার: এডিটর থেকে setup() ফাংশন একবার চালান, তারপর Web App হিসেবে Deploy করুন।
 */

const APP_NAME = 'মেস মিল হিসাব';
const APP_TZ = 'Asia/Dhaka';
const TOKEN_DAYS = 30;

/** Web App খুললে মূল পেজ দেখায় */
function doGet() {
  let messName = APP_NAME;
  try { messName = getSettings_().messName || APP_NAME; } catch (e) { /* setup বাকি */ }
  return HtmlService.createHtmlOutput(pageHtml_(messName))
    .setTitle(messName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}

/** পুরো পেজ (এই ফাইলের শেষে APP_HTML) — মেসের নাম বসিয়ে ফেরত দেয় */
function pageHtml_(messName) {
  return APP_HTML.split('{{MESS_NAME}}').join(escapeHtml_(messName));
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * ফ্রন্টএন্ড থেকে সব অনুরোধ এখানে আসে (google.script.run.api)।
 * ফেরত দেয়: { ok: true, data } অথবা { ok: false, error }
 */
function api(action, token, data) {
  let lock = null;
  try {
    const route = routes_()[action];
    if (!route) throw new Error('অজানা অনুরোধ: ' + action);

    let user = null;
    if (route.roles) {
      user = authenticate_(token);
      if (route.roles.indexOf(user.role) === -1) throw new Error('এই কাজের অনুমতি আপনার নেই');
    }

    if (route.write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) throw new Error('সার্ভার ব্যস্ত, একটু পরে আবার চেষ্টা করুন');
    }

    const payload = data && typeof data === 'object' ? data : {};
    return { ok: true, data: route.fn(payload, user) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** একই API অন্য জায়গা থেকে (যেমন GitHub Pages) fetch দিয়ে ব্যবহারের জন্য */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (x) { /* খালি */ }
  const res = api(body.action, body.token, body.data);
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** কোন অনুরোধ কে করতে পারবে */
function routes_() {
  const ALL = ['admin', 'manager', 'member'];
  const MGR = ['admin', 'manager'];
  const ADM = ['admin'];
  return {
    'auth.status':      { fn: authStatus_ },
    'auth.setupAdmin':  { fn: setupAdmin_, write: true },
    'auth.login':       { fn: login_ },

    'me.get':           { roles: ALL, fn: meGet_ },
    'me.password':      { roles: ALL, fn: changePassword_, write: true },
    'me.prefs':         { roles: ALL, fn: savePrefs_, write: true },
    'dashboard':        { roles: ALL, fn: dashboard_ },

    'meals.my':         { roles: ALL, fn: mealsMy_ },
    'meals.setMy':      { roles: ALL, fn: mealsSetMy_, write: true },
    'meals.setMyRange': { roles: ALL, fn: mealsSetMyRange_, write: true },
    'meals.day':        { roles: MGR, fn: mealsDay_ },
    'meals.saveDay':    { roles: MGR, fn: mealsSaveDay_, write: true },

    'expenses.list':    { roles: ALL, fn: expensesList_ },
    'expenses.save':    { roles: MGR, fn: expensesSave_, write: true },
    'expenses.delete':  { roles: MGR, fn: expensesDelete_, write: true },

    'deposits.list':    { roles: ALL, fn: depositsList_ },
    'deposits.save':    { roles: MGR, fn: depositsSave_, write: true },
    'deposits.delete':  { roles: MGR, fn: depositsDelete_, write: true },

    'memos.list':       { roles: ALL, fn: memosList_ },
    'memos.upload':     { roles: ALL, fn: memosUpload_, write: true },
    'memos.review':     { roles: MGR, fn: memosReview_, write: true },
    'memos.delete':     { roles: ALL, fn: memosDelete_, write: true },
    'image.get':        { roles: ALL, fn: imageGet_ },

    'duties.list':      { roles: ALL, fn: dutiesList_ },
    'duties.save':      { roles: MGR, fn: dutiesSave_, write: true },
    'duties.delete':    { roles: MGR, fn: dutiesDelete_, write: true },
    'duties.generate':  { roles: MGR, fn: dutiesGenerate_, write: true },
    'duties.status':    { roles: ALL, fn: dutiesStatus_, write: true },

    'report.month':     { roles: ALL, fn: reportMonth_ },

    'users.list':       { roles: ALL, fn: usersList_ },
    'users.save':       { roles: ADM, fn: usersSave_, write: true },
    'settings.save':    { roles: ADM, fn: settingsSave_, write: true }
  };
}

/**
 * ⚙️ প্রথমবার একবার চালান (Apps Script এডিটরে ফাংশন বেছে নিয়ে Run)।
 * শিট, গোপন কী, মেমো ফোল্ডার আর প্রতিদিনের অটো-মিল ট্রিগার তৈরি করে।
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Google Sheet খুলে Extensions > Apps Script থেকে setup চালান');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  ensureSheets_(ss);
  props.setProperty('SCHEMA_V', SCHEMA_VERSION);
  secret_();
  memoFolder_();

  const existing = readAll_('Settings').map(function (r) { return r.key; });
  const missing = Object.keys(DEFAULT_SETTINGS)
    .filter(function (k) { return existing.indexOf(k) === -1; })
    .map(function (k) { return { key: k, value: DEFAULT_SETTINGS[k] }; });
  insertRows_('Settings', missing);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoMealJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoMealJob').timeBased().everyDays(1).atHour(0).nearMinute(30).inTimezone(APP_TZ).create();

  Logger.log('✅ Setup সম্পন্ন। এখন Deploy > New deployment > Web app করুন।');
}


/* ======================= Db.gs ======================= */

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


/* ======================= Auth.gs ======================= */

/**
 * লগইন, টোকেন, প্রোফাইল এবং সদস্য (ইউজার) ব্যবস্থাপনা।
 * পাসওয়ার্ড SHA-256 + salt দিয়ে হ্যাশ করে রাখা হয়, আসল পাসওয়ার্ড কোথাও থাকে না।
 */

const ROLES = ['admin', 'manager', 'member'];

function hash_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SECRET', s);
  }
  return s;
}

function sign_(text) {
  const sig = Utilities.computeHmacSha256Signature(text, secret_(), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

// পাসওয়ার্ড বদলালে পুরনো টোকেন আপনাআপনি বাতিল হয়, কারণ সিগনেচারে passHash থাকে
function makeToken_(user) {
  const payload = user.id + '.' + (Date.now() + TOKEN_DAYS * 864e5);
  return payload + '.' + sign_(payload + '|' + user.passHash);
}

function authenticate_(token) {
  const fail = new Error('AUTH: সেশন শেষ, আবার লগইন করুন');
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || Number(parts[1]) < Date.now()) throw fail;
  const user = findById_('Users', parts[0]);
  if (!user || user.active !== '1') throw fail;
  if (sign_(parts[0] + '.' + parts[1] + '|' + user.passHash) !== parts[2]) throw fail;
  return user;
}

function publicUser_(u) {
  return {
    id: u.id, name: u.name, username: u.username, role: u.role, phone: u.phone, room: u.room,
    active: u.active, autoLunch: u.autoLunch, autoDinner: u.autoDinner, createdAt: u.createdAt
  };
}

function normUsername_(s) {
  const u = String(s || '').trim().toLowerCase();
  if (!/^[a-z0-9_.@-]{3,40}$/.test(u)) throw new Error('ইউজারনেম ৩+ অক্ষরের হবে (ইংরেজি অক্ষর/সংখ্যা, যেমন: rahim বা 01712345678)');
  return u;
}

function checkPassword_(p) {
  if (String(p || '').length < 6) throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে');
  return String(p);
}

/* ---------- পাবলিক (লগইন ছাড়া) ---------- */

function authStatus_() {
  return { needsSetup: readAll_('Users').length === 0, messName: getSettings_().messName };
}

/** প্রথম ব্যবহারকারী তৈরি — শুধু তখনই কাজ করে যখন কোনো ইউজার নেই */
function setupAdmin_(d) {
  if (readAll_('Users').length > 0) throw new Error('অ্যাডমিন আগেই তৈরি হয়েছে, লগইন করুন');
  const user = newUser_({
    name: d.name, username: d.username, password: d.password,
    role: 'admin', phone: d.phone, room: d.room
  });
  if (d.messName) settingsSave_({ messName: d.messName });
  insertRows_('Users', [user]);
  return { token: makeToken_(user), user: publicUser_(user), settings: getSettings_() };
}

function login_(d) {
  const username = String(d.username || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('অনেকবার ভুল চেষ্টা হয়েছে। ১০ মিনিট পরে আবার চেষ্টা করুন।');

  const user = readAll_('Users').filter(function (u) { return u.username === username; })[0];
  if (!user || hash_(String(d.password || ''), user.salt) !== user.passHash) {
    cache.put(failKey, String(fails + 1), 600);
    throw new Error('ইউজারনেম বা পাসওয়ার্ড ভুল');
  }
  if (user.active !== '1') throw new Error('আপনার অ্যাকাউন্ট বন্ধ আছে, অ্যাডমিনের সাথে যোগাযোগ করুন');
  cache.remove(failKey);
  return { token: makeToken_(user), user: publicUser_(user), settings: getSettings_() };
}

/* ---------- নিজের প্রোফাইল ---------- */

function meGet_(d, me) {
  return { user: publicUser_(me), settings: getSettings_() };
}

function changePassword_(d, me) {
  if (hash_(String(d.oldPassword || ''), me.salt) !== me.passHash) throw new Error('বর্তমান পাসওয়ার্ড ভুল');
  me.salt = uid_();
  me.passHash = hash_(checkPassword_(d.newPassword), me.salt);
  updateRow_('Users', me._row, me);
  return { token: makeToken_(me) };
}

/** ডিফল্ট মিল (প্রতিদিন আপনাআপনি চালু থাকবে কিনা) */
function savePrefs_(d, me) {
  me.autoLunch = d.autoLunch ? '1' : '0';
  me.autoDinner = d.autoDinner ? '1' : '0';
  updateRow_('Users', me._row, me);
  fillAutoMeals_([addDays_(today_(), 1)], me.id, true);
  return publicUser_(me);
}

/* ---------- সদস্য ব্যবস্থাপনা (অ্যাডমিন) ---------- */

function newUser_(d) {
  const salt = uid_();
  const role = ROLES.indexOf(d.role) > -1 ? d.role : 'member';
  const name = clean_(d.name, 60);
  if (!name) throw new Error('নাম দিন');
  return {
    id: uid_(), name: name, username: normUsername_(d.username),
    passHash: hash_(checkPassword_(d.password), salt), salt: salt, role: role,
    phone: clean_(d.phone, 20), room: clean_(d.room, 20), active: '1',
    autoLunch: '1', autoDinner: '1', createdAt: nowStr_()
  };
}

function usersList_(d, me) {
  const all = readAll_('Users').map(publicUser_);
  return me.role === 'admin' ? all : all.filter(function (u) { return u.active === '1'; });
}

function usersSave_(d, me) {
  const users = readAll_('Users');
  const username = normUsername_(d.username);
  const taken = users.filter(function (u) { return u.username === username && u.id !== d.id; })[0];
  if (taken) throw new Error('এই ইউজারনেম আগেই ব্যবহার হয়েছে');

  if (!d.id) {
    const user = newUser_(d);
    insertRows_('Users', [user]);
    fillAutoMeals_([addDays_(today_(), 1)], user.id, false);
    return usersList_(d, me);
  }

  const u = users.filter(function (x) { return x.id === d.id; })[0];
  if (!u) throw new Error('সদস্য পাওয়া যায়নি');
  const role = ROLES.indexOf(d.role) > -1 ? d.role : u.role;
  const active = d.active === '0' ? '0' : '1';
  if (u.id === me.id && (role !== 'admin' || active !== '1')) {
    throw new Error('নিজের অ্যাডমিন রোল বা অ্যাকাউন্ট বন্ধ করা যাবে না');
  }
  const name = clean_(d.name, 60);
  if (!name) throw new Error('নাম দিন');

  u.name = name;
  u.username = username;
  u.role = role;
  u.active = active;
  u.phone = clean_(d.phone, 20);
  u.room = clean_(d.room, 20);
  if (d.password) {
    u.salt = uid_();
    u.passHash = hash_(checkPassword_(d.password), u.salt);
  }
  updateRow_('Users', u._row, u);
  return usersList_(d, me);
}

function nameMap_() {
  const m = {};
  readAll_('Users').forEach(function (u) { m[u.id] = u.name; });
  return m;
}


/* ======================= Meals.gs ======================= */

/**
 * মিল: প্রতিদিন দুই বেলা — দুপুর (lunch) ও রাত (dinner)।
 * Meals শিটে প্রতি সদস্য প্রতি দিনের জন্য একটি সারি: key = তারিখ_ইউজারআইডি
 *
 * নিয়ম:
 *  - সদস্য শুধু নিজের মিল দিতে/বন্ধ করতে পারবে, আজকের মিল কাটঅফ সময়ের আগ পর্যন্ত।
 *  - ম্যানেজার/অ্যাডমিন যেকোনো দিনের যেকোনো সদস্যের মিল ঠিক করতে পারবে।
 *  - "ডিফল্ট মিল" চালু থাকলে প্রতিদিন রাত ১২:৩০-এ আজ ও কালকের মিল আপনাআপনি বসে যায়।
 *    তার পরের দিনগুলোতে এন্ট্রি না থাকলে ডিফল্টটাই দেখানো হয়।
 */

function mealsIndex_() {
  const map = {};
  readAll_('Meals').forEach(function (r) { map[r.key] = r; });
  return map;
}

function clampMeal_(v, max) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(max, n));
}

function slotLocked_(date, slot, settings) {
  const today = today_();
  if (date < today) return true;
  if (date > today) return false;
  return nowHM_() >= (slot === 'lunch' ? settings.lunchCutoff : settings.dinnerCutoff);
}

/** এন্ট্রি না থাকলে কী দেখানো হবে */
function currentMeal_(date, user, ex) {
  if (ex) return { lunch: ex.lunch, dinner: ex.dinner, isDefault: false };
  if (date > addDays_(today_(), 1)) {
    return { lunch: user.autoLunch === '1' ? 1 : 0, dinner: user.autoDinner === '1' ? 1 : 0, isDefault: true };
  }
  return { lunch: 0, dinner: 0, isDefault: false };
}

/** changes = [{date, userId, lunch, dinner}] — নতুন হলে যোগ, পুরনো হলে আপডেট */
function upsertMeals_(changes, by) {
  const map = mealsIndex_();
  const now = nowStr_();
  const inserts = [];
  changes.forEach(function (c) {
    const key = c.date + '_' + c.userId;
    const ex = map[key];
    if (ex) {
      if (ex.lunch === c.lunch && ex.dinner === c.dinner) return;
      ex.lunch = c.lunch;
      ex.dinner = c.dinner;
      ex.updatedBy = by;
      ex.updatedAt = now;
      if (ex._row) updateRow_('Meals', ex._row, ex);
    } else {
      const row = { key: key, date: c.date, userId: c.userId, lunch: c.lunch, dinner: c.dinner, updatedBy: by, updatedAt: now };
      inserts.push(row);
      map[key] = row;
    }
  });
  insertRows_('Meals', inserts);
}

/**
 * ডিফল্ট মিল বসানো। overwriteAuto = true হলে আগে আপনাআপনি বসানো (কেউ বদলায়নি এমন)
 * এন্ট্রিও নতুন ডিফল্ট অনুযায়ী বদলাবে।
 */
function fillAutoMeals_(dates, onlyUserId, overwriteAuto) {
  const users = readAll_('Users').filter(function (u) {
    return u.active === '1' && (!onlyUserId || u.id === onlyUserId);
  });
  const map = mealsIndex_();
  const changes = [];
  dates.forEach(function (date) {
    users.forEach(function (u) {
      const l = u.autoLunch === '1' ? 1 : 0;
      const dn = u.autoDinner === '1' ? 1 : 0;
      const ex = map[date + '_' + u.id];
      if (!ex && (l || dn)) changes.push({ date: date, userId: u.id, lunch: l, dinner: dn });
      else if (ex && overwriteAuto && ex.updatedBy === 'auto') changes.push({ date: date, userId: u.id, lunch: l, dinner: dn });
    });
  });
  upsertMeals_(changes, 'auto');
}

/** টাইম ট্রিগার (setup() তৈরি করে) — প্রতিদিন রাত ~১২:৩০ */
function autoMealJob() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = today_();
    fillAutoMeals_([t, addDays_(t, 1)], null, false);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- সদস্য: নিজের মিল ---------- */

function mealsMy_(d, me) {
  const today = today_();
  const from = isYMD_(d.from) ? d.from : today;
  const to = isYMD_(d.to) ? d.to : addDays_(from, 6);
  const n = daysBetween_(from, to);
  if (n < 0 || n > 62) throw new Error('তারিখের সীমা সঠিক নয়');

  const s = getSettings_();
  const map = mealsIndex_();
  const days = [];
  for (let i = 0; i <= n; i++) {
    const date = addDays_(from, i);
    const cur = currentMeal_(date, me, map[date + '_' + me.id]);
    days.push({
      date: date, lunch: cur.lunch, dinner: cur.dinner, isDefault: cur.isDefault,
      lockLunch: slotLocked_(date, 'lunch', s), lockDinner: slotLocked_(date, 'dinner', s)
    });
  }
  return {
    days: days, today: today, now: nowHM_(),
    lunchCutoff: s.lunchCutoff, dinnerCutoff: s.dinnerCutoff, maxGuestMeal: Number(s.maxGuestMeal) || 5,
    autoLunch: me.autoLunch, autoDinner: me.autoDinner
  };
}

/** এক দিনের মিল: { date, lunch, dinner } — যেটা পাঠানো হয়নি সেটা অপরিবর্তিত */
function mealsSetMy_(d, me) {
  const date = requireDate_(d.date);
  const s = getSettings_();
  const max = Number(s.maxGuestMeal) || 5;
  const cur = currentMeal_(date, me, mealsIndex_()[date + '_' + me.id]);
  const next = { lunch: cur.lunch, dinner: cur.dinner };

  ['lunch', 'dinner'].forEach(function (slot) {
    if (d[slot] === undefined || d[slot] === null) return;
    const v = clampMeal_(d[slot], max);
    if (v === cur[slot]) return;
    if (slotLocked_(date, slot, s)) {
      throw new Error((slot === 'lunch' ? 'দুপুরের' : 'রাতের') + ' মিল পরিবর্তনের সময় শেষ। ম্যানেজারকে বলুন।');
    }
    next[slot] = v;
  });

  upsertMeals_([{ date: date, userId: me.id, lunch: next.lunch, dinner: next.dinner }], me.id);
  return {
    date: date, lunch: next.lunch, dinner: next.dinner, isDefault: false,
    lockLunch: slotLocked_(date, 'lunch', s), lockDinner: slotLocked_(date, 'dinner', s)
  };
}

/** একাধিক দিনে একসাথে (যেমন বাড়ি যাচ্ছি — ৫ দিন মিল বন্ধ)। বন্ধ হয়ে যাওয়া বেলা বাদ যায়। */
function mealsSetMyRange_(d, me) {
  const from = requireDate_(d.from, 'শুরুর তারিখ');
  const to = requireDate_(d.to, 'শেষের তারিখ');
  const n = daysBetween_(from, to);
  if (n < 0 || n > 62) throw new Error('সর্বোচ্চ ৬২ দিনের জন্য একসাথে দেওয়া যাবে');

  const s = getSettings_();
  const max = Number(s.maxGuestMeal) || 5;
  const map = mealsIndex_();
  const changes = [];
  let skipped = 0;

  for (let i = 0; i <= n; i++) {
    const date = addDays_(from, i);
    const cur = currentMeal_(date, me, map[date + '_' + me.id]);
    const next = { lunch: cur.lunch, dinner: cur.dinner };
    ['lunch', 'dinner'].forEach(function (slot) {
      if (d[slot] === undefined || d[slot] === null || d[slot] === '') return;
      const v = clampMeal_(d[slot], max);
      if (v === cur[slot]) return;
      if (slotLocked_(date, slot, s)) { skipped++; return; }
      next[slot] = v;
    });
    if (next.lunch !== cur.lunch || next.dinner !== cur.dinner) {
      changes.push({ date: date, userId: me.id, lunch: next.lunch, dinner: next.dinner });
    }
  }
  upsertMeals_(changes, me.id);
  return { changed: changes.length, skipped: skipped };
}

/* ---------- ম্যানেজার: দিনভিত্তিক সবার মিল ---------- */

function mealsDay_(d) {
  const date = isYMD_(d.date) ? d.date : today_();
  const map = mealsIndex_();
  const users = readAll_('Users').filter(function (u) {
    return u.active === '1' || map[date + '_' + u.id];
  });
  let lunch = 0, dinner = 0;
  const rows = users.map(function (u) {
    const cur = currentMeal_(date, u, map[date + '_' + u.id]);
    lunch += cur.lunch;
    dinner += cur.dinner;
    return { userId: u.id, name: u.name, room: u.room, lunch: cur.lunch, dinner: cur.dinner, isDefault: cur.isDefault };
  });
  rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { date: date, rows: rows, totalLunch: lunch, totalDinner: dinner };
}

/** { date, entries: [{userId, lunch, dinner}] } */
function mealsSaveDay_(d, me) {
  const date = requireDate_(d.date);
  const ids = {};
  readAll_('Users').forEach(function (u) { ids[u.id] = true; });
  const changes = (d.entries || [])
    .filter(function (e) { return ids[e.userId]; })
    .map(function (e) {
      return { date: date, userId: e.userId, lunch: clampMeal_(e.lunch, 20), dinner: clampMeal_(e.dinner, 20) };
    });
  upsertMeals_(changes, me.id);
  return mealsDay_({ date: date });
}


/* ======================= Finance.gs ======================= */

/**
 * খরচ (বাজার / সাধারণ), জমা (ডিপোজিট) এবং বাজারের মেমো।
 *
 * খরচের ধরন:
 *   bazar  — মিলের বাজার; মিল রেট = মোট বাজার ÷ মোট মিল
 *   shared — সাধারণ খরচ (গ্যাস, খালা, বিদ্যুৎ ইত্যাদি); সবার মধ্যে সমান ভাগ
 * paidBy: ফাঁকা = মেসের ফান্ড থেকে; সদস্যের id = সদস্য নিজের টাকায় করেছে (তার জমায় যোগ হবে)
 */

const EXPENSE_TYPES = ['bazar', 'shared'];

function inMonth_(rows, month) {
  return rows.filter(function (r) { return String(r.date).slice(0, 7) === month; });
}

function byDateDesc_(a, b) {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1);
}

function strip_(r) {
  const o = {};
  Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; });
  return o;
}

/* ---------- ছবি (Google Drive) ---------- */

function memoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* ফোল্ডার মুছে গেছে, নতুন বানাই */ }
  }
  const folder = DriveApp.createFolder('Mess Memo Images');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

/** img = { data: base64, mime } — ফাইল আইডি ফেরত দেয় */
function saveImage_(img, prefix) {
  if (!img || !img.data) return '';
  const bytes = Utilities.base64Decode(String(img.data));
  if (bytes.length > 5 * 1024 * 1024) throw new Error('ছবি খুব বড় (সর্বোচ্চ ৫ MB)');
  const mime = /^image\/(jpeg|png|webp)$/.test(img.mime) ? img.mime : 'image/jpeg';
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const file = memoFolder_().createFile(Utilities.newBlob(bytes, mime, prefix + '_' + nowStr_().replace(/[: ]/g, '-') + '.' + ext));
  return file.getId();
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* আগেই মুছে গেছে */ }
}

/**
 * অ্যাপের ভেতরে ছবি দেখানো — শুধু শিটে থাকা মেমো/খরচের ছবি, অন্য কোনো Drive ফাইল নয়।
 * { kind: 'memo' | 'expense', id }
 */
function imageGet_(d) {
  const row = findById_(d.kind === 'expense' ? 'Expenses' : 'Memos', d.id);
  if (!row || !row.fileId) throw new Error('ছবি পাওয়া যায়নি');
  const blob = DriveApp.getFileById(row.fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ---------- খরচ ---------- */

function expensesList_(d) {
  const month = requireMonth_(d.month);
  const names = nameMap_();
  return inMonth_(readAll_('Expenses'), month).sort(byDateDesc_).map(function (e) {
    const o = strip_(e);
    o.paidByName = e.paidBy ? (names[e.paidBy] || '?') : '';
    o.addedByName = names[e.addedBy] || '';
    o.hasImage = !!e.fileId;
    delete o.fileId;
    return o;
  });
}

/** { id?, date, type, amount, description, paidBy, image? } */
function expensesSave_(d, me) {
  const date = requireDate_(d.date);
  const type = EXPENSE_TYPES.indexOf(d.type) > -1 ? d.type : 'bazar';
  const amount = requireAmount_(d.amount);
  const description = clean_(d.description, 300);
  const paidBy = d.paidBy && findById_('Users', d.paidBy) ? d.paidBy : '';
  const fileId = d.image ? saveImage_(d.image, 'expense') : '';

  if (d.id) {
    const e = findById_('Expenses', d.id);
    if (!e) throw new Error('খরচ পাওয়া যায়নি');
    if (fileId) { trashFile_(e.fileId); e.fileId = fileId; }
    e.date = date; e.type = type; e.amount = amount; e.description = description; e.paidBy = paidBy;
    updateRow_('Expenses', e._row, e);
  } else {
    insertRows_('Expenses', [{
      id: uid_(), date: date, type: type, amount: amount, description: description,
      paidBy: paidBy, fileId: fileId, memoId: '', addedBy: me.id, createdAt: nowStr_()
    }]);
  }
  return expensesList_({ month: date.slice(0, 7) });
}

function expensesDelete_(d) {
  const e = findById_('Expenses', d.id);
  if (!e) throw new Error('খরচ পাওয়া যায়নি');
  if (e.memoId) {
    // মেমো থেকে আসা খরচ মুছলে মেমোটা আবার "অপেক্ষমাণ" হয়ে যায়, ছবি মেমোতেই থাকে
    const m = findById_('Memos', e.memoId);
    if (m) { m.status = 'pending'; m.expenseId = ''; m.reviewedBy = ''; updateRow_('Memos', m._row, m); }
  } else {
    trashFile_(e.fileId);
  }
  const month = e.date.slice(0, 7);
  deleteRow_('Expenses', findById_('Expenses', d.id)._row);
  return expensesList_({ month: month });
}

/* ---------- জমা ---------- */

function depositsList_(d, me) {
  const month = requireMonth_(d.month);
  const names = nameMap_();
  return inMonth_(readAll_('Deposits'), month)
    .filter(function (r) { return me.role !== 'member' || r.userId === me.id; })
    .sort(byDateDesc_)
    .map(function (r) {
      const o = strip_(r);
      o.name = names[r.userId] || '?';
      o.addedByName = names[r.addedBy] || '';
      return o;
    });
}

/** { id?, date, userId, amount, note } — ঋণাত্মক টাকা = সমন্বয় / ফেরত */
function depositsSave_(d, me) {
  const date = requireDate_(d.date);
  if (!findById_('Users', d.userId)) throw new Error('সদস্য বেছে নিন');
  const amount = requireAmount_(d.amount);
  const note = clean_(d.note, 200);

  if (d.id) {
    const r = findById_('Deposits', d.id);
    if (!r) throw new Error('জমা পাওয়া যায়নি');
    r.date = date; r.userId = d.userId; r.amount = amount; r.note = note;
    updateRow_('Deposits', r._row, r);
  } else {
    insertRows_('Deposits', [{
      id: uid_(), date: date, userId: d.userId, amount: amount, note: note, addedBy: me.id, createdAt: nowStr_()
    }]);
  }
  return depositsList_({ month: date.slice(0, 7) }, me);
}

function depositsDelete_(d, me) {
  const r = findById_('Deposits', d.id);
  if (!r) throw new Error('জমা পাওয়া যায়নি');
  deleteRow_('Deposits', r._row);
  return depositsList_({ month: r.date.slice(0, 7) }, me);
}

/* ---------- বাজারের মেমো ---------- */

function memosList_(d, me) {
  const month = requireMonth_(d.month);
  const names = nameMap_();
  return inMonth_(readAll_('Memos'), month)
    .filter(function (m) { return me.role !== 'member' || m.userId === me.id; })
    .filter(function (m) { return !d.status || m.status === d.status; })
    .sort(byDateDesc_)
    .map(function (m) {
      const o = strip_(m);
      o.name = names[m.userId] || '?';
      o.reviewedByName = names[m.reviewedBy] || '';
      o.hasImage = !!m.fileId;
      delete o.fileId;
      return o;
    });
}

/** সদস্য বাজার করে মেমোর ছবি দেয়: { date, amount, note, image } */
function memosUpload_(d, me) {
  const date = requireDate_(d.date);
  const amount = requireAmount_(d.amount);
  if (amount < 0) throw new Error('সঠিক টাকার পরিমাণ দিন');
  if (!d.image || !d.image.data) throw new Error('মেমোর ছবি দিন');
  const fileId = saveImage_(d.image, 'memo_' + me.username);

  insertRows_('Memos', [{
    id: uid_(), date: date, userId: me.id, amount: amount, note: clean_(d.note, 300),
    fileId: fileId, status: 'pending', expenseId: '', reviewedBy: '', createdAt: nowStr_()
  }]);

  // ওই দিনে এই সদস্যের বাজার ডিউটি থাকলে সেটা "সম্পন্ন" করে দিই
  readAll_('Duties').forEach(function (t) {
    if (t.type === 'bazar' && t.date === date && t.userId === me.id && t.status !== 'done') {
      t.status = 'done'; t.updatedBy = me.id;
      updateRow_('Duties', t._row, t);
    }
  });
  return memosList_({ month: date.slice(0, 7) }, me);
}

/**
 * ম্যানেজার মেমো যাচাই করে:
 * { id, action: 'approve'|'reject', amount?, description?, paidByMember: bool, type? }
 * অনুমোদন করলে খরচের তালিকায় যোগ হয়।
 */
function memosReview_(d, me) {
  const m = findById_('Memos', d.id);
  if (!m) throw new Error('মেমো পাওয়া যায়নি');
  if (m.status !== 'pending') throw new Error('এই মেমো আগেই যাচাই করা হয়েছে');

  if (d.action === 'approve') {
    const amount = d.amount ? requireAmount_(d.amount) : m.amount;
    const expenseId = uid_();
    insertRows_('Expenses', [{
      id: expenseId, date: m.date, type: EXPENSE_TYPES.indexOf(d.type) > -1 ? d.type : 'bazar',
      amount: amount, description: clean_(d.description || m.note || 'বাজার (মেমো)', 300),
      paidBy: d.paidByMember ? m.userId : '', fileId: m.fileId, memoId: m.id,
      addedBy: me.id, createdAt: nowStr_()
    }]);
    m.status = 'approved';
    m.amount = amount;
    m.expenseId = expenseId;
  } else {
    m.status = 'rejected';
  }
  m.reviewedBy = me.id;
  updateRow_('Memos', findById_('Memos', d.id)._row, m);
  return memosList_({ month: m.date.slice(0, 7) }, me);
}

/** সদস্য নিজের অপেক্ষমাণ মেমো মুছতে পারে; ম্যানেজার অনুমোদিত নয় এমন যেকোনো মেমো */
function memosDelete_(d, me) {
  const m = findById_('Memos', d.id);
  if (!m) throw new Error('মেমো পাওয়া যায়নি');
  const isMgr = me.role !== 'member';
  if (!isMgr && (m.userId !== me.id || m.status !== 'pending')) throw new Error('শুধু নিজের অপেক্ষমাণ মেমো মুছতে পারবেন');
  if (m.status === 'approved') throw new Error('অনুমোদিত মেমো মুছতে আগে খরচ থেকে এন্ট্রিটি মুছুন');
  trashFile_(m.fileId);
  deleteRow_('Memos', m._row);
  return memosList_({ month: m.date.slice(0, 7) }, me);
}


/* ======================= Duties.gs ======================= */

/**
 * ডিউটি রোস্টার: বাজারের তারিখ ও ওয়াশরুম পরিষ্কারের তারিখ।
 * type: 'bazar' | 'clean', status: 'pending' | 'done' | 'missed'
 */

const DUTY_TYPES = ['bazar', 'clean'];
const DUTY_STATUS = ['pending', 'done', 'missed'];

function dutiesList_(d) {
  const month = requireMonth_(d.month);
  const names = nameMap_();
  return readAll_('Duties')
    .filter(function (t) { return t.date.slice(0, 7) === month && (!d.type || t.type === d.type); })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : 1; })
    .map(function (t) {
      const o = strip_(t);
      o.name = names[t.userId] || '?';
      return o;
    });
}

/** { id?, type, date, userId, area, note, status } */
function dutiesSave_(d, me) {
  const date = requireDate_(d.date);
  const type = DUTY_TYPES.indexOf(d.type) > -1 ? d.type : 'bazar';
  if (!findById_('Users', d.userId)) throw new Error('সদস্য বেছে নিন');
  const area = clean_(d.area, 60) || (type === 'clean' ? 'ওয়াশরুম' : '');
  const status = DUTY_STATUS.indexOf(d.status) > -1 ? d.status : 'pending';

  if (d.id) {
    const t = findById_('Duties', d.id);
    if (!t) throw new Error('ডিউটি পাওয়া যায়নি');
    t.type = type; t.date = date; t.userId = d.userId; t.area = area;
    t.note = clean_(d.note, 200); t.status = status; t.updatedBy = me.id;
    updateRow_('Duties', t._row, t);
  } else {
    insertRows_('Duties', [{
      id: uid_(), type: type, date: date, userId: d.userId, area: area,
      status: status, note: clean_(d.note, 200), updatedBy: me.id
    }]);
  }
  return dutiesList_({ month: date.slice(0, 7) });
}

function dutiesDelete_(d) {
  const t = findById_('Duties', d.id);
  if (!t) throw new Error('ডিউটি পাওয়া যায়নি');
  deleteRow_('Duties', t._row);
  return dutiesList_({ month: t.date.slice(0, 7) });
}

/**
 * পালাক্রমে রোস্টার তৈরি:
 * { type, from, to, every (কত দিন পরপর), userIds (ক্রম অনুযায়ী), area, replace }
 * replace = true হলে ওই সময়ের একই ধরনের অপেক্ষমাণ ডিউটি মুছে নতুন বানায়।
 */
function dutiesGenerate_(d, me) {
  const type = DUTY_TYPES.indexOf(d.type) > -1 ? d.type : 'bazar';
  const from = requireDate_(d.from, 'শুরুর তারিখ');
  const to = requireDate_(d.to, 'শেষের তারিখ');
  const every = Math.max(1, Math.min(31, parseInt(d.every, 10) || 1));
  const span = daysBetween_(from, to);
  if (span < 0 || span > 92) throw new Error('সর্বোচ্চ ৯২ দিনের রোস্টার একসাথে বানানো যাবে');

  const valid = {};
  readAll_('Users').forEach(function (u) { if (u.active === '1') valid[u.id] = true; });
  const userIds = (d.userIds || []).filter(function (id) { return valid[id]; });
  if (!userIds.length) throw new Error('অন্তত একজন সদস্য বেছে নিন');

  if (d.replace) {
    const sh = sheet_('Duties');
    readAll_('Duties')
      .filter(function (t) { return t.type === type && t.status === 'pending' && t.date >= from && t.date <= to; })
      .map(function (t) { return t._row; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (row) { sh.deleteRow(row); });
    delete _tableCache.Duties;
  }

  const area = clean_(d.area, 60) || (type === 'clean' ? 'ওয়াশরুম' : '');
  const rows = [];
  for (let i = 0, k = 0; i <= span; i += every, k++) {
    rows.push({
      id: uid_(), type: type, date: addDays_(from, i), userId: userIds[k % userIds.length],
      area: area, status: 'pending', note: '', updatedBy: me.id
    });
  }
  insertRows_('Duties', rows);
  return { created: rows.length };
}

/** সদস্য নিজের ডিউটি "সম্পন্ন" করতে পারে; ম্যানেজার যেকোনোটা */
function dutiesStatus_(d, me) {
  const t = findById_('Duties', d.id);
  if (!t) throw new Error('ডিউটি পাওয়া যায়নি');
  const status = DUTY_STATUS.indexOf(d.status) > -1 ? d.status : 'done';
  if (me.role === 'member' && (t.userId !== me.id || status === 'missed')) {
    throw new Error('শুধু নিজের ডিউটি সম্পন্ন করতে পারবেন');
  }
  t.status = status;
  t.updatedBy = me.id;
  updateRow_('Duties', t._row, t);
  return dutiesList_({ month: t.date.slice(0, 7) });
}


/* ======================= Report.gs ======================= */

/**
 * মাসিক হিসাব ও ড্যাশবোর্ড।
 *
 *   মিল রেট        = মোট বাজার খরচ ÷ মোট মিল
 *   মিল খরচ        = নিজের মিল × মিল রেট
 *   সাধারণ খরচ ভাগ = মোট সাধারণ খরচ ÷ সদস্য সংখ্যা
 *   মোট জমা        = টাকা জমা + নিজের টাকায় করা বাজার
 *   ব্যালেন্স       = মোট জমা − (মিল খরচ + সাধারণ খরচ ভাগ)   (+ হলে ফেরত পাবে, − হলে দিতে হবে)
 */

function computeReport_(month, withMatrix) {
  const users = readAll_('Users');
  const per = {};
  const ensure = function (id) {
    if (!per[id]) {
      const u = users.filter(function (x) { return x.id === id; })[0] || {};
      per[id] = { userId: id, name: u.name || '?', room: u.room || '', lunch: 0, dinner: 0, deposit: 0, paidBazar: 0 };
    }
    return per[id];
  };
  users.forEach(function (u) { if (u.active === '1') ensure(u.id); });

  // দিনভিত্তিক মোট মিল
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const dayMap = {};
  for (let i = 1; i <= daysInMonth; i++) {
    const date = month + '-' + ('0' + i).slice(-2);
    dayMap[date] = { date: date, lunch: 0, dinner: 0 };
  }

  const matrix = {};
  inMonth_(readAll_('Meals'), month).forEach(function (m) {
    if (!m.lunch && !m.dinner) return;
    const p = ensure(m.userId);
    p.lunch += m.lunch;
    p.dinner += m.dinner;
    if (dayMap[m.date]) { dayMap[m.date].lunch += m.lunch; dayMap[m.date].dinner += m.dinner; }
    if (withMatrix) {
      matrix[m.userId] = matrix[m.userId] || {};
      matrix[m.userId][m.date] = [m.lunch, m.dinner];
    }
  });

  let totalBazar = 0, totalShared = 0, fundSpent = 0;
  inMonth_(readAll_('Expenses'), month).forEach(function (e) {
    if (e.type === 'shared') totalShared += e.amount; else totalBazar += e.amount;
    if (e.paidBy) ensure(e.paidBy).paidBazar += e.amount; else fundSpent += e.amount;
  });

  let totalDeposit = 0;
  inMonth_(readAll_('Deposits'), month).forEach(function (d) {
    ensure(d.userId).deposit += d.amount;
    totalDeposit += d.amount;
  });

  const members = Object.keys(per).map(function (k) { return per[k]; });
  const totalLunch = members.reduce(function (s, p) { return s + p.lunch; }, 0);
  const totalDinner = members.reduce(function (s, p) { return s + p.dinner; }, 0);
  const totalMeals = totalLunch + totalDinner;
  const mealRate = totalMeals ? totalBazar / totalMeals : 0;
  const sharedEach = members.length ? totalShared / members.length : 0;

  members.forEach(function (p) {
    p.meals = p.lunch + p.dinner;
    p.mealCost = round2_(p.meals * mealRate);
    p.sharedCost = round2_(sharedEach);
    p.totalCost = round2_(p.mealCost + p.sharedCost);
    p.credit = round2_(p.deposit + p.paidBazar);
    p.balance = round2_(p.credit - p.totalCost);
    p.deposit = round2_(p.deposit);
    p.paidBazar = round2_(p.paidBazar);
  });
  members.sort(function (a, b) { return a.name.localeCompare(b.name); });

  const out = {
    month: month,
    totalLunch: totalLunch, totalDinner: totalDinner, totalMeals: totalMeals,
    totalBazar: round2_(totalBazar), totalShared: round2_(totalShared),
    totalDeposit: round2_(totalDeposit), fundSpent: round2_(fundSpent),
    cashInHand: round2_(totalDeposit - fundSpent),
    mealRate: Math.round(mealRate * 100) / 100,
    sharedEach: round2_(sharedEach),
    members: members,
    days: Object.keys(dayMap).sort().map(function (k) { return dayMap[k]; })
  };
  if (withMatrix) out.matrix = matrix;
  return out;
}

function reportMonth_(d) {
  return computeReport_(requireMonth_(d.month), !!d.matrix);
}

function dashboard_(d, me) {
  const today = today_();
  const report = computeReport_(today.slice(0, 7), false);
  const mine = report.members.filter(function (p) { return p.userId === me.id; })[0] ||
    { meals: 0, lunch: 0, dinner: 0, mealCost: 0, sharedCost: 0, totalCost: 0, credit: 0, balance: 0 };

  const todayMeals = mealsDay_({ date: today });
  const myToday = todayMeals.rows.filter(function (r) { return r.userId === me.id; })[0] || { lunch: 0, dinner: 0 };
  const tomorrow = mealsDay_({ date: addDays_(today, 1) });

  const names = nameMap_();
  const until = addDays_(today, 7);
  const duties = readAll_('Duties')
    .filter(function (t) { return t.date >= today && t.date <= until; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .map(function (t) {
      const o = strip_(t);
      o.name = names[t.userId] || '?';
      o.mine = t.userId === me.id;
      return o;
    });

  const pendingMemos = readAll_('Memos').filter(function (m) {
    return m.status === 'pending' && (me.role !== 'member' || m.userId === me.id);
  }).length;

  return {
    today: today,
    settings: getSettings_(),
    month: {
      mealRate: report.mealRate, totalMeals: report.totalMeals, totalBazar: report.totalBazar,
      totalShared: report.totalShared, totalDeposit: report.totalDeposit, cashInHand: report.cashInHand
    },
    mine: mine,
    todayMeals: { lunch: todayMeals.totalLunch, dinner: todayMeals.totalDinner },
    tomorrowMeals: { lunch: tomorrow.totalLunch, dinner: tomorrow.totalDinner },
    myToday: { lunch: myToday.lunch, dinner: myToday.dinner },
    duties: duties,
    pendingMemos: pendingMemos
  };
}


/* ======================= UI (Index + Styles + JS) ======================= */

const APP_HTML = `<!DOCTYPE html>
<html lang="bn">
<head>
  <base target="_top">
  <meta charset="utf-8">
  <meta name="theme-color" content="#0f766e">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
:root {
  --bg: #f3f6f5;
  --card: #ffffff;
  --text: #13201d;
  --muted: #64748b;
  --line: #e2e8f0;
  --primary: #0f766e;
  --primary-soft: #ccfbf1;
  --on-primary: #ffffff;
  --accent: #f59e0b;
  --danger: #dc2626;
  --danger-soft: #fee2e2;
  --ok: #16a34a;
  --ok-soft: #dcfce7;
  --warn-soft: #fef3c7;
  --radius: 14px;
  --shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 16px rgba(15,118,110,.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1211; --card: #131d1b; --text: #e6efed; --muted: #94a3b8; --line: #23302d;
    --primary: #2dd4bf; --primary-soft: #134e48; --on-primary: #042f2b; --danger-soft: #451a1a; --ok-soft: #14361f; --warn-soft: #3d2f0b;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  font-family: 'Hind Siliguri', system-ui, sans-serif;
  background: var(--bg); color: var(--text); font-size: 15px; line-height: 1.5;
  -webkit-tap-highlight-color: transparent;
}
.hidden { display: none !important; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.center { text-align: center; }
.right { text-align: right; }
.pos { color: var(--ok); font-weight: 600; }
.neg { color: var(--danger); font-weight: 600; }
h2 { font-size: 18px; margin: 4px 0 12px; }
h3 { font-size: 16px; margin: 0 0 10px; }

/* ---------- ফর্ম ---------- */
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); font-weight: 500; }
input, select, textarea {
  font: inherit; color: var(--text); background: var(--card);
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; width: 100%; min-height: 44px;
}
input:focus, select:focus, textarea:focus { outline: 2px solid var(--primary); outline-offset: -1px; }
textarea { min-height: 70px; resize: vertical; }
.check { flex-direction: row; align-items: center; gap: 8px; color: var(--text); font-size: 15px; }
.check input { width: 20px; min-height: 20px; height: 20px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.row > * { flex: 1; min-width: 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.btn {
  font: inherit; font-weight: 600; border: 1px solid var(--line); background: var(--card); color: var(--text);
  border-radius: 10px; padding: 9px 14px; min-height: 42px; cursor: pointer; white-space: nowrap;
}
.btn.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
.btn.danger { color: var(--danger); border-color: var(--danger-soft); background: var(--danger-soft); }
.btn.ok { color: var(--ok); border-color: var(--ok-soft); background: var(--ok-soft); }
.btn.ghost { background: transparent; }
.btn.sm { min-height: 34px; padding: 4px 10px; font-size: 13px; }
.btn.block { width: 100%; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.icon-btn { border: 0; background: transparent; color: inherit; font-size: 20px; width: 42px; height: 42px; border-radius: 10px; cursor: pointer; }

/* ---------- লগইন ---------- */
.auth { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.auth-card { width: 100%; max-width: 380px; background: var(--card); border-radius: 20px; padding: 24px; box-shadow: var(--shadow); }
.brand { text-align: center; margin-bottom: 16px; }
.brand-icon { font-size: 44px; }
.brand h1 { margin: 4px 0 0; font-size: 22px; }
.brand p { margin: 0; }
.note { background: var(--warn-soft); border-radius: 10px; padding: 10px 12px; font-size: 14px; }

/* ---------- লেআউট ---------- */
.topbar {
  position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; background: var(--card); border-bottom: 1px solid var(--line);
}
.topbar-title { flex: 1; display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.topbar-title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-chip { border: 0; background: var(--primary-soft); color: var(--text); border-radius: 999px; padding: 6px 10px; font: inherit; font-size: 13px; display: flex; gap: 6px; align-items: center; cursor: pointer; max-width: 50%; }
.user-chip span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--primary); color: var(--on-primary); font-weight: 600; white-space: nowrap; }
.badge.gray { background: var(--line); color: var(--text); }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.badge.warn { background: var(--warn-soft); color: #b45309; }
.badge.danger { background: var(--danger-soft); color: var(--danger); }

.view { padding: 14px 16px 96px; max-width: 980px; margin: 0 auto; }

.drawer {
  position: fixed; top: 0; bottom: 0; left: 0; width: 270px; max-width: 85vw; z-index: 40; background: var(--card);
  transform: translateX(-100%); transition: transform .2s ease; padding: 10px; display: flex; flex-direction: column; gap: 6px;
}
.drawer.open { transform: none; }
.drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px 8px; }
.drawer nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.drawer nav a { padding: 11px 12px; border-radius: 10px; color: var(--text); text-decoration: none; cursor: pointer; display: flex; gap: 10px; }
.drawer nav a.active { background: var(--primary-soft); font-weight: 600; }
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 30; display: none; }
.scrim.open { display: block; }

.bottom-nav {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 20; display: flex; background: var(--card);
  border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom);
}
.bottom-nav a { flex: 1; text-align: center; padding: 7px 2px 6px; font-size: 12px; color: var(--muted); text-decoration: none; cursor: pointer; position: relative; }
.bottom-nav a .ico { display: block; font-size: 20px; line-height: 1.2; }
.bottom-nav a.active { color: var(--primary); font-weight: 600; }
.dot { position: absolute; top: 4px; left: 55%; background: var(--danger); color: #fff; font-size: 10px; border-radius: 999px; padding: 0 5px; }

@media (min-width: 900px) {
  .drawer { transform: none; top: 59px; border-right: 1px solid var(--line); }
  .scrim, .scrim.open { display: none; }
  .topbar [data-act="menu"], .drawer-head { display: none; }
  .bottom-nav { display: none; }
  .view { margin-left: 270px; padding-bottom: 32px; }
}

/* ---------- কার্ড ---------- */
.card { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px; margin-bottom: 14px; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.card-head h3 { margin: 0; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
@media (min-width: 640px) { .stats { grid-template-columns: repeat(4, 1fr); } }
.stat { background: var(--card); border-radius: var(--radius); padding: 12px; box-shadow: var(--shadow); }
.stat .lbl { font-size: 12px; color: var(--muted); }
.stat .val { font-size: 20px; font-weight: 700; }
.stat.hl { background: var(--primary); color: var(--on-primary); }
.stat.hl .lbl { color: var(--on-primary); opacity: .85; }

.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.toolbar input[type="month"], .toolbar input[type="date"] { width: auto; flex: 1; min-width: 150px; }

/* ---------- তালিকা ও টেবিল ---------- */
.list { display: flex; flex-direction: column; }
.item { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.item .grow { flex: 1; min-width: 0; }
.item .title { font-weight: 600; }
.item .sub { font-size: 13px; color: var(--muted); }
.amount { font-weight: 700; white-space: nowrap; }
.empty { text-align: center; color: var(--muted); padding: 24px 8px; }

.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px 6px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
td.num, th.num { text-align: right; }
tfoot td { font-weight: 700; }
.sheet th, .sheet td { padding: 4px 6px; text-align: center; font-size: 12px; }
.sheet td:first-child, .sheet th:first-child { text-align: left; position: sticky; left: 0; background: var(--card); }

/* ---------- মিল টগল ---------- */
.meal-day { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.meal-day:last-child { border-bottom: 0; }
.meal-day .d { flex: 1; min-width: 0; }
.meal-day .d strong { display: block; }
.meal-day.today { background: var(--primary-soft); margin: 0 -14px; padding: 10px 14px; }
.stepper { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); }
.stepper button { width: 34px; height: 38px; border: 0; background: transparent; font-size: 18px; cursor: pointer; color: var(--text); }
.stepper .v { min-width: 26px; text-align: center; font-weight: 700; }
.stepper.on { border-color: var(--primary); }
.stepper.on .v { color: var(--primary); }
.stepper.locked { opacity: .45; }
.stepper.locked button { cursor: not-allowed; }
.slot { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: var(--muted); }

/* ---------- ডিউটি ---------- */
.duty-ico { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 20px; background: var(--primary-soft); flex-shrink: 0; }
.duty-ico.clean { background: #e0f2fe; }

/* ---------- মডাল, লোডার, টোস্ট ---------- */
.modal { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; }
@media (min-width: 640px) { .modal { align-items: center; } }
.modal-card { background: var(--card); width: 100%; max-width: 520px; max-height: 92vh; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; }
@media (min-width: 640px) { .modal-card { border-radius: 18px; } }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 10px 4px 16px; }
.modal-body { padding: 8px 16px 16px; overflow-y: auto; }
.modal-body img.memo { width: 100%; max-height: 55vh; object-fit: contain; border-radius: 10px; background: #fff; }

.loader { position: fixed; inset: 0; z-index: 60; background: rgba(255,255,255,.35); display: grid; place-items: center; }
.spinner { width: 42px; height: 42px; border-radius: 50%; border: 4px solid var(--primary-soft); border-top-color: var(--primary); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.toasts { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 70; display: flex; flex-direction: column; gap: 8px; width: calc(100% - 32px); max-width: 420px; }
.toast { background: #13201d; color: #fff; padding: 10px 14px; border-radius: 10px; font-size: 14px; box-shadow: var(--shadow); animation: up .2s ease; }
.toast.err { background: var(--danger); }
.toast.ok { background: var(--ok); }
@keyframes up { from { transform: translateY(10px); opacity: 0; } }
.preview { max-width: 100%; max-height: 220px; border-radius: 10px; display: block; margin-top: 6px; }

.switcher { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.switcher strong { flex: 1; text-align: center; }
.switcher .btn { flex: 0 0 auto; }

@media print {
  .topbar, .drawer, .scrim, .bottom-nav, .toolbar, .switcher .btn, .btn { display: none !important; }
  .view { margin: 0; padding: 0; max-width: none; }
  .card, .stat { box-shadow: none; border: 1px solid #ddd; }
}
</style>

</head>
<body>
  <!-- লগইন / প্রথম অ্যাডমিন তৈরি -->
  <section id="auth" class="auth hidden">
    <div class="auth-card">
      <div class="brand">
        <div class="brand-icon">🍛</div>
        <h1 id="authTitle">{{MESS_NAME}}</h1>
        <p class="muted" id="authSub">মেস মিল হিসাব</p>
      </div>

      <form id="loginForm" class="stack hidden" autocomplete="on">
        <label>ইউজারনেম<input name="username" required autocomplete="username" autocapitalize="none"></label>
        <label>পাসওয়ার্ড<input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary block" type="submit">লগইন</button>
        <p class="muted small center">পাসওয়ার্ড ভুলে গেলে অ্যাডমিনকে রিসেট করতে বলুন</p>
      </form>

      <form id="setupForm" class="stack hidden">
        <div class="note">প্রথমবার চালু হচ্ছে — অ্যাডমিন অ্যাকাউন্ট তৈরি করুন</div>
        <label>মেসের নাম<input name="messName" required placeholder="যেমন: বাসা নং ১২ মেস"></label>
        <label>আপনার নাম<input name="name" required></label>
        <label>ইউজারনেম<input name="username" required autocapitalize="none" placeholder="ইংরেজিতে, যেমন: tarun"></label>
        <label>পাসওয়ার্ড<input name="password" type="password" required minlength="6"></label>
        <button class="btn primary block" type="submit">অ্যাডমিন তৈরি করুন</button>
      </form>
    </div>
  </section>

  <!-- মূল অ্যাপ -->
  <div id="app" class="hidden">
    <header class="topbar">
      <button class="icon-btn" data-act="menu" aria-label="মেনু">☰</button>
      <div class="topbar-title">
        <strong id="messName">{{MESS_NAME}}</strong>
        <span id="pageTitle" class="muted small"></span>
      </div>
      <button class="user-chip" data-act="go" data-page="profile">
        <span id="userName"></span>
        <span id="userRole" class="badge"></span>
      </button>
    </header>

    <aside id="drawer" class="drawer">
      <div class="drawer-head">
        <strong>মেনু</strong>
        <button class="icon-btn" data-act="menu-close" aria-label="বন্ধ">✕</button>
      </div>
      <nav id="drawerNav"></nav>
      <button class="btn ghost block" data-act="logout">🚪 লগআউট</button>
    </aside>
    <div id="scrim" class="scrim" data-act="menu-close"></div>

    <main id="view" class="view"></main>

    <nav id="bottomNav" class="bottom-nav"></nav>
  </div>

  <!-- ডায়ালগ -->
  <div id="modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-head">
        <strong id="modalTitle"></strong>
        <button class="icon-btn" data-act="modal-close" aria-label="বন্ধ">✕</button>
      </div>
      <div id="modalBody" class="modal-body"></div>
    </div>
  </div>

  <div id="loader" class="loader hidden"><div class="spinner"></div></div>
  <div id="toasts" class="toasts"></div>

  <script>
/* ================= অবস্থা ও সহায়ক ================= */
const ROLE_LABEL = { admin: 'অ্যাডমিন', manager: 'ম্যানেজার', member: 'সদস্য' };
const ALL = ['admin', 'manager', 'member'], MGR = ['admin', 'manager'], ADM = ['admin'];

const S = { token: null, user: null, settings: {}, page: 'home', params: {}, users: null, month: null, date: null };
const PAGES = {};   // JsPages / JsManage এ পেজগুলো যোগ হয়
const ACT = {};     // data-act="..." ক্লিক হ্যান্ডলার
const CHG = {};     // data-chg="..." change হ্যান্ডলার

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* প্রাইভেট মোড */ } }
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bn = n => Number(n || 0).toLocaleString('bn-BD', { maximumFractionDigits: 2 });
const tk = n => '৳' + bn(n);
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => ymd(new Date());
const thisMonth = () => todayStr().slice(0, 7);
const addDays = (s, n) => { const p = s.split('-').map(Number); return ymd(new Date(p[0], p[1] - 1, p[2] + n)); };
const shiftMonth = (m, n) => { const p = m.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const fmtDate = (s, opt) => s ? new Date(s + 'T00:00:00').toLocaleDateString('bn-BD', opt || { day: 'numeric', month: 'short', weekday: 'short' }) : '';
const fmtMonth = m => new Date(m + '-01T00:00:00').toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' });
const isMgr = () => !!S.user && S.user.role !== 'member';
const isAdmin = () => !!S.user && S.user.role === 'admin';
const signed = n => (n >= 0 ? '+' : '−') + tk(Math.abs(n));
const balClass = n => n >= 0 ? 'pos' : 'neg';

/* ================= API ================= */
let loadCount = 0;
function loading(on) {
  loadCount = Math.max(0, loadCount + (on ? 1 : -1));
  $('#loader').classList.toggle('hidden', loadCount === 0);
}

function call(action, data, opts) {
  opts = opts || {};
  if (!opts.silent) loading(true);
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(res => {
        if (!opts.silent) loading(false);
        if (res && res.ok) return resolve(res.data);
        const msg = (res && res.error) || 'কিছু একটা সমস্যা হয়েছে';
        if (msg.indexOf('AUTH:') === 0) {
          const wasIn = !!S.user;
          clearSession();
          if (wasIn) { toast(msg.slice(5).trim(), 'err'); showAuth(); }
          return reject(new Error('auth'));
        }
        toast(msg, 'err');
        reject(new Error(msg));
      })
      .withFailureHandler(err => {
        if (!opts.silent) loading(false);
        toast('সার্ভারে সংযোগ হয়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।', 'err');
        reject(err);
      })
      .api(action, S.token, data || {});
  });
}

async function getUsers(force) {
  if (!S.users || force) S.users = await call('users.list');
  return S.users;
}
function userOptions(users, selected, emptyLabel) {
  return (emptyLabel ? \`<option value="">\${esc(emptyLabel)}</option>\` : '') +
    users.filter(u => u.active === '1' || u.id === selected)
      .map(u => \`<option value="\${esc(u.id)}" \${u.id === selected ? 'selected' : ''}>\${esc(u.name)}\${u.room ? ' (' + esc(u.room) + ')' : ''}</option>\`).join('');
}

/* ================= UI: টোস্ট, মডাল ================= */
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 5000 : 3000);
}

function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => {
    if (v instanceof File) return;
    if (o[k] !== undefined) o[k] = [].concat(o[k], v); else o[k] = v;
  });
  $$('input[type="checkbox"]', form).forEach(c => { if (!c.name.endsWith('[]')) o[c.name] = c.checked; });
  return o;
}

/** onSubmit(data, form) — true ফেরত দিলে ডায়ালগ খোলা থাকে */
function openModal(title, html, onSubmit) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  const form = $('#modalBody form');
  if (form && onSubmit) {
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = $('button[type="submit"]', form);
      if (btn) btn.disabled = true;
      try {
        const keep = await onSubmit(formData(form), form);
        if (keep !== true) closeModal();
      } catch (err) { /* টোস্টে দেখানো হয়েছে */ }
      if (btn) btn.disabled = false;
    };
    const first = $('input:not([type="hidden"]), select, textarea', form);
    if (first && window.innerWidth > 640) first.focus();
  }
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }

function confirmBox(msg, okText) {
  return new Promise(resolve => {
    openModal('নিশ্চিত করুন', \`<form class="stack"><p>\${esc(msg)}</p>
      <div class="row"><button type="button" class="btn" data-act="modal-close">না</button>
      <button type="submit" class="btn danger">\${esc(okText || 'হ্যাঁ')}</button></div></form>\`, () => { resolve(true); });
    const obs = new MutationObserver(() => { if ($('#modal').classList.contains('hidden')) { obs.disconnect(); resolve(false); } });
    obs.observe($('#modal'), { attributes: true });
  });
}

/* ================= ছবি ================= */
function compressImage(file, max, quality) {
  max = max || 1400; quality = quality || 0.75;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ছবি পড়া যায়নি'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('এই ছবিটি খোলা যাচ্ছে না, অন্য ছবি দিন'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/jpeg', quality);
        resolve({ data: url.split(',')[1], mime: 'image/jpeg', preview: url });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** ফর্মের ছবি ফিল্ড থেকে কমপ্রেস করা ছবি (না থাকলে null) */
async function imageFromForm(form) {
  const input = $('input[type="file"]', form);
  if (!input || !input.files || !input.files[0]) return null;
  try { const img = await compressImage(input.files[0]); delete img.preview; return img; }
  catch (e) { toast(e.message, 'err'); throw e; }
}

CHG.preview = async el => {
  const box = $('#' + el.dataset.target);
  if (!box) return;
  box.innerHTML = '';
  if (el.files && el.files[0]) {
    try { const img = await compressImage(el.files[0], 600, 0.6); box.innerHTML = \`<img class="preview" src="\${img.preview}" alt="">\`; }
    catch (e) { toast(e.message, 'err'); }
  }
};

ACT['show-image'] = async el => {
  const src = await call('image.get', { kind: el.dataset.kind, id: el.dataset.id });
  openModal('মেমোর ছবি', \`<img class="memo" src="\${src}" alt="মেমো">\`);
};

/* ================= নেভিগেশন ================= */
const NAV_ORDER = ['home', 'mymeal', 'daymeal', 'memo', 'expense', 'deposit', 'duty', 'report', 'users', 'settings', 'profile'];

function allowed(page) { return PAGES[page] && PAGES[page].roles.indexOf(S.user.role) > -1; }

function renderNav() {
  const pages = NAV_ORDER.filter(allowed);
  $('#drawerNav').innerHTML = pages.map(p =>
    \`<a data-act="go" data-page="\${p}" class="\${S.page === p ? 'active' : ''}"><span>\${PAGES[p].icon}</span>\${PAGES[p].title}</a>\`).join('');

  const bottom = (isMgr() ? ['home', 'daymeal', 'memo', 'report'] : ['home', 'mymeal', 'memo', 'duty']).filter(allowed);
  $('#bottomNav').innerHTML = bottom.map(p =>
    \`<a data-act="go" data-page="\${p}" class="\${S.page === p ? 'active' : ''}"><span class="ico">\${PAGES[p].icon}</span>\${PAGES[p].short || PAGES[p].title}
     \${p === 'memo' && S.pendingMemos ? \`<span class="dot">\${bn(S.pendingMemos)}</span>\` : ''}</a>\`).join('') +
    \`<a data-act="menu"><span class="ico">☰</span>আরো</a>\`;
}

async function go(page, params) {
  if (!allowed(page)) page = 'home';
  S.page = page;
  S.params = params || {};
  store.set('page', page);
  $('#pageTitle').textContent = PAGES[page].title;
  renderNav();
  closeDrawer();
  const view = $('#view');
  view.innerHTML = '<div class="empty">লোড হচ্ছে…</div>';
  window.scrollTo(0, 0);
  try { await PAGES[page].render(view, S.params); }
  catch (e) { if (S.page === page && e.message !== 'auth') view.innerHTML = \`<div class="empty">\${esc(e.message || 'লোড করা যায়নি')}<br><br><button class="btn" data-act="reload">আবার চেষ্টা</button></div>\`; }
}
const refresh = () => go(S.page, S.params);

function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }

/** মাস বদলানোর বার (‹ অক্টোবর ২০২৬ ›) */
function monthNav() {
  S.month = S.month || thisMonth();
  return \`<div class="switcher"><button class="btn sm" data-act="month-shift" data-n="-1">‹</button>
    <strong>\${fmtMonth(S.month)}</strong>
    <button class="btn sm" data-act="month-shift" data-n="1">›</button></div>\`;
}

ACT.go = el => go(el.dataset.page, el.dataset.id ? { id: el.dataset.id } : null);
ACT.menu = openDrawer;
ACT['menu-close'] = closeDrawer;
ACT['modal-close'] = closeModal;
ACT.reload = refresh;
ACT.logout = () => { clearSession(); showAuth(); };
ACT['month-shift'] = el => { S.month = shiftMonth(S.month || thisMonth(), Number(el.dataset.n)); refresh(); };

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault();
  Promise.resolve().then(() => ACT[el.dataset.act](el, e)).catch(() => { /* টোস্টে দেখানো হয়েছে */ });
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (el && CHG[el.dataset.chg]) Promise.resolve().then(() => CHG[el.dataset.chg](el, e)).catch(() => {});
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

/* ================= লগইন ================= */
function clearSession() { store.set('token', null); S.token = null; S.user = null; S.users = null; }

function startApp(res) {
  if (res.token) { S.token = res.token; store.set('token', res.token); }
  S.user = res.user;
  S.settings = res.settings || {};
  S.month = thisMonth();
  $('#messName').textContent = S.settings.messName || 'মেস মিল হিসাব';
  $('#userName').textContent = S.user.name;
  $('#userRole').textContent = ROLE_LABEL[S.user.role];
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  go(store.get('page') || 'home');
}

async function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#loginForm').classList.add('hidden');
  $('#setupForm').classList.add('hidden');
  const st = await call('auth.status');
  if (st.messName) $('#authTitle').textContent = st.messName;
  $(st.needsSetup ? '#setupForm' : '#loginForm').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { startApp(await call('auth.login', formData(e.target))); e.target.reset(); } catch (err) { /* টোস্ট */ }
});
$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { startApp(await call('auth.setupAdmin', formData(e.target))); toast('স্বাগতম! এখন সদস্যদের যোগ করুন', 'ok'); } catch (err) { /* টোস্ট */ }
});

window.addEventListener('load', async () => {
  S.token = store.get('token');
  if (S.token) {
    try { return startApp(await call('me.get')); } catch (e) { clearSession(); }
  }
  showAuth().catch(() => {});
});
</script>

  <script>
/* =========================================================
   সবার জন্য পেজ: হোম, আমার মিল, মেমো, ডিউটি, রিপোর্ট, প্রোফাইল
   ========================================================= */

const DUTY_LABEL = { bazar: 'বাজার', clean: 'পরিষ্কার' };
const DUTY_ICON = { bazar: '🛒', clean: '🚿' };
const DUTY_STATUS = { pending: ['বাকি', 'warn'], done: ['সম্পন্ন', 'ok'], missed: ['মিস', 'danger'] };
const MEMO_STATUS = { pending: ['অপেক্ষমাণ', 'warn'], approved: ['অনুমোদিত', 'ok'], rejected: ['বাতিল', 'danger'] };
const badge = (map, key) => \`<span class="badge \${(map[key] || [])[1] || 'gray'}">\${(map[key] || [key])[0]}</span>\`;

function dutyItem(t) {
  const mine = S.user && t.userId === S.user.id;
  const actions = [];
  if (t.status === 'pending' && (mine || isMgr())) actions.push(\`<button class="btn sm ok" data-act="duty-done" data-id="\${t.id}">✓ সম্পন্ন</button>\`);
  if (isMgr() && S.page === 'duty') actions.push(\`<button class="btn sm" data-act="duty-edit" data-id="\${t.id}">✎</button>\`);
  return \`<div class="item">
    <div class="duty-ico \${t.type}">\${DUTY_ICON[t.type]}</div>
    <div class="grow">
      <div class="title">\${esc(t.name)}\${mine ? ' <span class="badge">আমি</span>' : ''}</div>
      <div class="sub">\${fmtDate(t.date)} · \${DUTY_LABEL[t.type]}\${t.area ? ' (' + esc(t.area) + ')' : ''}\${t.note ? ' · ' + esc(t.note) : ''}</div>
    </div>
    \${badge(DUTY_STATUS, t.status)} \${actions.join(' ')}
  </div>\`;
}

ACT['duty-done'] = async el => {
  await call('duties.status', { id: el.dataset.id, status: 'done' });
  toast('ডিউটি সম্পন্ন হিসেবে চিহ্নিত হয়েছে', 'ok');
  refresh();
};

/* ---------------- হোম ---------------- */
PAGES.home = {
  title: 'হোম', icon: '🏠', roles: ALL,
  async render(v) {
    const d = await call('dashboard');
    S.pendingMemos = d.pendingMemos;
    renderNav();
    const m = d.mine;
    v.innerHTML = \`
      <div class="stats">
        <div class="stat hl"><div class="lbl">এই মাসের মিল রেট</div><div class="val">\${tk(d.month.mealRate)}</div></div>
        <div class="stat"><div class="lbl">আমার মিল (এই মাস)</div><div class="val">\${bn(m.meals)}</div></div>
        <div class="stat"><div class="lbl">আমার খরচ</div><div class="val">\${tk(m.totalCost)}</div></div>
        <div class="stat"><div class="lbl">আমার ব্যালেন্স</div><div class="val \${balClass(m.balance)}">\${signed(m.balance)}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>আজকের মিল · \${fmtDate(d.today)}</h3>
          <button class="btn sm" data-act="go" data-page="\${isMgr() ? 'daymeal' : 'mymeal'}">পরিবর্তন</button></div>
        <div class="grid2">
          <div class="stat"><div class="lbl">☀️ দুপুর — মোট</div><div class="val">\${bn(d.todayMeals.lunch)}</div><div class="small muted">আমার: \${bn(d.myToday.lunch)}</div></div>
          <div class="stat"><div class="lbl">🌙 রাত — মোট</div><div class="val">\${bn(d.todayMeals.dinner)}</div><div class="small muted">আমার: \${bn(d.myToday.dinner)}</div></div>
        </div>
        <p class="small muted" style="margin:10px 0 0">আগামীকাল: দুপুর \${bn(d.tomorrowMeals.lunch)} · রাত \${bn(d.tomorrowMeals.dinner)} জন</p>
      </div>

      \${d.pendingMemos && isMgr() ? \`<div class="card note row"><span>📄 \${bn(d.pendingMemos)}টি বাজারের মেমো যাচাইয়ের অপেক্ষায়</span>
        <button class="btn sm primary" style="flex:none" data-act="go" data-page="memo">দেখুন</button></div>\` : ''}

      <div class="card">
        <div class="card-head"><h3>সামনের ৭ দিনের ডিউটি</h3><button class="btn sm" data-act="go" data-page="duty">সব দেখুন</button></div>
        <div class="list">\${d.duties.length ? d.duties.map(dutyItem).join('') : '<div class="empty">কোনো ডিউটি নেই</div>'}</div>
      </div>

      <div class="card">
        <h3>এই মাসের মেস হিসাব</h3>
        <div class="list">
          <div class="item"><span class="grow">মোট মিল</span><span class="amount">\${bn(d.month.totalMeals)}</span></div>
          <div class="item"><span class="grow">মোট বাজার</span><span class="amount">\${tk(d.month.totalBazar)}</span></div>
          <div class="item"><span class="grow">সাধারণ খরচ</span><span class="amount">\${tk(d.month.totalShared)}</span></div>
          <div class="item"><span class="grow">মোট টাকা জমা</span><span class="amount">\${tk(d.month.totalDeposit)}</span></div>
          <div class="item"><span class="grow">ম্যানেজারের হাতে আছে</span><span class="amount \${balClass(d.month.cashInHand)}">\${tk(d.month.cashInHand)}</span></div>
        </div>
      </div>\`;
  }
};

/* ---------------- আমার মিল ---------------- */
function stepper(act, date, slot, val, locked, max) {
  return \`<div class="slot">\${slot === 'lunch' ? '☀️ দুপুর' : '🌙 রাত'}
    <div class="stepper \${val > 0 ? 'on' : ''} \${locked ? 'locked' : ''}">
      <button data-act="\${act}" data-date="\${date}" data-slot="\${slot}" data-n="-1" \${locked || val <= 0 ? 'disabled' : ''}>−</button>
      <span class="v">\${locked ? '🔒' : ''}\${bn(val)}</span>
      <button data-act="\${act}" data-date="\${date}" data-slot="\${slot}" data-n="1" \${locked || val >= max ? 'disabled' : ''}>+</button>
    </div></div>\`;
}

function myMealRows() {
  const st = S.myMeals;
  return st.days.map(d => \`<div class="meal-day \${d.date === st.today ? 'today' : ''}">
      <div class="d"><strong>\${fmtDate(d.date)}</strong>
        <span class="small muted">\${d.date === st.today ? 'আজ' : d.date === addDays(st.today, 1) ? 'আগামীকাল' : ''}
        \${d.isDefault ? '<span class="badge gray">ডিফল্ট</span>' : ''}</span></div>
      \${stepper('meal-step', d.date, 'lunch', d.lunch, d.lockLunch, st.maxGuestMeal)}
      \${stepper('meal-step', d.date, 'dinner', d.dinner, d.lockDinner, st.maxGuestMeal)}
    </div>\`).join('');
}

PAGES.mymeal = {
  title: 'আমার মিল', short: 'আমার মিল', icon: '🍽️', roles: ALL,
  async render(v, p) {
    const from = p.from || todayStr();
    S.myMeals = await call('meals.my', { from: from, to: addDays(from, 6) });
    const st = S.myMeals;
    v.innerHTML = \`
      <div class="card">
        <div class="card-head"><h3>কবে কবে মিল খাবেন</h3>
          <button class="btn sm primary" data-act="meal-range">একসাথে অনেক দিন</button></div>
        <p class="small muted" style="margin-top:0">আজকের দুপুরের মিল <b>\${esc(st.lunchCutoff)}</b> এবং রাতের মিল <b>\${esc(st.dinnerCutoff)}</b>
          এর আগে পরিবর্তন করা যাবে। গেস্ট থাকলে + চেপে সংখ্যা বাড়ান।</p>
        <div class="switcher">
          <button class="btn sm" data-act="meal-week" data-n="-7">‹ আগের</button>
          <strong>\${fmtDate(st.days[0].date, { day: 'numeric', month: 'short' })} – \${fmtDate(st.days[6].date, { day: 'numeric', month: 'short' })}</strong>
          <button class="btn sm" data-act="meal-week" data-n="7">পরের ›</button>
        </div>
        <div id="myMealList">\${myMealRows()}</div>
      </div>
      <div class="card">
        <h3>ডিফল্ট মিল</h3>
        <p class="small muted" style="margin-top:0">চালু থাকলে প্রতিদিন আপনাআপনি মিল বসে যাবে, শুধু যেদিন খাবেন না সেদিন বন্ধ করবেন।</p>
        <form id="prefsForm" class="row">
          <label class="check"><input type="checkbox" name="autoLunch" \${st.autoLunch === '1' ? 'checked' : ''}> ☀️ দুপুর</label>
          <label class="check"><input type="checkbox" name="autoDinner" \${st.autoDinner === '1' ? 'checked' : ''}> 🌙 রাত</label>
          <button class="btn" type="submit" style="flex:none">সেভ</button>
        </form>
      </div>\`;
    $('#prefsForm').onsubmit = async e => {
      e.preventDefault();
      S.user = await call('me.prefs', formData(e.target));
      toast('ডিফল্ট মিল সেভ হয়েছে', 'ok');
      refresh();
    };
  }
};

ACT['meal-week'] = el => {
  const base = S.params.from || todayStr();
  go('mymeal', { from: addDays(base, Number(el.dataset.n)) });
};

ACT['meal-step'] = async el => {
  const st = S.myMeals;
  const day = st.days.filter(d => d.date === el.dataset.date)[0];
  const slot = el.dataset.slot;
  const next = Math.max(0, Math.min(st.maxGuestMeal, day[slot] + Number(el.dataset.n)));
  const payload = { date: day.date };
  payload[slot] = next;
  const res = await call('meals.setMy', payload);
  Object.assign(day, res);
  $('#myMealList').innerHTML = myMealRows();
  toast(\`\${fmtDate(day.date)} — \${slot === 'lunch' ? 'দুপুর' : 'রাত'}: \${bn(next)} মিল\`, 'ok');
};

ACT['meal-range'] = () => {
  const opts = \`<option value="">অপরিবর্তিত</option><option value="1">চালু (১টি)</option><option value="0">বন্ধ</option>\`;
  openModal('একসাথে অনেক দিনের মিল', \`<form class="stack">
      <div class="grid2">
        <label>শুরু<input type="date" name="from" value="\${todayStr()}" required></label>
        <label>শেষ<input type="date" name="to" value="\${addDays(todayStr(), 4)}" required></label>
      </div>
      <div class="grid2">
        <label>☀️ দুপুর<select name="lunch">\${opts}</select></label>
        <label>🌙 রাত<select name="dinner">\${opts}</select></label>
      </div>
      <p class="small muted">যেমন: বাড়ি যাচ্ছেন — দুই বেলাই "বন্ধ" দিন। সময় পেরিয়ে যাওয়া বেলা বদলাবে না।</p>
      <button class="btn primary" type="submit">সেভ করুন</button></form>\`, async data => {
    const res = await call('meals.setMyRange', data);
    toast(\`\${bn(res.changed)} দিনের মিল আপডেট হয়েছে\` + (res.skipped ? \` (\${bn(res.skipped)}টি বেলার সময় শেষ)\` : ''), 'ok');
    refresh();
  });
};

/* ---------------- মেমো ---------------- */
PAGES.memo = {
  title: 'বাজারের মেমো', short: 'মেমো', icon: '🧾', roles: ALL,
  async render(v, p) {
    const status = p.status === undefined ? (isMgr() ? 'pending' : '') : p.status;
    const list = await call('memos.list', { month: S.month || thisMonth(), status: status });
    const total = list.reduce((s, m) => s + Number(m.amount), 0);
    v.innerHTML = \`
      <div class="toolbar">
        <button class="btn primary" data-act="memo-new">📷 মেমো আপলোড</button>
        \${isMgr() ? \`<select data-chg="memo-filter" style="flex:1">
          <option value="pending" \${status === 'pending' ? 'selected' : ''}>অপেক্ষমাণ</option>
          <option value="" \${status === '' ? 'selected' : ''}>সব মেমো</option>
          <option value="approved" \${status === 'approved' ? 'selected' : ''}>অনুমোদিত</option>
          <option value="rejected" \${status === 'rejected' ? 'selected' : ''}>বাতিল</option></select>\` : ''}
      </div>
      \${monthNav()}
      <div class="card">
        <div class="card-head"><h3>\${bn(list.length)}টি মেমো</h3><span class="amount">\${tk(total)}</span></div>
        <div class="list">\${list.length ? list.map(memoItem).join('') : '<div class="empty">এই মাসে কোনো মেমো নেই</div>'}</div>
      </div>\`;
  }
};

function memoItem(m) {
  const mine = m.userId === S.user.id;
  const btns = [];
  if (m.hasImage) btns.push(\`<button class="btn sm" data-act="show-image" data-kind="memo" data-id="\${m.id}">🖼️ ছবি</button>\`);
  if (isMgr() && m.status === 'pending') btns.push(\`<button class="btn sm primary" data-act="memo-review" data-id="\${m.id}">যাচাই</button>\`);
  if (m.status !== 'approved' && (isMgr() || (mine && m.status === 'pending'))) btns.push(\`<button class="btn sm danger" data-act="memo-delete" data-id="\${m.id}">মুছুন</button>\`);
  return \`<div class="item" style="flex-wrap:wrap">
    <div class="grow">
      <div class="title">\${esc(m.name)} · \${tk(m.amount)}</div>
      <div class="sub">\${fmtDate(m.date)}\${m.note ? ' · ' + esc(m.note) : ''}\${m.reviewedByName ? ' · যাচাই: ' + esc(m.reviewedByName) : ''}</div>
    </div>
    \${badge(MEMO_STATUS, m.status)}
    <div class="row" style="flex-basis:100%;justify-content:flex-end;flex:0 0 100%">\${btns.map(b => \`<span style="flex:none">\${b}</span>\`).join('')}</div>
  </div>\`;
}

CHG['memo-filter'] = el => go('memo', { status: el.value });

ACT['memo-new'] = () => {
  openModal('বাজারের মেমো আপলোড', \`<form class="stack">
      <label>বাজারের তারিখ<input type="date" name="date" value="\${todayStr()}" required></label>
      <label>মোট টাকা<input type="number" name="amount" min="1" step="0.01" inputmode="decimal" required></label>
      <label>কী কী কিনেছেন (ঐচ্ছিক)<textarea name="note" placeholder="চাল, ডাল, মাছ..."></textarea></label>
      <label>মেমোর ছবি<input type="file" accept="image/*" data-chg="preview" data-target="memoPrev" required></label>
      <div id="memoPrev"></div>
      <button class="btn primary" type="submit">আপলোড করুন</button></form>\`, async (data, form) => {
    data.image = await imageFromForm(form);
    if (!data.image) { toast('মেমোর ছবি দিন', 'err'); return true; }
    await call('memos.upload', data);
    toast('মেমো আপলোড হয়েছে, ম্যানেজার যাচাই করবেন', 'ok');
    S.month = data.date.slice(0, 7);
    go('memo', { status: isMgr() ? 'pending' : '' });
  });
};

ACT['memo-delete'] = async el => {
  if (!(await confirmBox('মেমোটি মুছে ফেলবেন?', 'মুছুন'))) return;
  await call('memos.delete', { id: el.dataset.id });
  toast('মেমো মুছে ফেলা হয়েছে', 'ok');
  refresh();
};

/* ---------------- ডিউটি ---------------- */
PAGES.duty = {
  title: 'বাজার ও পরিষ্কারের ডিউটি', short: 'ডিউটি', icon: '🗓️', roles: ALL,
  async render(v, p) {
    const type = p.type || '';
    const list = await call('duties.list', { month: S.month || thisMonth(), type: type });
    v.innerHTML = \`
      \${isMgr() ? \`<div class="toolbar">
        <button class="btn primary" data-act="duty-new">+ ডিউটি</button>
        <button class="btn" data-act="duty-generate">🔁 রোস্টার তৈরি</button></div>\` : ''}
      \${monthNav()}
      <div class="toolbar">
        <select data-chg="duty-filter">
          <option value="" \${type === '' ? 'selected' : ''}>সব ডিউটি</option>
          <option value="bazar" \${type === 'bazar' ? 'selected' : ''}>🛒 বাজার</option>
          <option value="clean" \${type === 'clean' ? 'selected' : ''}>🚿 ওয়াশরুম পরিষ্কার</option>
        </select>
      </div>
      <div class="card"><div class="list">\${list.length ? list.map(dutyItem).join('') : '<div class="empty">এই মাসে কোনো ডিউটি নেই</div>'}</div></div>\`;
  }
};
CHG['duty-filter'] = el => go('duty', { type: el.value });

/* ---------------- রিপোর্ট ---------------- */
PAGES.report = {
  title: 'মাসিক রিপোর্ট', short: 'রিপোর্ট', icon: '📊', roles: ALL,
  async render(v, p) {
    const r = await call('report.month', { month: S.month || thisMonth(), matrix: !!p.matrix });
    const rows = r.members.map(m => \`<tr \${m.userId === S.user.id ? 'style="background:var(--primary-soft)"' : ''}>
        <td>\${esc(m.name)}</td><td class="num">\${bn(m.lunch)}+\${bn(m.dinner)}=\${bn(m.meals)}</td>
        <td class="num">\${tk(m.mealCost)}</td><td class="num">\${tk(m.sharedCost)}</td><td class="num">\${tk(m.totalCost)}</td>
        <td class="num">\${tk(m.credit)}\${m.paidBazar ? \`<div class="small muted">বাজার \${tk(m.paidBazar)}</div>\` : ''}</td>
        <td class="num \${balClass(m.balance)}">\${signed(m.balance)}</td></tr>\`).join('');
    const sum = k => r.members.reduce((s, m) => s + Number(m[k]), 0);
    const days = r.days.filter(d => d.lunch || d.dinner);

    v.innerHTML = \`
      \${monthNav()}
      <div class="stats">
        <div class="stat hl"><div class="lbl">মিল রেট</div><div class="val">\${tk(r.mealRate)}</div></div>
        <div class="stat"><div class="lbl">মোট মিল</div><div class="val">\${bn(r.totalMeals)}</div><div class="small muted">দুপুর \${bn(r.totalLunch)} · রাত \${bn(r.totalDinner)}</div></div>
        <div class="stat"><div class="lbl">মোট বাজার</div><div class="val">\${tk(r.totalBazar)}</div></div>
        <div class="stat"><div class="lbl">সাধারণ খরচ</div><div class="val">\${tk(r.totalShared)}</div><div class="small muted">জনপ্রতি \${tk(r.sharedEach)}</div></div>
        <div class="stat"><div class="lbl">মোট জমা</div><div class="val">\${tk(r.totalDeposit)}</div></div>
        <div class="stat"><div class="lbl">ফান্ড থেকে খরচ</div><div class="val">\${tk(r.fundSpent)}</div></div>
        <div class="stat"><div class="lbl">হাতে আছে</div><div class="val \${balClass(r.cashInHand)}">\${tk(r.cashInHand)}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>সদস্যভিত্তিক হিসাব</h3><button class="btn sm" data-act="print">🖨️ প্রিন্ট</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>নাম</th><th class="num">মিল (দু+রা)</th><th class="num">মিল খরচ</th><th class="num">সাধারণ</th>
            <th class="num">মোট খরচ</th><th class="num">জমা</th><th class="num">ব্যালেন্স</th></tr></thead>
          <tbody>\${rows || '<tr><td colspan="7" class="empty">কোনো তথ্য নেই</td></tr>'}</tbody>
          <tfoot><tr><td>মোট</td><td class="num">\${bn(r.totalMeals)}</td><td class="num">\${tk(sum('mealCost'))}</td><td class="num">\${tk(sum('sharedCost'))}</td>
            <td class="num">\${tk(sum('totalCost'))}</td><td class="num">\${tk(sum('credit'))}</td><td class="num">\${signed(sum('balance'))}</td></tr></tfoot>
        </table></div>
        <p class="small muted">ব্যালেন্স + হলে মেস থেকে ফেরত পাবেন, − হলে মেসকে দিতে হবে। জমার মধ্যে নিজের টাকায় করা বাজারও ধরা আছে।</p>
      </div>

      <div class="card">
        <div class="card-head"><h3>দিনভিত্তিক মিল</h3>
          <button class="btn sm" data-act="report-matrix">\${p.matrix ? 'সারসংক্ষেপ' : '📋 পুরো মিল শিট'}</button></div>
        \${p.matrix ? mealSheet(r) : \`<div class="table-wrap"><table>
          <thead><tr><th>তারিখ</th><th class="num">☀️ দুপুর</th><th class="num">🌙 রাত</th><th class="num">মোট</th></tr></thead>
          <tbody>\${days.map(d => \`<tr><td>\${fmtDate(d.date)}</td><td class="num">\${bn(d.lunch)}</td><td class="num">\${bn(d.dinner)}</td><td class="num">\${bn(d.lunch + d.dinner)}</td></tr>\`).join('') ||
            '<tr><td colspan="4" class="empty">কোনো মিল নেই</td></tr>'}</tbody></table></div>\`}
      </div>\`;
  }
};

function mealSheet(r) {
  const head = r.days.map(d => \`<th>\${bn(Number(d.date.slice(8)))}</th>\`).join('');
  const body = r.members.map(m => {
    const row = (r.matrix || {})[m.userId] || {};
    return \`<tr><td>\${esc(m.name)}</td>\${r.days.map(d => {
      const c = row[d.date];
      return \`<td>\${c ? bn(c[0]) + '/' + bn(c[1]) : '<span class="muted">–</span>'}</td>\`;
    }).join('')}<td><b>\${bn(m.meals)}</b></td></tr>\`;
  }).join('');
  return \`<p class="small muted" style="margin-top:0">প্রতিটি ঘরে দুপুর/রাত</p>
    <div class="table-wrap"><table class="sheet"><thead><tr><th>নাম</th>\${head}<th>মোট</th></tr></thead><tbody>\${body}</tbody></table></div>\`;
}

ACT['report-matrix'] = () => go('report', S.params.matrix ? {} : { matrix: 1 });
ACT.print = () => window.print();

/* ---------------- প্রোফাইল ---------------- */
PAGES.profile = {
  title: 'প্রোফাইল', icon: '👤', roles: ALL,
  async render(v) {
    const u = S.user;
    v.innerHTML = \`
      <div class="card">
        <h3>\${esc(u.name)} <span class="badge">\${ROLE_LABEL[u.role]}</span></h3>
        <div class="list">
          <div class="item"><span class="grow muted">ইউজারনেম</span><span>\${esc(u.username)}</span></div>
          <div class="item"><span class="grow muted">রুম</span><span>\${esc(u.room || '—')}</span></div>
          <div class="item"><span class="grow muted">ফোন</span><span>\${esc(u.phone || '—')}</span></div>
        </div>
      </div>
      <div class="card">
        <h3>পাসওয়ার্ড পরিবর্তন</h3>
        <form id="pwForm" class="stack">
          <label>বর্তমান পাসওয়ার্ড<input type="password" name="oldPassword" required autocomplete="current-password"></label>
          <label>নতুন পাসওয়ার্ড<input type="password" name="newPassword" required minlength="6" autocomplete="new-password"></label>
          <button class="btn primary" type="submit">পরিবর্তন করুন</button>
        </form>
      </div>
      <button class="btn danger block" data-act="logout">🚪 লগআউট</button>\`;
    $('#pwForm').onsubmit = async e => {
      e.preventDefault();
      const res = await call('me.password', formData(e.target)).catch(() => null);
      if (!res) return;
      S.token = res.token;
      store.set('token', res.token);
      e.target.reset();
      toast('পাসওয়ার্ড পরিবর্তন হয়েছে', 'ok');
    };
  }
};
</script>

  <script>
/* =========================================================
   ম্যানেজার ও অ্যাডমিন: মিল এন্ট্রি, খরচ, জমা, মেমো যাচাই,
   ডিউটি রোস্টার, সদস্য ও সেটিংস
   ========================================================= */

/* ---------------- দিনভিত্তিক মিল এন্ট্রি ---------------- */
function dayMealBody() {
  const st = S.day;
  let l = 0, d = 0;
  st.rows.forEach(r => { l += r.lunch; d += r.dinner; });
  return \`<div class="list">\${st.rows.map(r => \`<div class="meal-day">
      <div class="d"><strong>\${esc(r.name)}</strong><span class="small muted">\${esc(r.room || '')}
        \${r.isDefault && !st.dirty ? '<span class="badge gray">ডিফল্ট</span>' : ''}</span></div>
      \${stepper('day-step', r.userId, 'lunch', r.lunch, false, 20)}
      \${stepper('day-step', r.userId, 'dinner', r.dinner, false, 20)}
    </div>\`).join('') || '<div class="empty">কোনো সক্রিয় সদস্য নেই</div>'}</div>
    <div class="grid2" style="margin-top:12px">
      <div class="stat hl"><div class="lbl">☀️ দুপুর মোট</div><div class="val">\${bn(l)}</div></div>
      <div class="stat hl"><div class="lbl">🌙 রাত মোট</div><div class="val">\${bn(d)}</div></div>
    </div>\`;
}

PAGES.daymeal = {
  title: 'মিল এন্ট্রি (দিনভিত্তিক)', short: 'মিল এন্ট্রি', icon: '📝', roles: MGR,
  async render(v) {
    S.date = S.date || todayStr();
    S.day = await call('meals.day', { date: S.date });
    S.day.dirty = false;
    v.innerHTML = \`
      <div class="card">
        <div class="switcher">
          <button class="btn sm" data-act="day-shift" data-n="-1">‹</button>
          <input type="date" value="\${S.date}" data-chg="day-pick" style="flex:1">
          <button class="btn sm" data-act="day-shift" data-n="1">›</button>
        </div>
        <p class="small muted center" style="margin:0">\${fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <div class="card">
        <div class="toolbar">
          <button class="btn sm" data-act="day-all" data-slot="lunch" data-v="1">সবার দুপুর ✓</button>
          <button class="btn sm" data-act="day-all" data-slot="dinner" data-v="1">সবার রাত ✓</button>
          <button class="btn sm danger" data-act="day-all" data-slot="both" data-v="0">সব বন্ধ</button>
        </div>
        <div id="dayBody">\${dayMealBody()}</div>
        <button class="btn primary block" style="margin-top:12px" data-act="day-save">💾 সেভ করুন</button>
      </div>\`;
  }
};

ACT['day-shift'] = el => { S.date = addDays(S.date, Number(el.dataset.n)); refresh(); };
CHG['day-pick'] = el => { if (el.value) { S.date = el.value; refresh(); } };
ACT['day-step'] = el => {
  const r = S.day.rows.filter(x => x.userId === el.dataset.date)[0];   // data-date এখানে userId বহন করে
  r[el.dataset.slot] = Math.max(0, Math.min(20, r[el.dataset.slot] + Number(el.dataset.n)));
  S.day.dirty = true;
  $('#dayBody').innerHTML = dayMealBody();
};
ACT['day-all'] = el => {
  const v = Number(el.dataset.v), slot = el.dataset.slot;   // lunch | dinner | both
  S.day.rows.forEach(r => {
    if (slot !== 'dinner') r.lunch = v;
    if (slot !== 'lunch') r.dinner = v;
  });
  S.day.dirty = true;
  $('#dayBody').innerHTML = dayMealBody();
};
ACT['day-save'] = async () => {
  S.day = await call('meals.saveDay', { date: S.date, entries: S.day.rows.map(r => ({ userId: r.userId, lunch: r.lunch, dinner: r.dinner })) });
  S.day.dirty = false;
  $('#dayBody').innerHTML = dayMealBody();
  toast(fmtDate(S.date) + ' এর মিল সেভ হয়েছে', 'ok');
};

/* ---------------- খরচ ---------------- */
PAGES.expense = {
  title: 'বাজার ও খরচ', short: 'খরচ', icon: '💸', roles: ALL,
  async render(v) {
    const list = await call('expenses.list', { month: S.month || thisMonth() });
    S.expenses = list;
    let bazar = 0, shared = 0;
    list.forEach(e => { if (e.type === 'shared') shared += Number(e.amount); else bazar += Number(e.amount); });
    v.innerHTML = \`
      \${isMgr() ? '<div class="toolbar"><button class="btn primary" data-act="exp-edit">+ খরচ যোগ করুন</button></div>' : ''}
      \${monthNav()}
      <div class="grid2" style="margin-bottom:14px">
        <div class="stat"><div class="lbl">🛒 বাজার (মিলের)</div><div class="val">\${tk(bazar)}</div></div>
        <div class="stat"><div class="lbl">🏠 সাধারণ খরচ</div><div class="val">\${tk(shared)}</div></div>
      </div>
      <div class="card"><div class="list">\${list.length ? list.map(e => \`<div class="item">
        <div class="grow">
          <div class="title">\${esc(e.description || (e.type === 'shared' ? 'সাধারণ খরচ' : 'বাজার'))}</div>
          <div class="sub">\${fmtDate(e.date)} · <span class="badge \${e.type === 'shared' ? 'gray' : ''}">\${e.type === 'shared' ? 'সাধারণ' : 'বাজার'}</span>
            \${e.paidBy ? ' · নিজের টাকায়: ' + esc(e.paidByName) : ' · ফান্ড থেকে'}</div>
        </div>
        <span class="amount">\${tk(e.amount)}</span>
        \${e.hasImage ? \`<button class="btn sm" data-act="show-image" data-kind="expense" data-id="\${e.id}">🖼️</button>\` : ''}
        \${isMgr() ? \`<button class="btn sm" data-act="exp-edit" data-id="\${e.id}">✎</button>\` : ''}
      </div>\`).join('') : '<div class="empty">এই মাসে কোনো খরচ নেই</div>'}</div></div>\`;
  }
};

ACT['exp-edit'] = async el => {
  const users = await getUsers();
  const e = (S.expenses || []).filter(x => x.id === el.dataset.id)[0] || { date: todayStr(), type: 'bazar' };
  openModal(e.id ? 'খরচ সম্পাদনা' : 'নতুন খরচ', \`<form class="stack">
      <div class="grid2">
        <label>তারিখ<input type="date" name="date" value="\${e.date}" required></label>
        <label>ধরন<select name="type">
          <option value="bazar" \${e.type !== 'shared' ? 'selected' : ''}>🛒 বাজার (মিলের)</option>
          <option value="shared" \${e.type === 'shared' ? 'selected' : ''}>🏠 সাধারণ (সমান ভাগ)</option></select></label>
      </div>
      <label>টাকা<input type="number" name="amount" step="0.01" inputmode="decimal" value="\${e.amount || ''}" required></label>
      <label>বিবরণ<input name="description" value="\${esc(e.description || '')}" placeholder="যেমন: মাছ, সবজি / গ্যাস বিল"></label>
      <label>টাকা কে দিয়েছে<select name="paidBy">\${userOptions(users, e.paidBy, 'মেস ফান্ড (ম্যানেজার) থেকে')}</select></label>
      <p class="small muted" style="margin:-6px 0 0">সদস্য নিজের পকেট থেকে দিলে তাকে বেছে নিন — টাকাটা তার জমায় যোগ হবে।</p>
      <label>মেমোর ছবি (ঐচ্ছিক)<input type="file" accept="image/*" data-chg="preview" data-target="expPrev"></label>
      <div id="expPrev"></div>
      <div class="row">
        \${e.id ? '<button type="button" class="btn danger" data-act="exp-delete" data-id="' + e.id + '">মুছুন</button>' : ''}
        <button class="btn primary" type="submit">সেভ</button>
      </div></form>\`, async (data, form) => {
    data.id = e.id || '';
    data.image = await imageFromForm(form);
    await call('expenses.save', data);
    toast('খরচ সেভ হয়েছে', 'ok');
    S.month = data.date.slice(0, 7);
    refresh();
  });
};

ACT['exp-delete'] = async el => {
  if (!(await confirmBox('এই খরচটি মুছে ফেলবেন?', 'মুছুন'))) return;
  await call('expenses.delete', { id: el.dataset.id });
  toast('খরচ মুছে ফেলা হয়েছে', 'ok');
  refresh();
};

/* ---------------- জমা ---------------- */
PAGES.deposit = {
  title: 'টাকা জমা', short: 'জমা', icon: '💰', roles: ALL,
  async render(v) {
    const list = await call('deposits.list', { month: S.month || thisMonth() });
    S.deposits = list;
    const total = list.reduce((s, d) => s + Number(d.amount), 0);
    v.innerHTML = \`
      \${isMgr() ? '<div class="toolbar"><button class="btn primary" data-act="dep-edit">+ জমা যোগ করুন</button></div>' : ''}
      \${monthNav()}
      <div class="card">
        <div class="card-head"><h3>\${isMgr() ? 'মোট জমা' : 'আমার জমা'}</h3><span class="amount">\${tk(total)}</span></div>
        <div class="list">\${list.length ? list.map(d => \`<div class="item">
          <div class="grow"><div class="title">\${esc(d.name)}</div>
            <div class="sub">\${fmtDate(d.date)}\${d.note ? ' · ' + esc(d.note) : ''}</div></div>
          <span class="amount \${d.amount < 0 ? 'neg' : ''}">\${tk(d.amount)}</span>
          \${isMgr() ? \`<button class="btn sm" data-act="dep-edit" data-id="\${d.id}">✎</button>\` : ''}
        </div>\`).join('') : '<div class="empty">এই মাসে কোনো জমা নেই</div>'}</div>
      </div>\`;
  }
};

ACT['dep-edit'] = async el => {
  const users = await getUsers();
  const d = (S.deposits || []).filter(x => x.id === el.dataset.id)[0] || { date: todayStr() };
  openModal(d.id ? 'জমা সম্পাদনা' : 'নতুন জমা', \`<form class="stack">
      <label>সদস্য<select name="userId" required>\${userOptions(users, d.userId, 'বেছে নিন')}</select></label>
      <div class="grid2">
        <label>তারিখ<input type="date" name="date" value="\${d.date}" required></label>
        <label>টাকা<input type="number" name="amount" step="0.01" inputmode="decimal" value="\${d.amount || ''}" required></label>
      </div>
      <label>নোট (ঐচ্ছিক)<input name="note" value="\${esc(d.note || '')}" placeholder="যেমন: বিকাশে / নগদ"></label>
      <p class="small muted" style="margin:-6px 0 0">টাকা ফেরত দিলে বা আগের মাসের বাকি সমন্বয় করতে − (মাইনাস) দিন।</p>
      <div class="row">
        \${d.id ? '<button type="button" class="btn danger" data-act="dep-delete" data-id="' + d.id + '">মুছুন</button>' : ''}
        <button class="btn primary" type="submit">সেভ</button>
      </div></form>\`, async data => {
    data.id = d.id || '';
    await call('deposits.save', data);
    toast('জমা সেভ হয়েছে', 'ok');
    S.month = data.date.slice(0, 7);
    refresh();
  });
};

ACT['dep-delete'] = async el => {
  if (!(await confirmBox('এই জমাটি মুছে ফেলবেন?', 'মুছুন'))) return;
  await call('deposits.delete', { id: el.dataset.id });
  toast('জমা মুছে ফেলা হয়েছে', 'ok');
  refresh();
};

/* ---------------- মেমো যাচাই ---------------- */
ACT['memo-review'] = async el => {
  const list = await call('memos.list', { month: S.month || thisMonth() }, { silent: true });
  const m = list.filter(x => x.id === el.dataset.id)[0];
  if (!m) return;
  const src = m.hasImage ? await call('image.get', { kind: 'memo', id: m.id }) : '';
  openModal('মেমো যাচাই — ' + m.name, \`<form class="stack">
      \${src ? \`<img class="memo" src="\${src}" alt="মেমো">\` : ''}
      <p class="small muted" style="margin:0">\${fmtDate(m.date)} · সদস্যের দেওয়া: \${tk(m.amount)}\${m.note ? ' · ' + esc(m.note) : ''}</p>
      <div class="grid2">
        <label>অনুমোদিত টাকা<input type="number" name="amount" step="0.01" value="\${m.amount}" required></label>
        <label>ধরন<select name="type"><option value="bazar">🛒 বাজার</option><option value="shared">🏠 সাধারণ</option></select></label>
      </div>
      <label>বিবরণ<input name="description" value="\${esc(m.note || 'বাজার')}"></label>
      <label class="check"><input type="checkbox" name="paidByMember" checked> \${esc(m.name)} নিজের টাকায় বাজার করেছে (তার জমায় যোগ হবে)</label>
      <div class="row">
        <button type="button" class="btn danger" data-act="memo-reject" data-id="\${m.id}">✕ বাতিল</button>
        <button type="submit" class="btn primary">✓ অনুমোদন</button>
      </div></form>\`, async data => {
    data.id = m.id;
    data.action = 'approve';
    await call('memos.review', data);
    toast('মেমো অনুমোদিত — খরচে যোগ হয়েছে', 'ok');
    refresh();
  });
};

ACT['memo-reject'] = async el => {
  await call('memos.review', { id: el.dataset.id, action: 'reject' });
  closeModal();
  toast('মেমো বাতিল করা হয়েছে');
  refresh();
};

/* ---------------- ডিউটি ব্যবস্থাপনা ---------------- */
ACT['duty-new'] = el => dutyForm(null);
ACT['duty-edit'] = async el => {
  const list = await call('duties.list', { month: S.month || thisMonth() }, { silent: true });
  dutyForm(list.filter(t => t.id === el.dataset.id)[0]);
};

async function dutyForm(t) {
  const users = await getUsers();
  t = t || { type: 'bazar', date: todayStr(), status: 'pending' };
  openModal(t.id ? 'ডিউটি সম্পাদনা' : 'নতুন ডিউটি', \`<form class="stack">
      <div class="grid2">
        <label>ধরন<select name="type">
          <option value="bazar" \${t.type === 'bazar' ? 'selected' : ''}>🛒 বাজার</option>
          <option value="clean" \${t.type === 'clean' ? 'selected' : ''}>🚿 পরিষ্কার</option></select></label>
        <label>তারিখ<input type="date" name="date" value="\${t.date}" required></label>
      </div>
      <label>সদস্য<select name="userId" required>\${userOptions(users, t.userId, 'বেছে নিন')}</select></label>
      <div class="grid2">
        <label>জায়গা (পরিষ্কারের জন্য)<input name="area" value="\${esc(t.area || '')}" placeholder="ওয়াশরুম"></label>
        <label>অবস্থা<select name="status">
          <option value="pending" \${t.status === 'pending' ? 'selected' : ''}>বাকি</option>
          <option value="done" \${t.status === 'done' ? 'selected' : ''}>সম্পন্ন</option>
          <option value="missed" \${t.status === 'missed' ? 'selected' : ''}>মিস</option></select></label>
      </div>
      <label>নোট<input name="note" value="\${esc(t.note || '')}"></label>
      <div class="row">
        \${t.id ? '<button type="button" class="btn danger" data-act="duty-delete" data-id="' + t.id + '">মুছুন</button>' : ''}
        <button class="btn primary" type="submit">সেভ</button>
      </div></form>\`, async data => {
    data.id = t.id || '';
    await call('duties.save', data);
    toast('ডিউটি সেভ হয়েছে', 'ok');
    S.month = data.date.slice(0, 7);
    refresh();
  });
}

ACT['duty-delete'] = async el => {
  if (!(await confirmBox('এই ডিউটিটি মুছে ফেলবেন?', 'মুছুন'))) return;
  await call('duties.delete', { id: el.dataset.id });
  toast('ডিউটি মুছে ফেলা হয়েছে', 'ok');
  refresh();
};

ACT['duty-generate'] = async () => {
  const users = (await getUsers()).filter(u => u.active === '1');
  const start = (S.month || thisMonth()) + '-01';
  const end = shiftMonth(S.month || thisMonth(), 1) + '-01';
  openModal('পালাক্রমে রোস্টার তৈরি', \`<form class="stack">
      <div class="grid2">
        <label>ধরন<select name="type"><option value="bazar">🛒 বাজার</option><option value="clean">🚿 ওয়াশরুম পরিষ্কার</option></select></label>
        <label>কত দিন পরপর<input type="number" name="every" min="1" max="31" value="1" required></label>
      </div>
      <div class="grid2">
        <label>শুরু<input type="date" name="from" value="\${start}" required></label>
        <label>শেষ<input type="date" name="to" value="\${addDays(end, -1)}" required></label>
      </div>
      <label>জায়গা (পরিষ্কারের জন্য)<input name="area" placeholder="ওয়াশরুম"></label>
      <div><div class="small muted" style="margin-bottom:4px">সদস্য (এই ক্রমে পালা আসবে)</div>
        \${users.map(u => \`<label class="check"><input type="checkbox" name="userIds[]" value="\${esc(u.id)}" checked> \${esc(u.name)}</label>\`).join('')}</div>
      <label class="check"><input type="checkbox" name="replace" checked> এই সময়ের আগের "বাকি" ডিউটি মুছে নতুন বানাও</label>
      <button class="btn primary" type="submit">রোস্টার তৈরি করুন</button></form>\`, async (data, form) => {
    data.userIds = $$('input[name="userIds[]"]:checked', form).map(c => c.value);
    delete data['userIds[]'];
    const res = await call('duties.generate', data);
    toast(bn(res.created) + 'টি ডিউটি তৈরি হয়েছে', 'ok');
    S.month = data.from.slice(0, 7);
    go('duty', { type: data.type });
  });
};

/* ---------------- সদস্য (অ্যাডমিন) ---------------- */
PAGES.users = {
  title: 'সদস্য ও রোল', short: 'সদস্য', icon: '👥', roles: ADM,
  async render(v) {
    const users = await getUsers(true);
    v.innerHTML = \`
      <div class="toolbar"><button class="btn primary" data-act="user-edit">+ নতুন সদস্য</button></div>
      <div class="card">
        <p class="small muted" style="margin-top:0"><b>অ্যাডমিন</b> সব পারে ও রোল ঠিক করে · <b>ম্যানেজার</b> হিসাব, খরচ, জমা, ডিউটি দেখে ·
          <b>সদস্য</b> নিজের মিল দেয়, মেমো আপলোড করে ও হিসাব দেখে।</p>
        <div class="list">\${users.map(u => \`<div class="item">
          <div class="grow">
            <div class="title">\${esc(u.name)} <span class="badge \${u.role === 'member' ? 'gray' : ''}">\${ROLE_LABEL[u.role]}</span>
              \${u.active !== '1' ? '<span class="badge danger">বন্ধ</span>' : ''}</div>
            <div class="sub">@\${esc(u.username)}\${u.room ? ' · রুম ' + esc(u.room) : ''}\${u.phone ? ' · ' + esc(u.phone) : ''}</div>
          </div>
          <button class="btn sm" data-act="user-edit" data-id="\${u.id}">✎ সম্পাদনা</button>
        </div>\`).join('')}</div>
      </div>\`;
  }
};

ACT['user-edit'] = async el => {
  const u = (await getUsers()).filter(x => x.id === el.dataset.id)[0] || { role: 'member', active: '1' };
  const roleOpt = r => \`<option value="\${r}" \${u.role === r ? 'selected' : ''}>\${ROLE_LABEL[r]}</option>\`;
  openModal(u.id ? 'সদস্য সম্পাদনা' : 'নতুন সদস্য', \`<form class="stack">
      <label>নাম<input name="name" value="\${esc(u.name || '')}" required></label>
      <label>ইউজারনেম (লগইনের জন্য)<input name="username" value="\${esc(u.username || '')}" required autocapitalize="none" placeholder="যেমন: rahim বা মোবাইল নম্বর"></label>
      <label>\${u.id ? 'নতুন পাসওয়ার্ড (রিসেট করতে চাইলে)' : 'পাসওয়ার্ড'}<input name="password" type="text" minlength="6" \${u.id ? '' : 'required'} autocomplete="off"></label>
      <div class="grid2">
        <label>রোল<select name="role">\${roleOpt('member')}\${roleOpt('manager')}\${roleOpt('admin')}</select></label>
        <label>অবস্থা<select name="active">
          <option value="1" \${u.active === '1' ? 'selected' : ''}>সক্রিয়</option>
          <option value="0" \${u.active !== '1' ? 'selected' : ''}>বন্ধ (মেস ছেড়েছে)</option></select></label>
      </div>
      <div class="grid2">
        <label>রুম<input name="room" value="\${esc(u.room || '')}"></label>
        <label>ফোন<input name="phone" type="tel" value="\${esc(u.phone || '')}"></label>
      </div>
      <button class="btn primary" type="submit">সেভ</button></form>\`, async data => {
    data.id = u.id || '';
    S.users = await call('users.save', data);
    toast('সদস্য সেভ হয়েছে' + (data.password ? ' — পাসওয়ার্ডটি সদস্যকে জানিয়ে দিন' : ''), 'ok');
    refresh();
  });
};

/* ---------------- সেটিংস (অ্যাডমিন) ---------------- */
PAGES.settings = {
  title: 'সেটিংস', icon: '⚙️', roles: ADM,
  async render(v) {
    const me = await call('me.get');
    const s = me.settings;
    v.innerHTML = \`
      <div class="card">
        <form id="setForm" class="stack">
          <label>মেসের নাম<input name="messName" value="\${esc(s.messName)}" required></label>
          <div class="grid2">
            <label>দুপুরের মিল বন্ধের শেষ সময়<input type="time" name="lunchCutoff" value="\${esc(s.lunchCutoff)}" required></label>
            <label>রাতের মিল বন্ধের শেষ সময়<input type="time" name="dinnerCutoff" value="\${esc(s.dinnerCutoff)}" required></label>
          </div>
          <label>এক বেলায় সর্বোচ্চ মিল (গেস্টসহ)<input type="number" name="maxGuestMeal" min="1" max="20" value="\${esc(s.maxGuestMeal)}"></label>
          <button class="btn primary" type="submit">সেভ করুন</button>
        </form>
      </div>
      <div class="card small muted">সব তথ্য আপনার Google Sheet-এ জমা থাকে (Users, Meals, Expenses, Deposits, Duties, Memos, Settings ট্যাব)।
        মেমোর ছবি Google Drive-এর "Mess Memo Images" ফোল্ডারে থাকে। শিটের হেডার বা কলামের ক্রম বদলাবেন না।</div>\`;
    $('#setForm').onsubmit = async e => {
      e.preventDefault();
      const res = await call('settings.save', formData(e.target)).catch(() => null);
      if (!res) return;
      S.settings = res;
      $('#messName').textContent = res.messName;
      toast('সেটিংস সেভ হয়েছে', 'ok');
    };
  }
};
</script>

</body>
</html>
`;
