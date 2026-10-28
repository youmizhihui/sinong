@echo off
rem 启动前端 http://localhost:5173  (vite HMR)
cd /d %~dp0frontend
taskkill /FI "WindowTitle eq sinong-frontend*" /T /F 2>nul
timeout /t 1 /nobreak >nul
title sinong-frontend (5173)
npm run dev
