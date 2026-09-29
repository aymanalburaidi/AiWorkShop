// ينشر مجلد docs/ على GitHub Pages: يحفظ التعديلات ويرفعها إلى الفرع main
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const run = cmd => execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();

run('git add -A');
if (!run('git status --porcelain')) {
  console.log('لا توجد تعديلات جديدة للنشر.');
  process.exit(0);
}
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
run(`git commit -m "تحديث محتوى ورشة العمل ${stamp}"`);
run('git push');
console.log('✓ تم الرفع. يظهر التحديث على الموقع خلال دقيقة أو دقيقتين.');
