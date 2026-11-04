@echo off
rem NOTE: save this file as UTF-8 (not ANSI/GBK); top-level chcp is REQUIRED before any line containing Chinese,
rem       otherwise cmd parses those lines as GBK and passes mojibake args to node.
chcp 65001 >nul
rem ===== sinong local dev =====
rem backend : http://127.0.0.1:18099 (data dir .devdb)
rem frontend: http://localhost:5173 (vite HMR)
set ROOT=%~dp0
start "sinong-backend" cmd /k "chcp 65001 >nul && cd /d %ROOT% && node app\server\server.js --port 18099 --data-dir .devdb --dev-user u1:开发测试"
start "sinong-frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"
echo.
echo backend 18099 and frontend 5173 started.
echo open http://localhost:5173/ in browser.
echo stop: close the two black windows.
pause
