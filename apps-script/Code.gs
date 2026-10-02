/**
 * Mess Meal Manager — Google Apps Script backend
 *
 * Database: the Google Sheet this script is attached to (Extensions → Apps Script).
 * Deploy:   Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Sheets, the memo photo folder and the daily auto-meal trigger are created
 * automatically on first use — running setup() by hand is optional.
 */

const APP_NAME = 'Mess Meal Manager';
const APP_TZ = 'Asia/Dhaka';
const TOKEN_DAYS = 30;

/** Serves the app when the Web App URL is opened */
function doGet() {
  let messName = APP_NAME;
  try { messName = getSettings_().messName || APP_NAME; } catch (e) { /* first run */ }
  return HtmlService.createHtmlOutput(pageHtml_(messName))
    .setTitle(messName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}

// BUILD:PAGE-START — in the single-file version (deploy/Code.gs) this block is replaced by embedded HTML
// ⚠️ This file alone is not enough in Apps Script — for a single-file install use deploy/Code.gs.
/** Builds the full page from Index.html and the Styles/Js files it includes */
function pageHtml_(messName) {
  let t;
  try {
    t = HtmlService.createTemplateFromFile('Index');
  } catch (e) {
    throw new Error('Index file not found. For a single-file install, paste the whole of deploy/Code.gs instead.');
  }
  t.messName = messName;
  return t.evaluate().getContent();
}

/** Inserts another HTML file inside a template */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
// BUILD:PAGE-END

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Every request from the frontend comes here (google.script.run.api or doPost).
 * Returns { ok: true, data } or { ok: false, error }
 */
function api(action, token, data) {
  let lock = null;
  try {
    const route = routes_()[action];
    if (!route) throw new Error('Unknown request: ' + action);

    let user = null;
    if (route.roles) {
      user = authenticate_(token);
      if (route.roles.indexOf(user.role) === -1) throw new Error('You do not have permission to do this');
    }

    if (route.write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) throw new Error('Server is busy, please try again in a moment');
    }

    const payload = data && typeof data === 'object' ? data : {};
    return { ok: true, data: route.fn(payload, user) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** Same API over HTTP, used by the Vercel / static-site version */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (x) { /* empty body */ }
  const res = api(body.action, body.token, body.data);
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** Who may call what */
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
 * Optional manual setup (select "setup" in the editor and press Run).
 * The same things also happen automatically when the first admin is created.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Google Sheet and run setup from Extensions → Apps Script');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  ensureSheets_(ss);
  props.setProperty('SCHEMA_V', SCHEMA_VERSION);
  secret_();
  memoFolder_();
  ensureTrigger_();
  Logger.log('✅ Setup complete. Now use Deploy → New deployment → Web app.');
}

/** Daily job (~12:30 AM) that fills in default meals for today and tomorrow */
function ensureTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'autoMealJob';
  });
  if (!exists) {
    ScriptApp.newTrigger('autoMealJob').timeBased().everyDays(1).atHour(0).nearMinute(30).inTimezone(APP_TZ).create();
  }
}

/** Web App URL, used for the "share login details" message */
function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
