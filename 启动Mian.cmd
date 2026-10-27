@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Mian LAN

cd /d "%~dp0"
if errorlevel 1 goto :PROJECT_ERROR

set "MIAN_PROJECT=%~dp0"
if not defined MIAN_LAN_IP set "MIAN_LAN_IP=127.0.0.1"
set "MIAN_LAN_URL=http://%MIAN_LAN_IP%:5173"

rem Exit codes from the check below:
rem   0  = ports are clear (or confirmed stale Mian processes were stopped)
rem   10 = an existing Mian LAN frontend and local backend are healthy
rem   20 = a target port belongs to an unknown process; do not stop it
rem   21 = confirmed stale Mian listeners could not be stopped cleanly
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $project=$env:MIAN_PROJECT; $lanUrl=$env:MIAN_LAN_URL; $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5173,8787 }); if($listeners.Count -eq 0){ exit 0 }; $records=@(); foreach($listener in $listeners){ $owner=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$listener.OwningProcess) -ErrorAction SilentlyContinue; $command=if($null -eq $owner){''}else{[string]$owner.CommandLine}; $isMian=($null -ne $owner -and $owner.Name -ieq 'node.exe' -and $command.IndexOf($project,[StringComparison]::OrdinalIgnoreCase) -ge 0); $records += [pscustomobject]@{ Listener=$listener; Owner=$owner; IsMian=$isMian } }; $lanFrontend=@($records | Where-Object { $_.IsMian -and $_.Listener.LocalPort -eq 5173 -and $_.Listener.LocalAddress -in '0.0.0.0',$env:MIAN_LAN_IP }); $localBackend=@($records | Where-Object { $_.IsMian -and $_.Listener.LocalPort -eq 8787 -and $_.Listener.LocalAddress -eq '127.0.0.1' }); $frontHealthy=$false; $backHealthy=$false; if($lanFrontend.Count -gt 0){ try { $frontResponse=Invoke-WebRequest -UseBasicParsing -Uri $lanUrl -TimeoutSec 4; $frontHealthy=$frontResponse.StatusCode -ge 200 -and $frontResponse.StatusCode -lt 400 } catch {} }; if($localBackend.Count -gt 0){ try { $backResponse=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/config' -TimeoutSec 4; $backHealthy=$backResponse.StatusCode -ge 200 -and $backResponse.StatusCode -lt 400 } catch {} }; if($frontHealthy -and $backHealthy){ exit 10 }; $unknown=@($records | Where-Object { -not $_.IsMian }); if($unknown.Count -gt 0){ Write-Host 'The following target port is owned by an unknown process:'; foreach($record in $unknown){ $name=if($null -eq $record.Owner){'unknown'}else{$record.Owner.Name}; Write-Host ('  {0}:{1} PID={2} {3}' -f $record.Listener.LocalAddress,$record.Listener.LocalPort,$record.Listener.OwningProcess,$name) }; exit 20 }; Write-Host 'Stopping confirmed stale Mian listener(s) before LAN startup...'; $processIds=@($records | ForEach-Object { $_.Listener.OwningProcess } | Sort-Object -Unique); foreach($processId in $processIds){ Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; $remaining=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5173,8787 }); if($remaining.Count -gt 0){ exit 21 }; exit 0"
set "MIAN_CHECK_CODE=%ERRORLEVEL%"

if "%MIAN_CHECK_CODE%"=="0" goto :START_MIAN
if "%MIAN_CHECK_CODE%"=="10" goto :ALREADY_RUNNING
if "%MIAN_CHECK_CODE%"=="20" goto :UNKNOWN_PORT_OWNER
if "%MIAN_CHECK_CODE%"=="21" goto :STALE_PROCESS_ERROR
goto :CHECK_ERROR

:START_MIAN
echo.
call :SAY 5q2j5Zyo5ZCv5YqoIE1pYW4g5bGA5Z+f572R5rWL6K+V5qih5byP4oCm4oCm
echo LAN URL: %MIAN_LAN_URL%
call :SAY 5omL5py66K6/6Zeu5pyf6Ze06K+35L+d5oyB5q2k56qX5Y+j5byA5ZCv44CC
echo.
call npm.cmd run dev:lan
set "MIAN_EXIT_CODE=%ERRORLEVEL%"
echo.
call :SAY TWlhbiDmnI3liqHlt7LlgZzmraLjgII=
echo Exit code: %MIAN_EXIT_CODE%
goto :WAIT_AND_EXIT

:ALREADY_RUNNING
echo.
call :SAY 5pyN5Yqh5Y+v6IO95bey57uP5Zyo6L+Q6KGM77yM6K+35LiN6KaB5YWz6Zet5Y6f5p2l55qEIE1pYW4g56qX5Y+j44CC
echo LAN URL: %MIAN_LAN_URL%
call :SAY 5b2T5YmN56qX5Y+j5rKh5pyJ5ZCv5Yqo56ys5LqM5aWX5pyN5Yqh44CC
goto :WAIT_AND_EXIT

:UNKNOWN_PORT_OWNER
echo.
call :SAY 56uv5Y+j5bey6KKr5p2l5rqQ5LiN5piO55qE6L+b56iL5Y2g55So77yb5Li66YG/5YWN6K+v5Lyk77yM5rKh5pyJ5YGc5q2i5Lu75L2V6L+b56iL44CC
goto :WAIT_AND_EXIT

:STALE_PROCESS_ERROR
echo.
call :SAY 5bey56Gu6K6k5pen55uR5ZCs5bGe5LqOIE1pYW7vvIzkvYbnq6/lj6PmnKrog73lronlhajph4rmlL7jgII=
goto :WAIT_AND_EXIT

:CHECK_ERROR
echo.
call :SAY 56uv5Y+j5LiO5pyN5Yqh54q25oCB5qOA5p+l5aSx6LSl44CC
echo Check exit code: %MIAN_CHECK_CODE%
goto :WAIT_AND_EXIT

:PROJECT_ERROR
echo.
call :SAY 5peg5rOV6L+b5YWl6aG555uu55uu5b2V44CC
echo %~dp0
goto :WAIT_AND_EXIT

:WAIT_AND_EXIT
echo.
call :SAY 5oyJ5Lu75oSP6ZSu5YWz6Zet5q2k56qX5Y+j44CC
pause >nul
exit /b 0

:SAY
powershell.exe -NoLogo -NoProfile -Command "[Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%~1')))"
exit /b 0
