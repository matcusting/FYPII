[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $DestinationDirectory,
  [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string] $DailyAt = '02:00',
  [string] $MirrorDirectory,
  [ValidateRange(0, 3650)][int] $RetainDays = 0,
  [ValidateRange(1, 1000)][int] $MinimumCopies = 7
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run this installer in Windows PowerShell on the computer hosting the local site.' }
if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) { throw 'Windows Task Scheduler is unavailable.' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'Run-ScheduledBackup.ps1'
$taskName = 'UTS Housing Encrypted Local Backup'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$accountSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$settingsDirectory = Join-Path $env:LOCALAPPDATA 'UTSHousingBackup'
$configFile = Join-Path $settingsDirectory 'schedule.json'
$secretFile = Join-Path $settingsDirectory 'passphrase.dpapi'

function Resolve-BackupDirectory([string] $Path) {
  if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Use a full destination path, such as E:\UTS-Backups or a UNC network path.' }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  if (-not $resolved.Equals([IO.Path]::GetPathRoot($resolved), [StringComparison]::OrdinalIgnoreCase)) {
    $resolved = $resolved.TrimEnd('\', '/')
  }
  $projectPrefix = $project.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if ($resolved.Equals($project, [StringComparison]::OrdinalIgnoreCase) -or
      $resolved.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep backups outside the project folder and Git.'
  }
  $probe = Join-Path $resolved ([IO.Path]::GetRandomFileName())
  try { [IO.File]::WriteAllText($probe, 'backup destination check') } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
  return $resolved
}

$destination = Resolve-BackupDirectory $DestinationDirectory
$mirror = if ($MirrorDirectory) { Resolve-BackupDirectory $MirrorDirectory } else { $null }
if ($mirror -and $destination.Equals($mirror, [StringComparison]::OrdinalIgnoreCase)) { throw 'The mirror must be a different directory.' }

$first = $null
if (Test-Path -LiteralPath $secretFile -PathType Leaf) {
  $first = (Get-Content -LiteralPath $secretFile -Raw).Trim() | ConvertTo-SecureString
  if (([System.Net.NetworkCredential]::new('', $first)).Password.Length -lt 16) { throw 'The existing protected backup passphrase is invalid.' }
  Write-Host 'Keeping the existing protected passphrase so older scheduled backups remain readable.'
} else {
  $first = Read-Host 'Choose a private backup passphrase (at least 16 characters)' -AsSecureString
  $plain = ([System.Net.NetworkCredential]::new('', $first)).Password
  if ($plain.Length -lt 16) { throw 'The backup passphrase must contain at least 16 characters.' }
  $second = Read-Host 'Enter the same passphrase again' -AsSecureString
  if (([System.Net.NetworkCredential]::new('', $second)).Password -cne $plain) { throw 'The two passphrases do not match.' }
  $plain = $null
}

New-Item -ItemType Directory -Path $settingsDirectory -Force | Out-Null
$acl = Get-Acl -LiteralPath $settingsDirectory
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object -TypeName Security.AccessControl.FileSystemAccessRule -ArgumentList @(
  $accountSid,
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
  [Security.AccessControl.PropagationFlags]::None,
  [Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $settingsDirectory -AclObject $acl

if (-not (Test-Path -LiteralPath $secretFile -PathType Leaf)) {
  $first | ConvertFrom-SecureString | Set-Content -LiteralPath $secretFile -Encoding Ascii
}
@{
  version = 1
  project = $project
  destination = $destination
  mirror = $mirror
  retainDays = $RetainDays
  minimumCopies = $MinimumCopies
} | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8

$parts = $DailyAt.Split(':')
$at = (Get-Date).Date.AddHours([int] $parts[0]).AddMinutes([int] $parts[1])
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runner) -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $at
# Interactive logon keeps the task under the same DPAPI user and permits an
# authenticated UNC share. StartWhenAvailable catches a missed time after boot.
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Description 'Encrypted local PostgreSQL and private media backup; site must be closed.' -Force | Out-Null

Write-Host "Scheduled $taskName daily at $DailyAt for the signed-in Windows user."
Write-Host "Encrypted archives will be written to $destination."
if ($mirror) { Write-Host "A verified second copy will be written to $mirror." }
Write-Host 'The site must be closed; leave Docker Desktop running. Check the task result and backup log after the first run.'
Write-Host 'Remember the passphrase separately: DPAPI protects the scheduler copy, but it cannot be recovered on another PC.'
