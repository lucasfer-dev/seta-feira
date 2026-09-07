import os from 'node:os';
import { spawnSync } from 'node:child_process';

let previousCpu = null;
let cache = null;
let cacheAt = 0;

function cpuTotals() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}
function cpuUsagePercent() {
  const next = cpuTotals();
  if (!previousCpu) { previousCpu = next; return null; }
  const idle = next.idle - previousCpu.idle;
  const total = next.total - previousCpu.total;
  previousCpu = next;
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 1000) / 10)) : null;
}
function windowsDetails() {
  if (process.platform !== 'win32') return {};
  const script = `
$disks=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [pscustomobject]@{ name=$_.DeviceID; size=[double]$_.Size; free=[double]$_.FreeSpace } })
$gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; adapterRam=[double]$_.AdapterRAM; driver=$_.DriverVersion } })
$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
$nets=@(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" | ForEach-Object { [pscustomobject]@{ description=$_.Description; ip=@($_.IPAddress); mac=$_.MACAddress } })
[pscustomobject]@{ disks=$disks; gpus=$gpus; battery=if($b){[pscustomobject]@{ percent=[int]$b.EstimatedChargeRemaining; status=[int]$b.BatteryStatus }}else{$null}; network=$nets } | ConvertTo-Json -Depth 6 -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 7000 });
  if (result.status !== 0) return { windowsProbeError: String(result.stderr || '').trim().slice(0, 300) };
  try { return JSON.parse(String(result.stdout || '{}')); } catch { return {}; }
}
function arr(value) { return Array.isArray(value) ? value : value ? [value] : []; }

export async function hardwareSnapshot({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < 20000) return cache;
  const total = os.totalmem();
  const free = os.freemem();
  const details = windowsDetails();
  const disks = arr(details.disks).map(disk => {
    const size = Number(disk.size || 0), freeBytes = Number(disk.free || 0);
    return {
      name: String(disk.name || ''), sizeGB: size ? Math.round(size / 1073741824 * 10) / 10 : null,
      freeGB: size ? Math.round(freeBytes / 1073741824 * 10) / 10 : null,
      freePercent: size ? Math.round(freeBytes / size * 1000) / 10 : null
    };
  });
  cache = {
    collectedAt: new Date().toISOString(),
    cpu: { percent: cpuUsagePercent(), cores: os.cpus().length, model: os.cpus()[0]?.model || '' },
    memory: { totalMB: Math.round(total / 1048576), freeMB: Math.round(free / 1048576), usedPercent: total ? Math.round((1 - free / total) * 1000) / 10 : null },
    disks,
    gpus: arr(details.gpus).map(gpu => ({ name: String(gpu.name || ''), adapterRAMMB: Number(gpu.adapterRam) > 0 ? Math.round(Number(gpu.adapterRam) / 1048576) : null, driver: String(gpu.driver || '') })),
    battery: details.battery || null,
    network: arr(details.network).map(net => ({ description: String(net.description || ''), ip: arr(net.ip).map(String).slice(0, 6), mac: String(net.mac || '') })),
    uptimeSeconds: Math.round(os.uptime())
  };
  cacheAt = Date.now();
  return cache;
}
