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
