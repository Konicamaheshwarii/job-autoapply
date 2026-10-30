@echo off
rem One-time setup: registers the "JobBot" task that starts the bot at logon, on wake from sleep and every 15 minutes.
rem Replaces the old Startup-folder shortcut, which does not run when the laptop only wakes from sleep.
cd /d "%~dp0.."
powershell -NoProfile -Command "(Get-Content scripts\jobbot-task.xml -Raw).Replace('%%BOTDIR%%', (Get-Location).Path) | Set-Content $env:TEMP\jobbot-task.xml -Encoding Unicode"
schtasks /Create /TN JobBot /XML "%TEMP%\jobbot-task.xml" /F || (pause & exit /b 1)
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\run-bot.lnk" 2>nul
echo.
echo Done. The job bot now starts by itself at logon, after sleep, and is checked every 15 minutes.
pause
