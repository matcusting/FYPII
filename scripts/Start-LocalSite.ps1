[CmdletBinding()]
param([switch] $SeedDemo)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiDirectory = Join-Path $repoRoot 'uts-housing-api'
$frontendDirectory = Join-Path $repoRoot 'uts-housing-frontend'

function Require-Command([string] $Name, [string] $Instruction) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $Instruction"
  }
}

function Require-ExitCode([string] $Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit code $LASTEXITCODE). Read its output above." }
}

function In-Directory([string] $Directory, [scriptblock] $Action) {
  Push-Location $Directory
  try { & $Action } finally { Pop-Location }
}

function Ensure-Packages([string] $Directory) {
  $lockPath = Join-Path $Directory 'package-lock.json'
  $stampPath = Join-Path $Directory 'node_modules\.fypii-lock-sha256'
  $lockHash = (Get-FileHash -Algorithm SHA256 $lockPath).Hash
  $installedHash = if (Test-Path $stampPath) { (Get-Content -Raw $stampPath).Trim() } else { '' }
  if ($installedHash -eq $lockHash) {
    Write-Host "Dependencies already match $Directory"
    return
  }
  In-Directory $Directory {
    Write-Host "Installing locked dependencies in $(Get-Location)..."
    & npm.cmd ci
    Require-ExitCode 'npm ci'
  }
  [System.IO.File]::WriteAllText($stampPath, $lockHash)
}

function Wait-ForHttp([string] $Uri, [string] $Label) {
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
      $result = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
      if ($result.StatusCode -eq 200 -and $result.Headers['Content-Type'] -match 'application/json') { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "$Label did not become ready at $Uri. Check its service window for the error."
}

function Test-LocalClamAvReady {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', 3310)
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2500
    $stream.WriteTimeout = 2500
    $command = [System.Text.Encoding]::ASCII.GetBytes("zPING`0")
    $stream.Write($command, 0, $command.Length)
    $reply = New-Object System.Text.StringBuilder
    for ($byteIndex = 0; $byteIndex -lt 16; $byteIndex++) {
      $value = $stream.ReadByte()
      if ($value -le 0 -or $value -eq 10) { break }
      [void] $reply.Append([char] $value)
    }
    return $reply.ToString() -eq 'PONG'
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Start-LocalClamAv {
  # Older local installs may already have the standalone scanner used during
  # migration. Reuse it instead of binding a second container to port 3310.
  $standalone = [string] (& docker.exe ps -a --filter 'name=^/uts-housing-clamav$' --format '{{.Names}}')
  Require-ExitCode 'Checking the standalone ClamAV container'
  if ($standalone.Trim() -eq 'uts-housing-clamav') {
    $binding = [string] (& docker.exe port uts-housing-clamav 3310/tcp)
    Require-ExitCode 'Checking the standalone ClamAV port'
    if ($binding.Trim() -ne '127.0.0.1:3310') {
      throw 'The existing uts-housing-clamav container must publish only 127.0.0.1:3310. Check its Docker port mapping.'
    }
    $running = [string] (& docker.exe ps --filter 'name=^/uts-housing-clamav$' --format '{{.Names}}')
    Require-ExitCode 'Checking the standalone ClamAV state'
    if ($running.Trim() -ne 'uts-housing-clamav') {
      & docker.exe start uts-housing-clamav | Out-Null
      Require-ExitCode 'Starting the standalone ClamAV container'
    }
    Write-Host 'Using the existing loopback-only uts-housing-clamav container.'
  } else {
    Write-Host 'Starting the loopback-only ClamAV container...'
    In-Directory $repoRoot {
      & docker.exe compose up -d clamav
      Require-ExitCode 'Starting ClamAV'
    }
  }
  for ($attempt = 0; $attempt -lt 150; $attempt++) {
    if (Test-LocalClamAvReady) {
      Write-Host 'ClamAV is ready to scan local document uploads.'
      return
    }
    if ($attempt % 6 -eq 0) { Write-Host 'Waiting for ClamAV and its virus signatures to become ready...' }
    Start-Sleep -Seconds 4
  }
  throw 'ClamAV did not become ready on 127.0.0.1:3310. Check the scanner container logs in Docker Desktop.'
}

function New-LocalSessionSecret {
  $random = New-Object byte[] 48
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($random) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($random).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Assert-LocalDatabase([string] $EnvironmentFile) {
  if ($env:NODE_ENV -eq 'production') {
    throw 'This launcher is for local development. Remove NODE_ENV=production from the shell before using it.'
  }
  $contents = [System.IO.File]::ReadAllText($EnvironmentFile)
  $match = [regex]::Match($contents, '(?m)^\s*DATABASE_URL\s*=\s*(.+?)\s*$')
  $databaseUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } elseif ($match.Success) { $match.Groups[1].Value.Trim().Trim('"').Trim("'") } else { '' }
  try { $uri = [uri] $databaseUrl } catch { throw 'DATABASE_URL is missing or invalid in uts-housing-api/.env.' }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('postgresql', 'postgres') -or
      $uri.Host -notin @('localhost', '127.0.0.1') -or $uri.Port -ne 5432 -or
      $uri.AbsolutePath.Trim('/') -ne 'housing') {
    throw 'This launcher only migrates the local Docker housing database on localhost:5432. Check DATABASE_URL without sharing its password.'
  }
}

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This launcher is for Windows. Use the commands in README.md on other systems.'
  }
  if (-not (Test-Path (Join-Path $repoRoot 'docker-compose.yml'))) {
    throw "The repository is incomplete at $repoRoot. Extract or clone the whole FYPII project first."
  }
  Require-Command 'node.exe' 'Install Node.js 24 from https://nodejs.org/ and reopen PowerShell.'
  Require-Command 'npm.cmd' 'Install Node.js 24 from https://nodejs.org/ and reopen PowerShell.'
  Require-Command 'docker.exe' 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and start it.'
  $nodeVersion = (& node.exe --version).Trim()
  Require-ExitCode 'Checking Node.js'
  if ($nodeVersion -notmatch '^v(\d+)\.') {
    throw "Could not read the Node.js version: $nodeVersion."
  }
  if ([int] $Matches[1] -lt 24) {
    throw "Node.js 24 or newer is required; found $nodeVersion."
  }
  & docker.exe compose version | Out-Null
  Require-ExitCode 'Docker Compose'
  & docker.exe info --format '{{.ServerVersion}}' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is installed but not running. Start Docker Desktop and wait until it is ready.' }

  Write-Host "Project folder: $repoRoot"
  Write-Host 'Starting the local PostgreSQL container...'
  In-Directory $repoRoot {
    & docker.exe compose up -d postgres
    Require-ExitCode 'Starting PostgreSQL'
  }
  $databaseReady = $false
  In-Directory $repoRoot {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      & docker.exe compose exec -T postgres pg_isready -U housing -d housing 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $script:databaseReady = $true; break }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $databaseReady) { throw 'PostgreSQL did not become ready. Check Docker Desktop and port 5432.' }
  Start-LocalClamAv

  $envPath = Join-Path $apiDirectory '.env'
  $sampleSecret = 'replace-with-a-random-secret-at-least-32-characters'
  if (-not (Test-Path $envPath)) {
    $example = [System.IO.File]::ReadAllText((Join-Path $apiDirectory '.env.example'))
    $contents = $example.Replace($sampleSecret, (New-LocalSessionSecret))
    [System.IO.File]::WriteAllText($envPath, $contents, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Created uts-housing-api/.env with a new local session secret.'
  } else {
    Assert-LocalDatabase $envPath
    $existing = [System.IO.File]::ReadAllText($envPath)
    if ($existing.Contains("SESSION_SECRET=$sampleSecret")) {
      $updated = $existing.Replace("SESSION_SECRET=$sampleSecret", "SESSION_SECRET=$(New-LocalSessionSecret)")
      [System.IO.File]::WriteAllText($envPath, $updated, [System.Text.UTF8Encoding]::new($false))
      Write-Host 'Replaced only the known sample session secret in the existing .env; other settings were preserved.'
    } else {
      Write-Host 'Using the existing uts-housing-api/.env without changing it.'
    }
  }
  Assert-LocalDatabase $envPath

  Ensure-Packages $apiDirectory
  Ensure-Packages $frontendDirectory
  In-Directory $apiDirectory {
    & npm.cmd run db:generate
    Require-ExitCode 'Generating the Prisma client'
    & npm.cmd run db:deploy
    Require-ExitCode 'Applying database migrations'
    if ($SeedDemo) {
      & npm.cmd run db:init-local -- --keep-demo-admin
    } else {
      & npm.cmd run db:init-local
    }
    Require-ExitCode 'Creating the private local administrator and campus'
    if ($SeedDemo) {
      $env:CONFIRM_DEMO_SEED = '1'
      try {
        & npm.cmd run db:seed
        Require-ExitCode 'Adding fictional demo records'
      } finally { Remove-Item Env:\CONFIRM_DEMO_SEED -ErrorAction SilentlyContinue }
    }
    & npm.cmd run locations:backfill
    Require-ExitCode 'Updating campus distances for existing listings'
  }

  $runner = Join-Path $PSScriptRoot 'Run-LocalService.ps1'
  # Child processes inherit these explicit loopback settings, even if the
  # launching PowerShell window had unrelated environment variables set.
  $env:HOST = '127.0.0.1'
  $env:PORT = '3001'
  $env:FRONTEND_ORIGIN = 'http://localhost:5173'
  $env:PUBLIC_BASE_URL = 'http://localhost:5173'
  $env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:3001'
  # Node's --env-file leaves inherited variables unchanged. This forces real
  # local scanning even when an older preserved .env lacks these settings or
  # still contains the old synthetic-file test-bypass value.
  $env:MALWARE_SCAN_MODE = 'clamav'
  $env:CLAMAV_HOST = '127.0.0.1'
  $env:CLAMAV_PORT = '3310'
  $env:CLAMAV_SOCKET = ''
  foreach ($service in @('api', 'email', 'frontend')) {
    $childArguments = '-NoExit -NoProfile -ExecutionPolicy Bypass -File "{0}" -Service {1}' -f $runner, $service
    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $repoRoot -ArgumentList $childArguments | Out-Null
  }
  Wait-ForHttp 'http://127.0.0.1:3001/health/ready' 'API and database'
  Wait-ForHttp 'http://localhost:5173/api/v1/campuses' 'Frontend and API proxy'
  Write-Host ''
  Write-Host 'The REAL local site is ready: http://localhost:5173' -ForegroundColor Green
  Write-Host 'Keep the API, email worker and frontend windows open. This is separate from the 127.0.0.1:4173 memory preview.'
  Write-Host 'On first run, save the one-time local administrator password printed above. It is not shown again.'
  Write-Host 'Email links without SMTP are in uts-housing-api\data\outbox. Test with fictional accounts and files only.'
  $chromePaths = @('ProgramFiles', 'ProgramFiles(x86)') |
    ForEach-Object { [Environment]::GetEnvironmentVariable($_) } |
    Where-Object { $_ } |
    ForEach-Object { Join-Path $_ 'Google\Chrome\Application\chrome.exe' }
  $chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList 'http://localhost:5173/' | Out-Null }
  Write-Host 'If Chrome did not open, enter http://localhost:5173/ in its address bar.'
} catch {
  Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
