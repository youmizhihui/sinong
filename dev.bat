@echo off
rem ===== sinong local dev =====
rem backend : http://127.0.0.1:18099 (data dir .devdb)
rem frontend: http://localhost:5173 (vite HMR)
rem NOTE: keep this file pure ASCII - Chinese chars break cmd parsing on GBK console.
set ROOT=%~dp0
start "sinong-backend" cmd /k "cd /d %ROOT% && node app\server\server.js --port 18099 --data-dir .devdb"
start "sinong-frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"
echo.
echo backend 18099 and frontend 5173 started.
echo open http://localhost:5173/ in browser.
echo stop: close the two black windows.
pause
