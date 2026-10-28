@echo off
rem 重启前后端：先关再启
cd /d %~dp0
taskkill /FI "WindowTitle eq sinong-backend*" /T /F 2>nul
taskkill /FI "WindowTitle eq sinong-frontend*" /T /F 2>nul
timeout /t 1 /nobreak >nul
start "sinong-backend (18099)" cmd /k "cd /d %~dp0 && title sinong-backend (18099) && node app\server\server.js --port 18099 --data-dir .devdb"
start "sinong-frontend (5173)" cmd /k "cd /d %~dp0frontend && title sinong-frontend (5173) && npm run dev"
echo restarted.
timeout /t 1 /nobreak >nul
