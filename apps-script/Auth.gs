/**
 * Login, tokens, profile and member (user) management.
 * Passwords are stored only as SHA-256 + salt hashes, never in plain text.
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

// The signature includes passHash, so changing a password logs out old sessions
function makeToken_(user) {
  const payload = user.id + '.' + (Date.now() + TOKEN_DAYS * 864e5);
  return payload + '.' + sign_(payload + '|' + user.passHash);
}

function authenticate_(token) {
  const fail = new Error('AUTH: Your session has ended, please log in again');
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

/** What the app needs after logging in */
function session_(user, withToken) {
  const out = { user: publicUser_(user), settings: getSettings_(), appUrl: appUrl_() };
  if (withToken) out.token = makeToken_(user);
  return out;
}

function normUsername_(s) {
  const u = String(s || '').trim().toLowerCase();
  if (!/^[a-z0-9_.@-]{3,40}$/.test(u)) {
    throw new Error('Username must be 3+ characters: English letters or numbers (e.g. rahim or 01712345678)');
  }
  return u;
}

function checkPassword_(p) {
  if (String(p || '').length < 4) throw new Error('Password must be at least 4 characters');
  return String(p);
}

/* ---------- Public (no login needed) ---------- */

function authStatus_() {
  return { needsSetup: readAll_('Users').length === 0, messName: getSettings_().messName };
}

/** Creates the very first user (admin). Works only while there are no users. */
function setupAdmin_(d) {
  if (readAll_('Users').length > 0) throw new Error('The admin already exists, please log in');
  const user = newUser_({
    name: d.name, username: d.username, password: d.password,
    role: 'admin', phone: d.phone, room: d.room
  });
  if (d.messName) settingsSave_({ messName: d.messName });
  insertRows_('Users', [user]);

  // First-run setup that used to need a manual setup() run
  try { secret_(); memoFolder_(); ensureTrigger_(); } catch (e) { console.warn('Auto setup: ' + e.message); }

  return session_(user, true);
}

function login_(d) {
  const username = String(d.username || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Too many wrong attempts. Please try again in 30 minutes.');

  const user = readAll_('Users').filter(function (u) { return u.username === username; })[0];
  if (!user || hash_(String(d.password || ''), user.salt) !== user.passHash) {
    cache.put(failKey, String(fails + 1), 1800);
    throw new Error('Username or password is incorrect');
  }
  if (user.active !== '1') throw new Error('Your account is deactivated. Please contact the admin.');
  cache.remove(failKey);
  return session_(user, true);
}

/* ---------- Own profile ---------- */

function meGet_(d, me) {
  return session_(me, false);
}

function changePassword_(d, me) {
  if (hash_(String(d.oldPassword || ''), me.salt) !== me.passHash) throw new Error('Current password is incorrect');
  me.salt = uid_();
  me.passHash = hash_(checkPassword_(d.newPassword), me.salt);
  updateRow_('Users', me._row, me);
  return { token: makeToken_(me) };
}

/** Default meals: whether meals are switched on automatically every day */
function savePrefs_(d, me) {
  me.autoLunch = d.autoLunch ? '1' : '0';
  me.autoDinner = d.autoDinner ? '1' : '0';
  updateRow_('Users', me._row, me);
  fillAutoMeals_([addDays_(today_(), 1)], me.id, true);
  return publicUser_(me);
}

/* ---------- Member management (admin) ---------- */

function newUser_(d) {
  const salt = uid_();
  const role = ROLES.indexOf(d.role) > -1 ? d.role : 'member';
  const name = clean_(d.name, 60);
  if (!name) throw new Error('Enter a name');
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
  if (taken) throw new Error('This username is already taken');

  if (!d.id) {
    const user = newUser_(d);
    insertRows_('Users', [user]);
    fillAutoMeals_([addDays_(today_(), 1)], user.id, false);
    return usersList_(d, me);
  }

  const u = users.filter(function (x) { return x.id === d.id; })[0];
  if (!u) throw new Error('Member not found');
  const role = ROLES.indexOf(d.role) > -1 ? d.role : u.role;
  const active = d.active === '0' ? '0' : '1';
  if (u.id === me.id && (role !== 'admin' || active !== '1')) {
    throw new Error('You cannot remove your own admin role or deactivate your own account');
  }
  const name = clean_(d.name, 60);
  if (!name) throw new Error('Enter a name');

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
