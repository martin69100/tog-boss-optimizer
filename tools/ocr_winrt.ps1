param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Paths
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
})[0]

function Await-WinRt($WinRtTask, [Type]$ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

$lang = [Windows.Globalization.Language]::new("fr-FR")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if (-not $engine) {
  throw "Impossible d'initialiser Windows.Media.Ocr.OcrEngine."
}

function Convert-OcrResult($ocrRes) {
  $linesOut = @()
  foreach ($line in $ocrRes.Lines) {
    $minX = [double]::PositiveInfinity
    $minY = [double]::PositiveInfinity
    $maxX = 0.0
    $maxY = 0.0
    $wordsOut = @()
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      if ($r.X -lt $minX) { $minX = $r.X }
      if ($r.Y -lt $minY) { $minY = $r.Y }
      if (($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
      if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
      $wordsOut += [ordered]@{
        text = $word.Text
        x    = [math]::Round($r.X, 1)
        y    = [math]::Round($r.Y, 1)
        w    = [math]::Round($r.Width, 1)
        h    = [math]::Round($r.Height, 1)
      }
    }
    if ([double]::IsInfinity($minX)) { $minX = 0; $minY = 0 }
    $linesOut += [ordered]@{
      text  = $line.Text
      x     = [math]::Round($minX, 1)
      y     = [math]::Round($minY, 1)
      w     = [math]::Round([math]::Max(0, $maxX - $minX), 1)
      h     = [math]::Round([math]::Max(0, $maxY - $minY), 1)
      words = $wordsOut
    }
  }
  return [ordered]@{
    fullText = $ocrRes.Text
    lines    = $linesOut
  }
}

function Invoke-OcrBitmap($bmp, [int]$scale = 2, [bool]$softInvert = $false, [int]$pad = 24) {
  $sw = [int]([math]::Max(1, $bmp.Width * $scale))
  $sh = [int]([math]::Max(1, $bmp.Height * $scale))
  $w = $sw + $pad * 2
  $h = $sh + $pad * 2
  $canvas = New-Object System.Drawing.Bitmap($w, $h)
  try {
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $g.Clear($(if ($softInvert) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(245, 245, 245) }))
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($bmp, $pad, $pad, $sw, $sh)
    } finally {
      $g.Dispose()
    }
    if ($softInvert) {
      for ($y = $pad; $y -lt ($h - $pad); $y++) {
        for ($x = $pad; $x -lt ($w - $pad); $x++) {
          $p = $canvas.GetPixel($x, $y)
          $lum = 0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B
          $isGold = ($p.R -gt 195 -and $p.G -gt 170 -and $p.B -lt 155)
          $effLum = if ($isGold) { [math]::Max($lum, 225) } else { $lum }
          $v = [int][math]::Max(0, [math]::Min(255, (232 - $effLum) * 2.2))
          $canvas.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($v, $v, $v))
        }
      }
    }
    $ms = New-Object System.IO.MemoryStream
    try {
      $canvas.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $ms.Position = 0
      $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
      try {
        $dec = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $sb = Await-WinRt ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
          $res = Await-WinRt ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
          return (Convert-OcrResult $res)
        } finally {
          $sb.Dispose()
        }
      } finally {
        $ras.Dispose()
      }
    } finally {
      $ms.Dispose()
    }
  } finally {
    $canvas.Dispose()
  }
}

function Crop-Bitmap($src, [double]$fx, [double]$fy, [double]$fw, [double]$fh) {
  $rx = [int][math]::Max(0, [math]::Min($src.Width - 2, [math]::Round($src.Width * $fx)))
  $ry = [int][math]::Max(0, [math]::Min($src.Height - 2, [math]::Round($src.Height * $fy)))
  $rw = [int][math]::Max(2, [math]::Min($src.Width - $rx, [math]::Round($src.Width * $fw)))
  $rh = [int][math]::Max(2, [math]::Min($src.Height - $ry, [math]::Round($src.Height * $fh)))
  return $src.Clone([System.Drawing.Rectangle]::new($rx, $ry, $rw, $rh), $src.PixelFormat)
}

function Estimate-GreenSkillBars($tileBmp) {
  # Scan right edge strip (x: 68%..88%, y: 38%..72%) for green bright skill bar segments (5 tiers bottom-up)
  $x0 = [int]($tileBmp.Width * 0.68)
  $x1 = [int]($tileBmp.Width * 0.90)
  $filled = 0
  for ($seg = 0; $seg -lt 5; $seg++) {
    $yStart = [int]($tileBmp.Height * (0.40 + $seg * 0.062))
    $yEnd = [int]($tileBmp.Height * (0.40 + ($seg + 1) * 0.062))
    $greenPx = 0
    for ($y = $yStart; $y -lt $yEnd -and $y -lt $tileBmp.Height; $y++) {
      for ($x = $x0; $x -lt $x1 -and $x -lt $tileBmp.Width; $x++) {
        $p = $tileBmp.GetPixel($x, $y)
        if ($p.G -gt 175 -and $p.G -gt ($p.R + 25) -and $p.B -gt 90) {
          $greenPx++
        }
      }
    }
    if ($greenPx -ge 6) { $filled++ }
  }
  return $filled
}

$imageFiles = New-Object System.Collections.Generic.List[string]
foreach ($p in $Paths) {
  if (-not (Test-Path -LiteralPath $p)) {
    throw "Chemin introuvable: $p"
  }
  $item = Get-Item -LiteralPath $p
  if ($item.PSIsContainer) {
    Get-ChildItem -LiteralPath $item.FullName -File -Recurse | Where-Object {
      $_.Extension -match '^\.(png|jpe?g|bmp)$'
    } | Sort-Object FullName | ForEach-Object {
      $imageFiles.Add($_.FullName)
    }
  } else {
    $imageFiles.Add($item.FullName)
  }
}

$results = @()
foreach ($imgPath in $imageFiles) {
  $bmp = [System.Drawing.Bitmap]::new($imgPath)
  try {
    $ocr1 = Invoke-OcrBitmap $bmp 1 $false 8
    $ocr2 = Invoke-OcrBitmap $bmp 2 $false 24
    $combinedText = ($ocr1.fullText + " " + $ocr2.fullText)

    $extras = [ordered]@{}

    # 1. Lien de shinsu
    if ($combinedText -match 'lien de shinsu|noyau de') {
      $cTop = Crop-Bitmap $bmp 0.0 0.18 1.0 0.16
      $topRaw = Invoke-OcrBitmap $cTop 3 $false 24
      $topInv = Invoke-OcrBitmap $cTop 3 $true 24
      $cTop.Dispose()

      $cCore = Crop-Bitmap $bmp 0.58 0.44 0.38 0.16
      $coreInv = Invoke-OcrBitmap $cCore 3 $true 24
      $cCore.Dispose()

      $extras.shinsuTopRaw = $topRaw.fullText
      $extras.shinsuTopInv = $topInv.fullText
      $extras.shinsuCoreInv = $coreInv.fullText
    }

    # 2. Ame d'arme a activation (4x4 fixed grid)
    if ($combinedText -match 'activation|arme\s+a\s+ac' -or ($combinedText -notmatch 'shinsu|hangar|Non\s*obtenu|SSR|combat|Zig|Dégâts|Replay' -and ([regex]::Matches($combinedText, 'Ni[vw.]', 'IgnoreCase').Count -ge 3))) {
      $rowYs = @(0.20, 0.435, 0.67, 0.90)
      $grid = @()
      for ($r = 0; $r -lt 4; $r++) {
        for ($c = 0; $c -lt 4; $c++) {
          $crop = Crop-Bitmap $bmp (0.03 + $c * 0.242) $rowYs[$r] 0.22 0.055
          $tInv = Invoke-OcrBitmap $crop 3 $true 20
          $tRaw = Invoke-OcrBitmap $crop 3 $false 20
          $crop.Dispose()
          $grid += [ordered]@{
            row     = $r
            col     = $c
            invText = $tInv.fullText
            rawText = $tRaw.fullText
          }
        }
      }
      $extras.iwSoulGrid = $grid
    }

    # 3. Hangar (Vaisseaux Suspendus SSR+ & SSR)
    if ($combinedText -match 'hangar|Non\s*obtenu') {
      $shipGrid = @(
        @{ id = "lux_imperium";  fx = 0.015; fy = 0.085; fw = 0.205; fh = 0.145 },
        @{ id = "carcharias";    fx = 0.229; fy = 0.085; fw = 0.205; fh = 0.145 },
        @{ id = "gloamspire";    fx = 0.443; fy = 0.085; fw = 0.205; fh = 0.145 },
        @{ id = "ignis_ira";     fx = 0.657; fy = 0.085; fw = 0.205; fh = 0.145 },
        @{ id = "red_death";     fx = 0.015; fy = 0.250; fw = 0.205; fh = 0.145 },
        @{ id = "azure_tempest"; fx = 0.229; fy = 0.250; fw = 0.205; fh = 0.145 },
        @{ id = "tempest_hawk";  fx = 0.443; fy = 0.250; fw = 0.205; fh = 0.145 },
        @{ id = "vigilantia";    fx = 0.657; fy = 0.250; fw = 0.205; fh = 0.145 },
        @{ id = "aquila_nova";   fx = 0.015; fy = 0.415; fw = 0.205; fh = 0.145 },
        @{ id = "albatross";     fx = 0.015; fy = 0.610; fw = 0.205; fh = 0.145 },
        @{ id = "epervier";      fx = 0.229; fy = 0.610; fw = 0.205; fh = 0.145 }
      )
      $cards = @()
      foreach ($spec in $shipGrid) {
        $tile = Crop-Bitmap $bmp $spec.fx $spec.fy $spec.fw $spec.fh
        $tFull = Invoke-OcrBitmap $tile 3 $true 20
        $bars = Estimate-GreenSkillBars $tile
        $tile.Dispose()
        # Tight bottom-left strip solely for "Niv. X" without big "SSR+" text distracting WinRT
        $nivCrop = Crop-Bitmap $bmp ($spec.fx + 0.002) ($spec.fy + 0.095) 0.145 0.036
        $nivInv = Invoke-OcrBitmap $nivCrop 4 $true 24
        $nivRaw = Invoke-OcrBitmap $nivCrop 4 $false 24
        $nivCrop.Dispose()
        $cards += [ordered]@{
          id        = $spec.id
          invText   = ($nivInv.fullText + " " + $tFull.fullText).Trim()
          rawText   = ($nivRaw.fullText).Trim()
          greenBars = $bars
        }
      }
      $extras.hangarCards = $cards
    }

    # 4. Stats d'essence (Tri-Essence: right column zoomed)
    if ($combinedText -match "Stats d.essence|Essence de|Essence d") {
      $cVals = Crop-Bitmap $bmp 0.55 0.32 0.44 0.66
      $valsOcr = Invoke-OcrBitmap $cVals 3 $false 28
      $cVals.Dispose()
      $extras.triValuesOcr = $valsOcr
    }

    $results += [ordered]@{
      file     = $imgPath
      language = $engine.RecognizerLanguage.LanguageTag
      width    = [int]$bmp.Width
      height   = [int]$bmp.Height
      fullText = $ocr2.fullText
      lines    = $ocr2.lines
      raw1x    = $ocr1
      extras   = $extras
    }
  } finally {
    $bmp.Dispose()
  }
}

$results | ConvertTo-Json -Depth 7 -Compress
