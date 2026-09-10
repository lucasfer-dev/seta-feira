import { spawn } from 'node:child_process';

const PASSWORD_TARGET = /(?:\[password\]|\bpassword\b|\bsenha\b|\bpasscode\b|\bpin\b|\b2fa\b|\botp\b)/i;

function enc(value = '') { return Buffer.from(String(value), 'utf8').toString('base64'); }
function parseJson(text) { const raw = String(text || '').trim(); if (!raw) throw new Error('PC_UI_TYPE_EMPTY_RESULT'); try { return JSON.parse(raw); } catch { throw new Error(`PC_UI_TYPE_JSON_INVALID:${raw.slice(0, 700)}`); } }

function runPowerShell(script, timeout = 12000, envData = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envData)) env[`SEXTA_${key}`] = enc(value);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = '', settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {}; finish(reject, new Error('PC_UI_TYPE_TIMEOUT')); }, timeout);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error((err || out || `powershell ${code}`).trim())));
    child.stdin.end(`${script}\r\n`, 'utf8');
  });
}

export async function uiTypeTextV2(text, target = '') {
  const value = String(text || '').slice(0, 4000);
  const needle = String(target || '').trim().slice(0, 240);
  if (needle && PASSWORD_TARGET.test(needle)) throw new Error('PC_UI_PASSWORD_FIELD_BLOCKED');
  const script = String.raw`
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
function Decode([string]$name){$raw=[Environment]::GetEnvironmentVariable($name);if([string]::IsNullOrWhiteSpace($raw)){return ''};return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try{Add-Type -AssemblyName UIAutomationProvider}catch{}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SextaTypeNativeV2 {
 const uint INPUT_KEYBOARD=1, KEYUP=0x0002, UNICODE=0x0004;
 const uint TOKEN_QUERY=0x0008, PROCESS_QUERY_LIMITED_INFORMATION=0x1000;
 const int TokenElevation=20;
 [StructLayout(LayoutKind.Sequential)] public struct INPUT{public uint type;public U u;}
 [StructLayout(LayoutKind.Explicit)] public struct U{[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;[FieldOffset(0)]public HARDWAREINPUT hi;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT{public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT{public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT{public uint msg;public ushort paramL,paramH;}
 [StructLayout(LayoutKind.Sequential)] public struct TOKEN_ELEVATION{public int TokenIsElevated;}
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] input,int size);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int c,out TOKEN_ELEVATION info,int len,out int returned);
 static bool Elevated(IntPtr p){if(p==IntPtr.Zero)return false;IntPtr t;if(!OpenProcessToken(p,TOKEN_QUERY,out t))return false;try{TOKEN_ELEVATION i;int r;return GetTokenInformation(t,TokenElevation,out i,Marshal.SizeOf(typeof(TOKEN_ELEVATION)),out r)&&i.TokenIsElevated!=0;}finally{CloseHandle(t);}}
 public static bool CurrentElevated(){return Elevated(GetCurrentProcess());}
 public static bool TargetElevated(IntPtr h){uint pid;GetWindowThreadProcessId(h,out pid);if(pid==0)return false;IntPtr p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,pid);if(p==IntPtr.Zero)return false;try{return Elevated(p);}finally{CloseHandle(p);}}
 public static int InputSize(){return Marshal.SizeOf(typeof(INPUT));}
 public static int Unicode(string text){if(text==null)return 0;int count=0;foreach(char ch in text){var d=new INPUT{type=INPUT_KEYBOARD,u=new U{ki=new KEYBDINPUT{scan=ch,flags=UNICODE}}};var u=new INPUT{type=INPUT_KEYBOARD,u=new U{ki=new KEYBDINPUT{scan=ch,flags=UNICODE|KEYUP}}};uint sent=SendInput(2,new[]{d,u},Marshal.SizeOf(typeof(INPUT)));if(sent!=2)return -Marshal.GetLastWin32Error();count++;}return count;}
}
"@
$hwnd=[SextaTypeNativeV2]::GetForegroundWindow()
if($hwnd -eq [IntPtr]::Zero){throw 'PC_UI_NO_FOREGROUND_WINDOW'}
$currentElevated=[SextaTypeNativeV2]::CurrentElevated();$targetElevated=[SextaTypeNativeV2]::TargetElevated($hwnd)
if($targetElevated -and -not $currentElevated){throw 'PC_UI_PRIVILEGE_MISMATCH:TARGET_ELEVATED'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if($null -eq $root){throw 'PC_UI_ROOT_UNAVAILABLE'}
$value=Decode 'SEXTA_VALUE';$needle=(Decode 'SEXTA_TARGET').Trim().ToLowerInvariant()
$els=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition)
$matches=New-Object System.Collections.ArrayList
for($i=0;$i -lt $els.Count -and $i -lt 1600;$i++){
 try{
  $n=$els.Item($i);$name=[string]$n.Current.Name;$id=[string]$n.Current.AutomationId;$type=[string]$n.Current.ControlType.ProgrammaticName;$enabled=[bool]$n.Current.IsEnabled;$focused=[bool]$n.Current.HasKeyboardFocus;$pwd=[bool]$n.Current.IsPassword
  if(-not $enabled){continue};$editable=$false
  try{$vp=$n.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern);if($vp -and -not $vp.Current.IsReadOnly){$editable=$true}}catch{}
  if(-not $editable -and $type -match 'Edit'){ $editable=$true }
  if(-not $editable -and -not $pwd){continue}
  $nl=$name.Trim().ToLowerInvariant();$il=$id.Trim().ToLowerInvariant();$score=99
  if([string]::IsNullOrWhiteSpace($needle)){if($focused){$score=0}else{$score=6}}
  elseif($nl -eq $needle -or $il -eq $needle){$score=0}
  elseif($nl.StartsWith($needle)-or$il.StartsWith($needle)){$score=2}
  elseif(($nl+' '+$il).Contains($needle)){$score=4}
  if($score -lt 99){[void]$matches.Add([pscustomobject]@{node=$n;name=$name;id=$id;type=$type;password=$pwd;score=$score})}
 }catch{}
}
$chosen=$matches|Sort-Object score|Select-Object -First 1
if($null -eq $chosen){throw 'PC_UI_EDIT_NOT_FOUND'}
if([bool]$chosen.password){throw 'PC_UI_PASSWORD_FIELD_BLOCKED'}
$match=[System.Windows.Automation.AutomationElement]$chosen.node;$typed=$false;$verified=$false;$via=''
try{$p=$match.GetCurrentPattern([System.Windows.Automation.ValuePatternIdentifiers]::Pattern);if($p -and -not $p.Current.IsReadOnly){$p.SetValue($value);$typed=$true;$via='value-pattern';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.Value -eq $value)}}catch{}
if(-not $typed){try{$p=$match.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePatternIdentifiers]::Pattern);if($p){$p.SetValue($value);$typed=$true;$via='legacy-value';Start-Sleep -Milliseconds 60;$verified=([string]$p.Current.Value -eq $value)}}catch{}}
if(-not $typed){$match.SetFocus();Start-Sleep -Milliseconds 70;$sent=[SextaTypeNativeV2]::Unicode($value);if($sent -lt 0){throw ('PC_UI_TYPE_SENDINPUT_FAILED:win32='+(-1*$sent)+',inputSize='+[SextaTypeNativeV2]::InputSize())};$typed=($sent -eq $value.Length);$verified=$typed;$via='unicode-sendinput'}
if(-not $typed){throw 'PC_UI_TYPE_FAILED'}
[pscustomobject]@{typed=$true;verified=[bool]$verified;name=[string]$chosen.name;automationId=[string]$chosen.id;controlType=[string]$chosen.type;length=$value.Length;via=$via;inputSize=[SextaTypeNativeV2]::InputSize();targetElevated=$targetElevated;agentElevated=$currentElevated}|ConvertTo-Json -Compress
`;
  return parseJson(await runPowerShell(script, 12000, { VALUE: value, TARGET: needle }));
}
