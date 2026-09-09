import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as ui from '../agent/windows-ui.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Windows real UIA: window enumeration, partial focus, minimized restore, click, input, passwords', {skip:process.platform!=='win32',timeout:120000},async t=>{
 const title=`SEXTA UI fixture ${process.pid}`;
 const script=`Add-Type -AssemblyName System.Windows.Forms
 $f=New-Object System.Windows.Forms.Form;$f.Text='${title}';$f.Width=500;$f.Height=350
 $text=New-Object System.Windows.Forms.TextBox;$text.Name='search';$text.AccessibleName='Pesquisar';$text.Top=20;$text.Width=300
 $pass=New-Object System.Windows.Forms.TextBox;$pass.Name='password';$pass.AccessibleName='Senha';$pass.UseSystemPasswordChar=$true;$pass.Text='SECRET-NEVER-EXPOSE';$pass.Top=60
 $btn=New-Object System.Windows.Forms.Button;$btn.Text='Configurações';$btn.Width=180;$btn.Top=100;$btn.Add_Click({$f.Text='${title} Configurações'})
 $min=New-Object System.Windows.Forms.Button;$min.Text='Minimizar';$min.Top=140;$min.Add_Click({$f.WindowState='Minimized'})
 $f.Controls.AddRange(@($text,$pass,$btn,$min));$f.Add_Shown({$f.Activate()});[System.Windows.Forms.Application]::Run($f)`;
 const child=spawn('powershell.exe',['-NoProfile','-STA','-Command',script],{stdio:'ignore'});
 t.after(()=>child.kill());
 let windows;
 for(let i=0;i<10;i++){windows=await ui.windowList(30);if(windows.windows.some(w=>w.title.includes(title)))break;await delay(200);}
 const window=windows.windows.find(w=>w.title.includes(title));assert.ok(window);
 let focus=await ui.focusWindow(title);assert.equal(focus.verified,true,JSON.stringify(focus));
 let tree=await ui.uiTree(180);assert.ok(tree.nodes.some(n=>n.name==='Pesquisar'));assert.doesNotMatch(JSON.stringify(tree),/SECRET-NEVER-EXPOSE/);
 const typed=await ui.uiTypeText('Lucas','Pesquisar');assert.equal(typed.verified,true,JSON.stringify(typed));
 await assert.rejects(()=>ui.uiTypeText('blocked','Senha'),/PASSWORD/);
 const click=await ui.uiClickText('Configurações');assert.equal(click.verified,true,JSON.stringify(click));
 await ui.uiClickText('Minimizar');
 windows=await ui.windowList(30);assert.equal(windows.windows.find(w=>w.handle===window.handle).minimized,true);
 focus=await ui.focusWindow(title,window.handle);assert.equal(focus.verified,true,JSON.stringify(focus));assert.equal(focus.after.minimized,false);
 assert.equal((await ui.uiClickText('Pagar')).ok,false);
});
