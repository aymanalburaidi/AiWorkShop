// تقرير PDF مستقل لكل مدرسة شريكة، من بيانات التصدير (exports/<التاريخ>/data.json)
// الاستخدام: node scripts/school-reports.mjs [مجلد التصدير] [--exclude=اسم،اسم]
// - مدارس الشراكة فقط (content/02-partners.md)، لا المدارس الإضافية مثل مدرسة المتطوعات
// - الأسماء المكررة في المدرسة نفسها تُدمج (اختلاف الهمزة والتاء المربوطة والألف المقصورة والمسافات)
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

  // الكلمات: تُدمج "تطوير" و"التطوير"، ويُستبعد ما كُتب فيه اسم شخص بدل كلمة
  const allNames = [...persons.values()].map(r => new Set(tokens(r.name)));
  const looksLikeName = w => { const t = tokens(w); return t.length >= 3 && allNames.some(n => t.filter(x => n.has(x)).length >= 2); };
  const words = new Map();
  data.posts.filter(p => mine(p) && p.topic === 'word' && !looksLikeName(p.body)).forEach(p => {
    const k = norm(p.body).replace(/^ال(?=\S{3,})/, '');
    const e = words.get(k) || { text: p.body.trim(), n: 0 }; e.n++;
    if (p.body.trim().length < e.text.length) e.text = p.body.trim();
    words.set(k, e);
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
@page{size:A4;margin:14mm 13mm}
:root{--sc:${sc.color};--ink:#15445a;--muted:#5B7380;--line:#DDE7E8}
*{box-sizing:border-box}
body{font-family:Tajawal,'Segoe UI',Tahoma,sans-serif;color:var(--ink);margin:0;line-height:1.75;font-size:12.5pt}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid var(--sc);padding-bottom:10px}
header img{height:52px}
h1{font-weight:500;font-size:20pt;margin:16px 0 2px;line-height:1.4}
.school{font-size:16pt;color:var(--sc);font-weight:500;margin:0}
h2{font-weight:500;font-size:14pt;border-bottom:2px solid var(--sc);padding-bottom:3px;margin:22px 0 10px;break-after:avoid}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.box{border:1px solid var(--line);border-top:3px solid var(--sc);border-radius:12px;padding:10px 12px}
.box b{font-size:20pt;font-weight:500;display:block;line-height:1.3;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid var(--line);padding:5px 8px;text-align:right;font-weight:400;vertical-align:top}
th{color:var(--muted);font-size:10.5pt}
tr{break-inside:avoid}
.num{width:40px;color:var(--muted)}.n{width:90px;text-align:center;font-variant-numeric:tabular-nums}
.bar{height:9px;border-radius:5px;background:var(--sc)}
.poll{break-inside:avoid;margin-bottom:12px}
.words{line-height:2.2}.words span{display:inline-block;margin:0 9px;color:var(--sc)}
.post{border:1px solid var(--line);border-inline-start:4px solid var(--sc);border-radius:12px;padding:10px 14px;margin-bottom:10px;break-inside:avoid}
.post p{white-space:pre-wrap;margin:0;word-break:break-word}
.post img{max-width:100%;max-height:300px;border-radius:8px;display:block;margin-bottom:8px}
.who{font-weight:500}.tag{font-size:9.5pt;padding:1px 8px;border-radius:999px;background:#f3efe2;color:#7b6c3a}
footer{margin-top:24px;font-size:9.5pt;color:var(--muted);border-top:1px solid var(--line);padding-top:6px}
</style></head><body>
<header><img src="images/moe-logo.png" alt="وزارة التعليم"><img src="images/yafea-logo.png" alt="يافع المستقبل"></header>
<h1>تقرير ورشة عمل "الذكاء الاصطناعي في خدمة المعلم والمعلمة"</h1>
<p class="school">${esc(sc.name)}</p>
<p class="muted">${esc(date)}م · ${esc(hijri)} · مديرة المدرسة: ${esc(sc.principal)} · مقدّم ورشة العمل: ${esc(settings.presenter_name)}</p>

<h2>ملخص</h2>
<div class="grid">
<div class="box"><b>${roster.length}</b>${unit(roster.length, 'متدربة', 'متدربتان', 'متدربات')} ${unit(roster.length, 'مسجلة', 'مسجلتان', 'مسجلات')}</div>
<div class="box"><b>${active}</b>${unit(active, 'متدربة', 'متدربتان', 'متدربات')} ${unit(active, 'شاركت', 'شاركتا', 'شاركن')}</div>
<div class="box"><b>${total}</b>${unit(total, 'مشاركة', 'مشاركتان', 'مشاركات')} (تصويت، كلمات، أعمال)</div>
<div class="box"><b>${works.length}</b>${unit(works.length, 'عمل', 'عملان', 'أعمال')} على جدار الإبداعات${images ? ` (${images} ${unit(images, 'صورة', 'صورتان', 'صور')})` : ''}</div>
</div>

<h2>نتائج الاستطلاعين</h2>
${polls.map(p => `<div class="poll"><p><b>${esc(p.question)}</b> <span class="muted">(${p.total} ${unit(p.total, 'صوت', 'صوتان', 'أصوات')})</span></p><table>${p.options.map((o, i) => `<tr><td style="width:46%">${esc(o)}</td><td style="width:44%"><div class="bar" style="width:${p.total ? p.counts[i] / p.total * 100 : 0}%"></div></td><td class="n">${p.counts[i]}</td></tr>`).join('')}</table></div>`).join('')}

<h2>سحابة الكلمات</h2>
<p class="words">${[...words.values()].sort((a, b) => b.n - a.n).map(w => `<span style="font-size:${12 + Math.min(w.n, 5) * 3}pt">${esc(w.text)}${w.n > 1 ? ` <small class="muted">(${w.n})</small>` : ''}</span>`).join('') || '<span class="muted">لا كلمات</span>'}</p>

<h2>المتدربات</h2>
<table><tr><th class="num">#</th><th>الاسم</th><th class="n">المشاركات</th></tr>
${roster.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="n">${r.n}</td></tr>`).join('')}
</table>

<h2>إبداعات المتدربات</h2>
${works.map(p => `<div class="post">${p.local_image ? `<img src="${esc(p.local_image)}" alt="">` : ''}<p class="who">${esc(personOf.get(p.device).name)} ${p.topic === 'create' ? '<span class="tag">تحدّي الإبداع</span>' : ''}</p>${p.body ? `<p>${linkify(p.body)}</p>` : ''}</div>`).join('') || '<p class="muted">لا أعمال</p>'}

<footer>يقتصر التقرير على منسوبات ${esc(sc.name)} المسجلات في بوابة الحضور. الأسماء المكررة دُمجت، وكل متدربة يُحتسب لها صوت واحد في كل استطلاع.</footer>
</body></html>`;

  const htmlFile = path.join(dir, `report-${sc.key}.html`);
  fs.writeFileSync(htmlFile, html);
  if (browser) {
    const pdf = path.join(dir, `تقرير ورشة العمل - ${sc.name}.pdf`);
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=15000',
      `--print-to-pdf=${pdf}`, pathToFileURL(htmlFile).href], { stdio: 'ignore' });
    console.log('✓', path.relative(root, pdf));
  }
}
console.log(JSON.stringify(summary, null, 1));
console.log('مدموج:', merged.map(r => r.name + ' (' + r.devices.size + ' أجهزة)').join('، ') || 'لا شيء');
console.log('مستبعد:', removed.map(r => r.name + ' [' + r.school + ']').join('، ') || 'لا شيء');
if (!browser) console.log('لم يُعثر على Edge أو Chrome؛ افتح report-*.html واطبعه PDF.');
