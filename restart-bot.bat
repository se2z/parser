@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" (
    echo Файл .env не найден. Сначала настройте start-bot.bat.
    pause
    exit /b 1
)
echo Перезапуск Gift Tracker. Будет остановлен только процесс, удерживающий блокировку базы этого проекта.
node --env-file=.env scripts/restart.js
if errorlevel 1 (
    pause
    exit /b 1
)
call "%~dp0start-bot.bat"
