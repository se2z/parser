@echo off
setlocal
chcp 65001 >nul
title Gift Tracker Bot
cd /d "%~dp0"
if errorlevel 1 goto directory_error

where node >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден. Установите Node.js 24 и откройте батник повторно.
    goto failed
)

node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
    echo [ОШИБКА] Для запуска нужен Node.js версии 24 или новее.
    goto failed
)

if not exist ".env" (
    if not exist ".env.example" (
        echo [ОШИБКА] Файл .env.example не найден рядом с батником.
        goto failed
    )
    copy /y ".env.example" ".env" >nul
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось создать файл .env.
        goto failed
    )
    echo Создан файл .env. Заполните BOT_TOKEN, ADMIN_IDS и GROUP_ID.
    echo Затем укажите ID тем в config.json и запустите батник повторно.
    start "" notepad.exe "%~dp0.env"
    goto failed
)

if not exist "config.json" (
    echo [ОШИБКА] Не найден config.json.
    goto failed
)

echo Запуск Gift Tracker. Для остановки нажмите Ctrl+C.
echo Источник объявлений определяется настройкой SOURCE в .env.
echo.
node --use-env-proxy --env-file=.env src/main.js
set "bot_exit=%errorlevel%"
echo.
if not "%bot_exit%"=="0" (
    echo [ОШИБКА] Бот завершился с кодом %bot_exit%. Подробности выше.
) else (
    echo Бот остановлен.
)
pause
exit /b %bot_exit%

:directory_error
echo [ОШИБКА] Не удалось открыть папку проекта.
:failed
echo.
pause
exit /b 1
