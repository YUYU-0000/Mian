@echo off
setlocal
title Mian restart
cd /d "%~dp0"
node scripts\launch.mjs --restart
echo.
pause

