param(
  [string]$TaskName = 'SEXTA PC Agent'
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'Este instalador é exclusivo para Windows.' }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AgentScript = Join-Path $RepoRoot 'agent\start-cloud.mjs'
$ConfigPath = Join-Path $RepoRoot 'agent\config.json'
$EnvPath = Join-Path $RepoRoot '.env.local'
$DoctorScript = Join-Path $RepoRoot 'agent\doctor.mjs'

$Node = Get-Command node -ErrorAction Stop
$Codex = Get-Command codex -ErrorAction SilentlyContinue

if (-not (Test-Path $AgentScript)) { throw "Agent não encontrado: $AgentScript" }
if (-not (Test-Path $ConfigPath)) { throw 'agent\config.json não encontrado. Rode primeiro: npm run sexta:setup' }
if (-not (Test-Path $EnvPath)) { throw '.env.local não encontrado. Rode primeiro: npm run sexta:setup' }

$EnvText = Get-Content $EnvPath -Raw
if ($EnvText -notmatch '(?m)^\s*SEXTA_AGENT_TOKEN\s*=\s*[^\s#].*$') { throw 'Token do agente ausente. Rode: npm run sexta:setup' }
if ($EnvText -notmatch '(?m)^\s*SEXTA_DEVICE_ID\s*=\s*[^\s#].*$') { throw 'SEXTA_DEVICE_ID ausente. Rode: npm run sexta:setup' }

Write-Host "Node: $(& $Node.Source --version 2>$null)"
if ($Codex) { Write-Host "Codex: $(& $Codex.Source --version 2>$null)" }
else { Write-Warning 'Codex CLI não encontrado. A Sexta funcionará normalmente; apenas tarefas de edição/análise de código via Codex ficarão indisponíveis.' }

if (Test-Path $DoctorScript) {
  Write-Host ''
  Write-Host 'Executando SEXTA Doctor antes da instalação...'
  & $Node.Source --env-file-if-exists="$EnvPath" "$DoctorScript"
  if ($LASTEXITCODE -ne 0) { throw 'SEXTA Doctor encontrou bloqueios essenciais. Corrija-os antes de instalar.' }
}

$Arguments = "--env-file-if-exists=`"$EnvPath`" `"$AgentScript`""
$Action = New-ScheduledTaskAction -Execute $Node.Source -Argument $Arguments -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -Hidden

$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $Identity -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'SEXTA PC Agent v3: corpo local pareado, com kill switch, autonomia e privacidade configuráveis.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ''
Write-Host 'SEXTA PC Agent instalado.'
Write-Host "Estado: $($Task.State)"
Write-Host "Última execução: $($Info.LastRunTime)"
Write-Host 'A instalação NÃO alterou suspensão, energia, firewall ou permissões administrativas do Windows.'
Write-Host 'Para pausar imediatamente: npm run agent:pause'
