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

// BUILD:PAGE-START — এক-ফাইল সংস্করণে (deploy/Code.gs) এই অংশটি এমবেড করা HTML দিয়ে বদলে যায়
// ⚠️ এই ফাইল একা Apps Script-এ পেস্ট করলে চলবে না — এক ফাইলে চালাতে deploy/Code.gs ব্যবহার করুন।
/** Index.html আর তার ভেতরের Styles/Js ফাইলগুলো জুড়ে পুরো পেজ বানায় */
function pageHtml_(messName) {
  let t;
  try {
    t = HtmlService.createTemplateFromFile('Index');
  } catch (e) {
    throw new Error('Index ফাইল পাওয়া যায়নি। এক ফাইলে চালাতে চাইলে deploy/Code.gs এর পুরো কোড পেস্ট করুন।');
  }
  t.messName = messName;
  return t.evaluate().getContent();
}

/** HTML টেমপ্লেটের ভেতরে অন্য HTML ফাইল যুক্ত করে */
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
