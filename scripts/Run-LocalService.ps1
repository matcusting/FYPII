param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('api', 'email', 'frontend')]
  [string] $Service
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($Service -eq 'frontend') {
  Set-Location (Join-Path $repoRoot 'uts-housing-frontend')
  $label = 'Frontend (http://localhost:5173)'
  $arguments = @('run', 'dev', '--', '--host', 'localhost', '--port', '5173', '--strictPort')
} else {
  Set-Location (Join-Path $repoRoot 'uts-housing-api')
  $label = if ($Service -eq 'api') { 'API (http://127.0.0.1:3001)' } else { 'Email worker' }
  $arguments = if ($Service -eq 'api') { @('run', 'dev') } else { @('run', 'email:worker') }
}

try { $Host.UI.RawUI.WindowTitle = "UTS Housing - $label" } catch { }
Write-Host "Starting $label from $(Get-Location). Keep this window open while using the site."
& npm.cmd @arguments
if ($LASTEXITCODE -ne 0) {
  Write-Host "$label stopped with exit code $LASTEXITCODE. Check the error above." -ForegroundColor Red
}
