import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function encodedEnv(value=''){return Buffer.from(String(value),'utf8').toString('base64');}
const outputEncodingPrelude = String.raw`
$sextaUtf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$sextaUtf8
$OutputEncoding=$sextaUtf8
`;
function runPowerShell(script,timeout=8000,data={}){
  if(process.platform!=='win32')return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  const env={...process.env};for(const[key,value]of Object.entries(data||{}))env[`SEXTA_${key}`]=encodedEnv(value);
  return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});let out='',err='',settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};const timer=setTimeout(()=>{try{child.kill();}catch{};finish(reject,new Error('PC_POWERSHELL_TIMEOUT'));},timeout);
    child.stdout?.on('data',d=>{out+=d.toString('utf8');});child.stderr?.on('data',d=>{err+=d.toString('utf8');});child.on('error',error=>finish(reject,error));child.on('close',code=>code!==0?finish(reject,new Error(String(err||out||`powershell exit ${code}`).trim())):finish(resolve,String(out||'').trim()));child.stdin?.on('error',error=>{if(error?.code!=='EPIPE')finish(reject,error);});child.stdin?.end(`${outputEncodingPrelude}${String(script||'')}\r\n`,'utf8');
  });
}
function psString(value=''){return `'${String(value).replace(/'/g,"''")}'`;}
function parseJson(text,fallback={}){try{return JSON.parse(String(text||'').trim());}catch{return fallback;}}
const decodeHelper=String.raw`
function Get-SextaUtf8([string]$name){$raw=[Environment]::GetEnvironmentVariable($name);if([string]::IsNullOrWhiteSpace($raw)){return ''};return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))}
`;
const win32Prelude=String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SextaWin32 {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint processId);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint nInputs,INPUT[] pInputs,int cbSize);
 const uint INPUT_KEYBOARD=1,KEYEVENTF_KEYUP=0x0002,KEYEVENTF_UNICODE=0x0004;
 [StructLayout(LayoutKind.Sequential)] public struct INPUT{public uint type;public InputUnion U;}
 [StructLayout(LayoutKind.Explicit)] public struct InputUnion{[FieldOffset(0)]public KEYBDINPUT ki;}
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT{public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr dwExtraInfo;}
 public static bool SendUnicode(string text){if(text==null)return false;foreach(char ch in text){INPUT d=new INPUT{type=INPUT_KEYBOARD,U=new InputUnion{ki=new KEYBDINPUT{wScan=ch,dwFlags=KEYEVENTF_UNICODE}}};INPUT u=new INPUT{type=INPUT_KEYBOARD,U=new InputUnion{ki=new KEYBDINPUT{wScan=ch,dwFlags=KEYEVENTF_UNICODE|KEYEVENTF_KEYUP}}};if(SendInput(2,new INPUT[]{d,u},Marshal.SizeOf(typeof(INPUT)))!=2)return false;}return true;}
}
"@
`;
const uiPrelude=String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try{Add-Type -AssemblyName UIAutomationProvider}catch{}
`+win32Prelude+String.raw`
$handle=[SextaWin32]::GetForegroundWindow();if($handle -eq [IntPtr]::Zero){throw 'PC_UI_NO_FOREGROUND_WINDOW'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($handle);if($null -eq $root){throw 'PC_UI_ROOT_UNAVAILABLE'}
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
function Get-SextaElements(){try{return $root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition)}catch{throw ('PC_UI_ENUMERATION_FAILED: '+$_.Exception.Message)}}
function Get-SextaInfo([System.Windows.Automation.AutomationElement]$node){
 $name='';$id='';$type='';$enabled=$false;$focused=$false;$pwd=$false;$legacyName='';$legacyRole=0;$legacyState=0;$legacyValue='';$hasLegacy=$false;$hasValue=$false;$readOnly=$true
 try{$name=[string]$node.Current.Name;$id=[string]$node.Current.AutomationId;$type=[string]$node.Current.ControlType.ProgrammaticName;$enabled=[bool]$node.Current.IsEnabled;$focused=[bool]$node.Current.HasKeyboardFocus;$pwd=[bool]$node.Current.IsPassword}catch{}
 try{$lp=$node.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern);if($lp){$hasLegacy=$true;$legacyName=[string]$lp.Current.Name;$legacyRole=[int]$lp.Current.Role;$legacyState=[int]$lp.Current.State;$legacyValue=[string]$lp.Current.Value}}catch{}
 try{$vp=$node.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern);if($vp){$hasValue=$true;$readOnly=[bool]$vp.Current.IsReadOnly}}catch{}
 if(($legacyState -band 0x20000000) -ne 0){$pwd=$true}
 $effectiveName=if($pwd){'[password]'}elseif(-not [string]::IsNullOrWhiteSpace($name)){$name}else{$legacyName}
 $editable=((-not $pwd) -and (($hasValue -and -not $readOnly) -or $legacyRole -eq 42))
 [pscustomobject]@{node=$node;name=$effectiveName;rawName=$name;legacyName=$legacyName;automationId=$id;controlType=$type;legacyRole=$legacyRole;legacyState=$legacyState;legacyValue=$legacyValue;hasLegacy=$hasLegacy;hasValue=$hasValue;editable=$editable;enabled=$enabled;focused=$focused;password=$pwd}
}
`;

export async function activeWindow(){const script=win32Prelude+String.raw`
$h=[SextaWin32]::GetForegroundWindow();if($h -eq [IntPtr]::Zero){throw 'PC_WINDOW_NO_FOREGROUND'};$pidValue=[uint32]0;[void][SextaWin32]::GetWindowThreadProcessId($h,[ref]$pidValue);$p=Get-Process -Id $pidValue -ErrorAction SilentlyContinue
[pscustomobject]@{hwnd=$h.ToInt64();pid=[int]$pidValue;process=if($p){$p.ProcessName}else{''};title=if($p){$p.MainWindowTitle}else{''}}|ConvertTo-Json -Compress`;return parseJson(await runPowerShell(script),{});}
export async function windowList(limit=12){const max=Math.max(1,Math.min(30,Number(limit)||12));const script=win32Prelude+String.raw`
$fg=[SextaWin32]::GetForegroundWindow().ToInt64();$items=Get-Process|Where-Object{$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle}|Select-Object -First ${max} @{N='process';E={$_.ProcessName}},@{N='pid';E={$_.Id}},@{N='title';E={$_.MainWindowTitle}},@{N='hwnd';E={$_.MainWindowHandle.ToInt64()}},@{N='active';E={$_.MainWindowHandle.ToInt64() -eq $fg}};@($items)|ConvertTo-Json -Compress`;const result=parseJson(await runPowerShell(script),[]);const windows=Array.isArray(result)?result:result?[result]:[];return{windows,count:windows.length,active:windows.find(item=>item.active)||null};}
export async function focusWindow(title){const needle=String(title||'').trim().slice(0,240);if(!needle)throw new Error('PC_WINDOW_TITLE_REQUIRED');const script=decodeHelper+win32Prelude+String.raw`
$needle=(Get-SextaUtf8 'SEXTA_TITLE').Trim();$all=@(Get-Process|Where-Object{$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle});$ranked=@($all|ForEach-Object{$t=[string]$_.MainWindowTitle;$score=if($t.Equals($needle,[StringComparison]::OrdinalIgnoreCase)){0}elseif($t.StartsWith($needle,[StringComparison]::OrdinalIgnoreCase)){1}elseif($t.IndexOf($needle,[StringComparison]::OrdinalIgnoreCase) -ge 0){2}else{99};if($score -lt 99){[pscustomobject]@{processObj=$_;score=$score;title=$t}}}|Sort-Object score,title);if($ranked.Count -eq 0){throw 'PC_WINDOW_NOT_FOUND'}
$p=$ranked[0].processObj;$h=[IntPtr]$p.MainWindowHandle;$before=[SextaWin32]::GetForegroundWindow().ToInt64();$wasMinimized=[SextaWin32]::IsIconic($h);if($wasMinimized){[void][SextaWin32]::ShowWindowAsync($h,9);Start-Sleep -Milliseconds 160}else{[void][SextaWin32]::ShowWindowAsync($h,5)}
$fg=[SextaWin32]::GetForegroundWindow();$a=[uint32]0;$b=[uint32]0;$fgThread=if($fg -ne [IntPtr]::Zero){[SextaWin32]::GetWindowThreadProcessId($fg,[ref]$a)}else{0};$targetThread=[SextaWin32]::GetWindowThreadProcessId($h,[ref]$b);$attached=$false
try{if($fgThread -ne 0 -and $targetThread -ne 0 -and $fgThread -ne $targetThread){$attached=[SextaWin32]::AttachThreadInput($fgThread,$targetThread,$true)};[void][SextaWin32]::BringWindowToTop($h);[void][SextaWin32]::SetActiveWindow($h);[void][SextaWin32]::SetForegroundWindow($h)}finally{if($attached){[void][SextaWin32]::AttachThreadInput($fgThread,$targetThread,$false)}}
if([SextaWin32]::GetForegroundWindow() -ne $h){try{$ws=New-Object -ComObject WScript.Shell;[void]$ws.AppActivate($p.Id)}catch{}};$verified=$false;for($i=0;$i -lt 12;$i++){Start-Sleep -Milliseconds 80;if([SextaWin32]::GetForegroundWindow() -eq $h){$verified=$true;break};[void][SextaWin32]::SetForegroundWindow($h)};$after=[SextaWin32]::GetForegroundWindow().ToInt64();if(-not $verified){throw 'PC_WINDOW_FOCUS_NOT_VERIFIED'}
[pscustomobject]@{focused=$true;verified=$true;restored=[bool]$wasMinimized;process=$p.ProcessName;pid=$p.Id;title=$p.MainWindowTitle;hwnd=$h.ToInt64();beforeHwnd=$before;afterHwnd=$after;ambiguousMatches=$ranked.Count}|ConvertTo-Json -Compress`;return parseJson(await runPowerShell(script,10000,{TITLE:needle}),{});}

export async function uiTree(maxNodes=120){const max=Math.max(20,Math.min(180,Number(maxNodes)||120));const script=uiPrelude+String.raw`
$elements=Get-SextaElements;$items=New-Object System.Collections.ArrayList;$limit=[Math]::Min(${max},$elements.Count)
for($i=0;$i -lt $limit;$i++){try{$node=$elements.Item($i);$info=Get-SextaInfo $node;$r=$node.Current.BoundingRectangle;[void]$items.Add([pscustomobject]@{index=$items.Count;depth=0;name=$info.name;automationId=$info.automationId;controlType=$info.controlType;legacyRole=$info.legacyRole;editable=[bool]$info.editable;enabled=[bool]$info.enabled;focused=[bool]$info.focused;password=[bool]$info.password;x=[int]$r.X;y=[int]$r.Y;width=[int]$r.Width;height=[int]$r.Height})}catch{}}
[pscustomobject]@{window=[string]$root.Current.Name;hwnd=$handle.ToInt64();provider='uia+legacy';nodes=@($items);count=$items.Count;enumerated=$elements.Count}|ConvertTo-Json -Depth 5 -Compress`;return parseJson(await runPowerShell(script,12000),{});}
const SENSITIVE=/\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar)\b/i;
const PASSWORD_TARGET=/(?:\[password\]|\bpassword\b|\bsenha\b|\bpasscode\b|\bpin\b)/i;
export async function uiClickText(text){const needle=String(text||'').trim().slice(0,240);if(!needle)throw new Error('PC_UI_TEXT_REQUIRED');if(SENSITIVE.test(needle))throw new Error('PC_UI_SENSITIVE_CONTROL_BLOCKED');const script=decodeHelper+uiPrelude+String.raw`
$needle=(Get-SextaUtf8 'SEXTA_TEXT').Trim().ToLowerInvariant();$elements=Get-SextaElements;$matches=New-Object System.Collections.ArrayList
for($i=0;$i -lt $elements.Count -and $i -lt 1200;$i++){try{$node=$elements.Item($i);$info=Get-SextaInfo $node;if($info.password -or -not $info.enabled){continue};$name=([string]$info.name).Trim();$id=([string]$info.automationId).Trim();$nl=$name.ToLowerInvariant();$il=$id.ToLowerInvariant();$score=99;if($nl -eq $needle -or $il -eq $needle){$score=0}elseif($nl.StartsWith($needle)-or$il.StartsWith($needle)){$score=1}elseif(($nl+' '+$il).Contains($needle)){$score=2};if($score -lt 99){[void]$matches.Add([pscustomobject]@{node=$node;info=$info;score=$score})}}catch{}}
$chosen=$matches|Sort-Object score|Select-Object -First 1;if($null -eq $chosen){throw 'PC_UI_CONTROL_NOT_FOUND'};$match=[System.Windows.Automation.AutomationElement]$chosen.node;$info=$chosen.info;$name=[string]$info.name;if($name -match ${psString(SENSITIVE.source)}){throw 'PC_UI_SENSITIVE_CONTROL_BLOCKED'}
$done=$false;$via='';try{$p=$match.GetCurrentPattern([System.Windows.Automation.InvokePatternIdentifiers]::Pattern);if($p){$p.Invoke();$done=$true;$via='invoke'}}catch{};if(-not $done){try{$p=$match.GetCurrentPattern([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern);if($p){$p.Select();$done=$true;$via='selection'}}catch{}};if(-not $done){try{$p=$match.GetCurrentPattern([System.Windows.Automation.TogglePatternIdentifiers]::Pattern);if($p){$p.Toggle();$done=$true;$via='toggle'}}catch{}};if(-not $done){try{$p=$match.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePatternIdentifiers]::Pattern);if($p){$p.Expand();$done=$true;$via='expand'}}catch{}};if(-not $done){try{$p=$match.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern);if($p){$p.DoDefaultAction();$done=$true;$via='legacy'}}catch{}};if(-not $done){try{$r=$match.Current.BoundingRectangle;if($r.Width -gt 1 -and $r.Height -gt 1){$x=[int]($r.X+$r.Width/2);$y=[int]($r.Y+$r.Height/2);[void][SextaWin32]::SetCursorPos($x,$y);[SextaWin32]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero);[SextaWin32]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero);$done=$true;$via='bounding-rect'}}catch{}};if(-not $done){throw 'PC_UI_CONTROL_NOT_INVOKABLE'}
[pscustomobject]@{clicked=$true;verified=$true;name=$name;automationId=[string]$info.automationId;controlType=[string]$info.controlType;legacyRole=[int]$info.legacyRole;via=$via}|ConvertTo-Json -Compress`;return parseJson(await runPowerShell(script,12000,{TEXT:needle}),{});}
export async function uiTypeText(text,target=''){const value=String(text||'').slice(0,4000);const needle=String(target||'').trim().slice(0,240);if(needle&&PASSWORD_TARGET.test(needle))throw new Error('PC_UI_PASSWORD_FIELD_BLOCKED');const script=decodeHelper+uiPrelude+String.raw`
$value=Get-SextaUtf8 'SEXTA_VALUE';$needle=(Get-SextaUtf8 'SEXTA_TARGET').Trim().ToLowerInvariant();$match=$null;$selectedInfo=$null;$elements=Get-SextaElements;$matches=New-Object System.Collections.ArrayList
for($i=0;$i -lt $elements.Count -and $i -lt 1200;$i++){try{$node=$elements.Item($i);$info=Get-SextaInfo $node;$name=([string]$info.name).Trim();$id=([string]$info.automationId).Trim();$nl=$name.ToLowerInvariant();$il=$id.ToLowerInvariant();$score=99;if([string]::IsNullOrWhiteSpace($needle)){if($info.focused -and ($info.editable -or $info.password)){$score=0}elseif($info.editable -or $info.password){$score=3}}elseif($nl -eq $needle -or $il -eq $needle){$score=0}elseif($nl.StartsWith($needle)-or$il.StartsWith($needle)){$score=1}elseif(($nl+' '+$il).Contains($needle)){$score=2};if($score -lt 99 -and ($info.editable -or $info.password)){[void]$matches.Add([pscustomobject]@{node=$node;info=$info;score=$score})}}catch{}}
$chosen=$matches|Sort-Object score|Select-Object -First 1;if($chosen){$match=[System.Windows.Automation.AutomationElement]$chosen.node;$selectedInfo=$chosen.info};if($null -eq $match){throw 'PC_UI_EDIT_NOT_FOUND'};if([bool]$selectedInfo.password){throw 'PC_UI_PASSWORD_FIELD_BLOCKED'}
$typed=$false;$verified=$false;$via='';try{$p=$match.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern);if($p -and -not $p.Current.IsReadOnly){$p.SetValue($value);$typed=$true;$via='value-pattern';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.Value -eq $value)}}catch{};if(-not $typed){try{$p=$match.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern);if($p){$p.SetValue($value);$typed=$true;$via='legacy-value';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.Value -eq $value)}}catch{}};if(-not $typed){try{$match.SetFocus();Start-Sleep -Milliseconds 80;$typed=[SextaWin32]::SendUnicode($value);$via='unicode-input';$verified=[bool]$typed}catch{}};if(-not $typed){throw 'PC_UI_TYPE_FAILED'}
[pscustomobject]@{typed=$true;verified=[bool]$verified;name=[string]$selectedInfo.name;automationId=[string]$selectedInfo.automationId;controlType=[string]$selectedInfo.controlType;legacyRole=[int]$selectedInfo.legacyRole;length=$value.Length;via=$via}|ConvertTo-Json -Compress`;return parseJson(await runPowerShell(script,12000,{VALUE:value,TARGET:needle}),{});}
export async function uiScroll(direction='down',amount='large'){const dir=direction==='up'?'up':'down';const amt=amount==='small'?'small':'large';const script=uiPrelude+String.raw`
$node=$null;try{$node=[System.Windows.Automation.AutomationElement]::FocusedElement}catch{};if($null -eq $node){$node=$root};$pattern=$null;$current=$node;for($i=0;$i -lt 8 -and $null -ne $current -and $null -eq $pattern;$i++){try{$pattern=$current.GetCurrentPattern([System.Windows.Automation.ScrollPatternIdentifiers]::Pattern)}catch{};if($null -eq $pattern){$current=$walker.GetParent($current)}};if($null -eq $pattern){try{$pattern=$root.GetCurrentPattern([System.Windows.Automation.ScrollPatternIdentifiers]::Pattern)}catch{}};if($null -eq $pattern){throw 'PC_UI_SCROLL_UNAVAILABLE'};$before=[double]$pattern.Current.VerticalScrollPercent;$v=if(${psString(dir)} -eq 'up'){if(${psString(amt)} -eq 'small'){[System.Windows.Automation.ScrollAmount]::SmallDecrement}else{[System.Windows.Automation.ScrollAmount]::LargeDecrement}}else{if(${psString(amt)} -eq 'small'){[System.Windows.Automation.ScrollAmount]::SmallIncrement}else{[System.Windows.Automation.ScrollAmount]::LargeIncrement}};$pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,$v);Start-Sleep -Milliseconds 120;$after=[double]$pattern.Current.VerticalScrollPercent;[pscustomobject]@{scrolled=$true;verified=($before -ne $after);direction=${psString(dir)};amount=${psString(amt)};before=$before;after=$after}|ConvertTo-Json -Compress`;return parseJson(await runPowerShell(script),{});}
const HOTKEYS=new Map([['ctrl+f','^f'],['ctrl+l','^l'],['ctrl+c','^c'],['ctrl+a','^a'],['ctrl+z','^z'],['ctrl+tab','^{TAB}'],['ctrl+shift+tab','^+{TAB}'],['alt+left','%{LEFT}'],['alt+right','%{RIGHT}'],['esc','{ESC}'],['escape','{ESC}'],['tab','{TAB}'],['shift+tab','+{TAB}'],['f5','{F5}']]);
export async function uiHotkey(shortcut){const key=String(shortcut||'').toLowerCase().replace(/\s+/g,'');const send=HOTKEYS.get(key);if(!send)throw new Error('PC_UI_HOTKEY_NOT_ALLOWED');const script=String.raw`Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psString(send)})
[pscustomobject]@{sent=$true;shortcut=${psString(key)}}|ConvertTo-Json -Compress`;return parseJson(await runPowerShell(script),{});}
export async function captureScreen(scope='primary'){if(process.platform!=='win32')throw new Error('PC_SCREEN_WINDOWS_ONLY');const tmp=path.join(os.tmpdir(),`sexta-screen-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);const all=scope==='all';const maxWidth=Math.max(900,Math.min(1440,Number(process.env.SEXTA_VISION_MAX_WIDTH)||1152));const quality=Math.max(45,Math.min(78,Number(process.env.SEXTA_VISION_JPEG_QUALITY)||60));const script=String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds=if(${all?'$true':'$false'}){[System.Windows.Forms.SystemInformation]::VirtualScreen}else{[System.Windows.Forms.Screen]::PrimaryScreen.Bounds};$source=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height;$g=[System.Drawing.Graphics]::FromImage($source);$g.CopyFromScreen($bounds.X,$bounds.Y,0,0,$bounds.Size);$g.Dispose();$maxWidth=${maxWidth};if($source.Width -gt $maxWidth){$ratio=$maxWidth/[double]$source.Width;$h=[int]($source.Height*$ratio);$target=New-Object System.Drawing.Bitmap $maxWidth,$h;$tg=[System.Drawing.Graphics]::FromImage($target);$tg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$tg.DrawImage($source,0,0,$maxWidth,$h);$tg.Dispose();$source.Dispose();$source=$target};$codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType -eq 'image/jpeg'}|Select-Object -First 1;$params=New-Object System.Drawing.Imaging.EncoderParameters 1;$params.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]${quality});$source.Save(${psString(tmp)},$codec,$params);$w=$source.Width;$h=$source.Height;$source.Dispose();[pscustomobject]@{path=${psString(tmp)};width=$w;height=$h;scope=${psString(all?'all':'primary')}}|ConvertTo-Json -Compress`;const meta=parseJson(await runPowerShell(script,12000),{});if(!fs.existsSync(tmp))throw new Error('PC_SCREEN_CAPTURE_FAILED');const data=fs.readFileSync(tmp);try{fs.unlinkSync(tmp)}catch{};if(data.length>1_350_000)throw new Error('PC_SCREEN_CAPTURE_TOO_LARGE');return{...meta,mimeType:'image/jpeg',imageBase64:data.toString('base64'),bytes:data.length};}
