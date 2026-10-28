@echo off
rem 一键关闭前后端
taskkill /FI "WindowTitle eq sinong-backend*" /T /F 2>nul
taskkill /FI "WindowTitle eq sinong-frontend*" /T /F 2>nul
echo done.
timeout /t 1 /nobreak >nul
