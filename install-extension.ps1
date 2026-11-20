<#
.SYNOPSIS
  Install or update the Evidence.com Data Aggregator Chrome extension without
  the Chrome Web Store and without git.

.DESCRIPTION
  Downloads the latest published build, unpacks it into a stable folder under
  %LOCALAPPDATA%, and prints the exact clicks Chrome needs. Anything you have
  collected lives in the Chrome profile, never in that folder, so updating
  cannot touch your data.

.EXAMPLE
  irm https://raw.githubusercontent.com/barrars/axon-extension-dist/main/install-extension.ps1 | iex

.EXAMPLE
  .\install-extension.ps1 -Dir 'D:\Tools\AxonExtension'
#>
param(
  [string]$Dir = (Join-Path $env:LOCALAPPDATA 'AxonExtension'),
  [string]$Url = 'https://github.com/barrars/axon-extension-dist/archive/refs/heads/main.zip'
)

$ErrorActionPreference = 'Stop'

function Read-ManifestVersion ([string]$Path) {
  $manifest = Join-Path $Path 'manifest.json'
  if (-not (Test-Path $manifest)) { return $null }
  return (Get-Content $manifest -Raw | ConvertFrom-Json).version
}

# Never wipe a folder that is not ours: a typo in -Dir must not eat user data.
$existingVersion = Read-ManifestVersion $Dir
if (-not $existingVersion -and (Test-Path $Dir)) {
  $hasContent = Get-ChildItem -Path $Dir -Force | Select-Object -First 1
  if ($hasContent) {
    throw "$Dir exists and is not an extension folder (no manifest.json); pick another -Dir or empty it first"
  }
}

Write-Host 'Downloading latest build...'
$tmp = Join-Path $env:TEMP ('axon-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp 'build.zip'
  Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing

  Write-Host 'Extracting...'
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force

  $src = Get-ChildItem -Path (Join-Path $tmp 'x') -Directory | Select-Object -First 1
  if (-not $src) { throw 'unexpected archive layout' }
  $srcPath = $src.FullName
  if (Test-Path (Join-Path $srcPath 'dist')) { $srcPath = Join-Path $srcPath 'dist' }

  $newVersion = Read-ManifestVersion $srcPath
  if (-not $newVersion) { throw 'archive has no manifest.json with a version' }

  New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  Get-ChildItem -Path $Dir -Force | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $srcPath '*') -Destination $Dir -Recurse -Force

  # Repo documentation, not part of the extension package.
  foreach ($doc in 'README.md', 'install-extension.ps1', 'install-extension.sh', 'install-extension.bat') {
    Remove-Item (Join-Path $Dir $doc) -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  Write-Host "Installed v$newVersion to $Dir"
  if ($existingVersion) { Write-Host "Updated from v$existingVersion" } else { Write-Host 'Fresh install' }
  Write-Host ''
  Write-Host 'Now:'
  Write-Host '  1. Open chrome://extensions'
  Write-Host '  2. Turn on Developer mode (top right)'
  Write-Host '  3. Click "Load unpacked" and choose:'
  Write-Host "       $Dir"
  Write-Host '  4. Already installed? Click the Reload arrow on its card instead.'
  Write-Host ''

  Start-Process explorer.exe -ArgumentList $Dir -ErrorAction SilentlyContinue
  try {
    Start-Process 'chrome.exe' -ArgumentList 'chrome://extensions/' -ErrorAction SilentlyContinue
  } catch {
    # Chrome not on PATH is fine; the printed steps cover it.
  }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
