import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function runPowerShell(script, timeout = 8000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  return new Promise((resolve, reject) => {
    // Defender-friendly: execute a normal non-interactive PowerShell command from stdin.
    // Avoid policy-bypass flags and encoded command-line payloads; keep scripts visible to the local security stack.
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '', err = '', settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(reject, new Error('PC_POWERSHELL_TIMEOUT'));
    }, timeout);
    child.stdout?.on('data', d => { out += d; });
    child.stderr?.on('data', d => { err += d; });
    child.on('error', error => finish(reject, error));
    child.on('close', code => {
      if (code !== 0) return finish(reject, new Error(String(err || out || `powershell exit ${code}`).trim()));
      finish(resolve, String(out || '').trim());
    });
    child.stdin?.on('error', error => {
      if (error?.code !== 'EPIPE') finish(reject, error);
    });
    child.stdin?.end(`${String(script || '')}\r\n`, 'utf8');
  });
}

function psString(value = '') { return `'${String(value).replace(/'/g, "''")}'`; }
function parseJson(text, fallback = {}) {
  try { return JSON.parse(String(text || '').trim()); } catch { return fallback; }
}

const uiPrelude = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SextaWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$handle = [SextaWin32]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { throw 'PC_UI_NO_FOREGROUND_WINDOW' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { throw 'PC_UI_ROOT_UNAVAILABLE' }
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
`;

export async function windowList(limit = 12) {
  const max = Math.max(1, Math.min(30, Number(limit) || 12));
  const script = String.raw`
$items = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First ${max} @{N='process';E={$_.ProcessName}}, @{N='pid';E={$_.Id}}, @{N='title';E={$_.MainWindowTitle}}
@($items) | ConvertTo-Json -Compress
`;
  const result = parseJson(await runPowerShell(script), []);
  return { windows: Array.isArray(result) ? result : result ? [result] : [], count: Array.isArray(result) ? result.length : result ? 1 : 0 };
}

export async function focusWindow(title) {
  const needle = String(title || '').trim().slice(0, 240);
  if (!needle) throw new Error('PC_WINDOW_TITLE_REQUIRED');
  const script = String.raw`
$needle = ${psString(needle)}
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$needle*" } | Select-Object -First 1
if ($null -eq $p) { throw 'PC_WINDOW_NOT_FOUND' }
$ws = New-Object -ComObject WScript.Shell
$ok = $ws.AppActivate($p.Id)
[pscustomobject]@{ focused = [bool]$ok; process = $p.ProcessName; pid = $p.Id; title = $p.MainWindowTitle } | ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script), {});
}

export async function uiTree(maxNodes = 120) {
  const max = Math.max(20, Math.min(180, Number(maxNodes) || 120));
  const script = uiPrelude + String.raw`
$items = New-Object System.Collections.ArrayList
function Walk-Sexta([System.Windows.Automation.AutomationElement]$node, [int]$depth) {
  if ($null -eq $node -or $items.Count -ge ${max} -or $depth -gt 12) { return }
  try {
    $isPassword = [bool]$node.Current.IsPassword
    $rect = $node.Current.BoundingRectangle
    $name = if ($isPassword) { '[password]' } else { [string]$node.Current.Name }
    [void]$items.Add([pscustomobject]@{
      index = $items.Count; depth = $depth; name = $name; automationId = [string]$node.Current.AutomationId;
      controlType = [string]$node.Current.ControlType.ProgrammaticName; enabled = [bool]$node.Current.IsEnabled;
      focused = [bool]$node.Current.HasKeyboardFocus; password = $isPassword;
      x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height
    })
  } catch {}
  $child = $walker.GetFirstChild($node)
  while ($null -ne $child -and $items.Count -lt ${max}) {
    Walk-Sexta $child ($depth + 1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk-Sexta $root 0
[pscustomobject]@{ window = [string]$root.Current.Name; nodes = @($items); count = $items.Count } | ConvertTo-Json -Depth 5 -Compress
`;
  return parseJson(await runPowerShell(script, 10000), {});
}

const SENSITIVE = /\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|ok|yes|sim|accept|aceitar|allow|permitir)\b/i;

export async function uiClickText(text) {
  const needle = String(text || '').trim().slice(0, 240);
  if (!needle) throw new Error('PC_UI_TEXT_REQUIRED');
  if (SENSITIVE.test(needle)) throw new Error('PC_UI_SENSITIVE_CONTROL_BLOCKED');
  const script = uiPrelude + String.raw`
$needle = ${psString(needle)}.ToLowerInvariant()
$queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
$match = $null
$fuzzy = $null
$count = 0
while ($queue.Count -gt 0 -and $count -lt 700 -and $null -eq $match) {
  $node = [System.Windows.Automation.AutomationElement]$queue.Dequeue(); $count++
  try {
    $name = ([string]$node.Current.Name).Trim(); $id = ([string]$node.Current.AutomationId).Trim();
    $candidate = ($name + ' ' + $id).ToLowerInvariant()
    if ($name.ToLowerInvariant() -eq $needle -or $id.ToLowerInvariant() -eq $needle) { $match = $node; break }
    if ($null -eq $fuzzy -and $candidate.Contains($needle)) { $fuzzy = $node }
  } catch {}
  $child = $walker.GetFirstChild($node)
  while ($null -ne $child) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) }
}
if ($null -eq $match) { $match = $fuzzy }
if ($null -eq $match) { throw 'PC_UI_CONTROL_NOT_FOUND' }
$name = [string]$match.Current.Name
if (${psString(SENSITIVE.source)} -and $name -match ${psString(SENSITIVE.source)}) { throw 'PC_UI_SENSITIVE_CONTROL_BLOCKED' }
$done = $false; $via = ''
try { $p = $match.GetCurrentPattern([System.Windows.Automation.InvokePatternIdentifiers]::Pattern); if ($p) { $p.Invoke(); $done=$true; $via='invoke' } } catch {}
if (-not $done) { try { $p = $match.GetCurrentPattern([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern); if ($p) { $p.Select(); $done=$true; $via='selection' } } catch {} }
if (-not $done) { try { $p = $match.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern); if ($p) { $p.DoDefaultAction(); $done=$true; $via='legacy' } } catch {} }
if (-not $done) { throw 'PC_UI_CONTROL_NOT_INVOKABLE' }
[pscustomobject]@{ clicked=$true; name=$name; automationId=[string]$match.Current.AutomationId; via=$via } | ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script, 10000), {});
}

export async function uiTypeText(text, target = '') {
  const value = String(text || '').slice(0, 4000);
  const needle = String(target || '').trim().slice(0, 240);
  const script = uiPrelude + String.raw`
$value = ${psString(value)}
$needle = ${psString(needle)}.ToLowerInvariant()
$match = $null
if ([string]::IsNullOrWhiteSpace($needle)) {
  try { $match = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
}
if ($null -eq $match -or -not [string]::IsNullOrWhiteSpace($needle)) {
  $queue = New-Object System.Collections.Queue; $queue.Enqueue($root); $count=0
  while ($queue.Count -gt 0 -and $count -lt 700 -and $null -eq $match) {
    $node=[System.Windows.Automation.AutomationElement]$queue.Dequeue(); $count++
    try {
      $type=[string]$node.Current.ControlType.ProgrammaticName; $name=([string]$node.Current.Name).ToLowerInvariant(); $id=([string]$node.Current.AutomationId).ToLowerInvariant()
      if ($type -eq 'ControlType.Edit' -and ([string]::IsNullOrWhiteSpace($needle) -or $name.Contains($needle) -or $id.Contains($needle))) { $match=$node; break }
    } catch {}
    $child=$walker.GetFirstChild($node); while ($null -ne $child) { $queue.Enqueue($child); $child=$walker.GetNextSibling($child) }
  }
}
if ($null -eq $match) { throw 'PC_UI_EDIT_NOT_FOUND' }
$isPassword=[bool]$match.Current.IsPassword
if ($isPassword) { throw 'PC_UI_PASSWORD_FIELD_BLOCKED' }
try { $p=$match.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern); if ($null -eq $p) { throw 'PC_UI_VALUE_PATTERN_UNAVAILABLE' }; $p.SetValue($value) } catch { throw $_ }
[pscustomobject]@{ typed=$true; name=[string]$match.Current.Name; length=$value.Length } | ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script, 10000), {});
}

export async function uiScroll(direction = 'down', amount = 'large') {
  const dir = direction === 'up' ? 'up' : 'down';
  const amt = amount === 'small' ? 'small' : 'large';
  const script = uiPrelude + String.raw`
$node = $null
try { $node = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
if ($null -eq $node) { $node = $root }
$pattern = $null
$current = $node
for ($i=0; $i -lt 8 -and $null -ne $current -and $null -eq $pattern; $i++) {
  try { $pattern=$current.GetCurrentPattern([System.Windows.Automation.ScrollPatternIdentifiers]::Pattern) } catch {}
  if ($null -eq $pattern) { $current=$walker.GetParent($current) }
}
if ($null -eq $pattern) { try { $pattern=$root.GetCurrentPattern([System.Windows.Automation.ScrollPatternIdentifiers]::Pattern) } catch {} }
if ($null -eq $pattern) { throw 'PC_UI_SCROLL_UNAVAILABLE' }
$v = if (${psString(dir)} -eq 'up') { if (${psString(amt)} -eq 'small') {[System.Windows.Automation.ScrollAmount]::SmallDecrement} else {[System.Windows.Automation.ScrollAmount]::LargeDecrement} } else { if (${psString(amt)} -eq 'small') {[System.Windows.Automation.ScrollAmount]::SmallIncrement} else {[System.Windows.Automation.ScrollAmount]::LargeIncrement} }
$pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,$v)
[pscustomobject]@{ scrolled=$true; direction=${psString(dir)}; amount=${psString(amt)} } | ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script), {});
}

const HOTKEYS = new Map([
  ['ctrl+f', '^f'], ['ctrl+l', '^l'], ['ctrl+c', '^c'], ['ctrl+a', '^a'], ['ctrl+z', '^z'],
  ['ctrl+tab', '^{TAB}'], ['ctrl+shift+tab', '^+{TAB}'], ['alt+left', '%{LEFT}'], ['alt+right', '%{RIGHT}'],
  ['esc', '{ESC}'], ['escape', '{ESC}'], ['tab', '{TAB}'], ['shift+tab', '+{TAB}'], ['f5', '{F5}']
]);

export async function uiHotkey(shortcut) {
  const key = String(shortcut || '').toLowerCase().replace(/\s+/g, '');
  const send = HOTKEYS.get(key);
  if (!send) throw new Error('PC_UI_HOTKEY_NOT_ALLOWED');
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psString(send)})
[pscustomobject]@{ sent=$true; shortcut=${psString(key)} } | ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script), {});
}

export async function captureScreen(scope = 'primary') {
  if (process.platform !== 'win32') throw new Error('PC_SCREEN_WINDOWS_ONLY');
  const tmp = path.join(os.tmpdir(), `sexta-screen-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  const all = scope === 'all';
  const maxWidth = Math.max(900, Math.min(1440, Number(process.env.SEXTA_VISION_MAX_WIDTH) || 1152));
  const quality = Math.max(45, Math.min(78, Number(process.env.SEXTA_VISION_JPEG_QUALITY) || 60));
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = if (${all ? '$true' : '$false'}) { [System.Windows.Forms.SystemInformation]::VirtualScreen } else { [System.Windows.Forms.Screen]::PrimaryScreen.Bounds }
$source = New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
$g=[System.Drawing.Graphics]::FromImage($source)
$g.CopyFromScreen($bounds.X,$bounds.Y,0,0,$bounds.Size)
$g.Dispose()
$maxWidth=${maxWidth}
if ($source.Width -gt $maxWidth) {
  $ratio=$maxWidth / [double]$source.Width; $h=[int]($source.Height*$ratio)
  $target=New-Object System.Drawing.Bitmap $maxWidth,$h
  $tg=[System.Drawing.Graphics]::FromImage($target); $tg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $tg.DrawImage($source,0,0,$maxWidth,$h); $tg.Dispose(); $source.Dispose(); $source=$target
}
$codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$params=New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]${quality})
$source.Save(${psString(tmp)},$codec,$params)
$w=$source.Width; $h=$source.Height; $source.Dispose()
[pscustomobject]@{ path=${psString(tmp)}; width=$w; height=$h; scope=${psString(all ? 'all' : 'primary')} } | ConvertTo-Json -Compress
`;
  const meta = parseJson(await runPowerShell(script, 12000), {});
  if (!fs.existsSync(tmp)) throw new Error('PC_SCREEN_CAPTURE_FAILED');
  const data = fs.readFileSync(tmp);
  try { fs.unlinkSync(tmp); } catch {}
  if (data.length > 1_350_000) throw new Error('PC_SCREEN_CAPTURE_TOO_LARGE');
  return { ...meta, mimeType: 'image/jpeg', imageBase64: data.toString('base64'), bytes: data.length };
}
