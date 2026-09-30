// بعد ورشة العمل: يصدّر المشاركات والأسماء والنتائج والصور إلى exports/، وبـ --delete يحذفها من قاعدة البيانات
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const cfg = JSON.parse(read('config.json'));
const del = process.argv.includes('--delete');

/* ---------- المحتوى: المدارس والاستطلاعات ---------- */
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
const byId = Object.fromEntries(fs.readdirSync(path.join(root, 'content')).filter(f => f.endsWith('.md'))
  .map(f => [f.replace(/^\d+-/, '').replace(/\.md$/, ''), parseMd(read('content/' + f))]));
const schools = [...items(byId.partners.schools), ...items(byId.settings.extra_schools)].map(([, name, , principal, key, color]) => ({ key, name, principal, color }));
const polls = {
  p1: { question: byId['poll-open'].question, options: items(byId['poll-open'].options).map(([t]) => t) },
  p2: { question: byId['poll-close'].question, options: items(byId['poll-close'].options).map(([t]) => t) },
};

/* ---------- جلب البيانات ---------- */
const headers = { apikey: cfg.supabaseKey, 'Content-Type': 'application/json' };
async function rest(table, select) {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?room=eq.${cfg.room}&select=${select}&order=created_at.asc`, { headers });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  return r.json();
}
const [people, posts, votes] = await Promise.all([
  rest('aiws_people', 'device,name,school,created_at'),
  rest('aiws_posts', 'id,device,author,body,topic,image_path,created_at'),
  rest('aiws_votes', 'poll_key,choice,device,author,created_at'),
]);
// رسائل المتدربات إلى المقدّم خاصة: تُقرأ بمفتاح المقدّم، ولا تدخل التقرير المطبوع
let questions = [];
if (fs.existsSync(path.join(root, 'secrets/presenter-key.txt'))) {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/aiws_questions_list`, { method: 'POST', headers, body: JSON.stringify({ p_room: cfg.room, p_secret: read('secrets/presenter-key.txt').trim() }) });
  if (r.ok) questions = (await r.json()).reverse(); else console.warn('تعذّر جلب رسائل المتدربات:', r.status);
}
console.log(`المتدربات: ${people.length} · المشاركات: ${posts.length} · الأصوات: ${votes.length} · الرسائل: ${questions.length}`);

/* ---------- مجلد التصدير والصور ---------- */
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const dir = path.join(root, 'exports', stamp);
fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
for (const p of posts.filter(p => p.image_path)) {
  const url = `${cfg.supabaseUrl}/storage/v1/object/public/aiws-uploads/${p.image_path.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url);
  if (!r.ok) { console.warn('تعذّر تنزيل صورة:', p.image_path); continue; }
  const file = p.id + '.jpg';
  fs.writeFileSync(path.join(dir, 'images', file), Buffer.from(await r.arrayBuffer()));
  p.local_image = 'images/' + file;
}

/* ---------- التجميع ---------- */
const personOf = new Map(people.map(p => [p.device, p]));
const nameOf = d => personOf.get(d)?.name || posts.find(p => p.device === d)?.author || votes.find(v => v.device === d)?.author || 'بدون اسم';
const schoolOf = d => schools.find(s => s.key === personOf.get(d)?.school);
const count = new Map();
[...posts.map(p => p.device), ...votes.map(v => v.device)].forEach(d => count.set(d, (count.get(d) || 0) + 1));
const devices = [...new Set([...people.map(p => p.device), ...count.keys()])];
const roster = devices.map(d => ({ name: nameOf(d), school: schoolOf(d), n: count.get(d) || 0 }))
  .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ar'));
const pollResults = Object.entries(polls).map(([k, p]) => {
  const c = p.options.map((_, i) => votes.filter(v => v.poll_key === k && v.choice === i).length);
  return { ...p, counts: c, total: c.reduce((a, b) => a + b, 0) };
});
const words = new Map();
posts.filter(p => p.topic === 'word').forEach(p => { const w = p.body.trim(); words.set(w, (words.get(w) || 0) + 1); });
const works = posts.filter(p => p.topic !== 'word');

/* ---------- الملفات ---------- */
const csv = rows => '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ exported_at: new Date().toISOString(), room: cfg.room, schools, polls, people, posts, votes, questions }, null, 2));
fs.writeFileSync(path.join(dir, 'questions.csv'), csv([['الوقت', 'الاسم', 'المدرسة', 'الرسالة', 'تمت'], ...questions.map(q => [q.created_at, q.author || '', schools.find(s => s.key === q.school)?.name || '', q.body, q.done ? 'نعم' : ''])]));
fs.writeFileSync(path.join(dir, 'trainees.csv'), csv([['الاسم', 'المدرسة', 'عدد المشاركات'], ...roster.map(r => [r.name, r.school?.name || '', r.n])]));
fs.writeFileSync(path.join(dir, 'posts.csv'), csv([['الوقت', 'الاسم', 'المدرسة', 'النوع', 'النص', 'الصورة'],
  ...posts.map(p => [p.created_at, nameOf(p.device), schoolOf(p.device)?.name || '', { share: 'مشاركة', create: 'تحدّي الإبداع', word: 'كلمة' }[p.topic], p.body, p.local_image || ''])]));

// لفظ المعدود حسب العدد: 2 مثنى، ومن 3 إلى 10 جمع، وما عداها مفرد
const unit = (n, one, two, many) => n === 2 ? two : (n % 100 >= 3 && n % 100 <= 10) ? many : one;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
const date = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير ورشة العمل</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500&display=swap" rel="stylesheet">
<style>
body{font-family:Tajawal,sans-serif;color:#15445a;max-width:960px;margin:32px auto;padding:0 24px;line-height:1.8}
h1{font-weight:500;margin-bottom:0}h2{font-weight:500;border-bottom:2px solid #0da9a6;padding-bottom:4px;margin-top:36px}
.muted{color:#5B7380}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.box{border:1px solid #DDE7E8;border-radius:14px;padding:14px 16px}.box b{font-size:1.8rem;font-weight:500;display:block}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #DDE7E8;padding:6px 8px;text-align:right;font-weight:400}th{color:#5B7380}
.bar{height:10px;border-radius:6px;background:linear-gradient(90deg,#3d7eb9,#07a869)}
.post{border:1px solid #DDE7E8;border-top:3px solid var(--sc,#DDE7E8);border-radius:14px;padding:14px 16px;margin-bottom:12px;break-inside:avoid}
.post p{white-space:pre-wrap;margin:0}.post img{max-width:100%;max-height:360px;border-radius:10px;display:block;margin-bottom:8px}
.who{font-weight:500}.tag{font-size:.8rem;padding:1px 8px;border-radius:999px;background:#f3efe2;color:#7b6c3a}
.words span{display:inline-block;margin:4px 10px}
@media print{body{margin:0}h2{break-after:avoid}}
</style></head><body>
<h1>تقرير ورشة عمل "الذكاء الاصطناعي في خدمة المعلم والمعلمة"</h1>
<p class="muted">${esc(date)}م · ${esc(hijri)} · مقدّم ورشة العمل: ${esc(byId.settings.presenter_name)}</p>

<h2>ملخص</h2>
<div class="grid">
<div class="box"><b>${roster.length}</b>${unit(roster.length, 'متدربة', 'متدربتان', 'متدربات')}</div>
<div class="box"><b>${works.length}</b>${unit(works.length, 'عمل', 'عملان', 'أعمال')} على جدار الإبداعات</div>
<div class="box"><b>${works.filter(p => p.image_path).length}</b>${unit(works.filter(p => p.image_path).length, 'صورة', 'صورتان', 'صور')}</div>
<div class="box"><b>${votes.length + posts.length}</b>${unit(votes.length + posts.length, 'مشاركة', 'مشاركتان', 'مشاركات')} بالمجمل</div>
</div>

<h2>المدارس</h2>
<table><tr><th>المدرسة</th><th>مديرة المدرسة</th><th>المتدربات</th><th>المشاركات</th></tr>
${schools.map(s => { const r = roster.filter(x => x.school?.key === s.key); return `<tr><td style="color:${s.color}">${esc(s.name)}</td><td>${esc(s.principal)}</td><td>${r.length}</td><td>${r.reduce((a, x) => a + x.n, 0)}</td></tr>`; }).join('')}
</table>

<h2>نتائج الاستطلاعين</h2>
${pollResults.map(p => `<p><b>${esc(p.question)}</b> <span class="muted">(${p.total} ${unit(p.total, 'صوت', 'صوتان', 'أصوات')})</span></p><table>${p.options.map((o, i) => `<tr><td style="width:45%">${esc(o)}</td><td style="width:45%"><div class="bar" style="width:${p.total ? p.counts[i] / p.total * 100 : 0}%"></div></td><td>${p.counts[i]}</td></tr>`).join('')}</table>`).join('')}

<h2>سحابة الكلمات</h2>
<p class="words">${[...words.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `<span style="font-size:${1 + Math.min(n, 6) * .25}rem">${esc(w)}${n > 1 ? ` <small class="muted">(${n})</small>` : ''}</span>`).join('') || '<span class="muted">لا كلمات</span>'}</p>

<h2>المتدربات</h2>
<table><tr><th>#</th><th>الاسم</th><th>المدرسة</th><th>المشاركات</th></tr>
${roster.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td style="color:${r.school?.color || 'inherit'}">${esc(r.school?.name || '')}</td><td>${r.n}</td></tr>`).join('')}
</table>

<h2>إبداعات المتدربات</h2>
${works.map(p => `<div class="post" style="--sc:${schoolOf(p.device)?.color || '#DDE7E8'}">${p.local_image ? `<img src="${p.local_image}" alt="">` : ''}<p class="who">${esc(nameOf(p.device))} <span class="muted">· ${esc(schoolOf(p.device)?.name || '')}</span> ${p.topic === 'create' ? '<span class="tag">تحدّي الإبداع</span>' : ''}</p>${p.body ? `<p>${linkify(p.body)}</p>` : ''}</div>`).join('') || '<p class="muted">لا مشاركات</p>'}
</body></html>`;
fs.writeFileSync(path.join(dir, 'report.html'), html);
console.log('✓ التصدير في:', path.relative(root, dir));
console.log('  التقرير: report.html (افتحه واطبعه PDF) · trainees.csv · posts.csv · questions.csv (خاص) · data.json · images/');

/* ---------- الحذف (اختياري) ---------- */
if (del) {
  const secret = read('secrets/presenter-key.txt').trim();
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/aiws_reset`, { method: 'POST', headers, body: JSON.stringify({ p_room: cfg.room, p_secret: secret, p_what: 'all' }) });
  if (!r.ok) { console.error('✗ تعذّر الحذف:', r.status, await r.text()); process.exit(1); }
  console.log('✓ حُذفت الأسماء والمشاركات والأصوات والرسائل من قاعدة البيانات.');
  console.log('  الصور المرفوعة تُحذف يدويًا من لوحة Supabase: Storage ثم aiws-uploads.');
} else {
  console.log('للحذف من قاعدة البيانات بعد التأكد من التقرير: pnpm run export -- --delete');
}
