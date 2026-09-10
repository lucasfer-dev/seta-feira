import { spawn } from 'node:child_process';

const ALLOWED = new Map([
  ['ctrl+f', ['CTRL', 'F']],
  ['ctrl+l', ['CTRL', 'L']],
  ['ctrl+c', ['CTRL', 'C']],
  ['ctrl+a', ['CTRL', 'A']],
  ['ctrl+z', ['CTRL', 'Z']],
  ['ctrl+tab', ['CTRL', 'TAB']],
  ['ctrl+shift+tab', ['CTRL', 'SHIFT', 'TAB']],
  ['alt+left', ['ALT', 'LEFT']],
  ['alt+right', ['ALT', 'RIGHT']],
  ['esc', ['ESC']],
  ['escape', ['ESC']],
  ['tab', ['TAB']],
  ['shift+tab', ['SHIFT', 'TAB']],
  ['f5', ['F5']]
]);

function normalizeShortcut(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function runPowerShell(script, timeout = 8000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(reject, new Error('PC_UI_HOTKEY_TIMEOUT'));
    }, timeout);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => {
      if (code !== 0) return finish(reject, new Error(String(err || out || `powershell exit ${code}`).trim()));
      finish(resolve, String(out || '').trim());
    });
    child.stdin.end(`${script}\r\n`, 'utf8');
  });
}

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('PC_UI_HOTKEY_EMPTY_RESULT');
  try { return JSON.parse(raw); }
  catch { throw new Error(`PC_UI_HOTKEY_JSON_INVALID:${raw.slice(0, 700)}`); }
}

export async function uiHotkey(shortcut) {
  const key = normalizeShortcut(shortcut);
  const keys = ALLOWED.get(key);
  if (!keys) throw new Error('PC_UI_HOTKEY_NOT_ALLOWED');
  const keyArray = keys.map(value => `'${value.replace(/'/g, "''")}'`).join(',');
  const script = String.raw`
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SextaHotkeyNative {
  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const int TokenElevation = 20;
  const uint TOKEN_QUERY = 0x0008;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_ELEVATION { public int TokenIsElevated; }

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int tokenClass, out TOKEN_ELEVATION info, int length, out int returned);

  static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
    {"CTRL",0x11},{"SHIFT",0x10},{"ALT",0x12},{"TAB",0x09},{"ESC",0x1B},{"LEFT",0x25},{"RIGHT",0x27},{"F5",0x74},
    {"A",0x41},{"C",0x43},{"F",0x46},{"L",0x4C},{"Z",0x5A}
  };

  static bool IsExtended(ushort vk) { return vk == 0x25 || vk == 0x27; }
  static INPUT Input(ushort vk, bool up) {
    uint flags = (up ? KEYEVENTF_KEYUP : 0) | (IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
    return new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = flags } } };
  }

  static bool ElevatedForHandle(IntPtr process) {
    if (process == IntPtr.Zero) return false;
    IntPtr token;
    if (!OpenProcessToken(process, TOKEN_QUERY, out token)) return false;
    try {
      TOKEN_ELEVATION info;
      int returned;
      if (!GetTokenInformation(token, TokenElevation, out info, Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out returned)) return false;
      return info.TokenIsElevated != 0;
    } finally { CloseHandle(token); }
  }

  public static bool CurrentElevated() { return ElevatedForHandle(GetCurrentProcess()); }
  public static bool TargetElevated(IntPtr hwnd) {
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (pid == 0) return false;
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (process == IntPtr.Zero) return false;
    try { return ElevatedForHandle(process); } finally { CloseHandle(process); }
  }

  public static int SendCombo(string[] names) {
    if (names == null || names.Length == 0) return 0;
    var virtualKeys = new List<ushort>();
    foreach (var name in names) {
      ushort vk;
      if (!Keys.TryGetValue(name, out vk)) throw new InvalidOperationException("PC_UI_HOTKEY_KEY_UNSUPPORTED:" + name);
      virtualKeys.Add(vk);
    }
    var inputs = new List<INPUT>();
    foreach (var vk in virtualKeys) inputs.Add(Input(vk, false));
    for (int i = virtualKeys.Count - 1; i >= 0; i--) inputs.Add(Input(virtualKeys[i], true));
    uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Count) return -(int)sent;
    return (int)sent;
  }
}
"@
$foreground=[SextaHotkeyNative]::GetForegroundWindow()
if($foreground -eq [IntPtr]::Zero){throw 'PC_UI_NO_FOREGROUND_WINDOW'}
$currentElevated=[SextaHotkeyNative]::CurrentElevated()
$targetElevated=[SextaHotkeyNative]::TargetElevated($foreground)
if($targetElevated -and -not $currentElevated){throw 'PC_UI_PRIVILEGE_MISMATCH:TARGET_ELEVATED'}
$keys=@(${keyArray})
$sent=[SextaHotkeyNative]::SendCombo($keys)
if($sent -le 0){throw ('PC_UI_HOTKEY_SENDINPUT_FAILED:'+(-1*$sent))}
Start-Sleep -Milliseconds 40
$after=[SextaHotkeyNative]::GetForegroundWindow()
[pscustomobject]@{sent=$true;verified=$true;shortcut='${key.replace(/'/g, "''")}';via='SendInput';inputEvents=$sent;foregroundHwnd=$foreground.ToInt64();afterHwnd=$after.ToInt64();targetElevated=$targetElevated;agentElevated=$currentElevated}|ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script));
}
