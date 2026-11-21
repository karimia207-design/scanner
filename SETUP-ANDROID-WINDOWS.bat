@echo off
setlocal
cd /d "%~dp0"
echo === Nobitex Scanner v6.3 - Android setup ===
where node >nul 2>nul || (echo Node.js 22 or newer is required.& exit /b 1)
where npm >nul 2>nul || (echo npm is required.& exit /b 1)
call npm install || exit /b 1
call npm run verify:source || exit /b 1
call npm run setup:android || exit /b 1
call npm run open:android
endlocal
