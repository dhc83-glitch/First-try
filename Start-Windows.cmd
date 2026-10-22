@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/ first.
  echo Then close this window and open Start-Windows.cmd again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>24||(a===24&&b>=5)?0:1)"
if errorlevel 1 (
  echo This app needs Node.js 24.5 or later. Install Node.js 24 LTS from https://nodejs.org/.
  pause
  exit /b 1
)
echo Personal Task Auditor
echo Keep this window open while using the app.
echo Once the server says it is running, open your browser and enter:
echo http://127.0.0.1:3000
echo.
echo If Notion is not connected, follow WINDOWS-START-HERE.txt.
echo.
call npm start
echo.
echo The app stopped. If port 3000 is in use, close the other copy of the app first.
pause
