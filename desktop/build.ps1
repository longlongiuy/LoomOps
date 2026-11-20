param([switch]$Smoke)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$web = Join-Path $root '../loomops/dist'
$sdk = Join-Path $root '../desktop-deps/webview2'
$destination = if ($Smoke) { '../desktop-smoke/LoomOps' } else { '../desktop-package-v1.1/LoomOps' }
$out = (New-Item -ItemType Directory -Path (Join-Path $root $destination) -Force).FullName
$icon = Join-Path $root 'loomops.ico'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'

Add-Type -AssemblyName System.Drawing
$sizes = @(16, 32, 48, 64)
$frames = foreach ($size in $sizes) {
    $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $draw = [Drawing.Graphics]::FromImage($bitmap)
    $fill = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(210, 241, 125))
    $stroke = [Drawing.Pen]::new([Drawing.Color]::FromArgb(25, 33, 15), 2)
    $png = [IO.MemoryStream]::new()
    try {
        $draw.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $draw.ScaleTransform($size / 24.0, $size / 24.0)
        $draw.FillEllipse($fill, 0.5, 0.5, 23, 23)
        $stroke.StartCap = $stroke.EndCap = [Drawing.Drawing2D.LineCap]::Round
        $stroke.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
        $draw.DrawLines($stroke, [Drawing.Point[]]@([Drawing.Point]::new(6,7), [Drawing.Point]::new(14,7), [Drawing.Point]::new(18,10), [Drawing.Point]::new(14,13), [Drawing.Point]::new(6,13)))
        $draw.DrawLines($stroke, [Drawing.Point[]]@([Drawing.Point]::new(6,13), [Drawing.Point]::new(14,13), [Drawing.Point]::new(17,16), [Drawing.Point]::new(14,18), [Drawing.Point]::new(6,18)))
        $draw.DrawLine($stroke, 8, 6, 8, 19)
        $bitmap.Save($png, [Drawing.Imaging.ImageFormat]::Png)
        @{Size = $size; Bytes = $png.ToArray()}
    } finally {
        $png.Dispose(); $stroke.Dispose(); $fill.Dispose(); $draw.Dispose(); $bitmap.Dispose()
    }
}
$writer = [IO.BinaryWriter]::new([IO.File]::Create($icon))
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $writer.Write([byte]$frame.Size)
        $writer.Write([byte]$frame.Size)
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([int]$frame.Bytes.Length)
        $writer.Write([int]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose() }

$core = (Resolve-Path (Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.Core.dll')).Path
$forms = (Resolve-Path (Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.WinForms.dll')).Path
$references = @('/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Net.Http.dll', '/reference:System.Web.Extensions.dll', "/reference:$core", "/reference:$forms")
$assets = foreach ($file in @('index.html','style.css','app.js','engine.js')) { '/resource:' + (Resolve-Path (Join-Path $web $file)).Path + ',loomops.' + $file }
$resources = $assets + @("/resource:$icon,loomops.ico", ('/resource:' + (Join-Path $root 'audit-prompt.txt') + ',loomops.audit-prompt.txt'))
$exe = Join-Path $out 'LoomOps.exe'
$flags = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001', "/out:$exe", "/win32icon:$icon", ("/win32manifest:" + (Join-Path $root 'desktop.manifest')))
if ($Smoke) { $flags += '/define:DESKTOP_SMOKE' }
$flags += $references + $resources + @((Join-Path $root 'Program.cs'), (Join-Path $root 'DeepSeekClient.cs'))
& $compiler @flags
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
Copy-Item -LiteralPath $core,$forms -Destination $out
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $out
Copy-Item -LiteralPath (Join-Path $root '使用说明.txt') -Destination $out
$licenses = (New-Item -ItemType Directory -Path (Join-Path $out 'licenses') -Force).FullName
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt'),(Join-Path $sdk 'NOTICE.txt') -Destination $licenses
Get-ChildItem -LiteralPath $out | Select-Object Name,Length
