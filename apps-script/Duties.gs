/**
 * Duty roster: bazar days and washroom cleaning days.
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
  if (!findById_('Users', d.userId)) throw new Error('Choose a member');
  const area = clean_(d.area, 60) || (type === 'clean' ? 'Washroom' : '');
  const status = DUTY_STATUS.indexOf(d.status) > -1 ? d.status : 'pending';

  if (d.id) {
    const t = findById_('Duties', d.id);
    if (!t) throw new Error('Duty not found');
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
  if (!t) throw new Error('Duty not found');
  deleteRow_('Duties', t._row);
  return dutiesList_({ month: t.date.slice(0, 7) });
}

/**
 * Builds a rotating roster:
 * { type, from, to, every (days apart), userIds (in turn order), area, replace }
 * With replace = true, pending duties of the same type in that period are removed first.
 */
function dutiesGenerate_(d, me) {
  const type = DUTY_TYPES.indexOf(d.type) > -1 ? d.type : 'bazar';
  const from = requireDate_(d.from, 'Start date');
  const to = requireDate_(d.to, 'End date');
  const every = Math.max(1, Math.min(31, parseInt(d.every, 10) || 1));
  const span = daysBetween_(from, to);
  if (span < 0 || span > 92) throw new Error('A roster can cover at most 92 days at once');

  const valid = {};
  readAll_('Users').forEach(function (u) { if (u.active === '1') valid[u.id] = true; });
  const userIds = (d.userIds || []).filter(function (id) { return valid[id]; });
  if (!userIds.length) throw new Error('Choose at least one member');

  if (d.replace) {
    const sh = sheet_('Duties');
    readAll_('Duties')
      .filter(function (t) { return t.type === type && t.status === 'pending' && t.date >= from && t.date <= to; })
      .map(function (t) { return t._row; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (row) { sh.deleteRow(row); });
    delete _tableCache.Duties;
  }

  const area = clean_(d.area, 60) || (type === 'clean' ? 'Washroom' : '');
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

/** Members can mark their own duty done; managers any duty */
function dutiesStatus_(d, me) {
  const t = findById_('Duties', d.id);
  if (!t) throw new Error('Duty not found');
  const status = DUTY_STATUS.indexOf(d.status) > -1 ? d.status : 'done';
  if (me.role === 'member' && (t.userId !== me.id || status === 'missed')) {
    throw new Error('You can only mark your own duty as done');
  }
  t.status = status;
  t.updatedBy = me.id;
  updateRow_('Duties', t._row, t);
  return dutiesList_({ month: t.date.slice(0, 7) });
}
