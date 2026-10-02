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
