@echo off
rem Starts the job bot in its own window unless it is already running.
rem Run by the "JobBot" scheduled task at logon, when the laptop wakes up, and every 15 minutes.
cd /d "%~dp0.."
set PID=
if exist data\bot.pid set /p PID=<data\bot.pid
if defined PID tasklist /FI "PID eq %PID%" /NH | findstr /i "node.exe" >nul && exit /b 0
tasklist /FI "WINDOWTITLE eq job-bot*" /NH | findstr /i "cmd.exe" >nul && exit /b 0
start "job-bot" "%~dp0run-bot.cmd"
