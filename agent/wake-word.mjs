import { spawn, spawnSync } from 'node:child_process';

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

export function startWakeWordListener({ onWake = () => {}, onReady = () => {}, onError = () => {}, onAudioState = () => {}, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
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
if($info.Culture.Name -like 'pt-*'){
  $choices.Add([string[]]@('sexta-feira','sexta feira','sexta'))
}else{
  $choices.Add([string[]]@('six the fair','six the fare','sista fair','sexta'))
}

$wakeBuilder=New-Object System.Speech.Recognition.GrammarBuilder
$wakeBuilder.Culture=$info.Culture
$wakeBuilder.Append($choices)
$wakeGrammar=New-Object System.Speech.Recognition.Grammar($wakeBuilder)
$wakeGrammar.Name='sexta-wake'
$rec.LoadGrammar($wakeGrammar)

try {
  $dictation=New-Object System.Speech.Recognition.DictationGrammar
  $dictation.Name='sexta-dictation'
  $rec.LoadGrammar($dictation)
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
  if(-not $isWake){ [Console]::Out.WriteLine('HEARD'+[char]9+$text+[char]9+$r.Confidence); [Console]::Out.Flush(); return }
  $command=($text -replace '^\\s*(sexta(?:[-\\s]+feira)?|six the fair|six the fare|sista fair)\\b[\\s,;:.!?-]*','').Trim()
  [Console]::Out.WriteLine('WAKE'+[char]9+$text+[char]9+$r.Confidence+[char]9+$command)
  [Console]::Out.Flush()
})
$rec.add_SpeechRecognitionRejected({
  param($sender,$e)
  if($e.Result){
    [Console]::Out.WriteLine('HEARD'+[char]9+[string]$e.Result.Text+[char]9+$e.Result.Confidence)
    [Console]::Out.Flush()
  }
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
        const parts=line.split('\t'); onReady({ culture: parts[1] || '', mode: parts[2] || '', at:new Date().toISOString() });
        continue;
      }
      if (line.startsWith('ERROR\t')) {
        onError({ message: line.split('\t').slice(1).join('\t'), at:new Date().toISOString() });
        continue;
      }
      if (line.startsWith('AUDIO\t')) { onAudioState({ state: line.split('\t')[1] || '', at:new Date().toISOString() }); continue; }
      if (line.startsWith('HEARD\t')) { onError({ message: 'HEARD:' + line.split('\t').slice(1).join('\t'), informational: true, at:new Date().toISOString() }); continue; }
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

if (process.argv.includes('--listen')) {
  const listener = startWakeWordListener({
    onReady: event => console.log('READY\t' + (event.culture || '') + '\t' + (event.mode || '')),
    onError: event => console.log((event.informational ? 'HEARD\t' : 'ERROR\t') + (event.message || 'unknown').replace(/^HEARD:/,'')),
    onAudioState: event => console.log('AUDIO\t' + (event.state || '')),
    onWake: event => console.log('WAKE\t' + event.phrase + '\t' + event.confidence + '\t' + (event.command || ''))
  });
  if (!listener.started) { console.error('WAKE_UNAVAILABLE:' + listener.reason); process.exitCode = 2; }
}
