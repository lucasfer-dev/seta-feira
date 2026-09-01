param(
  [string]$TaskName = 'SEXTA PC Agent'
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'Este instalador é exclusivo para Windows.'
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AgentScript = Join-Path $RepoRoot 'agent\start-cloud.mjs'
$ConfigPath = Join-Path $RepoRoot 'agent\config.json'
$ConfigExample = Join-Path $RepoRoot 'agent\config.example.json'
$EnvPath = Join-Path $RepoRoot '.env.local'

$Node = Get-Command node -ErrorAction Stop
$Codex = Get-Command codex -ErrorAction SilentlyContinue

if (-not (Test-Path $AgentScript)) {
  throw "Agent não encontrado: $AgentScript"
}

if (-not (Test-Path $ConfigPath)) {
  if (Test-Path $ConfigExample) {
    Copy-Item $ConfigExample $ConfigPath -Force
  }
  throw "Criei agent\config.json a partir do exemplo. Configure os projetos permitidos e rode npm run agent:install novamente."
}

if (-not (Test-Path $EnvPath)) {
  throw '.env.local não encontrado. O agente precisa do SEXTA_AGENT_TOKEN local para autenticar na SEXTA Cloud.'
}

$EnvText = Get-Content $EnvPath -Raw
if ($EnvText -notmatch '(?m)^\s*SEXTA_AGENT_TOKEN\s*=\s*[^\s#].*$') {
  throw 'SEXTA_AGENT_TOKEN não foi encontrado em .env.local.'
}

if (-not $Codex) {
  throw 'Codex CLI não foi encontrado no PATH. Instale e faça login no Codex antes de instalar o agente.'
}

$NodeVersion = (& $Node.Source --version 2>$null)
$CodexVersion = (& $Codex.Source --version 2>$null)
Write-Host "Node: $NodeVersion"
Write-Host "Codex: $CodexVersion"

# O PC precisa continuar acordado quando estiver bloqueado. Tela desligada continua permitida;
# apenas o modo de suspensão em alimentação AC é desativado.
try {
  & powercfg.exe /change standby-timeout-ac 0 | Out-Null
  Write-Host 'Suspensão automática em energia AC: desativada.'
} catch {
  Write-Warning 'Não consegui desativar a suspensão automática. Configure Windows > Energia > Suspender como Nunca enquanto conectado à tomada.'
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
  -Description 'SEXTA PC Agent: recebe comandos remotos e delega tarefas ao Codex enquanto o Windows está ligado, inclusive na tela de bloqueio.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ''
Write-Host 'SEXTA PC Agent instalado.'
Write-Host "Estado: $($Task.State)"
Write-Host "Última execução: $($Info.LastRunTime)"
Write-Host 'Pode bloquear o Windows normalmente. O agente continua rodando enquanto sua sessão estiver logada.'
