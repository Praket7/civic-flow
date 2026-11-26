# Test the packaged Windows builds on an isolated GitHub runner.
$ErrorActionPreference = "Stop"
if ($env:CI -ne "true" -or $env:RUNNER_OS -ne "Windows") { throw "CI Windows only" }
$bundle = (Resolve-Path "evaluation").Path
$msi = @(Get-ChildItem $bundle -Filter "*.msi")
$nsis = @(Get-ChildItem $bundle -Filter "*.exe")
if ($msi.Count -ne 1 -or $nsis.Count -ne 1) { throw "Expected one MSI and one NSIS package" }
$scratch = Join-Path $env:RUNNER_TEMP ("civicflow-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $scratch | Out-Null

function Run-Installer([string]$File, [string]$Arguments) {
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -Wait
    if ($p.ExitCode -ne 0) { throw "Installer exited with code $($p.ExitCode): $File" }
}
function Test-Launch([string]$InstallDir, [string]$Label) {
    $binary = @(Get-ChildItem -LiteralPath $InstallDir -Filter "civicflow.exe" -File -Recurse)
    if ($binary.Count -ne 1) { throw "Could not identify installed CivicFlow executable in $InstallDir" }
    $env:CIVICFLOW_DATA_DIR = Join-Path $scratch ("workspace-" + $Label)
    $env:CIVICFLOW_WORKSPACE_KEY = "0" * 64
    $process = Start-Process -FilePath $binary[0].FullName -PassThru
    try {
        $db = Join-Path $env:CIVICFLOW_DATA_DIR "civicflow.db"
        for ($i = 0; $i -lt 60; $i++) {
            $process.Refresh()
            if ($process.HasExited) { throw "Installed $Label app exited during startup: $($process.ExitCode)" }
            if ((Test-Path -LiteralPath $db) -and (Get-Item -LiteralPath $db).Length -ge 16) { break }
            Start-Sleep -Seconds 1
        }
        if (!(Test-Path -LiteralPath $db)) { throw "Installed $Label did not initialize its database" }
        $stream = [System.IO.File]::Open($db, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $header = New-Object byte[] 15
            if ($stream.Read($header, 0, 15) -ne 15) { throw "Incomplete database header" }
            if ([System.Text.Encoding]::ASCII.GetString($header) -eq "SQLite format 3") { throw "Unexpected plaintext workspace" }
        } finally { $stream.Dispose() }
        Start-Sleep -Seconds 5
        $process.Refresh()
        if ($process.HasExited) { throw "Installed $Label app did not remain running" }
        Write-Host "PASS: $Label installed, launched and initialized an encrypted workspace."
    } finally {
        if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue; $process.WaitForExit(10000) | Out-Null }
    }
}
try {
    $msiDir = Join-Path $scratch "msi"
    $log = Join-Path $scratch "msi.log"
    $installed = $false
    try {
        Run-Installer "msiexec.exe" ('/i "' + $msi[0].FullName + '" /qn /norestart INSTALLDIR="' + $msiDir + '" /L*v "' + $log + '"')
        $installed = $true
        Test-Launch $msiDir "MSI"
    } catch {
        if (Test-Path $log) { Get-Content $log -Tail 60 | Write-Host }
        throw
    } finally {
        if ($installed) { Run-Installer "msiexec.exe" ('/x "' + $msi[0].FullName + '" /qn /norestart') }
    }
    $nsisDir = Join-Path $scratch "nsis"
    $env:CIVICFLOW_DATA_DIR = Join-Path $scratch "workspace-NSIS"
    $env:CIVICFLOW_WORKSPACE_KEY = "0" * 64
    Run-Installer $nsis[0].FullName ("/S /D=" + $nsisDir)
    try {
        Test-Launch $nsisDir "NSIS"
    } finally {
        $uninstall = Join-Path $nsisDir "uninstall.exe"
        if (Test-Path -LiteralPath $uninstall) { Run-Installer $uninstall "/S" }
    }
} finally {
    Remove-Item Env:CIVICFLOW_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:CIVICFLOW_WORKSPACE_KEY -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
