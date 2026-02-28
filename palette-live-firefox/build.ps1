# Build script for Firefox extension packaging (PowerShell)
# Creates a ZIP with files at the root (no wrapping directory)
# Excludes node_modules, coverage, tests, and other dev files

param(
    [string]$OutputName = "palette-live-firefox.zip"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

try {
    # Remove old build
    if (Test-Path $OutputName) {
        Remove-Item $OutputName -Force
        Write-Host "Removed old $OutputName"
    }

    Write-Host "Building $OutputName ..."

    # Define which files/folders belong in the extension
    $includeItems = @(
        "manifest.json",
        "background.js",
        "assets",
        "content",
        "heatmap",
        "popup",
        "sidepanel",
        "utils"
    )

    # Create a temporary staging directory
    $stagingDir = Join-Path $env:TEMP "palette-live-firefox-build-$(Get-Random)"
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

    foreach ($item in $includeItems) {
        $sourcePath = Join-Path $scriptDir $item
        if (Test-Path $sourcePath) {
            $destPath = Join-Path $stagingDir $item
            if ((Get-Item $sourcePath).PSIsContainer) {
                Copy-Item -Path $sourcePath -Destination $destPath -Recurse -Force
            } else {
                Copy-Item -Path $sourcePath -Destination $destPath -Force
            }
            Write-Host "  Added: $item"
        } else {
            Write-Warning "  Missing: $item (skipped)"
        }
    }

    # Create ZIP using .NET ZipFile API to ensure forward-slash paths (required by Firefox)
    $outputPath = Join-Path $scriptDir $OutputName
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zipStream = [System.IO.File]::Create($outputPath)
    $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

    $stagingDirFull = (Resolve-Path $stagingDir).Path
    $allFiles = Get-ChildItem -Path $stagingDir -Recurse -File
    foreach ($file in $allFiles) {
        $relativePath = $file.FullName.Substring($stagingDirFull.Length + 1)
        # Convert backslashes to forward slashes for cross-platform ZIP compatibility
        $entryName = $relativePath -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }

    $archive.Dispose()
    $zipStream.Dispose()

    # Clean up staging directory
    Remove-Item -Path $stagingDir -Recurse -Force

    Write-Host ""
    Write-Host "Created: $outputPath" -ForegroundColor Green
    Write-Host ""

    # Show contents summary
    Write-Host "ZIP contents:"
    $zip = [System.IO.Compression.ZipFile]::OpenRead($outputPath)
    $zip.Entries | Select-Object FullName, Length | Format-Table -AutoSize | Out-String | Write-Host
    $zip.Dispose()

    Write-Host "Done! Upload $OutputName to Firefox Add-ons Developer Hub." -ForegroundColor Green
}
finally {
    Pop-Location
}
