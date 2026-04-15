<#
.SYNOPSIS
  Run containerized integration tests with guaranteed cleanup.

.DESCRIPTION
  - Starts the mock backend via docker compose
  - Waits for service readiness
  - Runs integration tests
  - Prints helpful logs on failure
  - Always performs teardown (even when tests fail)

.NOTES
  Requirements:
    - Docker Desktop running
    - pnpm installed
    - repo dependencies installed (`pnpm install`)
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Config
$RepoPath = "C:\Users\andreumv\Documents\Claude\Projects\electron-ipc-helper"
$ComposeFile = "docker-compose.integration.yml"
$ServiceName = "mock-backend"
$BaseUrl = "http://127.0.0.1:4010"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command '$Name' was not found in PATH."
  }
}

function Test-DockerRunning {
  docker version | Out-Null
}

function Wait-HttpHealthy([string]$Url, [int]$Attempts = 20, [int]$DelaySeconds = 2) {
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method GET -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        return
      }
    }
    catch {
      # Keep retrying until timeout budget is exhausted.
    }
    Start-Sleep -Seconds $DelaySeconds
  }
  throw "Service did not become healthy at $Url after $Attempts attempts."
}

Write-Step "Validating prerequisites"
Assert-Command "docker"
Assert-Command "pnpm"

if (-not (Test-Path $RepoPath)) {
  throw "Repository path does not exist: $RepoPath"
}

Set-Location $RepoPath

if (-not (Test-Path $ComposeFile)) {
  throw "Compose file not found: $ComposeFile"
}

Write-Step "Checking Docker availability"
Test-DockerRunning

Write-Step "Validating docker compose config"
docker compose -f $ComposeFile config | Out-Null

$TestsFailed = $false

try {
  Write-Step "Starting mock backend containers (build + wait)"
  try {
    docker compose -f $ComposeFile up -d --build --wait
  }
  catch {
    Write-Host "Could not use '--wait'. Falling back to HTTP health polling." -ForegroundColor Yellow
    docker compose -f $ComposeFile up -d --build
    Wait-HttpHealthy -Url "$BaseUrl/health" -Attempts 30 -DelaySeconds 2
  }

  Write-Step "Running integration tests"
  $PreviousRunIntegration = $env:RUN_INTEGRATION
  $env:RUN_INTEGRATION = "1"
  try {
    pnpm run test:integration
  }
  finally {
    if ($null -eq $PreviousRunIntegration) {
      Remove-Item Env:RUN_INTEGRATION -ErrorAction SilentlyContinue
    }
    else {
      $env:RUN_INTEGRATION = $PreviousRunIntegration
    }
  }

  Write-Step "Integration tests finished successfully"
}
catch {
  $TestsFailed = $true
  Write-Host ""
  Write-Host "Integration run failed: $($_.Exception.Message)" -ForegroundColor Red

  Write-Step "Mock backend logs for diagnosis"
  try {
    docker compose -f $ComposeFile logs --tail=200 $ServiceName
  }
  catch {
    Write-Host "Could not collect backend logs." -ForegroundColor Yellow
  }

  throw
}
finally {
  Write-Step "Tearing down containers and volumes"
  try {
    docker compose -f $ComposeFile down -v
    Write-Host "Cleanup completed." -ForegroundColor Green
  }
  catch {
    Write-Host "Cleanup encountered an issue: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  Write-Host ""
  if ($TestsFailed) {
    Write-Host "Final result: FAILED (cleanup attempted)." -ForegroundColor Red
  }
  else {
    Write-Host "Final result: OK (cleanup completed)." -ForegroundColor Green
  }
}

