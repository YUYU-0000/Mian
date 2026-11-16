# 安装当前用户的 Mian、隧道与每日备份计划任务。
# Run as the Windows user whose Codex login Mian should use.
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe).Source
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$startup = New-ScheduledTaskTrigger -AtLogOn -User $account
$daily = New-ScheduledTaskTrigger -Daily -At '02:00'
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$backupSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
foreach ($mode in @('service', 'tunnel', 'backup')) {
    $taskName = 'Mian-' + (Get-Culture).TextInfo.ToTitleCase($mode)
    $arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Mode {1} -NodePath "{2}"' -f (Join-Path $PSScriptRoot 'windows-task.ps1'), $mode, $nodePath
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectDirectory
    $trigger = if ($mode -eq 'backup') { $daily } else { $startup }
    $taskSettings = if ($mode -eq 'backup') { $backupSettings } else { $settings }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $taskSettings -Principal $principal -Description ('Mian ' + $mode + '; config and logs in ' + $projectDirectory) -Force | Select-Object TaskName, State
}

