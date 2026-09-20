param(
  [double]$MinConfidence = 0.22
)

$ErrorActionPreference = 'Stop'

function Emit([string]$Type, [string[]]$Parts = @()) {
  $payload = @($Type) + $Parts
  [Console]::Out.WriteLine(($payload -join [char]9))
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech

  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $installed -or $installed.Count -eq 0) {
    Emit 'ERROR' @('NO_RECOGNIZER')
    exit 2
  }

  $info = $installed | Where-Object { $_.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
  if (-not $info) { $info = $installed | Where-Object { $_.Culture.Name -like 'pt-*' } | Select-Object -First 1 }
  if (-not $info) { $info = $installed | Select-Object -First 1 }

  $culture = [string]$info.Culture.Name
  $mode = if ($culture -like 'pt-*') { 'pt' } else { 'fallback' }
  $allCultures = (($installed | ForEach-Object { $_.Culture.Name }) -join ',')

  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)

  $choices = New-Object System.Speech.Recognition.Choices
  if ($mode -eq 'pt') {
    $choices.Add([string[]]@('sexta-feira', 'sexta feira', 'sexta'))
  } else {
    $choices.Add([string[]]@(
      'six the fair',
      'six the fare',
      'six to fair',
      'six two fair',
      'sister fair',
      'sista fair',
      'say sta fair',
      'sexta',
      'sexta fair'
    ))
  }

  $wakeBuilder = New-Object System.Speech.Recognition.GrammarBuilder
  $wakeBuilder.Culture = $info.Culture
  $wakeBuilder.Append($choices)
  $wakeGrammar = New-Object System.Speech.Recognition.Grammar($wakeBuilder)
  $wakeGrammar.Name = 'sexta-wake'
  $rec.LoadGrammar($wakeGrammar)

  try {
    $dictation = New-Object System.Speech.Recognition.DictationGrammar
    $dictation.Name = 'sexta-dictation'
    $rec.LoadGrammar($dictation)
  } catch {
    Emit 'INFO' @('DICTATION_UNAVAILABLE', $_.Exception.Message)
  }

  try {
    $rec.SetInputToDefaultAudioDevice()
  } catch {
    Emit 'ERROR' @('MICROPHONE_UNAVAILABLE', $_.Exception.Message)
    exit 3
  }

  $aliases = @(
    'sexta',
    'sexta feira',
    'sexta-feira',
    'six the fair',
    'six the fare',
    'six to fair',
    'six two fair',
    'sister fair',
    'sista fair',
    'say sta fair',
    'sexta fair'
  )

  $lastFallbackWake = [DateTime]::MinValue
  $rec.add_AudioLevelUpdated({
    param($sender,$e)
    if ($e.AudioLevel -gt 0) {
      Emit 'LEVEL' @([string]$e.AudioLevel)
    }
  })

  $rec.add_SpeechDetected({
    param($sender,$e)
    Emit 'SPEECH' @('detected')
    if ($mode -eq 'fallback') {
      $now = [DateTime]::UtcNow
      if (($now - $lastFallbackWake).TotalMilliseconds -ge 2500) {
        $script:lastFallbackWake = $now
        Emit 'WAKE' @('speech-fallback', '1', '')
      }
    }
  })

  Emit 'READY' @($culture, $mode, $allCultures)
  Emit 'AUDIO' @('Listening')

  while ($true) {
    try {
      $r = $rec.Recognize([TimeSpan]::FromSeconds(3))
      if (-not $r) { continue }

      $text = [string]$r.Text
      $confidence = [double]$r.Confidence
      $normalized = $text.ToLowerInvariant().Trim()

      if ($confidence -lt $MinConfidence) {
        Emit 'HEARD' @($text, [string]$confidence, 'low-confidence')
        continue
      }

      if ($mode -eq 'fallback') {
        Emit 'HEARD' @($text, [string]$confidence, 'fallback-any-speech')
        Emit 'WAKE' @($text, [string]$confidence, '')
        continue
      }

      $matched = $null
      foreach ($alias in $aliases) {
        if ($normalized -eq $alias -or $normalized.StartsWith($alias + ' ')) {
          $matched = $alias
          break
        }
      }

      if (-not $matched) {
        Emit 'HEARD' @($text, [string]$confidence, [string]$r.Grammar.Name)
        continue
      }

      $command = ''
      if ($normalized.Length -gt $matched.Length) {
        $command = $text.Substring([Math]::Min($matched.Length, $text.Length)).Trim(' ', ',', ';', ':', '.', '!', '?', '-')
      }

      Emit 'WAKE' @($text, [string]$confidence, $command)
    }
    catch {
      Emit 'ERROR' @('RECOGNIZE_LOOP', $_.Exception.Message)
      Start-Sleep -Milliseconds 800
    }
  }
}
catch {
  Emit 'ERROR' @('WAKE_FATAL', $_.Exception.GetType().FullName, $_.Exception.Message)
  exit 5
}
