@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" copy /y ".env.example" ".env" >nul
echo Заполните TELEGRAM_API_ID и TELEGRAM_API_HASH в .env до входа.
echo Код входа и пароль вводятся только в этом окне.
node --use-env-proxy --env-file=.env src/market-login.js
set "result=%errorlevel%"
pause
exit /b %result%
