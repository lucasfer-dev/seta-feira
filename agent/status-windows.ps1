param(
  [string]$TaskName = 'SEXTA PC Agent'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConfigPath = Join-Path $RepoRoot 'agent\config.json'
$EnvPath = Join-Path $RepoRoot '.env.local'

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Task) {
  Write-Host 'Instalado: não'
  Write-Host 'Use: npm run agent:install'
  exit 1
}

$Info = Get-ScheduledTaskInfo -TaskName $TaskName
$Codex = Get-Command codex -ErrorAction SilentlyContinue
$Node = Get-Command node -ErrorAction SilentlyContinue

Write-Host 'Instalado: sim'
Write-Host "Estado: $($Task.State)"
Write-Host "Última execução: $($Info.LastRunTime)"
Write-Host "Último resultado: $($Info.LastTaskResult)"
Write-Host "Node: $(if ($Node) { $Node.Source } else { 'não encontrado' })"
Write-Host "Codex: $(if ($Codex) { $Codex.Source } else { 'não encontrado' })"
Write-Host "config.json: $(if (Test-Path $ConfigPath) { 'ok' } else { 'ausente' })"
Write-Host ".env.local: $(if (Test-Path $EnvPath) { 'ok' } else { 'ausente' })"
