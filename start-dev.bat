@echo off
rem Starts the HR System dev environment: backend API (:4000) + frontend (:3000).
rem MySQL must be running (XAMPP control panel) - the API works without it,
rem but /api/ready will report db down until it's up.

start "HR Backend :4000" cmd /k "cd /d %~dp0backend && npm run dev"
start "HR Frontend :3000" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Two windows opened: backend (:4000) and frontend (:3000).
echo App: http://localhost:3000
