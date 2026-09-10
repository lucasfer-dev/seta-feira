import { spawn } from 'node:child_process';
import { listWindows as listWindowsLegacy } from './windows-control-v2-legacy.mjs';
import { windowList as processWindowList } from './windows-ui-legacy.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreWindow(needle, win = {}) {
  const q = normalize(needle);
  const title = normalize(win.title);
  const process = normalize(win.process);
  if (!q) return -1;
  if (title === q) return 100;
  if (process === q || `${process}.exe` === q) return 96;
  if (title.startsWith(q)) return 88;
  if (process.startsWith(q)) return 84;
  if (title.includes(q)) return 76;
  if (process.includes(q)) return 72;
  const tokens = q.split(' ').filter(Boolean);
  const haystack = `${title} ${process}`;
  const hit = tokens.filter(token => haystack.includes(token)).length;
  return hit ? 45 + Math.round(25 * hit / tokens.length) : -1;
}

async function discoverWindows() {
  const combined = [];
  const seen = new Set();
  for (const loader of [
    async () => (await listWindowsLegacy(80))?.windows || [],
    async () => (await processWindowList(30))?.windows || []
  ]) {
    let windows = [];
    try { windows = await loader(); } catch {}
    for (const win of windows) {
      const hwnd = Number(win?.hwnd) || 0;
      if (!hwnd || seen.has(hwnd)) continue;
      seen.add(hwnd);
      combined.push({ ...win, hwnd });
    }
  }
  return combined;
}

async function resolveTarget(title = '', preferredHwnd = 0) {
  const windows = await discoverWindows();
  const hwnd = Number(preferredHwnd) || 0;
  if (hwnd) {
    const exact = windows.find(win => Number(win.hwnd) === hwnd);
    if (exact) return exact;
    return { hwnd, title: String(title || ''), process: '', active: false };
  }
  const needle = String(title || '').trim();
  if (!needle) throw new Error('PC_WINDOW_TITLE_REQUIRED');
  const ranked = windows.map(win => ({ win, score: scoreWindow(needle, win) }))
    .filter(item => item.score >= 45)
    .sort((a, b) => b.score - a.score || Number(b.win.active) - Number(a.win.active));
  if (!ranked.length) throw new Error('PC_WINDOW_NOT_FOUND');
  return ranked[0].win;
}

function runPowerShell(script, timeout = 9000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {}; finish(reject, new Error('PC_WINDOW_FOCUS_TIMEOUT')); }, timeout);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error((err || out || `powershell ${code}`).trim())));
    child.stdin.end(`${script}\r\n`, 'utf8');
  });
}

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('PC_WINDOW_FOCUS_EMPTY_RESULT');
  try { return JSON.parse(raw); }
  catch { throw new Error(`PC_WINDOW_FOCUS_JSON_INVALID:${raw.slice(0, 800)}`); }
}

export async function focusWindowRobust(title, preferredHwnd = 0, { restoreNormal = false } = {}) {
  const target = await resolveTarget(title, preferredHwnd);
  const hwnd = Number(target.hwnd) || 0;
  if (!hwnd) throw new Error('PC_WINDOW_NOT_FOUND');
  const script = String.raw`
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SextaFocusNativeV2 {
  const uint TOKEN_QUERY = 0x0008;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const int TokenElevation = 20;
  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint SWP_NOSIZE = 0x0001;
  const uint SWP_NOMOVE = 0x0002;
  const uint SWP_SHOWWINDOW = 0x0040;
  static readonly IntPtr HWND_TOP = new IntPtr(0);
  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_ELEVATION { public int TokenIsElevated; }

  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int tokenClass, out TOKEN_ELEVATION info, int length, out int returned);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] inputs, int cbSize);

  static bool Elevated(IntPtr process) {
    if (process == IntPtr.Zero) return false;
    IntPtr token;
    if (!OpenProcessToken(process, TOKEN_QUERY, out token)) return false;
    try { TOKEN_ELEVATION info; int returned; return GetTokenInformation(token, TokenElevation, out info, Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out returned) && info.TokenIsElevated != 0; }
    finally { CloseHandle(token); }
  }
  public static bool CurrentElevated() { return Elevated(GetCurrentProcess()); }
  public static bool TargetElevated(IntPtr hWnd) {
    uint pid; GetWindowThreadProcessId(hWnd, out pid); if (pid == 0) return false;
    IntPtr p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid); if (p == IntPtr.Zero) return false;
    try { return Elevated(p); } finally { CloseHandle(p); }
  }
  public static void AltPulse() {
    var down = new INPUT { type=INPUT_KEYBOARD, U=new InputUnion { ki=new KEYBDINPUT { wVk=0x12 } } };
    var up = new INPUT { type=INPUT_KEYBOARD, U=new InputUnion { ki=new KEYBDINPUT { wVk=0x12, dwFlags=KEYEVENTF_KEYUP } } };
    SendInput(2, new INPUT[]{down,up}, Marshal.SizeOf(typeof(INPUT)));
  }
  public static bool FocusAttempt(IntPtr hWnd, bool useAlt, bool topmostPulse) {
    if (!IsWindow(hWnd)) return false;
    if (useAlt) AltPulse();
    IntPtr fg = GetForegroundWindow(); uint fgPid, targetPid;
    uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out fgPid);
    uint targetThread = GetWindowThreadProcessId(hWnd, out targetPid);
    uint currentThread = GetCurrentThreadId();
    bool attachFg=false, attachTarget=false;
    try {
      if (fgThread != 0 && fgThread != currentThread) attachFg = AttachThreadInput(currentThread, fgThread, true);
      if (targetThread != 0 && targetThread != currentThread) attachTarget = AttachThreadInput(currentThread, targetThread, true);
      BringWindowToTop(hWnd);
      if (topmostPulse) {
        SetWindowPos(hWnd, HWND_TOPMOST, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW);
        SetWindowPos(hWnd, HWND_NOTOPMOST, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW);
      } else {
        SetWindowPos(hWnd, HWND_TOP, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW);
      }
      SetActiveWindow(hWnd);
      SetFocus(hWnd);
      SetForegroundWindow(hWnd);
    } finally {
      if (attachTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachFg) AttachThreadInput(currentThread, fgThread, false);
    }
    return GetForegroundWindow() == hWnd;
  }
}
"@
$h=[IntPtr][long]${hwnd}
if(-not [SextaFocusNativeV2]::IsWindow($h)){throw 'PC_WINDOW_NOT_FOUND'}
$currentElevated=[SextaFocusNativeV2]::CurrentElevated()
$targetElevated=[SextaFocusNativeV2]::TargetElevated($h)
if($targetElevated -and -not $currentElevated){throw 'PC_WINDOW_PRIVILEGE_MISMATCH:TARGET_ELEVATED'}
$wasMin=[SextaFocusNativeV2]::IsIconic($h)
$wasMax=[SextaFocusNativeV2]::IsZoomed($h)
$wasVisible=[SextaFocusNativeV2]::IsWindowVisible($h)
$before=[SextaFocusNativeV2]::GetForegroundWindow().ToInt64()
if(${restoreNormal ? '$true' : '$false'}){[void][SextaFocusNativeV2]::ShowWindowAsync($h,9);Start-Sleep -Milliseconds 130}
elseif($wasMin -or -not $wasVisible){[void][SextaFocusNativeV2]::ShowWindowAsync($h,9);Start-Sleep -Milliseconds 130}
else{[void][SextaFocusNativeV2]::ShowWindowAsync($h,5)}
$method='direct'
$ok=[SextaFocusNativeV2]::FocusAttempt($h,$false,$false)
if(-not $ok){Start-Sleep -Milliseconds 70;$method='alt-unlock';$ok=[SextaFocusNativeV2]::FocusAttempt($h,$true,$false)}
if(-not $ok){Start-Sleep -Milliseconds 70;$method='topmost-pulse';$ok=[SextaFocusNativeV2]::FocusAttempt($h,$true,$true)}
for($i=0;$i -lt 8 -and -not $ok;$i++){Start-Sleep -Milliseconds 70;$ok=([SextaFocusNativeV2]::GetForegroundWindow() -eq $h)}
if(-not $ok){throw 'PC_WINDOW_FOCUS_NOT_VERIFIED'}
$r=New-Object SextaFocusNativeV2+RECT
[void][SextaFocusNativeV2]::GetWindowRect($h,[ref]$r)
[pscustomobject]@{focused=$true;ok=$true;verified=$true;restored=($wasMin -or -not $wasVisible -or ${restoreNormal ? '$true' : '$false'});method=$method;beforeHwnd=$before;afterHwnd=[SextaFocusNativeV2]::GetForegroundWindow().ToInt64();hwnd=$h.ToInt64();visible=[SextaFocusNativeV2]::IsWindowVisible($h);minimized=[SextaFocusNativeV2]::IsIconic($h);maximized=[SextaFocusNativeV2]::IsZoomed($h);targetElevated=$targetElevated;agentElevated=$currentElevated;x=$r.Left;y=$r.Top;width=($r.Right-$r.Left);height=($r.Bottom-$r.Top)}|ConvertTo-Json -Compress
`;
  const result = parseJson(await runPowerShell(script));
  return { ...result, title: target.title || String(title || ''), process: target.process || '', pid: target.pid || null };
}
