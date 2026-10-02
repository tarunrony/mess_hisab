# 🍛 Mess Meal Manager

A simple web app for a shared mess (about 10 members): daily meals, bazar (grocery) costs, deposits, bazar and washroom-cleaning duties, and bazar memo photos.
It runs on **Google Apps Script** and keeps all data in your own **Google Sheet** — no server, no cost.

- Two meals a day: ☀️ lunch and 🌙 dinner (guests count as extra meals)
- Works well on phones; can also run on a nicer **Vercel** link

---

## Roles

| What | Member | Manager | Admin |
|---|:-:|:-:|:-:|
| Switch own meals on/off (one tap on Home) | ✅ | ✅ | ✅ |
| Upload a bazar memo photo | ✅ | ✅ | ✅ |
| Mark own duty as done | ✅ | ✅ | ✅ |
| See the monthly report, expenses and duties | ✅ | ✅ | ✅ |
| Enter / fix everyone's meals for any day | – | ✅ | ✅ |
| Add / edit expenses and deposits | – | ✅ | ✅ |
| Review memos (approve / reject) | – | ✅ | ✅ |
| Make bazar and cleaning rosters | – | ✅ | ✅ |
| Add members, set roles, reset passwords | – | – | ✅ |
| Settings (meal cut-off times etc.) | – | – | ✅ |

## How the accounts work

```
Meal rate    = total bazar cost of the month ÷ total meals of the month
Meal cost    = your meals × meal rate
Shared share = total shared costs (gas, maid, electricity...) ÷ number of members
Paid         = cash deposits + bazar you paid from your own pocket
Balance      = paid − (meal cost + shared share)
```

A **+** balance means the member gets money back; **−** means they still have to pay.
"Cash with manager" = total deposits − costs paid from the mess fund.

---

## Install (about 5 minutes)

1. **Make a Google Sheet** — open [sheets.new](https://sheets.new) and give it a name, e.g. `Mess Accounts`.
2. **Paste the code** — in the Sheet open **Extensions → Apps Script**. Delete everything in `Code.gs`, paste the whole of [`deploy/Code.gs`](deploy/Code.gs) (on GitHub: open it → **Raw** → Ctrl+A, Ctrl+C) and press **Ctrl+S**.
3. **Deploy** — **Deploy → New deployment →** ⚙️ **Web app**, set **Execute as: Me** and **Who has access: Anyone**, press **Deploy** and allow the permissions (if you see "Google hasn't verified this app": **Advanced → Go to … (unsafe) → Allow** — it is your own script).
4. **Open the Web app URL** and create the admin account. The sheets, the Drive folder for memo photos and the nightly auto-meal job are set up automatically.
5. **Add members** from **Members & roles**. After saving, the app offers to send each person their login on **WhatsApp** or copy it. Give one person the **Manager** role.

> ⚠️ Create the admin account **before** sharing the link — until then, whoever opens it first can become admin.
> "Anyone" access is safe after that: nothing can be seen without logging in, and only you can open the Sheet.

### Updating the code later

Paste the new `deploy/Code.gs`, save, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
This keeps the **same URL**. Making a *New deployment* creates a new URL, and the old links (and the Vercel site) stop getting updates.

---

## Optional: a nicer link on Vercel

The page is served from Vercel, while all data still comes from your Google Sheet (through the Apps Script `doPost` API).

1. Finish the install above and create the admin account.
2. Put your Web App URL in [`public/config.js`](public/config.js) — you can edit it directly on GitHub (✏️ icon). Only change the text between the quotes.
3. Import the GitHub repo in [vercel.com](https://vercel.com) → Framework preset **Other**, no build command ([`vercel.json`](vercel.json) points Vercel to `public/`).

If the Apps Script URL ever changes, just edit `public/config.js` again — Vercel redeploys by itself.

---

## Daily use

**Members**
- **Home → My meals**: tap Lunch / Dinner for today or tomorrow to switch it on or off.
- **My meals**: a whole week at a time; use **+** for guests, or **Many days at once** (e.g. going home for 5 days).
- **Default meals**: when on, your meals are added automatically every day — you only switch off the days you won't eat.
- Today's lunch can be changed until **10:00** and dinner until **17:00** (admin can change these). After that it is locked 🔒 — ask the manager.
- **Memos**: after doing the bazar, upload a photo of the memo with the total. If you had a bazar duty that day, it is marked done automatically.

**Manager**
- **Meal entry**: see and edit everyone's lunch/dinner for any date, then **Save**. The totals at the bottom tell the cook how many meals to make.
- **Memos → Review**: check the photo, fix the amount if needed and **Approve** — it is added to expenses. If the member paid with their own money, keep the tick: it counts as their payment.
- **Expenses**: `Bazar` (goes into the meal rate) or `Shared` (split equally).
- **Deposits**: who paid how much. Use a negative amount for refunds or to carry over last month's due.
- **Duties → Make a roster**: e.g. bazar every 2 days, washroom every 3 days, members taking turns.

---

## Google Sheet layout

| Sheet | Contents |
|---|---|
| `Users` | members, roles, password hashes (never plain passwords), default meals |
| `Meals` | one row per member per day: `lunch`, `dinner` |
| `Expenses` | `bazar` / `shared`, who paid (`paidBy` empty = mess fund) |
| `Deposits` | money paid in |
| `Duties` | bazar (`bazar`) and cleaning (`clean`) duties |
| `Memos` | uploaded memos and their status (`pending/approved/rejected`) |
| `Settings` | mess name, meal cut-off times, max meals per slot |

> Do **not** change the header row or the column order. Memo photos are kept in the Drive folder `Mess Memo Images`; they are not shared publicly — the app shows them itself.

## FAQ

- **Forgot password?** Admin → Members & roles → ✎ Edit → type a new password → share it.
- **Someone left the mess?** Set their status to **Inactive**. Their history stays, but they can no longer log in.
- **Last month's dues or advance?** Each month is calculated separately. Add a + or − deposit for that member in the new month.
- **5 wrong passwords** lock that username for 30 minutes.

---

## For developers

```
deploy/Code.gs      ⭐ the whole app in one file — paste this into Apps Script
public/index.html   the same app for Vercel (generated), loads public/config.js
public/config.js    the Apps Script Web App URL used by the Vercel site (edit by hand)
vercel.json         tells Vercel to serve public/
tools/build.js      builds deploy/Code.gs and public/index.html from apps-script/
apps-script/        source files
  Code.gs           doGet/doPost, API router, optional setup()
  Db.gs             Google Sheet helpers, settings, dates
  Auth.gs           login, tokens, passwords, members
  Meals.gs          meals, cut-off times, nightly auto-meal job
  Finance.gs        expenses, deposits, memos and photos (Drive)
  Duties.gs         bazar and cleaning duties, rosters
  Report.gs         monthly report and home dashboard
  Index.html        page structure
  Styles.html       design (mobile + dark mode)
  JsCore.html       API calls, login, navigation, sharing logins
  JsPages.html      Home, My meals, Memos, Duties, Report, Profile
  JsManage.html     Meal entry, Expenses, Deposits, Memo review, Members, Settings
  appsscript.json   manifest (only needed when using clasp)
```

After changing anything in `apps-script/`, run:

```bash
node tools/build.js
```

Using [clasp](https://github.com/google/clasp) instead of copy-paste: create `.clasp.json` with `{ "scriptId": "<SCRIPT_ID>", "rootDir": "apps-script" }`, then `clasp login` and `clasp push`.
