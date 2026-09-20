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

  $rec.add_SpeechRecognized({
    param($sender, $e)
    $r = $e.Result
    if (-not $r) { return }

    $text = [string]$r.Text
    $confidence = [double]$r.Confidence
    $normalized = $text.ToLowerInvariant().Trim()

    if ($confidence -lt $MinConfidence) {
      Emit 'HEARD' @($text, [string]$confidence, 'low-confidence')
      return
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
      return
    }

    $command = ''
    if ($normalized.Length -gt $matched.Length) {
      $command = $text.Substring([Math]::Min($matched.Length, $text.Length)).Trim(' ', ',', ';', ':', '.', '!', '?', '-')
    }

    Emit 'WAKE' @($text, [string]$confidence, $command)
  })

  $rec.add_SpeechRecognitionRejected({
    param($sender, $e)
    if ($e.Result) {
      Emit 'HEARD' @([string]$e.Result.Text, [string]$e.Result.Confidence, 'rejected')
    }
  })

  $rec.add_AudioStateChanged({
    param($sender, $e)
    Emit 'AUDIO' @([string]$e.AudioState)
  })

  $rec.add_RecognizeCompleted({
    param($sender, $e)
    if ($e.Error) {
      Emit 'ERROR' @('RECOGNIZE_COMPLETED', $e.Error.Message)
    }
  })

  Emit 'READY' @($culture, $mode, $allCultures)
  $rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

  while ($true) {
    Start-Sleep -Milliseconds 750
  }
}
catch {
  Emit 'ERROR' @('WAKE_FATAL', $_.Exception.GetType().FullName, $_.Exception.Message)
  exit 5
}
