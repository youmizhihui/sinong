@echo off
rem 启动后端 http://127.0.0.1:18099  (data dir .devdb)
cd /d %~dp0
taskkill /FI "WindowTitle eq sinong-backend*" /T /F 2>nul
timeout /t 1 /nobreak >nul
title sinong-backend (18099)
node app\server\server.js --port 18099 --data-dir .devdb
