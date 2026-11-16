@echo off
setlocal
title Mian
cd /d "%~dp0"
node scripts\launch.mjs
echo.
pause
