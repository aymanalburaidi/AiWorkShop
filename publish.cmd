@echo off
rem انقر مرتين لبناء الصفحات من ملفات content ثم نشرها
cd /d "%~dp0"
call pnpm run deploy
pause
