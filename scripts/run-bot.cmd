@echo off
rem Starts the job bot and restarts it if WhatsApp Web breaks.
rem Output shows here and is also saved to data\bot.log
title job-bot
cd /d "%~dp0.."
:loop
node src\index.js
if %errorlevel%==2 (
  echo Restarting in 10 seconds...
  timeout /t 10 /nobreak >nul
  goto loop
)
echo.
echo Job bot stopped. Press any key to close.
pause >nul
