@echo off
rem start backend http://127.0.0.1:18099 (data dir .devdb)
rem --dev-user: simulated gateway user for local dev (no TRIM headers here)
rem NOTE: save this file as UTF-8 (not ANSI/GBK); chcp 65001 makes Chinese dev-user names work.
chcp 65001 >nul
cd /d %~dp0
taskkill /FI "WindowTitle eq sinong-backend*" /T /F 2>nul
timeout /t 1 /nobreak >nul
title sinong-backend (18099)
node app\server\server.js --port 18099 --data-dir .devdb --dev-user u1:开发测试
