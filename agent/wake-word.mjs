import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WAKE_WORD_VERSION = '1.4.0-diagnostics-fallback';
export const DEFAULT_WAKE_PHRASES = Object.freeze(['sexta-feira', 'sexta feira', 'sexta']);
export const DEFAULT_MIN_CONFIDENCE = 0.24;

export function probeWakeWord() {
  if (process.platform !== 'win32') return { available: false, reason: 'windows_required' };
  const script = `Add-Type -AssemblyName System.Speech; $r=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers(); if($r.Count -gt 0){$r | ForEach-Object {$_.Culture.Name}} else {exit 2}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 7000 });
  const cultures = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const preferredCulture = cultures.find(c => /^pt-BR$/i.test(c)) || cultures.find(c => /^pt-/i.test(c)) || cultures[0] || '';
  return {
    available: result.status === 0,
    cultures,
    preferredCulture,
    hasPortuguese: cultures.some(c => /^pt-/i.test(c)),
    reason: result.status === 0 ? null : 'speech_recognizer_unavailable'
  };
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

export function startWakeWordListener({ onWake = () => {}, onReady = () => {}, onError = () => {}, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  const probe = probeWakeWord();
  if (!probe.available) return { started: false, ...probe };

  const min = Math.max(0.2, Math.min(0.9, Number(minConfidence) || DEFAULT_MIN_CONFIDENCE)).toFixed(2);
  const script = `
Add-Type -AssemblyName System.Speech
$installed=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
$info=$installed | Where-Object {$_.Culture.Name -eq 'pt-BR'} | Select-Object -First 1
if(-not $info){$info=$installed | Where-Object {$_.Culture.Name -like 'pt-*'} | Select-Object -First 1}
if(-not $info){$info=$installed | Select-Object -First 1}
if(-not $info){ Write-Output 'ERROR' + [char]9 + 'NO_RECOGNIZER'; exit 2 }

$rec=New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)

$choices=New-Object System.Speech.Recognition.Choices
$choices.Add([string[]]@('sexta-feira','sexta feira','sexta','six the fair','six the fare','sista fair'))

$wakeBuilder=New-Object System.Speech.Recognition.GrammarBuilder
$wakeBuilder.Culture=$info.Culture
$wakeBuilder.Append($choices)
$wakeGrammar=New-Object System.Speech.Recognition.Grammar($wakeBuilder)
$wakeGrammar.Name='sexta-wake'
$rec.LoadGrammar($wakeGrammar)

try {
  $commandChoices=New-Object System.Speech.Recognition.Choices
  $commandChoices.Add([string[]]@('sexta-feira','sexta feira','sexta','six the fair','six the fare','sista fair'))
  $commandBuilder=New-Object System.Speech.Recognition.GrammarBuilder
  $commandBuilder.Culture=$info.Culture
  $commandBuilder.Append($commandChoices)
  $commandBuilder.AppendDictation()
  $commandGrammar=New-Object System.Speech.Recognition.Grammar($commandBuilder)
  $commandGrammar.Name='sexta-command'
  $rec.LoadGrammar($commandGrammar)
} catch {}

$rec.SetInputToDefaultAudioDevice()
$rec.add_SpeechRecognized({
  param($sender,$e)
  $r=$e.Result
  if(-not $r){ return }
  $text=[string]$r.Text
  if($r.Confidence -lt MIN_CONFIDENCE){ return }
  $normalized=$text.ToLowerInvariant().Trim()
  $isWake=($normalized -match '^\\s*sexta(?:[-\\s]+feira)?\\b') -or ($normalized -match '^\\s*(six the fair|six the fare|sista fair)\\b')
  if(-not $isWake){ return }
  $command=($text -replace '^\\s*(sexta(?:[-\\s]+feira)?|six the fair|six the fare|sista fair)\\b[\\s,;:.!?-]*','').Trim()
  [Console]::Out.WriteLine('WAKE'+[char]9+$text+[char]9+$r.Confidence+[char]9+$command)
  [Console]::Out.Flush()
})
$rec.add_AudioStateChanged({ param($sender,$e) [Console]::Out.WriteLine('AUDIO'+[char]9+[string]$e.AudioState); [Console]::Out.Flush() })
$rec.add_RecognizeCompleted({
  param($sender,$e)
  if($e.Error){ [Console]::Out.WriteLine('ERROR'+[char]9+$e.Error.Message); [Console]::Out.Flush() }
})

[Console]::Out.WriteLine('READY'+[char]9+$info.Culture.Name+[char]9+$(if($info.Culture.Name -like 'pt-*'){'pt'}else{'fallback'}))
[Console]::Out.Flush()
$rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
while($true){ Start-Sleep -Milliseconds 750 }
`.replace('MIN_CONFIDENCE', min);

  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
  let buffer = '';
  let errorBuffer = '';

  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('READY\t')) {
        onReady({ culture: line.split('\t')[1] || '', at:new Date().toISOString() });
        continue;
      }
      if (line.startsWith('ERROR\t')) {
        onError({ message: line.split('\t').slice(1).join('\t'), at:new Date().toISOString() });
        continue;
      }
      if (line.startsWith('AUDIO\t')) { onError({ message: 'AUDIO_STATE:' + (line.split('\t')[1] || ''), informational: true, at:new Date().toISOString() }); continue; }
      if (!line.startsWith('WAKE\t')) continue;
      const [, transcript = '', confidence = '0', ...commandParts] = line.split('\t');
      const parsed = parseWakeTranscript(transcript) || { phrase:'Sexta-Feira', command:commandParts.join('\t').trim() };
      onWake({ ...parsed, transcript, confidence:Number(confidence) || 0, at:new Date().toISOString() });
    }
  });

  child.stderr.on('data', chunk => {
    errorBuffer = (errorBuffer + String(chunk || '')).slice(-4000);
    const message = errorBuffer.trim();
    if (message) onError({ message, at:new Date().toISOString() });
  });

  return {
    started: true,
    child,
    cultures: probe.cultures,
    phrases: DEFAULT_WAKE_PHRASES,
    minConfidence:Number(min),
    version: WAKE_WORD_VERSION
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--listen')) {
  const listener = startWakeWordListener({
    onReady: event => console.log('READY\t' + (event.culture || '')),
    onError: event => console.log('ERROR\t' + (event.message || 'unknown')),
    onWake: event => console.log('WAKE\t' + event.phrase + '\t' + event.confidence + '\t' + (event.command || ''))
  });
  if (!listener.started) { console.error('WAKE_UNAVAILABLE:' + listener.reason); process.exitCode = 2; }
}
