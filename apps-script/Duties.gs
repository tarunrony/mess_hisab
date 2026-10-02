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
