// apps-script/ ফোল্ডারের সব ফাইল জুড়ে এক-ফাইলের deploy/Code.gs বানায়।
// চালাতে: node tools/build.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'deploy', 'Code.gs');
const GS_ORDER = ['Code', 'Db', 'Auth', 'Meals', 'Finance', 'Duties', 'Report'];

const read = name => fs.readFileSync(path.join(SRC, name), 'utf8').replace(/\r\n/g, '\n');

// 1) HTML: include() গুলো বসিয়ে একটা পূর্ণ পেজ
let html = read('Index.html').replace(/<\?!= include\('(\w+)'\); \?>/g, (m, name) => read(name + '.html'));
html = html.replace(/<\?= messName \?>/g, '{{MESS_NAME}}');
if (html.includes('<?')) throw new Error('Index.html-এ অজানা টেমপ্লেট ট্যাগ রয়ে গেছে');

// টেমপ্লেট লিটারাল হিসেবে নিরাপদে বসানো: \ ` ${ এস্কেপ
const literal = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
if (new Function('return `' + literal + '`')() !== html) throw new Error('HTML এস্কেপ ঠিক হয়নি');

// 2) .gs ফাইলগুলো, পেজ বানানোর অংশটা এমবেড করা HTML দিয়ে বদলে
const page = /\/\/ BUILD:PAGE-START[\s\S]*?\/\/ BUILD:PAGE-END\n/;
const code = GS_ORDER.map(name => {
  let src = read(name + '.gs');
  if (name === 'Code') {
    if (!page.test(src)) throw new Error('Code.gs-এ BUILD:PAGE মার্কার পাওয়া যায়নি');
    src = src.replace(page, [
      '/** পুরো পেজ (এই ফাইলের শেষে APP_HTML) — মেসের নাম বসিয়ে ফেরত দেয় */',
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
 *  মেস মিল হিসাব — এক ফাইলে পুরো অ্যাপ (Google Apps Script)
 * ===================================================================
 *
 *  কীভাবে চালু করবেন:
 *   1. Google Sheet খুলুন → Extensions → Apps Script
 *   2. Code.gs-এর সব লেখা মুছে এই ফাইলের পুরোটা পেস্ট করুন → Save (Ctrl+S)
 *   3. উপরের ফাংশন তালিকা থেকে "setup" বেছে Run চাপুন → অনুমতি দিন
 *      (Advanced → Go to ... (unsafe) → Allow)
 *   4. Deploy → New deployment → ⚙️ Web app
 *        Execute as: Me   |   Who has access: Anyone   → Deploy
 *   5. Web app URL খুলে প্রথমে অ্যাডমিন অ্যাকাউন্ট বানান, তারপর সদস্য যোগ করুন
 *
 *  কোড বদলালে: Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 *  (তাহলে URL একই থাকে)
 *
 *  এই ফাইলটি apps-script/ ফোল্ডার থেকে "node tools/build.js" দিয়ে তৈরি।
 * ===================================================================
 */

`;

const out = header + code + `

/* ======================= UI (Index + Styles + JS) ======================= */

const APP_HTML = \`${literal}\`;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log('✅ ' + path.relative(ROOT, OUT) + ' — ' + Math.round(out.length / 1024) + ' KB, ' + out.split('\n').length + ' লাইন');
