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
