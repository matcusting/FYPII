[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('create', 'verify', 'rehearse')][string] $Action,
  [Parameter(Mandatory = $true)][string] $File
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$api = Join-Path $project 'uts-housing-api'
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 before using local backups.' }
if ($Action -ne 'verify' -and -not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Start Docker Desktop before creating or rehearsing a backup.' }

$first = Read-Host 'Backup passphrase (at least 16 characters; keep it privately)' -AsSecureString
$plain = ([System.Net.NetworkCredential]::new('', $first)).Password
if ($plain.Length -lt 16) { throw 'The backup passphrase must contain at least 16 characters.' }
if ($Action -eq 'create') {
  $second = Read-Host 'Enter the same backup passphrase again' -AsSecureString
  if (([System.Net.NetworkCredential]::new('', $second)).Password -cne $plain) { throw 'The two passphrases do not match.' }
}

Push-Location $api
try {
  $env:UTS_BACKUP_PASSPHRASE = $plain
  $flag = if ($Action -eq 'create') { "--output=$File" } else { "--file=$File" }
  & node.exe --env-file-if-exists=.env (Join-Path $project 'scripts/local-backup.mjs') $Action $flag
  if ($LASTEXITCODE -ne 0) { throw "Local backup $Action failed. Read the error above." }
} finally {
  Remove-Item Env:\UTS_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $plain = $null
  Pop-Location
}
