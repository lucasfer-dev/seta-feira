import { spawn } from 'node:child_process';

const SENSITIVE = /\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|instalar|desinstalar)\b/i;
const PASSWORD = /(?:\[password\]|\bpassword\b|\bsenha\b|\bpasscode\b|\bpin\b|\b2fa\b|\botp\b)/i;
const MUTATING_CONTROL_ACTIONS = new Set(['invoke', 'click', 'select', 'toggle', 'expand', 'collapse']);
const VERIFIED_WRITE_ACTIONS = new Set(['set_value', 'type']);

function semanticText(value = '') {
  return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
}
function isSensitive(value = '') { return SENSITIVE.test(semanticText(value)); }
function isCredential(value = '') { return PASSWORD.test(semanticText(value)); }
function enc(value = '') { return Buffer.from(String(value), 'utf8').toString('base64'); }

function parseResult(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('PC_UI_ACTION_EMPTY_RESULT');
  try { return JSON.parse(raw); } catch {}
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try { return JSON.parse(line); } catch {}
  }
  throw new Error(`PC_UI_ACTION_JSON_INVALID:${raw.slice(0, 700)}`);
}

const prelude = String.raw`
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
function Get-SextaUtf8([string]$name){
  $raw=[Environment]::GetEnvironmentVariable($name)
  if([string]::IsNullOrWhiteSpace($raw)){return ''}
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try{Add-Type -AssemblyName UIAutomationProvider}catch{}
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SextaUiNative {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] input,int size);
 const uint INPUT_KEYBOARD=1,KEYUP=0x0002,UNICODE=0x0004;
 [StructLayout(LayoutKind.Sequential)] public struct INPUT{public uint type;public U u;}
 [StructLayout(LayoutKind.Explicit)] public struct U{
   [FieldOffset(0)]public MOUSEINPUT mi;
   [FieldOffset(0)]public KEYBDINPUT ki;
   [FieldOffset(0)]public HARDWAREINPUT hi;
 }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT{public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr dwExtraInfo;}
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT{public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT{public uint msg;public ushort paramL,paramH;}
 public static bool Unicode(string text){
   if(text==null)return false;
   foreach(char ch in text){
     var d=new INPUT{type=INPUT_KEYBOARD,u=new U{ki=new KEYBDINPUT{scan=ch,flags=UNICODE}}};
     var u=new INPUT{type=INPUT_KEYBOARD,u=new U{ki=new KEYBDINPUT{scan=ch,flags=UNICODE|KEYUP}}};
     if(SendInput(2,new[]{d,u},Marshal.SizeOf(typeof(INPUT)))!=2)return false;
   }
   return true;
 }
}
"@
$hwnd=[SextaUiNative]::GetForegroundWindow()
if($hwnd -eq [IntPtr]::Zero){throw 'PC_UI_NO_FOREGROUND_WINDOW'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if($null -eq $root){throw 'PC_UI_ROOT_UNAVAILABLE'}
function Info($n){
 $name='';$id='';$type='';$enabled=$false;$focused=$false;$pwd=$false;$off=$false
 try{
   $name=[string]$n.Current.Name
   $id=[string]$n.Current.AutomationId
   $type=[string]$n.Current.ControlType.ProgrammaticName
   $enabled=[bool]$n.Current.IsEnabled
   $focused=[bool]$n.Current.HasKeyboardFocus
   $pwd=[bool]$n.Current.IsPassword
   $off=[bool]$n.Current.IsOffscreen
 }catch{}
 if($pwd){$name='[password]'}
 return [pscustomobject]@{node=$n;name=$name;automationId=$id;controlType=$type;enabled=$enabled;focused=$focused;password=$pwd;offscreen=$off}
}
function FindTarget([string]$name,[string]$id,[string]$type){
 $els=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition)
 $matches=New-Object System.Collections.ArrayList
 for($i=0;$i -lt $els.Count -and $i -lt 1800;$i++){
   try{
     $n=$els.Item($i);$x=Info $n
     if(-not $x.enabled){continue}
     $score=1000
     $nn=([string]$x.name).Trim();$ii=([string]$x.automationId).Trim();$tt=([string]$x.controlType).Replace('ControlType.','').Trim()
     if(-not [string]::IsNullOrWhiteSpace($id)){
       if($ii.Equals($id,[StringComparison]::OrdinalIgnoreCase)){$score=0}else{continue}
     }elseif(-not [string]::IsNullOrWhiteSpace($name)){
       if($nn.Equals($name,[StringComparison]::OrdinalIgnoreCase)){$score=1}
       elseif($nn.StartsWith($name,[StringComparison]::OrdinalIgnoreCase)){$score=3}
       elseif($nn.IndexOf($name,[StringComparison]::OrdinalIgnoreCase) -ge 0){$score=5}
       else{continue}
     }else{$score=10}
     if(-not [string]::IsNullOrWhiteSpace($type)){
       $full=[string]$x.controlType
       if(-not $tt.Equals($type,[StringComparison]::OrdinalIgnoreCase) -and -not $full.Equals($type,[StringComparison]::OrdinalIgnoreCase)){continue}
       $score-=1
     }
     [void]$matches.Add([pscustomobject]@{info=$x;score=$score;index=$i})
   }catch{}
 }
 $best=$matches | Sort-Object score,index | Select-Object -First 1
 if($null -eq $best){throw 'PC_UI_CONTROL_NOT_FOUND'}
 return $best.info
}
function Test-Sensitive([string]$value){
 $v=([regex]::Replace($value,'([a-z0-9])([A-Z])','$1 $2')).Replace('_',' ').Replace('-',' ')
 return $v -match '(?i)\b(send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|instalar|desinstalar)\b'
}
`;

function run(script, timeout = 12000, data = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  const env = { ...process.env };
  for (const [key, value] of Object.entries(data)) env[`SEXTA_${key}`] = enc(value);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });
    let out = '', err = '', done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(reject, new Error('PC_UI_ACTION_TIMEOUT'));
    }, timeout);
    child.stdout.on('data', data => { out += data.toString('utf8'); });
    child.stderr.on('data', data => { err += data.toString('utf8'); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => code === 0
      ? finish(resolve, out.trim())
      : finish(reject, new Error((err || out || `powershell ${code}`).trim())));
    child.stdin.on('error', error => { if (error?.code !== 'EPIPE') finish(reject, error); });
    child.stdin.end(`${prelude}${script}\r\n`, 'utf8');
  });
}

export async function uiAction({ action = 'invoke', name = '', automationId = '', controlType = '', value = '' } = {}) {
  const op = String(action || 'invoke').toLowerCase();
  const n = String(name || '').trim().slice(0, 240);
  const id = String(automationId || '').trim().slice(0, 240);
  const type = String(controlType || '').trim().slice(0, 120);
  const val = String(value ?? '').slice(0, 4000);
  if (!n && !id && !type) throw new Error('PC_UI_SELECTOR_REQUIRED');
  if (MUTATING_CONTROL_ACTIONS.has(op) && (isSensitive(n) || isSensitive(id))) throw new Error('PC_UI_SENSITIVE_CONTROL_BLOCKED');
  if (VERIFIED_WRITE_ACTIONS.has(op) && (isCredential(n) || isCredential(id))) throw new Error('PC_UI_PASSWORD_FIELD_BLOCKED');
  if (!['invoke', 'click', 'focus', 'select', 'toggle', 'expand', 'collapse', 'set_value', 'type', 'scroll_into_view'].includes(op)) throw new Error('PC_UI_ACTION_NOT_ALLOWED');

  const script = String.raw`
$name=Get-SextaUtf8 'SEXTA_NAME';$id=Get-SextaUtf8 'SEXTA_ID';$type=Get-SextaUtf8 'SEXTA_TYPE';$value=Get-SextaUtf8 'SEXTA_VALUE';$op=Get-SextaUtf8 'SEXTA_ACTION'
$info=FindTarget $name $id $type
$node=[System.Windows.Automation.AutomationElement]$info.node
if($info.password -and ($op -eq 'set_value' -or $op -eq 'type')){throw 'PC_UI_PASSWORD_FIELD_BLOCKED'}
if(($op -match '^(invoke|click|select|toggle|expand|collapse)$') -and (Test-Sensitive ([string]$info.name+' '+[string]$info.automationId))){throw 'PC_UI_SENSITIVE_CONTROL_BLOCKED'}
$via='';$done=$false;$verified=$false
switch($op){
 'focus' {
   $node.SetFocus();Start-Sleep -Milliseconds 80;$done=$true;$via='SetFocus'
   try{$verified=[bool]$node.Current.HasKeyboardFocus}catch{$verified=$true}
 }
 'select' {
   try{$p=$node.GetCurrentPattern([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern);if($p){$p.Select();$done=$true;$via='SelectionItem';Start-Sleep -Milliseconds 60;$verified=[bool]$p.Current.IsSelected}}catch{}
 }
 'toggle' {
   try{$p=$node.GetCurrentPattern([System.Windows.Automation.TogglePatternIdentifiers]::Pattern);if($p){$before=[string]$p.Current.ToggleState;$p.Toggle();$done=$true;$via='Toggle';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.ToggleState -ne $before)}}catch{}
 }
 'expand' {
   try{$p=$node.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePatternIdentifiers]::Pattern);if($p){$p.Expand();$done=$true;$via='ExpandCollapse';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.ExpandCollapseState -match 'Expanded|PartiallyExpanded')}}catch{}
 }
 'collapse' {
   try{$p=$node.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePatternIdentifiers]::Pattern);if($p){$p.Collapse();$done=$true;$via='ExpandCollapse';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.ExpandCollapseState -match 'Collapsed')}}catch{}
 }
 'scroll_into_view' {
   try{$p=$node.GetCurrentPattern([System.Windows.Automation.ScrollItemPatternIdentifiers]::Pattern);if($p){$p.ScrollIntoView();$done=$true;$via='ScrollItem';Start-Sleep -Milliseconds 60;$verified=(-not [bool]$node.Current.IsOffscreen)}}catch{}
 }
 'set_value' {
   try{
     $p=$node.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern)
     if($p -and -not $p.Current.IsReadOnly){
       $p.SetValue($value);$done=$true;$via='ValuePattern'
       for($i=0;$i -lt 8;$i++){Start-Sleep -Milliseconds 35;if([string]$p.Current.Value -eq $value){$verified=$true;break}}
     }
   }catch{}
   if(-not $done){
     try{
       $p=$node.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern)
       if($p){$p.SetValue($value);$done=$true;$via='LegacyValue';for($i=0;$i -lt 8;$i++){Start-Sleep -Milliseconds 35;if([string]$p.Current.Value -eq $value){$verified=$true;break}}}
     }catch{}
   }
   if(-not $done){
     $node.SetFocus();Start-Sleep -Milliseconds 80
     [System.Windows.Forms.SendKeys]::SendWait('^a')
     $done=[SextaUiNative]::Unicode($value);$via='keyboard-fallback';$verified=$done
   }
 }
 'type' {
   $node.SetFocus();Start-Sleep -Milliseconds 80;$done=[SextaUiNative]::Unicode($value);$via='keyboard';$verified=$done
 }
 default {
   try{$p=$node.GetCurrentPattern([System.Windows.Automation.InvokePatternIdentifiers]::Pattern);if($p){$p.Invoke();$done=$true;$via='Invoke'}}catch{}
   if(-not $done){try{$p=$node.GetCurrentPattern([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern);if($p){$p.Select();$done=$true;$via='SelectionItem'}}catch{}}
   if(-not $done){try{$p=$node.GetCurrentPattern([System.Windows.Automation.TogglePatternIdentifiers]::Pattern);if($p){$p.Toggle();$done=$true;$via='Toggle'}}catch{}}
   if(-not $done){try{$p=$node.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern);if($p){$p.DoDefaultAction();$done=$true;$via='LegacyDefault'}}catch{}}
   if(-not $done){
     $r=$node.Current.BoundingRectangle
     if($r.Width -gt 1 -and $r.Height -gt 1){
       $x=[int]($r.X+$r.Width/2);$y=[int]($r.Y+$r.Height/2)
       [void][SextaUiNative]::SetCursorPos($x,$y)
       [SextaUiNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
       [SextaUiNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
       $done=$true;$via='uia-bounds-click'
     }
   }
   $verified=$done
 }
}
if(-not $done){throw 'PC_UI_ACTION_UNSUPPORTED'}
if(($op -eq 'set_value' -or $op -eq 'type') -and -not $verified){throw 'PC_UI_ACTION_NOT_VERIFIED'}
[pscustomobject]@{ok=$true;action=$op;verified=[bool]$verified;requiresObservation=($op -match 'invoke|click|select');name=[string]$info.name;automationId=[string]$info.automationId;controlType=[string]$info.controlType;via=$via;hwnd=$hwnd.ToInt64()}|ConvertTo-Json -Compress
`;

  const result = parseResult(await run(script, 14000, { NAME: n, ID: id, TYPE: type, VALUE: val, ACTION: op }));
  if (!result || typeof result !== 'object' || result.ok !== true) throw new Error('PC_UI_ACTION_RESULT_INVALID');
  if (VERIFIED_WRITE_ACTIONS.has(op) && result.verified !== true) throw new Error('PC_UI_ACTION_NOT_VERIFIED');
  return result;
}

export async function clickScreenPoint({ x, y, label = '' } = {}) {
  const px = Math.round(Number(x));
  const py = Math.round(Number(y));
  const target = String(label || '').trim().slice(0, 240);
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('PC_SCREEN_POINT_REQUIRED');
  if (!target) throw new Error('PC_SCREEN_POINT_LABEL_REQUIRED');
  if (isSensitive(target) || isCredential(target)) throw new Error('PC_UI_SENSITIVE_CONTROL_BLOCKED');
  const script = String.raw`
$x=[int](Get-SextaUtf8 'SEXTA_X');$y=[int](Get-SextaUtf8 'SEXTA_Y');$label=Get-SextaUtf8 'SEXTA_LABEL'
$before=[SextaUiNative]::GetForegroundWindow().ToInt64()
[void][SextaUiNative]::SetCursorPos($x,$y)
[SextaUiNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
[SextaUiNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
$after=[SextaUiNative]::GetForegroundWindow().ToInt64()
[pscustomobject]@{ok=$true;clicked=$true;verified=$false;requiresObservation=$true;via='screen-coordinate-fallback';label=$label;x=$x;y=$y;beforeHwnd=$before;afterHwnd=$after}|ConvertTo-Json -Compress
`;
  return parseResult(await run(script, 8000, { X: px, Y: py, LABEL: target }));
}
