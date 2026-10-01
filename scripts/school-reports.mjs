// تقرير PDF مستقل لكل مدرسة شريكة، من بيانات التصدير (exports/<التاريخ>/data.json)
// الاستخدام: node scripts/school-reports.mjs [مجلد التصدير] [--exclude=اسم،اسم]
// - مدارس الشراكة فقط (content/02-partners.md)، لا المدارس الإضافية مثل مدرسة المتطوعات
// - الأسماء المكررة في المدرسة نفسها تُدمج (اختلاف الهمزة والتاء المربوطة والألف المقصورة والمسافات)
// - لا سحابة كلمات في التقرير (الكلمات تُحتسب ضمن مشاركات كل متدربة فقط)
// - --exclude يستبعد أشخاصًا وكل مشاركاتهم؛ يكفي جزء من الاسم مثل "نورة القحطاني"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const args = process.argv.slice(2);
const exclude = (args.find(a => a.startsWith('--exclude=')) || '').slice(10).split(/[,،]/).map(s => s.trim()).filter(Boolean);
const exportsDir = path.join(root, 'exports');
const dir = args.find(a => !a.startsWith('--')) ? path.resolve(args.find(a => !a.startsWith('--')))
  : path.join(exportsDir, fs.readdirSync(exportsDir).filter(f => fs.existsSync(path.join(exportsDir, f, 'data.json'))).sort().pop());
const data = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));

/* ---------- المحتوى ---------- */
function parseMd(src) {
  const out = {}; let key = null, buf = [];
  for (const line of src.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) { if (key) out[key] = buf.join('\n').trim(); key = m[1]; buf = []; continue; }
    if (key) buf.push(line);
  }
  if (key) out[key] = buf.join('\n').trim();
  return out;
}
const items = s => (s || '').split('\n').filter(l => /^\s*-\s+/.test(l)).map(l => l.replace(/^\s*-\s+/, '').split('|').map(x => x.trim()));
const partners = items(parseMd(read('content/02-partners.md')).schools).map(([, name, , principal, key, color]) => ({ key, name, principal, color }));
const settings = parseMd(read('content/00-settings.md'));

/* ---------- تطبيع الأسماء والكلمات ---------- */
const norm = s => String(s || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/^(المعلمه|الاستاذه|ا\.|أ\.)\s+/, '').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(Boolean);
const excluded = exclude.map(tokens);
const isExcluded = name => { const t = new Set(tokens(name)); return excluded.some(ex => ex.length && ex.every(x => t.has(x))); };

/* ---------- الأشخاص: دمج المكرر داخل المدرسة نفسها ---------- */
const persons = new Map();   // school|normName -> { name, school, devices:Set, names:[] }
for (const p of [...data.people].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  const k = p.school + '|' + norm(p.name);
  if (!persons.has(k)) persons.set(k, { name: p.name.trim().replace(/\s+/g, ' '), school: p.school, devices: new Set(), names: [] });
  const r = persons.get(k); r.devices.add(p.device); r.names.push(p.name);
}
const personOf = new Map(); persons.forEach(r => r.devices.forEach(d => personOf.set(d, r)));
const merged = [...persons.values()].filter(r => r.devices.size > 1);
const removed = [...persons.values()].filter(r => isExcluded(r.name));

/* ---------- لكل مدرسة ---------- */
const unit = (n, one, two, many) => n === 2 ? two : (n % 100 >= 3 && n % 100 <= 10) ? many : one;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
const first = [...data.people, ...data.posts].map(x => x.created_at).sort()[0] || data.exported_at;
const when = new Date(first);
const date = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(when);
const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(when);
for (const f of ['moe-logo.png', 'yafea-logo.png']) fs.copyFileSync(path.join(root, 'src/assets', f), path.join(dir, 'images', f));
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const summary = [];

for (const sc of partners) {
  const people = [...persons.values()].filter(r => r.school === sc.key && !isExcluded(r.name));
  const devs = new Set(people.flatMap(r => [...r.devices]));
  const mine = x => devs.has(x.device);

  // صوت واحد لكل متدربة في كل استطلاع (الأحدث إن صوّتت من جهازين)
  const votes = new Map();
  data.votes.filter(mine).sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(v => votes.set(v.poll_key + '|' + personOf.get(v.device).name, v));
  const vlist = [...votes.values()];
  const polls = Object.entries(data.polls).map(([k, p]) => {
    const counts = p.options.map((_, i) => vlist.filter(v => v.poll_key === k && v.choice === i).length);
    return { ...p, counts, total: counts.reduce((a, b) => a + b, 0) };
  });
  const works = data.posts.filter(p => mine(p) && p.topic !== 'word');

  const count = r => data.posts.filter(p => r.devices.has(p.device)).length + vlist.filter(v => r.devices.has(v.device)).length;
  const roster = people.map(r => ({ name: r.name, n: count(r) })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ar'));
  const active = roster.filter(r => r.n > 0).length, total = roster.reduce((a, r) => a + r.n, 0);
  const images = works.filter(p => p.local_image).length;
  summary.push({ school: sc.name, people: roster.length, active, total, works: works.length, images });

  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير ورشة العمل - ${esc(sc.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:12mm 12mm 14mm}
/* ألوان هوية وزارة التعليم الأساسية */
:root{--navy:#15445a;--green:#07a869;--teal:#0da9a6;--blue:#3d7eb9;--sand:#c1b489;--grey:#c2c1c1;--muted:#5B7380;--line:#DDE7E8;--soft:#F3F7F8}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Tajawal,'Segoe UI',Tahoma,sans-serif;color:var(--navy);margin:0;line-height:1.75;font-size:12pt}
.logos{display:flex;align-items:center;justify-content:space-between}
.logos img{height:50px}
.rule{height:5px;border-radius:3px;margin:10px 0 14px;background:linear-gradient(90deg,var(--blue),var(--teal),var(--green))}
.eyebrow{display:inline-block;font-size:10.5pt;color:var(--green);font-weight:500;letter-spacing:.02em}
h1{font-weight:500;font-size:21pt;margin:0 0 12px;line-height:1.35}
/* بطاقة البيانات: المدرسة والمديرة ومقدّم ورشة العمل والتاريخ */
.meta{display:grid;grid-template-columns:1fr 1fr;background:var(--navy);color:#fff;border-radius:16px;overflow:hidden}
.meta div{padding:10px 16px;border-top:1px solid rgba(255,255,255,.14)}
.meta div:nth-child(-n+2){border-top:0}
.meta div:nth-child(even){border-inline-start:1px solid rgba(255,255,255,.14)}
.meta small{display:block;font-size:9.5pt;color:#9fd8d4;line-height:1.5}
.meta b{font-weight:500;font-size:13pt;line-height:1.5}
.meta span{display:block;font-size:10pt;color:#d5e4e8}
h2{display:flex;align-items:center;gap:8px;font-weight:500;font-size:14pt;margin:22px 0 10px;padding-bottom:4px;border-bottom:1px solid var(--line);break-after:avoid}
h2::before{content:"";width:10px;height:10px;border-radius:3px;background:var(--green);flex:none}
.muted{color:var(--muted)}
/* بطاقات الملخص: لون من الهوية لكل بطاقة */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stat{border-radius:14px;padding:12px 14px 10px;color:#fff;min-height:96px}
.stat b{display:block;font-size:24pt;font-weight:500;line-height:1.2;font-variant-numeric:tabular-nums}
.stat span{display:block;font-size:10.5pt;line-height:1.5;opacity:.95}
.s1{background:var(--navy)}.s2{background:var(--green)}.s3{background:var(--teal)}.s4{background:var(--blue)}
/* الاستطلاعان */
.poll{break-inside:avoid;border:1px solid var(--line);border-radius:14px;padding:10px 14px;margin-bottom:10px}
.poll .q{font-weight:500;margin:0 0 4px}
.poll .q small{font-weight:400;color:var(--muted)}
.opt{display:grid;grid-template-columns:44% 1fr 40px;align-items:center;gap:10px;padding:3px 0}
.track{height:10px;border-radius:6px;background:var(--soft);overflow:hidden}
.fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--teal),var(--green))}
.opt .c{text-align:center;font-variant-numeric:tabular-nums;font-weight:500}
/* جدول المتدربات */
table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
th{background:var(--navy);color:#fff;font-weight:500;font-size:10.5pt;padding:7px 10px;text-align:right}
td{padding:6px 10px;border-top:1px solid var(--line);text-align:right;font-weight:400}
tr:nth-child(odd) td{background:var(--soft)}
tr{break-inside:avoid}
.num{width:44px;color:var(--muted);text-align:center}
.n{width:110px;text-align:center}
.pill{display:inline-block;min-width:34px;padding:0 10px;border-radius:999px;background:#e3f5ee;color:#067a4d;font-weight:500;font-variant-numeric:tabular-nums}
.pill.zero{background:#eef1f2;color:var(--muted)}
/* إبداعات المتدربات */
.post{border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:12px;break-inside:avoid}
.post .head{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--soft);border-bottom:1px solid var(--line);padding:7px 14px}
.post .head b{font-weight:500}
.tag{font-size:9.5pt;padding:1px 10px;border-radius:999px;background:var(--sand);color:#fff}
.post .body{padding:10px 14px}
.post p{white-space:pre-wrap;margin:0;word-break:break-word}
.post img{max-width:100%;max-height:300px;border-radius:8px;display:block;margin:0 auto 8px}
footer{margin-top:22px;font-size:9.5pt;color:var(--muted);border-top:1px solid var(--line);padding-top:6px}
</style></head><body>
<div class="logos"><img src="images/moe-logo.png" alt="وزارة التعليم"><img src="images/yafea-logo.png" alt="يافع المستقبل"></div>
<div class="rule"></div>
<span class="eyebrow">تقرير ورشة العمل</span>
<h1>الذكاء الاصطناعي في خدمة المعلم والمعلمة</h1>
<section class="meta">
  <div><small>المدرسة</small><b>${esc(sc.name)}</b></div>
  <div><small>مديرة المدرسة</small><b>${esc(sc.principal)}</b></div>
  <div><small>مقدّم ورشة العمل</small><b>${esc(settings.presenter_name)}</b></div>
  <div><small>التاريخ</small><b>${esc(date)}م</b><span>${esc(hijri)}</span></div>
</section>

<h2>ملخص</h2>
<div class="stats">
<div class="stat s1"><b>${roster.length}</b><span>${unit(roster.length, 'متدربة', 'متدربتان', 'متدربات')} ${unit(roster.length, 'مسجلة', 'مسجلتان', 'مسجلات')}</span></div>
<div class="stat s2"><b>${active}</b><span>${unit(active, 'متدربة', 'متدربتان', 'متدربات')} ${unit(active, 'شاركت', 'شاركتا', 'شاركن')}</span></div>
<div class="stat s3"><b>${total}</b><span>${unit(total, 'مشاركة', 'مشاركتان', 'مشاركات')} (تصويت، كلمات، أعمال)</span></div>
<div class="stat s4"><b>${works.length}</b><span>${unit(works.length, 'عمل', 'عملان', 'أعمال')} على جدار الإبداعات${images ? ` (${images} ${unit(images, 'صورة', 'صورتان', 'صور')})` : ''}</span></div>
</div>

<h2>نتائج الاستطلاعين</h2>
${polls.map(p => `<div class="poll"><p class="q">${esc(p.question)} <small>(${p.total} ${unit(p.total, 'صوت', 'صوتان', 'أصوات')})</small></p>${p.options.map((o, i) => `<div class="opt"><span>${esc(o)}</span><div class="track"><div class="fill" style="width:${p.total ? p.counts[i] / p.total * 100 : 0}%"></div></div><span class="c">${p.counts[i]}</span></div>`).join('')}</div>`).join('')}

<h2>المتدربات</h2>
<table><tr><th class="num">#</th><th>الاسم</th><th class="n">المشاركات</th></tr>
${roster.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="n"><span class="pill${r.n ? '' : ' zero'}">${r.n}</span></td></tr>`).join('')}
</table>

<h2>إبداعات المتدربات</h2>
${works.map(p => `<div class="post"><div class="head"><b>${esc(personOf.get(p.device).name)}</b>${p.topic === 'create' ? '<span class="tag">تحدّي الإبداع</span>' : ''}</div><div class="body">${p.local_image ? `<img src="${esc(p.local_image)}" alt="">` : ''}${p.body ? `<p>${linkify(p.body)}</p>` : ''}</div></div>`).join('') || '<p class="muted">لا أعمال</p>'}

<footer>يقتصر التقرير على منسوبات ${esc(sc.name)} المسجلات في بوابة الحضور. الأسماء المكررة دُمجت، وكل متدربة يُحتسب لها صوت واحد في كل استطلاع.</footer>
</body></html>`;

  const htmlFile = path.join(dir, `report-${sc.key}.html`);
  fs.writeFileSync(htmlFile, html);
  if (browser) {
    const pdf = path.join(dir, `تقرير ورشة العمل - ${sc.name}.pdf`);
    const t0 = Date.now();
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=15000',
      `--print-to-pdf=${pdf}`, pathToFileURL(htmlFile).href], { stdio: 'ignore' });
    // Edge قد يعود قبل أن يكمل كتابة الملف: ننتظر حتى يُكتب ويثبت حجمه
    const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let i = 0, last = -1; i < 80; i++) {
      const st = fs.existsSync(pdf) && fs.statSync(pdf);
      if (st && st.mtimeMs >= t0 - 1000 && st.size > 0 && st.size === last) break;
      last = st ? st.size : -1; sleep(250);
    }
    console.log('✓', path.relative(root, pdf));
  }
}
console.log(JSON.stringify(summary, null, 1));
console.log('مدموج:', merged.map(r => r.name + ' (' + r.devices.size + ' أجهزة)').join('، ') || 'لا شيء');
console.log('مستبعد:', removed.map(r => r.name + ' [' + r.school + ']').join('، ') || 'لا شيء');
if (!browser) console.log('لم يُعثر على Edge أو Chrome؛ افتح report-*.html واطبعه PDF.');
