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
