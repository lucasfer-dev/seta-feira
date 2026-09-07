import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WAKE_WORD_VERSION = '1.0.0-system-speech';
export function probeWakeWord() {
  if (process.platform !== 'win32') return { available: false, reason: 'windows_required' };
  const script = `Add-Type -AssemblyName System.Speech; $r=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers(); if($r.Count -gt 0){$r | ForEach-Object {$_.Culture.Name}} else {exit 2}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 7000 });
  return { available: result.status === 0, cultures: String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean), reason: result.status === 0 ? null : 'speech_recognizer_unavailable' };
}
export function startWakeWordListener({ phrases = ['sexta', 'sexta-feira'], onWake = () => {}, minConfidence = 0.58 } = {}) {
  const probe = probeWakeWord();
  if (!probe.available) return { started: false, ...probe };
  const encoded = Buffer.from(JSON.stringify(phrases.map(String))).toString('base64');
  const script = `
Add-Type -AssemblyName System.Speech
$phrases=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$installed=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
$info=$installed | Where-Object {$_.Culture.Name -eq 'pt-BR'} | Select-Object -First 1
if(-not $info){$info=$installed | Select-Object -First 1}
$rec=New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
$choices=New-Object System.Speech.Recognition.Choices
$choices.Add([string[]]$phrases)
$builder=New-Object System.Speech.Recognition.GrammarBuilder($choices)
$grammar=New-Object System.Speech.Recognition.Grammar($builder)
$rec.LoadGrammar($grammar); $rec.SetInputToDefaultAudioDevice()
while($true){$r=$rec.Recognize([TimeSpan]::FromSeconds(2)); if($r -and $r.Confidence -ge ${Number(minConfidence).toFixed(2)}){Write-Output ('WAKE`t'+$r.Text+'`t'+$r.Confidence); [Console]::Out.Flush()}}
`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('WAKE\t')) continue;
      const [, phrase, confidence] = line.split('\t');
      onWake({ phrase, confidence: Number(confidence) || 0, at: new Date().toISOString() });
    }
  });
  return { started: true, child, cultures: probe.cultures, version: WAKE_WORD_VERSION };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--listen')) {
  const listener = startWakeWordListener({ onWake: event => console.log(`WAKE\t${event.phrase}\t${event.confidence}`) });
  if (!listener.started) { console.error(`WAKE_UNAVAILABLE:${listener.reason}`); process.exitCode = 2; }
}
