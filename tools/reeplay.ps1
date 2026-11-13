param(
    [Parameter(Position = 0)]
    [ValidateSet("Setup", "Start", "Stop", "Logs", "Test", "Reset", "Seed", "Health", "Tools")]
    [string]$Action = "Start"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DevEnv = Join-Path $ProjectRoot ".env.development"
$TestEnv = Join-Path $ProjectRoot ".env.test"

Set-Location -LiteralPath $ProjectRoot

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' is required but was not found. Install Docker Desktop (WSL2 backend) and reopen PowerShell."
    }
}

function Initialize-Environment {
    if (-not (Test-Path -LiteralPath $DevEnv)) {
        Copy-Item -LiteralPath ".env.example" -Destination $DevEnv
        Write-Host "Created .env.development; review its local-only values before starting."
    }
    if (-not (Test-Path -LiteralPath $TestEnv)) {
        Copy-Item -LiteralPath ".env.test.example" -Destination $TestEnv
        Write-Host "Created .env.test; review its local-only values before testing."
    }
    if (-not (Test-Path -LiteralPath "node_modules")) {
        npm ci
    }
}

function Invoke-Compose([string[]]$Arguments) {
    Assert-Command "docker"
    & docker compose --env-file $DevEnv @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

switch ($Action) {
    "Setup" {
        Assert-Command "node"
        Assert-Command "npm"
        Assert-Command "docker"
        Initialize-Environment
        Invoke-Compose @("config", "--quiet")
        Write-Host "Local configuration is ready. Run: .\tools\reeplay.ps1 Start"
    }
    "Start" {
        Initialize-Environment
        Invoke-Compose @("up", "-d", "--wait", "mongodb")
        npm run dev
    }
    "Stop" { Invoke-Compose @("down") }
    "Logs" { Invoke-Compose @("logs", "-f", "mongodb") }
    "Test" {
        Initialize-Environment
        Invoke-Compose @("up", "-d", "--wait", "mongodb")
        npm test
    }
    "Reset" {
        Write-Host "Resetting only the Docker project 'reeplay-local' and its local MongoDB volume."
        Invoke-Compose @("down", "--volumes", "--remove-orphans")
        Invoke-Compose @("up", "-d", "--wait", "mongodb")
        $env:NODE_ENV = "development"
        $env:ENV_FILE = ".env.development"
        node scripts/db/seed-local.js
    }
    "Seed" {
        $env:NODE_ENV = "development"
        $env:ENV_FILE = ".env.development"
        node scripts/db/seed-local.js
    }
    "Health" {
        Invoke-RestMethod -Uri "http://127.0.0.1:3000/health"
        try { Invoke-RestMethod -Uri "http://127.0.0.1:3000/ready" } catch { $_.ErrorDetails.Message }
    }
    "Tools" { Invoke-Compose @("--profile", "tools", "up", "-d", "--wait") }
}
