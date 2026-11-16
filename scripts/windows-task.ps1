param(
    [Parameter(Mandatory)][ValidateSet('service', 'tunnel', 'backup')][string]$Mode,
    [Parameter(Mandatory)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
$runtimeDirectory = & $NodePath --input-type=module -e "import {runtimeDirectory} from './shared/deployment.mjs'; console.log(runtimeDirectory)"
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
$log = Join-Path $runtimeDirectory ($Mode + '.log')
if ($Mode -ne 'backup') {
    Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class MianPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }'
    # Keep the machine awake while serving. Display sleep remains available.
    [MianPower]::SetThreadExecutionState([uint32]2147483649) | Out-Null
}
try {
    Add-Content -LiteralPath $log -Value ("`nMian $Mode started " + (Get-Date -Format o)) -Encoding UTF8
    # Native stderr is normal for cloudflared. Preserve its exit code for task retries.
    $ErrorActionPreference = 'Continue'
    & $NodePath (Join-Path $PSScriptRoot ($Mode + '.mjs')) 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
    $result = $LASTEXITCODE
} finally {
    if ($Mode -ne 'backup') { [MianPower]::SetThreadExecutionState([uint32]2147483648) | Out-Null }
}
exit $result

