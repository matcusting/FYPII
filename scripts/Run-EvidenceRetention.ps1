param(
  [switch]$StudentOfferEnd,
  [int]$IdentityYears = 0,
  [int]$PropertyYears = 0,
  [int]$Limit = 100,
  [switch]$Apply,
  [switch]$ConfirmMaintenance,
  [string]$ActorEmail = ''
)

$ErrorActionPreference = 'Stop'
if (-not $StudentOfferEnd -and $IdentityYears -eq 0 -and $PropertyYears -eq 0) {
  throw 'Select at least one approved evidence-retention category.'
}
if ($Apply) {
  if (-not $ConfirmMaintenance -or [string]::IsNullOrWhiteSpace($ActorEmail)) {
    throw 'Apply requires -ConfirmMaintenance and -ActorEmail for an active administrator.'
  }
  # This wrapper is for the default Windows local site. Stop the API before
  # moving private evidence files so an in-flight download cannot race it.
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $apiListener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($apiListener) { throw 'The local API is listening on port 3001. Stop it before applying evidence retention.' }
  }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiRoot = Join-Path $projectRoot 'uts-housing-api'
$arguments = @('run', 'evidence:retention', '--', "--limit=$Limit")
if ($StudentOfferEnd) { $arguments += '--student-offer-end' }
if ($IdentityYears -ne 0) { $arguments += "--identity-years=$IdentityYears" }
if ($PropertyYears -ne 0) { $arguments += "--property-years=$PropertyYears" }
if ($Apply) {
  $arguments += '--apply'
  $arguments += '--confirm-maintenance'
  $arguments += '--confirm=DELETE_ELIGIBLE_EVIDENCE'
  $arguments += "--actor-email=$ActorEmail"
}

Push-Location $apiRoot
try {
  & npm.cmd @arguments
  $result = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $result
