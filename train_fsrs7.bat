@echo off
@chcp 65001 > nul
title FSRS-7 Optimizer - Ultimate Celestial Vocab

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node

node tools\train_fsrs7.js %*

if errorlevel 1 goto :script_error

goto :end

:no_node
echo.
echo [ERROR] Khong tim thay Node.js tren he thong!
echo Vui long cai dat Node.js tu: https://nodejs.org/
echo.
pause
exit /b 1

:script_error
echo.
echo [!] Tien trinh toi uu hoa chua the hoan tat.
echo.
pause
exit /b 1

:end
pause
