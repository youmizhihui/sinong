@echo off
rem 重启前后端：先关再启
rem NOTE: save this file as UTF-8 (not ANSI/GBK); chcp 65001 makes Chinese dev-user names work.
chcp 65001 >nul
cd /d %~dp0
taskkill /FI "WindowTitle eq sinong-backend*" /T /F 2>nul
taskkill /FI "WindowTitle eq sinong-frontend*" /T /F 2>nul
timeout /t 1 /nobreak >nul
start "sinong-backend (18099)" cmd /k "chcp 65001 >nul && cd /d %~dp0 && title sinong-backend (18099) && node app\server\server.js --port 18099 --data-dir .devdb --dev-user u1:开发测试"
start "sinong-frontend (5173)" cmd /k "cd /d %~dp0frontend && title sinong-frontend (5173) && npm run dev"
echo restarted.
timeout /t 1 /nobreak >nul
