/**
 * Expenses (bazar / shared), deposits and bazar memos (receipts).
 *
 * Expense types:
 *   bazar  — groceries for meals; meal rate = total bazar ÷ total meals
 *   shared — common costs (gas, maid, electricity...), split equally between members
 * paidBy: empty = paid from the mess fund; a member id = paid from that member's
 *         own pocket (counted as their deposit)
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

/* ---------- Photos (Google Drive) ---------- */

function memoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* folder was deleted, make a new one */ }
  }
  const folder = DriveApp.createFolder('Mess Memo Images');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

/** img = { data: base64, mime } — returns the Drive file id */
function saveImage_(img, prefix) {
  if (!img || !img.data) return '';
  const bytes = Utilities.base64Decode(String(img.data));
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Photo is too large (max 5 MB)');
  const mime = /^image\/(jpeg|png|webp)$/.test(img.mime) ? img.mime : 'image/jpeg';
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const file = memoFolder_().createFile(Utilities.newBlob(bytes, mime, prefix + '_' + nowStr_().replace(/[: ]/g, '-') + '.' + ext));
  return file.getId();
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
}

/**
 * Shows a photo inside the app — only photos of memos/expenses in the sheet,
 * never any other Drive file. { kind: 'memo' | 'expense', id }
 */
function imageGet_(d) {
  const row = findById_(d.kind === 'expense' ? 'Expenses' : 'Memos', d.id);
  if (!row || !row.fileId) throw new Error('Photo not found');
  const blob = DriveApp.getFileById(row.fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ---------- Expenses ---------- */

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
    if (!e) throw new Error('Expense not found');
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
  if (!e) throw new Error('Expense not found');
  if (e.memoId) {
    // Deleting an expense that came from a memo puts the memo back to "pending"; the photo stays with the memo
    const m = findById_('Memos', e.memoId);
    if (m) { m.status = 'pending'; m.expenseId = ''; m.reviewedBy = ''; updateRow_('Memos', m._row, m); }
  } else {
    trashFile_(e.fileId);
  }
  const month = e.date.slice(0, 7);
  deleteRow_('Expenses', findById_('Expenses', d.id)._row);
  return expensesList_({ month: month });
}

/* ---------- Deposits ---------- */

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

/** { id?, date, userId, amount, note } — a negative amount = refund / adjustment */
function depositsSave_(d, me) {
  const date = requireDate_(d.date);
  if (!findById_('Users', d.userId)) throw new Error('Choose a member');
  const amount = requireAmount_(d.amount);
  const note = clean_(d.note, 200);

  if (d.id) {
    const r = findById_('Deposits', d.id);
    if (!r) throw new Error('Deposit not found');
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
  if (!r) throw new Error('Deposit not found');
  deleteRow_('Deposits', r._row);
  return depositsList_({ month: r.date.slice(0, 7) }, me);
}

/* ---------- Bazar memos ---------- */

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

/** A member does the bazar and uploads the memo photo: { date, amount, note, image } */
function memosUpload_(d, me) {
  const date = requireDate_(d.date);
  const amount = requireAmount_(d.amount);
  if (amount < 0) throw new Error('Enter a valid amount');
  if (!d.image || !d.image.data) throw new Error('Add a photo of the memo');
  const fileId = saveImage_(d.image, 'memo_' + me.username);

  insertRows_('Memos', [{
    id: uid_(), date: date, userId: me.id, amount: amount, note: clean_(d.note, 300),
    fileId: fileId, status: 'pending', expenseId: '', reviewedBy: '', createdAt: nowStr_()
  }]);

  // If this member had a bazar duty that day, mark it done
  readAll_('Duties').forEach(function (t) {
    if (t.type === 'bazar' && t.date === date && t.userId === me.id && t.status !== 'done') {
      t.status = 'done'; t.updatedBy = me.id;
      updateRow_('Duties', t._row, t);
    }
  });
  return memosList_({ month: date.slice(0, 7) }, me);
}

/**
 * Manager reviews a memo:
 * { id, action: 'approve'|'reject', amount?, description?, paidByMember: bool, type? }
 * Approving adds it to the expenses.
 */
function memosReview_(d, me) {
  const m = findById_('Memos', d.id);
  if (!m) throw new Error('Memo not found');
  if (m.status !== 'pending') throw new Error('This memo was already reviewed');

  if (d.action === 'approve') {
    const amount = d.amount ? requireAmount_(d.amount) : m.amount;
    const expenseId = uid_();
    insertRows_('Expenses', [{
      id: expenseId, date: m.date, type: EXPENSE_TYPES.indexOf(d.type) > -1 ? d.type : 'bazar',
      amount: amount, description: clean_(d.description || m.note || 'Bazar (memo)', 300),
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

/** Members can delete their own pending memos; managers any memo that is not approved */
function memosDelete_(d, me) {
  const m = findById_('Memos', d.id);
  if (!m) throw new Error('Memo not found');
  const isMgr = me.role !== 'member';
  if (!isMgr && (m.userId !== me.id || m.status !== 'pending')) throw new Error('You can only delete your own pending memos');
  if (m.status === 'approved') throw new Error('To delete an approved memo, delete its expense first');
  trashFile_(m.fileId);
  deleteRow_('Memos', m._row);
  return memosList_({ month: m.date.slice(0, 7) }, me);
}
