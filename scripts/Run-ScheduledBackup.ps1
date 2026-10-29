[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$settingsDirectory = Join-Path $env:LOCALAPPDATA 'UTSHousingBackup'
$configFile = Join-Path $settingsDirectory 'schedule.json'
$secretFile = Join-Path $settingsDirectory 'passphrase.dpapi'
$logFile = Join-Path $settingsDirectory 'backup.log'
$lockFile = Join-Path $settingsDirectory 'backup.lock'

function Log([string] $Message) {
  Add-Content -LiteralPath $logFile -Value ('{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message)
}

function Retire-OldArchives([string] $Directory, [int] $Days, [int] $Keep) {
  if ($Days -eq 0) { return }
  $archives = @(Get-ChildItem -LiteralPath $Directory -File -Filter 'housing-auto-*.uthbak' | Sort-Object LastWriteTime -Descending)
  $cutoff = (Get-Date).AddDays(-$Days)
  for ($index = $Keep; $index -lt $archives.Count; $index++) {
    if ($archives[$index].LastWriteTime -lt $cutoff) {
      Remove-Item -LiteralPath $archives[$index].FullName -Force
      Log ('Removed expired scheduled archive: {0}' -f $archives[$index].Name)
    }
  }
}

$lock = $null
try {
  $lock = [IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None')
  if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { throw 'Backup schedule is not installed.' }
  $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
  if ($config.version -ne 1 -or -not $config.project -or -not $config.destination) { throw 'Backup schedule configuration is invalid.' }
  $project = $config.project
  $backupScript = Join-Path $project 'scripts\Backup-LocalSite.ps1'
  if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) { throw 'The project folder has moved. Reinstall the backup schedule.' }
  if (-not (Test-Path -LiteralPath $config.destination -PathType Container)) { throw 'The backup destination is unavailable.' }
  if ($config.mirror -and -not (Test-Path -LiteralPath $config.mirror -PathType Container)) { throw 'The backup mirror is unavailable.' }
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is unavailable.' }
  Push-Location $project
  try {
    & docker.exe compose up -d postgres | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not start.' }
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $name = 'housing-auto-{0}-{1}.uthbak' -f $stamp, [guid]::NewGuid().ToString('N').Substring(0, 8)
    $file = Join-Path $config.destination $name
    Log 'Starting scheduled encrypted backup.'
    & $backupScript -Action create -File $file -PassphraseFile $secretFile
    & $backupScript -Action verify -File $file -PassphraseFile $secretFile

    # A weekly disposable-database restore detects backups that authenticate but
    # cannot actually be used with PostgreSQL or their private media references.
    $marker = Join-Path $settingsDirectory 'last-rehearsal.txt'
    $last = if (Test-Path -LiteralPath $marker) { Get-Item -LiteralPath $marker | Select-Object -ExpandProperty LastWriteTime } else { [datetime]::MinValue }
    if ((Get-Date) - $last -ge [timespan]::FromDays(7)) {
      & $backupScript -Action rehearse -File $file -PassphraseFile $secretFile
      Set-Content -LiteralPath $marker -Value $stamp -Encoding Ascii
      Log 'Isolated restore rehearsal passed.'
    }

    if ($config.mirror) {
      $mirrorFile = Join-Path $config.mirror $name
      Copy-Item -LiteralPath $file -Destination $mirrorFile -ErrorAction Stop
      $sourceHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
      $mirrorHash = (Get-FileHash -LiteralPath $mirrorFile -Algorithm SHA256).Hash
      if ($sourceHash -cne $mirrorHash) { Remove-Item -LiteralPath $mirrorFile -Force; throw 'The mirrored backup checksum did not match.' }
      Log 'Mirrored backup checksum passed.'
    }
    Retire-OldArchives $config.destination ([int] $config.retainDays) ([int] $config.minimumCopies)
    if ($config.mirror) { Retire-OldArchives $config.mirror ([int] $config.retainDays) ([int] $config.minimumCopies) }
    Log ('Backup completed: {0}' -f $name)
  } finally { Pop-Location }
} catch {
  Log ('BACKUP FAILED: {0}' -f $_.Exception.Message)
  Write-Error ('Scheduled backup failed: {0}' -f $_.Exception.Message)
  exit 1
} finally {
  if ($lock) { $lock.Dispose() }
}
