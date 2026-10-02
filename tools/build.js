// Builds the deployable files from apps-script/:
//   deploy/Code.gs     — the whole app in one file, to paste into Apps Script
//   public/index.html  — the same app for Vercel / any static host (reads public/config.js)
// Run: node tools/build.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'deploy', 'Code.gs');
const WEB_OUT = path.join(ROOT, 'public', 'index.html');
const WEB_CONFIG = path.join(ROOT, 'public', 'config.js');
const GS_ORDER = ['Code', 'Db', 'Auth', 'Meals', 'Finance', 'Duties', 'Report'];

const read = name => fs.readFileSync(path.join(SRC, name), 'utf8').replace(/\r\n/g, '\n');
const report = (file, text, extra) =>
  console.log('✅ ' + path.relative(ROOT, file) + ' — ' + Math.round(text.length / 1024) + ' KB' + (extra || ''));

// 1) HTML: resolve include()s into one page
let html = read('Index.html').replace(/<\?!= include\('(\w+)'\); \?>/g, (m, name) => read(name + '.html'));
html = html.replace(/<\?= messName \?>/g, '{{MESS_NAME}}');
if (html.includes('<?')) throw new Error('Unknown template tag left in Index.html');

// Embed safely inside a template literal: escape \ ` ${
const literal = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
if (new Function('return `' + literal + '`')() !== html) throw new Error('HTML escaping failed');

// 2) The .gs files, with the page-building block replaced by the embedded HTML
const page = /\/\/ BUILD:PAGE-START[\s\S]*?\/\/ BUILD:PAGE-END\n/;
const code = GS_ORDER.map(name => {
  let src = read(name + '.gs');
  if (name === 'Code') {
    if (!page.test(src)) throw new Error('BUILD:PAGE markers not found in Code.gs');
    src = src.replace(page, [
      '/** The full page (APP_HTML at the end of this file) with the mess name filled in */',
      'function pageHtml_(messName) {',
      "  return APP_HTML.split('{{MESS_NAME}}').join(escapeHtml_(messName));",
      '}',
      ''
    ].join('\n'));
  }
  return `/* ======================= ${name}.gs ======================= */\n\n${src.trim()}\n`;
}).join('\n\n');

const header = `/**
 * ===================================================================
 *  Mess Meal Manager — the whole app in one file (Google Apps Script)
 * ===================================================================
 *
 *  How to install:
 *   1. Open your Google Sheet → Extensions → Apps Script
 *   2. Delete everything in Code.gs, paste this whole file → Save (Ctrl+S)
 *   3. Deploy → New deployment → ⚙️ Web app
 *        Execute as: Me   |   Who has access: Anyone   → Deploy → Authorize
 *   4. Open the Web app URL and create the admin account. Done!
 *
 *  Updating later: paste the new file, then
 *  Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy
 *  (this keeps the same URL — do NOT make a "New deployment")
 *
 *  This file is generated from apps-script/ by "node tools/build.js".
 * ===================================================================
 */

`;

const out = header + code + `

/* ======================= UI (Index + Styles + JS) ======================= */

const APP_HTML = \`${literal}\`;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
report(OUT, out, ', ' + out.split('\n').length + ' lines');

// 3) Static page for Vercel: the page comes from Vercel, the data from the Apps Script Web App (doPost)
const webHead = [
  '<meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">',
  '  <title>Mess Meal Manager</title>',
  '  <link rel="icon" type="image/png" href="logo.png">',
  '  <link rel="apple-touch-icon" href="logo.png">',
  '  <script src="config.js"></script>'
].join('\n');
if (!fs.existsSync(path.join(ROOT, 'public', 'logo.png'))) console.warn('⚠️  public/logo.png is missing (browser-tab icon)');
const web = html
  .split('{{MESS_NAME}}').join('Mess Meal Manager')
  .replace('  <base target="_top">\n', '')
  .replace('<meta charset="utf-8">', webHead);
if (!web.includes('config.js')) throw new Error('Could not add config.js to public/index.html');
fs.mkdirSync(path.dirname(WEB_OUT), { recursive: true });
fs.writeFileSync(WEB_OUT, web);
report(WEB_OUT, web, ' (Vercel)');

// public/config.js holds the Apps Script URL. It is edited by hand, so only create it if missing.
if (!fs.existsSync(WEB_CONFIG)) {
  fs.writeFileSync(WEB_CONFIG, [
    '// Your Apps Script Web App URL (Deploy → Manage deployments → Web app → URL).',
    '// Change only the text between the quotes.',
    'window.MESS_API_URL = "PASTE_YOUR_WEB_APP_URL_HERE";',
    ''
  ].join('\n'));
  console.log('ℹ️  Created public/config.js — put your Web App URL in it');
}
const cfg = fs.readFileSync(WEB_CONFIG, 'utf8');
if (!/https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(cfg)) {
  console.warn('⚠️  public/config.js has no valid Web App URL yet — the Vercel site will not connect');
}
