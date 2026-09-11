$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'SextaHands.csproj'
$outDir = Join-Path $PSScriptRoot 'bin'
$finalExe = Join-Path $outDir 'SextaHands.exe'

dotnet build $project --configuration Release --nologo
$built = Join-Path $PSScriptRoot 'bin\Release\net48\SextaHands.exe'
if (-not (Test-Path $built)) { throw "Native Hands build output missing: $built" }

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Copy-Item $built $finalExe -Force
Write-Host "SEXTA Native Hands built: $finalExe"
