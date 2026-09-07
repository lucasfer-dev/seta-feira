param(
  [string]$TaskName = 'SEXTA PC Agent'
)

$ErrorActionPreference = 'Stop'

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Task) {
  Write-Host 'SEXTA PC Agent não está instalado no Agendador de Tarefas.'
  exit 0
}

try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host 'SEXTA PC Agent removido do início automático.'
Write-Host 'Configuração, pairing e auditoria local foram preservados para facilitar uma reinstalação.'
Write-Host 'A instalação v3 não altera automaticamente energia, suspensão ou firewall do Windows.'
