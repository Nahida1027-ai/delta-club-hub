param(
  [Parameter(Mandatory=$true)][string]$CueJson,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$cueItems = Get-Content -LiteralPath $CueJson -Encoding UTF8 -Raw | ConvertFrom-Json
$voice = New-Object -ComObject SAPI.SpVoice
$available = $voice.GetVoices()
$selected = $null
for ($i=0; $i -lt $available.Count; $i++) {
  $token = $available.Item($i)
  if ($token.GetDescription() -like '*Chinese*') { $selected = $token; break }
}
if (-not $selected) { throw 'No local Chinese SAPI voice is installed. Set VIDEO_VOICE_WAV to a separately recorded narration.' }
$voice.Voice = $selected
$voice.Rate = 1
$voice.Volume = 100
for ($i=0; $i -lt $cueItems.Count; $i++) {
  $filename = Join-Path $OutputDirectory ('cue-{0:D2}.wav' -f ($i + 1))
  $wave = New-Object -ComObject SAPI.SpFileStream
  $wave.Format.Type = 34 # SAFT44kHz16BitMono
  $wave.Open($filename, 3, $false) # SSFMCreateForWrite
  $voice.AudioOutputStream = $wave
  [void]$voice.Speak([string]$cueItems[$i].text, 0)
  $wave.Close()
}
Write-Output ('Generated {0} Chinese voice cues with {1}' -f $cueItems.Count, $selected.GetDescription())
