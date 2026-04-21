param(
  [Parameter(Mandatory = $true)]
  [string]$DockerHubUser,

  [string]$ImageName = "clawbot-backend",

  [string]$Tag = "dev"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$BackendDir = Join-Path $RepoRoot "backend"
$Dockerfile = Join-Path $BackendDir "Dockerfile"
$ImageRef = "$DockerHubUser/$ImageName`:$Tag"

if (-not (Test-Path $Dockerfile)) {
  throw "Backend Dockerfile not found: $Dockerfile"
}

Write-Host "Checking Docker engine..."
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker engine is not running or Docker CLI cannot connect."
}

Write-Host "Building $ImageRef from $BackendDir"
docker build -f $Dockerfile -t $ImageRef $BackendDir
if ($LASTEXITCODE -ne 0) {
  throw "docker build failed."
}

Write-Host "Pushing $ImageRef"
docker push $ImageRef
if ($LASTEXITCODE -ne 0) {
  throw "docker push failed."
}

Write-Host "Done: $ImageRef"
