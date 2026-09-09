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
    child.stdin?.end(`[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)\r\n& {\r\ntry {\r\n$ErrorActionPreference = 'Stop'\r\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\r\n${String(script || '')}\r\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }\r\n}\r\n\r\n`, 'utf8');
  });
}

function psString(value = '') { return `'${String(value).replace(/'/g, "''")}'`; }
function parseJson(text, fallback = {}) {
  try { return JSON.parse(String(text || '').trim()); } catch { throw new Error('PC_WINDOWS_INVALID_RESPONSE'); }
}

const uiPrelude = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
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

const windowPrelude = String.raw`
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SextaWindow {
 public long handle; public uint pid; public string title; public bool minimized; public bool maximized; public bool active;
}
public static class SextaFocus {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
 public static SextaWindow[] List() {
  var result = new List<SextaWindow>();
  EnumWindows((h,p)=>{ var text=new StringBuilder(1024); GetWindowText(h,text,text.Capacity);
   if(IsWindowVisible(h)&&text.Length>0) {uint pid;GetWindowThreadProcessId(h,out pid);result.Add(new SextaWindow {handle=h.ToInt64(),pid=pid,title=text.ToString(),minimized=IsIconic(h),maximized=IsZoomed(h),active=h==GetForegroundWindow()});} return true;},IntPtr.Zero);
  return result.ToArray();
 }
 public static bool Focus(long handle) {
  IntPtr h=new IntPtr(handle); if(IsIconic(h)) ShowWindow(h,9);
  if(SetForegroundWindow(h)&&GetForegroundWindow()==h) return true;
  uint pid;uint own=GetCurrentThreadId(),fg=GetWindowThreadProcessId(GetForegroundWindow(),out pid),dest=GetWindowThreadProcessId(h,out pid);
  bool a=false,b=false;
  try {
   if(fg!=0&&fg!=own) a=AttachThreadInput(own,fg,true);
   if(dest!=0&&dest!=own&&dest!=fg) b=AttachThreadInput(own,dest,true);
   BringWindowToTop(h); SetActiveWindow(h); SetForegroundWindow(h);
  } finally {if(b) AttachThreadInput(own,dest,false);if(a) AttachThreadInput(own,fg,false);}
  return GetForegroundWindow()==h;
 }
}
"@
`;

export async function windowList(limit = 12) {
  const max = Math.max(1, Math.min(30, Math.floor(Number(limit) || 12)));
  const result = parseJson(await runPowerShell(windowPrelude + String.raw`
$all = @([SextaFocus]::List())
$items = @($all | Select-Object -First ${max})
[pscustomobject]@{ windows=$items; count=$items.Count; activeWindow=($all | Where-Object active | Select-Object -First 1) } | ConvertTo-Json -Depth 5 -Compress
`));
  return { ...result, ok: true, state: 'completed', verified: true };
}

export async function focusWindow(title, handle) {
  const needle = String(title || '').trim().slice(0, 240);
  if (!needle && handle == null) throw new Error('PC_WINDOW_TITLE_REQUIRED');
  if (handle != null && (!Number.isSafeInteger(Number(handle)) || Number(handle) <= 0)) throw new Error('PC_WINDOW_HANDLE_INVALID');
  return parseJson(await runPowerShell(windowPrelude + String.raw`
$needle = ${psString(needle)}
$deadline = [DateTime]::UtcNow.AddSeconds(4)
$matches = @()
do {
 $all=@([SextaFocus]::List())
 $matches=@($all | Where-Object { ${handle != null ? '$_.handle -eq '+Number(handle) : '$_.title.IndexOf($needle,[StringComparison]::OrdinalIgnoreCase) -ge 0'} })
 if ($matches.Count -eq 0) { Start-Sleep -Milliseconds 150 }
} while ($matches.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
$exact=@($matches | Where-Object { $_.title -ieq $needle })
if ($exact.Count -gt 0) { $matches=$exact }
if ($matches.Count -ne 1) {
 $reason=if($matches.Count -eq 0){'PC_WINDOW_NOT_FOUND'}else{'PC_WINDOW_AMBIGUOUS'}
 [pscustomobject]@{ok=$false;state='failed';action='window_focus';verified=$false;error=$reason;reason=$reason;observedState=@{candidates=$matches}} | ConvertTo-Json -Depth 6 -Compress
} else {
 $selected=$matches[0]; $before=($all | Where-Object active | Select-Object -First 1)
 $focused=$false
 for($i=0;$i -lt 4 -and -not $focused;$i++) {
  [void][SextaFocus]::Focus($selected.handle)
  Start-Sleep -Milliseconds 120
  $focused=([SextaFocus]::GetForegroundWindow().ToInt64() -eq $selected.handle)
 }
 $after=([SextaFocus]::List() | Where-Object active | Select-Object -First 1)
 $focused=$focused -and $null -ne $after -and $after.handle -eq $selected.handle -and -not $after.minimized
 [pscustomobject]@{ok=[bool]$focused;state=$(if($focused){'completed'}else{'failed'});action='window_focus';verified=[bool]$focused;focused=[bool]$focused;before=$before;after=$after;target=$selected;error=$(if(-not $focused){'PC_WINDOW_FOCUS_DENIED'}else{$null});reason=$(if(-not $focused){'PC_WINDOW_FOCUS_DENIED'}else{$null});observedState=$after} | ConvertTo-Json -Depth 6 -Compress
}
`, 12000));
}

export async function uiTree(maxNodes = 120) {
  const max = Math.max(20, Math.min(180, Number(maxNodes) || 120));
  const script = uiPrelude + String.raw`
$items = New-Object System.Collections.ArrayList
$readErrors = New-Object System.Collections.ArrayList
function Walk-Sexta([System.Windows.Automation.AutomationElement]$node, [int]$depth) {
  if ($null -eq $node -or $items.Count -ge ${max} -or $depth -gt 12) { return }
  try {
    $isPassword = [bool]$node.Current.IsPassword
    $rect = $node.Current.BoundingRectangle
    $name = if ($isPassword) { '[password]' } else { [string]$node.Current.Name }
    [void]$items.Add([pscustomobject]@{
      value = $(if(-not $isPassword){try{$vp=$node.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern);[string]$vp.Current.Value}catch{''}}else{'[password]'});
      toggle = $(try{$tp=$node.GetCurrentPattern([System.Windows.Automation.TogglePatternIdentifiers]::Pattern);[string]$tp.Current.ToggleState}catch{''});
      selected = $(try{$sp=$node.GetCurrentPattern([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern);$sp.Current.IsSelected}catch{$false});
      scroll = $(try{$sp=$node.GetCurrentPattern([System.Windows.Automation.ScrollPatternIdentifiers]::Pattern);$sp.Current.VerticalScrollPercent}catch{-1});
      index = $items.Count; depth = $depth; name = $name; automationId = [string]$node.Current.AutomationId;
      controlType = [string]$node.Current.ControlType.ProgrammaticName; enabled = [bool]$node.Current.IsEnabled;
      focused = [bool]$node.Current.HasKeyboardFocus; password = $isPassword;
      boundingRectangle = @{x=$rect.X;y=$rect.Y;width=$rect.Width;height=$rect.Height};
      x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height
    })
  } catch { [void]$readErrors.Add($_.Exception.Message) }
  $child = $walker.GetFirstChild($node)
  while ($null -ne $child -and $items.Count -lt ${max}) {
    Walk-Sexta $child ($depth + 1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk-Sexta $root 0
[pscustomobject]@{ window = [string]$root.Current.Name; nodes = @($items); count = $items.Count; readErrors=@($readErrors) } | ConvertTo-Json -Depth 5 -Compress
`;
  return parseJson(await runPowerShell(script, 10000), {});
}

const SENSITIVE = /\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|install|instalar|ok|yes|sim|accept|aceitar|allow|permitir)\b/i;

async function clickText(text) {
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
    $candidate = ($name + ' ' + $id + ' ' + [string]$node.Current.ControlType.ProgrammaticName).ToLowerInvariant()
    if (-not $node.Current.IsEnabled -or $node.Current.IsPassword -or $node.Current.IsOffscreen -or [string]$node.Current.ControlType.ProgrammaticName -notmatch 'Button|MenuItem|TabItem|CheckBox|RadioButton|Hyperlink|ListItem|TreeItem|ComboBox|SplitButton') { throw 'skip noninteractive' }
    if ($name.ToLowerInvariant() -eq $needle -or $id.ToLowerInvariant() -eq $needle) { $match = $node; break }
    if ($null -eq $fuzzy -and $candidate.Contains($needle)) { $fuzzy = $node }
  } catch {}
  $child = $walker.GetFirstChild($node)
  while ($null -ne $child) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) }
}
if ($null -eq $match) { $match = $fuzzy }
if ($null -eq $match) { throw 'PC_UI_CONTROL_NOT_FOUND' }
$name = [string]$match.Current.Name
if ([SextaWin32]::GetForegroundWindow() -ne $handle) { throw 'PC_UI_FOREGROUND_CHANGED' }
if ($match.Current.IsPassword) { throw 'PC_UI_PASSWORD_FIELD_BLOCKED' }
if (${psString(SENSITIVE.source)} -and $name -match ${psString(SENSITIVE.source)}) { throw 'PC_UI_SENSITIVE_CONTROL_BLOCKED' }
$done = $false; $via = ''
try { $p = $match.GetCurrentPattern([System.Windows.Automation.InvokePatternIdentifiers]::Pattern); if ($p) { $p.Invoke(); $done=$true; $via='invoke' } } catch {}
if (-not $done) { try { $p = $match.GetCurrentPattern([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern); if ($p) { $p.Select(); $done=$true; $via='selection' } } catch {} }
if (-not $done) { try { $p=$match.GetCurrentPattern([System.Windows.Automation.TogglePatternIdentifiers]::Pattern); if($p){$p.Toggle();$done=$true;$via='toggle'} } catch {} }
if (-not $done) { try { $p = $match.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern); if ($p) { $p.DoDefaultAction(); $done=$true; $via='legacy' } } catch {} }
if (-not $done) {
 if ([SextaWin32]::GetForegroundWindow() -ne $handle) { throw 'PC_UI_FOREGROUND_CHANGED' }
 $r=$match.Current.BoundingRectangle
 if($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0){throw 'PC_UI_CONTROL_NOT_INVOKABLE'}
 Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SextaMouse {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr extra);
}
"@
 $point=New-Object System.Windows.Point ($r.X+$r.Width/2),($r.Y+$r.Height/2)
 $hit=[System.Windows.Automation.AutomationElement]::FromPoint($point)
 $ancestor=$hit; $inside=$false
 for($i=0;$i -lt 12 -and $null -ne $ancestor;$i++) {if($ancestor.Equals($match)){$inside=$true;break};$ancestor=$walker.GetParent($ancestor)}
 if(-not $inside){throw 'PC_UI_CONTROL_OCCLUDED'}
 [void][SextaMouse]::SetCursorPos([int]$point.X,[int]$point.Y)
 [SextaMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[SextaMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 $done=$true;$via='boundingRectangle'
}
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
$ancestor=$match;$inside=$false
for($i=0;$i -lt 30 -and $null -ne $ancestor;$i++){if($ancestor.Equals($root)){$inside=$true;break};$ancestor=$walker.GetParent($ancestor)}
if(-not $inside){throw 'PC_UI_TARGET_OUTSIDE_WINDOW'}
$isPassword=[bool]$match.Current.IsPassword
if ($isPassword) { throw 'PC_UI_PASSWORD_FIELD_BLOCKED' }
if (-not $match.Current.IsEnabled -or [string]$match.Current.ControlType.ProgrammaticName -notmatch 'ControlType.Edit|ControlType.Document') { throw 'PC_UI_NOT_EDITABLE' }
if ([SextaWin32]::GetForegroundWindow() -ne $handle) { throw 'PC_UI_FOREGROUND_CHANGED' }
$p=$null
try {$p=$match.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern)}catch{}
if($p -and $p.Current.IsReadOnly){throw 'PC_UI_READ_ONLY'}
$before=if($p){[string]$p.Current.Value}else{''}
$via='value'
if($p){$p.SetValue($value)}else{
 $match.SetFocus()
 if(-not $match.Current.HasKeyboardFocus -or $match.Current.IsPassword){throw 'PC_UI_FOCUS_FAILED'}
 Add-Type -AssemblyName System.Windows.Forms
 # Literal per-character escaping prevents text from becoming a SendKeys shortcut.
 $escaped= -join ($value.ToCharArray() | ForEach-Object {if('+^%~()[]{}'.Contains([string]$_)){'{'+[string]$_+'}'}elseif([int]$_ -lt 32){throw 'PC_UI_CONTROL_CHARACTER_BLOCKED'}else{[string]$_}})
 [System.Windows.Forms.SendKeys]::SendWait('^a')
 [System.Windows.Forms.SendKeys]::SendWait($escaped)
 $via='literal-input'
}
$verified=$false;$after=''
for($i=0;$i -lt 8 -and -not $verified;$i++){
 Start-Sleep -Milliseconds 100
 if($match.Current.IsPassword){throw 'PC_UI_PASSWORD_FIELD_BLOCKED'}
 if($p){$after=[string]$p.Current.Value}else{
  try{$tp=$match.GetCurrentPattern([System.Windows.Automation.TextPatternIdentifiers]::Pattern);$after=$tp.DocumentRange.GetText(4001).TrimEnd([char]13,[char]10)}catch{throw 'PC_UI_INPUT_UNVERIFIABLE'}
 }
 $verified=$after -ceq $value
}
[pscustomobject]@{ok=$verified;state=$(if($verified){'completed'}else{'failed'});action='ui_type_text';verified=$verified;typed=$verified;name=[string]$match.Current.Name;length=$value.Length;via=$via;before=@{value=$before};after=@{value=$after};error=$(if(-not $verified){'PC_UI_INPUT_VERIFICATION_FAILED'}else{$null})} | ConvertTo-Json -Depth 5 -Compress
`;
  return parseJson(await runPowerShell(script, 10000), {});
}

async function scroll(direction = 'down', amount = 'large') {
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

async function hotkey(shortcut) {
  const key = String(shortcut || '').toLowerCase().replace(/\s+/g, '');
  const send = HOTKEYS.get(key);
  if (!send) throw new Error('PC_UI_HOTKEY_NOT_ALLOWED');
  const script = uiPrelude + String.raw`
$focused=[System.Windows.Automation.AutomationElement]::FocusedElement
if($focused -and $focused.Current.IsPassword){throw 'PC_UI_PASSWORD_FIELD_BLOCKED'}
if([SextaWin32]::GetForegroundWindow() -ne $handle){throw 'PC_UI_FOREGROUND_CHANGED'}
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


async function verifiedUiAction(action, operation) {
  let before, after;
  try {
    before = await uiTree(180);
    const result = await operation();
    const deadline = Date.now() + 3500;
    do {
      after = await uiTree(180);
      if (JSON.stringify(before) !== JSON.stringify(after)) return { ...result, ok: true, state: 'completed', action, verified: true, before, after };
      await new Promise(resolve => setTimeout(resolve, 150));
    } while (Date.now() < deadline);
    return { ok: false, state: 'failed', action, verified: false, error: 'PC_UI_CHANGE_UNVERIFIED', reason: 'PC_UI_CHANGE_UNVERIFIED', before, observedState: after };
  } catch (error) {
    return { ok: false, state: 'failed', action, verified: false, error: error.message, reason: error.message, before, observedState: after || {} };
  }
}
export async function uiClickText(text) { return verifiedUiAction('ui_click_text', () => clickText(text)); }
export async function uiScroll(direction, amount) { return verifiedUiAction('ui_scroll', () => scroll(direction, amount)); }
export async function uiHotkey(shortcut) { return verifiedUiAction('ui_hotkey', () => hotkey(shortcut)); }
