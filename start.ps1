# One-command Botanical start: Docker Compose, secrets, optional coding CLIs.
# Windows PowerShell 5.1+ and pwsh. Re-running keeps existing .env values.
# Writes .env as UTF-8 without BOM, LF line endings.
#
#   .\start.ps1
#   .\start.ps1 -Yes
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
#   .\start.ps1 --yes --no-cli
$ErrorActionPreference = 'Continue'

$Root = $PSScriptRoot
if ([string]::IsNullOrEmpty($Root)) {
  $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
}
Set-Location $Root
$EnvFile = Join-Path $Root '.env'
$ExampleFile = Join-Path $Root '.env.example'

$Yes = $false
$NoCli = $false
$SkipUp = $false

foreach ($arg in $args) {
  switch -Regex ($arg) {
    '^(--yes|-Yes|-yes|-y)$' { $Yes = $true; continue }
    '^(--no-cli|-NoCli|-nocli)$' { $NoCli = $true; continue }
    '^(--skip-up)$' { $SkipUp = $true; continue }
    '^(--help|-h)$' {
      Write-Host @'
Start Botanical with Docker Compose.

  .\start.ps1
  .\start.ps1 -Yes
  powershell -ExecutionPolicy Bypass -File .\start.ps1

  --yes / -Yes     Accept defaults (port 3000, include coding CLIs, skip API key)
  --no-cli / -NoCli  Do not use docker-compose.cli.yml
'@
      exit 0
    }
    default {
      [Console]::Error.WriteLine("start.ps1: unknown argument: $arg")
      exit 2
    }
  }
}

if ($env:BOTANICAL_START_SKIP_UP) { $SkipUp = $true }

$ShellProject = $env:COMPOSE_PROJECT_NAME
$ShellWebPort = $env:WEB_PORT
$ShellServerPort = $env:SERVER_PORT
$ShellPostgresPort = $env:POSTGRES_PORT
$ShellPublicOrigin = $env:BOTANICAL_PUBLIC_ORIGIN

function Write-StartError([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

function Write-Utf8NoBomLf([string]$Path, [string]$Content) {
  $normalized = $Content -replace "`r`n", "`n" -replace "`r", "`n"
  if (-not $normalized.EndsWith("`n")) {
    $normalized += "`n"
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $normalized, $utf8)
}

function Get-EnvLines {
  if (-not (Test-Path $EnvFile)) { return @() }
  $raw = [System.IO.File]::ReadAllText($EnvFile)
  $raw = $raw -replace "`r`n", "`n" -replace "`r", "`n"
  if ($raw.EndsWith("`n")) {
    $raw = $raw.Substring(0, $raw.Length - 1)
  }
  if ($raw.Length -eq 0) { return @() }
  return $raw.Split("`n")
}

function Get-EnvValue([string]$Key) {
  $value = $null
  foreach ($line in (Get-EnvLines)) {
    if ($line.StartsWith("$Key=")) {
      $value = $line.Substring($Key.Length + 1)
    }
  }
  if ($null -eq $value) { return '' }
  if ($value.Length -ge 2) {
    $q = $value[0]
    if (($q -eq '"' -or $q -eq "'") -and $value[$value.Length - 1] -eq $q) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  return $value
}

function Set-EnvValue([string]$Key, [string]$Value) {
  $lines = New-Object System.Collections.Generic.List[string]
  $found = $false
  foreach ($line in (Get-EnvLines)) {
    if ($line.StartsWith("$Key=")) {
      [void]$lines.Add("$Key=$Value")
      $found = $true
    } else {
      [void]$lines.Add($line)
    }
  }
  if (-not $found) {
    [void]$lines.Add("$Key=$Value")
  }
  Write-Utf8NoBomLf $EnvFile ($lines -join "`n")
}

function Test-Placeholder([string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return $true }
  return $Value -match 'change-me'
}

function Get-Base64Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Get-HexSecret([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $sb = New-Object System.Text.StringBuilder ($ByteCount * 2)
  foreach ($b in $bytes) {
    [void]$sb.Append($b.ToString('x2'))
  }
  return $sb.ToString()
}

function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-StartError 'start.ps1: Docker is not installed. Install Docker Desktop and retry.'
  }
  & docker info 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-StartError 'start.ps1: Docker is installed but the daemon is not running. Start Docker and retry.'
  }
  & docker compose version 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-StartError 'start.ps1: docker compose (v2) is not available. Install the Compose v2 plugin and retry.'
  }
}

function Read-Prompt([string]$Prompt, [string]$Default) {
  if ($Yes) { return $Default }
  $reply = Read-Host $Prompt
  if ([string]::IsNullOrWhiteSpace($reply)) { return $Default }
  return $reply
}

function Read-Secret([string]$Prompt) {
  if ($Yes) { return '' }
  $sec = Read-Host $Prompt -AsSecureString
  if ($null -eq $sec -or $sec.Length -eq 0) { return '' }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Copy-EnvExampleIfMissing {
  if (-not (Test-Path $ExampleFile)) {
    Write-StartError "start.ps1: missing $ExampleFile"
  }
  if (-not (Test-Path $EnvFile)) {
    $text = [System.IO.File]::ReadAllText($ExampleFile)
    Write-Utf8NoBomLf $EnvFile $text
    Write-Host 'Created .env from .env.example'
  }
}

function Update-GeneratedSecrets {
  $key = Get-EnvValue 'BOTANICAL_ENCRYPTION_KEY'
  if (Test-Placeholder $key) {
    Set-EnvValue 'BOTANICAL_ENCRYPTION_KEY' (Get-Base64Secret)
    Write-Host 'Generated BOTANICAL_ENCRYPTION_KEY'
  }

  $key = Get-EnvValue 'BOTANICAL_SESSION_SECRET'
  if (Test-Placeholder $key) {
    Set-EnvValue 'BOTANICAL_SESSION_SECRET' (Get-Base64Secret)
    Write-Host 'Generated BOTANICAL_SESSION_SECRET'
  }

  $pw = Get-EnvValue 'POSTGRES_PASSWORD'
  if (Test-Placeholder $pw) {
    $pw = Get-HexSecret 24
    Set-EnvValue 'POSTGRES_PASSWORD' $pw
    Write-Host 'Generated POSTGRES_PASSWORD'
  }

  $url = Get-EnvValue 'DATABASE_URL'
  $user = Get-EnvValue 'POSTGRES_USER'
  if ([string]::IsNullOrEmpty($user)) { $user = 'botanical' }
  $db = Get-EnvValue 'POSTGRES_DB'
  if ([string]::IsNullOrEmpty($db)) { $db = 'botanical' }

  if ([string]::IsNullOrEmpty($url) -or (Test-Placeholder $url)) {
    Set-EnvValue 'DATABASE_URL' "postgresql://${user}:${pw}@postgres:5432/${db}"
    Write-Host 'Updated DATABASE_URL to match POSTGRES_PASSWORD'
    return
  }

  $m = [regex]::Match($url, '^(?<prefix>[^:]+://)(?<user>[^:]+):(?<pass>[^@]+)@(?<rest>.+)$')
  if ($m.Success -and $m.Groups['rest'].Value -match '^postgres[:/]') {
    if ($m.Groups['pass'].Value -ne $pw) {
      Set-EnvValue 'DATABASE_URL' ($m.Groups['prefix'].Value + $m.Groups['user'].Value + ':' + $pw + '@' + $m.Groups['rest'].Value)
      Write-Host 'Updated DATABASE_URL to match POSTGRES_PASSWORD'
    }
  }
}

function Read-UserSettings {
  $currentPort = Get-EnvValue 'WEB_PORT'
  if ([string]::IsNullOrEmpty($currentPort)) { $currentPort = '3000' }
  if ($ShellWebPort) {
    $port = $ShellWebPort
  } else {
    $port = Read-Prompt "Web port [$currentPort]" $currentPort
  }
  if ($port -notmatch '^[0-9]+$') {
    Write-StartError "start.ps1: web port must be a number, got: $port"
  }
  Set-EnvValue 'WEB_PORT' $port

  $origin = Get-EnvValue 'BOTANICAL_PUBLIC_ORIGIN'
  if ($ShellPublicOrigin) {
    Set-EnvValue 'BOTANICAL_PUBLIC_ORIGIN' $ShellPublicOrigin
  } elseif ([string]::IsNullOrEmpty($origin) -or $origin -match '^http://(localhost|127\.0\.0\.1):') {
    Set-EnvValue 'BOTANICAL_PUBLIC_ORIGIN' "http://localhost:$port"
  }

  if ($ShellServerPort) { Set-EnvValue 'SERVER_PORT' $ShellServerPort }
  if ($ShellPostgresPort) { Set-EnvValue 'POSTGRES_PORT' $ShellPostgresPort }

  $include = $true
  if ($NoCli) {
    $include = $false
  } elseif (-not $Yes) {
    $reply = Read-Prompt 'Include coding CLIs (Grok Build / Claude Code / Codex)? [Y/n]' 'Y'
    if ($reply -match '^(n|N|no|NO)$') { $include = $false }
  }

  if (-not $Yes) {
    Write-Host 'Optional provider API key. Press Enter to skip; you can add keys later in Settings.'
    $provider = Read-Prompt 'Provider [deepseek]' 'deepseek'
    $key = Read-Secret 'API key (hidden, Enter to skip)'
    if (-not [string]::IsNullOrEmpty($key)) {
      switch ($provider.ToLowerInvariant()) {
        'openai' { Set-EnvValue 'OPENAI_API_KEY' $key }
        'anthropic' { Set-EnvValue 'ANTHROPIC_API_KEY' $key }
        'claude' { Set-EnvValue 'ANTHROPIC_API_KEY' $key }
        'xai' { Set-EnvValue 'XAI_API_KEY' $key }
        'grok' { Set-EnvValue 'XAI_API_KEY' $key }
        'openrouter' { Set-EnvValue 'OPENROUTER_API_KEY' $key }
        'compat' { Set-EnvValue 'OPENAI_COMPAT_API_KEY' $key }
        'openai-compat' { Set-EnvValue 'OPENAI_COMPAT_API_KEY' $key }
        default { Set-EnvValue 'DEEPSEEK_API_KEY' $key }
      }
      Write-Host 'Saved provider API key'
    }
  }

  return $include
}

function Wait-ForWeb([string]$Port) {
  $url = "http://127.0.0.1:${Port}/login"
  Write-Host "Waiting for the web app at $url ..."
  $deadline = (Get-Date).AddMinutes(15)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
        Write-Host 'Web app is up.'
        return
      }
    } catch { }
    Start-Sleep -Seconds 5
  }
  Write-StartError "start.ps1: timed out waiting for $url. Check: docker compose -p $env:COMPOSE_PROJECT_NAME logs"
}

Test-DockerReady
Copy-EnvExampleIfMissing
Update-GeneratedSecrets

if ($ShellProject) {
  $project = $ShellProject
} else {
  $project = Get-EnvValue 'COMPOSE_PROJECT_NAME'
  if ([string]::IsNullOrEmpty($project)) { $project = 'botanical-mvp' }
}
$env:COMPOSE_PROJECT_NAME = $project
if ([string]::IsNullOrEmpty((Get-EnvValue 'COMPOSE_PROJECT_NAME'))) {
  Set-EnvValue 'COMPOSE_PROJECT_NAME' $project
}

$IncludeCli = Read-UserSettings
$webPort = Get-EnvValue 'WEB_PORT'
if ([string]::IsNullOrEmpty($webPort)) { $webPort = '3000' }

if ($SkipUp) {
  Write-Host 'Skipping docker compose (--skip-up).'
  exit 0
}

$composeArgs = @('compose', '-p', $project, '-f', 'docker-compose.yml')
if ($IncludeCli) {
  $composeArgs += @('-f', 'docker-compose.cli.yml')
}
$composeArgs += @('up', '--build', '-d')

Write-Host "Starting Compose project '$project' (web port $webPort)..."
& docker $composeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Wait-ForWeb $webPort

$url = "http://localhost:$webPort"
Write-Host ''
Write-Host "Botanical is running at $url"
Write-Host 'The first account to sign up becomes the admin.'
if ($IncludeCli) {
  Write-Host "Stop with: docker compose -p $project -f docker-compose.yml -f docker-compose.cli.yml down"
} else {
  Write-Host "Stop with: docker compose -p $project down"
}
try {
  Start-Process $url
} catch { }
