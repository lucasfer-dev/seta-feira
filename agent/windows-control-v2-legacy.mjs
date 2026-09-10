import { spawn } from 'node:child_process';

function encode(value = '') { return Buffer.from(String(value), 'utf8').toString('base64'); }
function parseJson(text, fallback = {}) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error(`PC_WINDOWS_JSON_INVALID:${raw.slice(0, 900)}`); }
}

const psPrelude = String.raw`
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
function Get-SextaUtf8([string]$name){
  $raw=[Environment]::GetEnvironmentVariable($name)
  if([string]::IsNullOrWhiteSpace($raw)){return ''}
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))
}
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SextaWindowNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public sealed class WindowInfo {
    public long Hwnd { get; set; }
    public uint ProcessId { get; set; }
    public string Title { get; set; }
    public bool Visible { get; set; }
    public bool Minimized { get; set; }
    public bool Maximized { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
  }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  public static WindowInfo[] ListWindows() {
    var items = new List<WindowInfo>();
    EnumWindows((hWnd, lParam) => {
      try {
        if (!IsWindow(hWnd)) return true;
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return true;
        var text = new StringBuilder(length + 2);
        GetWindowText(hWnd, text, text.Capacity);
        string title = text.ToString().Trim();
        if (String.IsNullOrWhiteSpace(title)) return true;
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        RECT rect;
        GetWindowRect(hWnd, out rect);
        items.Add(new WindowInfo {
          Hwnd = hWnd.ToInt64(), ProcessId = processId, Title = title,
          Visible = IsWindowVisible(hWnd), Minimized = IsIconic(hWnd), Maximized = IsZoomed(hWnd),
          X = rect.Left, Y = rect.Top, Width = rect.Right - rect.Left, Height = rect.Bottom - rect.Top
        });
      } catch { }
      return true;
    }, IntPtr.Zero);
    return items.ToArray();
  }
}
"@
function Add-SextaWindowItem($items,$seen,[IntPtr]$h,[int]$processId,[string]$processName,[string]$title){
  if($h -eq [IntPtr]::Zero -or -not [SextaWindowNative]::IsWindow($h)){return}
  $key=$h.ToInt64().ToString()
  if($seen.ContainsKey($key)){return}
  if([string]::IsNullOrWhiteSpace($title)){return}
  $r=New-Object SextaWindowNative+RECT
  [void][SextaWindowNative]::GetWindowRect($h,[ref]$r)
  [void]$items.Add([pscustomobject]@{
    hwnd=$h.ToInt64(); pid=$processId; process=$processName; title=$title.Trim();
    active=($h -eq [SextaWindowNative]::GetForegroundWindow()); visible=[SextaWindowNative]::IsWindowVisible($h);
    minimized=[SextaWindowNative]::IsIconic($h); maximized=[SextaWindowNative]::IsZoomed($h);
    x=$r.Left; y=$r.Top; width=($r.Right-$r.Left); height=($r.Bottom-$r.Top)
  })
  $seen[$key]=$true
}
function Get-SextaWindows {
  $items=New-Object System.Collections.ArrayList
  $seen=@{}
  foreach($p in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle })){
    try{
      Add-SextaWindowItem $items $seen ([IntPtr]$p.MainWindowHandle) ([int]$p.Id) ([string]$p.ProcessName) ([string]$p.MainWindowTitle)
    }catch{}
  }
  foreach($native in @([SextaWindowNative]::ListWindows())){
    try{
      $h=[IntPtr][long]$native.Hwnd
      $key=$h.ToInt64().ToString()
      if($seen.ContainsKey($key)){continue}
      $processId=[int]$native.ProcessId
      $p=Get-Process -Id $processId -ErrorAction SilentlyContinue
      $processName=''
      if($p){$processName=[string]$p.ProcessName}
      Add-SextaWindowItem $items $seen $h $processId $processName ([string]$native.Title)
    }catch{}
  }
  return @($items)
}
function Find-SextaWindow([string]$needle,[long]$preferredHwnd=0){
  $all=@(Get-SextaWindows)
  if($preferredHwnd -ne 0){
    $exact=$all | Where-Object { $_.hwnd -eq $preferredHwnd } | Select-Object -First 1
    if($exact){return $exact}
  }
  $n=$needle.Trim()
  if([string]::IsNullOrWhiteSpace($n)){throw 'PC_WINDOW_TITLE_REQUIRED'}
  $ranked=@($all | ForEach-Object {
    $t=[string]$_.title;$p=[string]$_.process;$score=999
    if($t.Equals($n,[StringComparison]::OrdinalIgnoreCase)){$score=0}
    elseif($p.Equals($n,[StringComparison]::OrdinalIgnoreCase)){$score=1}
    elseif($t.StartsWith($n,[StringComparison]::OrdinalIgnoreCase)){$score=2}
    elseif($p.StartsWith($n,[StringComparison]::OrdinalIgnoreCase)){$score=3}
    elseif($t.IndexOf($n,[StringComparison]::OrdinalIgnoreCase) -ge 0){$score=4}
    elseif($p.IndexOf($n,[StringComparison]::OrdinalIgnoreCase) -ge 0){$score=5}
    if($score -lt 999){[pscustomobject]@{window=$_;score=$score}}
  } | Sort-Object score,@{Expression={$_.window.active};Descending=$true},@{Expression={$_.window.visible};Descending=$true},@{Expression={$_.window.title.Length}})
  if($ranked.Count -eq 0){throw 'PC_WINDOW_NOT_FOUND'}
  return $ranked[0].window
}
function Focus-SextaHwnd([IntPtr]$h){
  if($h -eq [IntPtr]::Zero -or -not [SextaWindowNative]::IsWindow($h)){throw 'PC_WINDOW_NOT_FOUND'}
  $wasMin=[SextaWindowNative]::IsIconic($h)
  $wasVisible=[SextaWindowNative]::IsWindowVisible($h)
  if($wasMin -or -not $wasVisible){[void][SextaWindowNative]::ShowWindowAsync($h,9);Start-Sleep -Milliseconds 150}else{[void][SextaWindowNative]::ShowWindowAsync($h,5)}
  $fg=[SextaWindowNative]::GetForegroundWindow();$a=[uint32]0;$b=[uint32]0
  $fgThread=if($fg -ne [IntPtr]::Zero){[SextaWindowNative]::GetWindowThreadProcessId($fg,[ref]$a)}else{0}
  $targetThread=[SextaWindowNative]::GetWindowThreadProcessId($h,[ref]$b)
  $attached=$false
  try {
    if($fgThread -ne 0 -and $targetThread -ne 0 -and $fgThread -ne $targetThread){$attached=[SextaWindowNative]::AttachThreadInput($fgThread,$targetThread,$true)}
    [void][SextaWindowNative]::BringWindowToTop($h)
    [void][SextaWindowNative]::SetActiveWindow($h)
    [void][SextaWindowNative]::SetFocus($h)
    [void][SextaWindowNative]::SetForegroundWindow($h)
  } finally {
    if($attached){[void][SextaWindowNative]::AttachThreadInput($fgThread,$targetThread,$false)}
  }
  for($i=0;$i -lt 18;$i++){
    if([SextaWindowNative]::GetForegroundWindow() -eq $h){return ($wasMin -or -not $wasVisible)}
    Start-Sleep -Milliseconds 70
    [void][SextaWindowNative]::ShowWindowAsync($h,5)
    [void][SextaWindowNative]::BringWindowToTop($h)
    [void][SextaWindowNative]::SetForegroundWindow($h)
  }
  try {
    $processId=[uint32]0
    [void][SextaWindowNative]::GetWindowThreadProcessId($h,[ref]$processId)
    $ws=New-Object -ComObject WScript.Shell
    [void]$ws.AppActivate([int]$processId)
  } catch {}
  for($i=0;$i -lt 8;$i++){
    if([SextaWindowNative]::GetForegroundWindow() -eq $h){return ($wasMin -or -not $wasVisible)}
    Start-Sleep -Milliseconds 80
  }
  throw 'PC_WINDOW_FOCUS_NOT_VERIFIED'
}
`;

function runPowerShell(script, timeout = 10000, data = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  const env = { ...process.env };
  for (const [key, value] of Object.entries(data)) env[`SEXTA_${key}`] = encode(value);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = '', done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(reject, new Error('PC_WINDOW_CONTROL_TIMEOUT')); }, timeout);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => finish(reject, e));
    child.on('close', code => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error((err || out || `powershell exit ${code}`).trim())));
    child.stdin.end(`${psPrelude}${script}\r\n`, 'utf8');
  });
}

export async function listWindows(limit = 30) {
  const max = Math.max(1, Math.min(80, Number(limit) || 30));
  const script = `$all=@(Get-SextaWindows | Sort-Object @{Expression={$_.active};Descending=$true},@{Expression={$_.visible};Descending=$true} | Select-Object -First ${max});$active=($all | Where-Object { $_.active } | Select-Object -First 1);[pscustomobject]@{windows=$all;count=$all.Count;active=$active}|ConvertTo-Json -Depth 5 -Compress`;
  return parseJson(await runPowerShell(script, 10000), { windows: [], count: 0, active: null });
}

export async function focusWindowNative(title, hwnd = 0) {
  const needle = String(title || '').trim().slice(0, 240);
  const handle = Number(hwnd) || 0;
  const script = String.raw`
$w=Find-SextaWindow (Get-SextaUtf8 'SEXTA_TITLE') ${handle}
$h=[IntPtr][long]$w.hwnd
$before=[SextaWindowNative]::GetForegroundWindow().ToInt64()
$restored=Focus-SextaHwnd $h
$after=[SextaWindowNative]::GetForegroundWindow().ToInt64()
$r=New-Object SextaWindowNative+RECT
[void][SextaWindowNative]::GetWindowRect($h,[ref]$r)
[pscustomobject]@{ok=$true;action='focus';verified=($after -eq $h.ToInt64());restored=[bool]$restored;beforeHwnd=$before;afterHwnd=$after;hwnd=$h.ToInt64();pid=$w.pid;process=$w.process;title=$w.title;visible=[SextaWindowNative]::IsWindowVisible($h);minimized=[SextaWindowNative]::IsIconic($h);maximized=[SextaWindowNative]::IsZoomed($h);x=$r.Left;y=$r.Top;width=($r.Right-$r.Left);height=($r.Bottom-$r.Top)}|ConvertTo-Json -Compress`;
  const result = parseJson(await runPowerShell(script, 12000, { TITLE: needle }), {});
  if (!result.verified) throw new Error('PC_WINDOW_FOCUS_NOT_VERIFIED');
  return result;
}

export async function setWindowState(title, state, hwnd = 0) {
  const needle = String(title || '').trim().slice(0, 240);
  const desired = String(state || '').toLowerCase();
  if (!['restore', 'minimize', 'maximize'].includes(desired)) throw new Error('PC_WINDOW_STATE_INVALID');
  const cmd = desired === 'minimize' ? 6 : desired === 'maximize' ? 3 : 9;
  const handle = Number(hwnd) || 0;
  const script = String.raw`
$w=Find-SextaWindow (Get-SextaUtf8 'SEXTA_TITLE') ${handle}
$h=[IntPtr][long]$w.hwnd
[void][SextaWindowNative]::ShowWindowAsync($h,${cmd})
Start-Sleep -Milliseconds 220
if('${desired}' -eq 'restore'){[void](Focus-SextaHwnd $h)}
$min=[SextaWindowNative]::IsIconic($h);$max=[SextaWindowNative]::IsZoomed($h);$vis=[SextaWindowNative]::IsWindowVisible($h)
$verified=if('${desired}' -eq 'minimize'){$min}elseif('${desired}' -eq 'maximize'){$max}else{(-not $min -and -not $max -and $vis)}
if(-not $verified){throw 'PC_WINDOW_STATE_NOT_VERIFIED'}
[pscustomobject]@{ok=$true;action='${desired}';verified=$true;hwnd=$h.ToInt64();pid=$w.pid;process=$w.process;title=$w.title;visible=$vis;minimized=$min;maximized=$max}|ConvertTo-Json -Compress`;
  return parseJson(await runPowerShell(script, 10000, { TITLE: needle }), {});
}

export async function moveResizeWindow(title, { x, y, width, height, hwnd = 0 } = {}) {
  const needle = String(title || '').trim().slice(0, 240);
  const values = [x, y, width, height].map(Number);
  if (values.some(v => !Number.isFinite(v))) throw new Error('PC_WINDOW_BOUNDS_REQUIRED');
  const [px, py, pw, ph] = values.map(Math.round);
  if (pw < 120 || ph < 80) throw new Error('PC_WINDOW_BOUNDS_TOO_SMALL');
  const handle = Number(hwnd) || 0;
  const script = String.raw`
$w=Find-SextaWindow (Get-SextaUtf8 'SEXTA_TITLE') ${handle}
$h=[IntPtr][long]$w.hwnd
if([SextaWindowNative]::IsIconic($h) -or [SextaWindowNative]::IsZoomed($h) -or -not [SextaWindowNative]::IsWindowVisible($h)){[void][SextaWindowNative]::ShowWindowAsync($h,9);Start-Sleep -Milliseconds 160}
[void][SextaWindowNative]::SetWindowPos($h,[IntPtr]::Zero,${px},${py},${pw},${ph},0x0040)
Start-Sleep -Milliseconds 200
$r=New-Object SextaWindowNative+RECT
[void][SextaWindowNative]::GetWindowRect($h,[ref]$r)
$verified=([Math]::Abs($r.Left-${px}) -le 4 -and [Math]::Abs($r.Top-${py}) -le 4 -and [Math]::Abs(($r.Right-$r.Left)-${pw}) -le 10 -and [Math]::Abs(($r.Bottom-$r.Top)-${ph}) -le 10)
if(-not $verified){throw 'PC_WINDOW_MOVE_NOT_VERIFIED'}
[pscustomobject]@{ok=$true;action='move_resize';verified=$true;hwnd=$h.ToInt64();pid=$w.pid;process=$w.process;title=$w.title;x=$r.Left;y=$r.Top;width=($r.Right-$r.Left);height=($r.Bottom-$r.Top)}|ConvertTo-Json -Compress`;
  return parseJson(await runPowerShell(script, 10000, { TITLE: needle }), {});
}

export async function closeWindowNative(title, hwnd = 0) {
  const needle = String(title || '').trim().slice(0, 240);
  const handle = Number(hwnd) || 0;
  const script = String.raw`
$w=Find-SextaWindow (Get-SextaUtf8 'SEXTA_TITLE') ${handle}
$h=[IntPtr][long]$w.hwnd;$title=$w.title;$processId=[int]$w.pid;$proc=$w.process
[void][SextaWindowNative]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
$closed=$false
for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 100;if(-not [SextaWindowNative]::IsWindow($h)){$closed=$true;break}}
if(-not $closed){throw 'PC_WINDOW_CLOSE_NOT_VERIFIED'}
$remaining=@(Get-SextaWindows | Where-Object { $_.pid -eq $processId })
[pscustomobject]@{ok=$true;action='close';verified=$true;closed=$true;hwnd=$h.ToInt64();pid=$processId;process=$proc;title=$title;remainingProcessWindows=$remaining.Count}|ConvertTo-Json -Compress`;
  return parseJson(await runPowerShell(script, 8000, { TITLE: needle }), {});
}
