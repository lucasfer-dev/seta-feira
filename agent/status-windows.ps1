param(
  [string]$TaskName = 'SEXTA PC Agent'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConfigPath = Join-Path $RepoRoot 'agent\config.json'
$EnvPath = Join-Path $RepoRoot '.env.local'
$StateScript = Join-Path $RepoRoot 'agent\control-local.mjs'

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Task) {
  Write-Host 'Instalado: não'
  Write-Host 'Primeiro contato: npm run sexta:setup'
  Write-Host 'Depois: npm run agent:install'
  exit 1
}

$Info = Get-ScheduledTaskInfo -TaskName $TaskName
$Codex = Get-Command codex -ErrorAction SilentlyContinue
$Node = Get-Command node -ErrorAction SilentlyContinue

Write-Host 'SEXTA PC AGENT // STATUS'
Write-Host '------------------------'
Write-Host 'Instalado: sim'
Write-Host "Estado da tarefa: $($Task.State)"
Write-Host "Última execução: $($Info.LastRunTime)"
Write-Host "Último resultado: $($Info.LastTaskResult)"
Write-Host "Node: $(if ($Node) { $Node.Source } else { 'não encontrado' })"
Write-Host "Codex: $(if ($Codex) { $Codex.Source } else { 'opcional / não encontrado' })"
Write-Host "config.json: $(if (Test-Path $ConfigPath) { 'ok' } else { 'ausente' })"
Write-Host ".env.local: $(if (Test-Path $EnvPath) { 'ok' } else { 'ausente' })"

if ($Node -and (Test-Path $StateScript)) {
  Write-Host ''
  Write-Host 'Runtime local:'
  & $Node.Source $StateScript status
}

Write-Host ''
Write-Host 'Diagnóstico completo: npm run sexta:doctor'
