@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "npm_config_cache=%CD%\work\npm-cache"
call npm ci
set "result=%errorlevel%"
pause
exit /b %result%
