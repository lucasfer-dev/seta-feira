import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WAKE_WORD_VERSION = '1.2.0-continuous-command';
export const DEFAULT_WAKE_PHRASES = Object.freeze(['sexta-feira', 'sexta feira', 'sexta']);

export function probeWakeWord() {
  if (process.platform !== 'win32') return { available: false, reason: 'windows_required' };
  const script = `Add-Type -AssemblyName System.Speech; $r=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers(); if($r.Count -gt 0){$r | ForEach-Object {$_.Culture.Name}} else {exit 2}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 7000 });
  return { available: result.status === 0, cultures: String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean), reason: result.status === 0 ? null : 'speech_recognizer_unavailable' };
}

export function parseWakeTranscript(text = '') {
  const raw = String(text || '').trim();
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = normalized.match(/^\s*sexta(?:[-\s]+feira)?\b[\s,;:.!?-]*(.*)$/i);
  if (!match) return null;
  const prefixMatch = raw.match(/^\s*sexta(?:[-\s]+feira)?\b[\s,;:.!?-]*/i);
  const command = prefixMatch ? raw.slice(prefixMatch[0].length).trim() : String(match[1] || '').trim();
  return { phrase: prefixMatch?.[0]?.trim().replace(/[\s,;:.!?-]+$/g, '') || 'Sexta-Feira', command };
}

export function startWakeWordListener({ onWake = () => {}, minConfidence = 0.46 } = {}) {
  const probe = probeWakeWord();
  if (!probe.available) return { started: false, ...probe };
  const min = Number(minConfidence).toFixed(2);
  const script = `
Add-Type -AssemblyName System.Speech
$installed=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
$info=$installed | Where-Object {$_.Culture.Name -eq 'pt-BR'} | Select-Object -First 1
if(-not $info){$info=$installed | Select-Object -First 1}
$rec=New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
try {
  $dictation=New-Object System.Speech.Recognition.DictationGrammar
  $rec.LoadGrammar($dictation)
} catch {
  $choices=New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]@('sexta-feira','sexta feira','sexta'))
  $builder=New-Object System.Speech.Recognition.GrammarBuilder
  $builder.Culture=$info.Culture
  $builder.Append($choices)
  $rec.LoadGrammar((New-Object System.Speech.Recognition.Grammar($builder)))
}
$rec.SetInputToDefaultAudioDevice()
while($true){
  $r=$rec.Recognize([TimeSpan]::FromSeconds(3))
  if($r -and $r.Confidence -ge MIN_CONFIDENCE){
    $text=[string]$r.Text
    if($text -match '^\s*sexta(?:[-\s]+feira)?\b'){
      $command=($text -replace '^\s*sexta(?:[-\s]+feira)?\b[\s,;:.!?-]*','').Trim()
      Write-Output ('WAKE'+[char]9+$text+[char]9+$r.Confidence+[char]9+$command)
      [Console]::Out.Flush()
    }
  }
}
`.replace('MIN_CONFIDENCE', min);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('WAKE\t')) continue;
      const [, transcript = '', confidence = '0', ...commandParts] = line.split('\t');
      const parsed = parseWakeTranscript(transcript) || { phrase:'Sexta-Feira', command:commandParts.join('\t').trim() };
      onWake({ ...parsed, transcript, confidence:Number(confidence) || 0, at:new Date().toISOString() });
    }
  });
  return { started: true, child, cultures: probe.cultures, phrases: DEFAULT_WAKE_PHRASES, version: WAKE_WORD_VERSION };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--listen')) {
  const listener = startWakeWordListener({
    onWake: event => console.log('WAKE\t' + event.phrase + '\t' + event.confidence + '\t' + (event.command || ''))
  });
  if (!listener.started) { console.error('WAKE_UNAVAILABLE:' + listener.reason); process.exitCode = 2; }
}
