#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/windows-cli-diagnostics.ps1') -LibraryOnly

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$unsupported = Get-AiQuotaWindowsCliDiagnostics -DiagnosticContext @{ IsWindows = $false } -SkipProcessInventory
Assert-True ($unsupported.status -eq 'unsupported_os') 'Non-Windows fixture must not inspect local commands.'

if (-not $IsWindows) {
    Write-Output 'PASS unsupported-OS fixture; Windows-only fixture skipped.'
    return
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('ai-quota-cli-fixture-' + [Guid]::NewGuid().ToString('N'))
$processDirectory = Join-Path $fixtureRoot 'visible'
$otherDirectory = Join-Path $fixtureRoot 'other'
$sentinel = Join-Path $fixtureRoot 'client-must-not-launch.txt'
$junctionPath = Join-Path $fixtureRoot 'local-junction'
$pathBefore = [Environment]::GetEnvironmentVariable('PATH', 'Process')
try {
    [IO.Directory]::CreateDirectory($processDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($otherDirectory) | Out-Null
    [IO.File]::WriteAllText((Join-Path $otherDirectory 'codex.cmd'), "@echo off`r`necho launched > `"$sentinel`"`r`n")
    [IO.File]::WriteAllText((Join-Path $processDirectory 'node.exe'), 'synthetic metadata only; never execute')
    $context = @{
        IsWindows = $true
        ProcessPath = $processDirectory
        UserPath = $otherDirectory
        MachinePath = $processDirectory
        DefaultNpmPrefix = $otherDirectory
        EnvironmentNpmPrefix = $null
    }
    $report = Get-AiQuotaWindowsCliDiagnostics -DiagnosticContext $context -SkipProcessInventory
    Assert-True ($report.status -eq 'metadata_only') 'Expected metadata report.'
    $codex = @($report.commands | Where-Object { $_.name -eq 'codex' })[0]
    $node = @($report.commands | Where-Object { $_.name -eq 'node' })[0]
    Assert-True (-not $codex.known_file_in_process_path) 'Codex must not appear in fixture process PATH.'
    Assert-True $codex.known_file_outside_process_path 'Codex outside PATH should be discoverable.'
    Assert-True $node.known_file_in_process_path 'Node metadata should be detected without execution.'
    Assert-True ($report.path_comparison.persistent_entries_missing_from_process -eq 1) 'Must detect persistent/process PATH difference.'
    Assert-True ($report.findings -contains 'codex_file_found_outside_current_process_path') 'Must describe limited PATH finding.'
    Assert-True (-not [IO.File]::Exists($sentinel)) 'A discovered shim must not be executed.'
    Assert-True ([Environment]::GetEnvironmentVariable('PATH', 'Process') -eq $pathBefore) 'Diagnostic must not modify PATH.'
    $json = $report | ConvertTo-Json -Depth 8
    Assert-True (-not $json.Contains($fixtureRoot)) 'Report must not contain raw fixture paths.'
    Assert-True (-not $json.Contains('client-must-not-launch')) 'Report must not contain command file contents.'
    foreach ($value in $report.checks.Values) { Assert-True (-not $value) 'All side-effect/privacy flags must remain false.' }

    $uncContext = @{
        IsWindows = $true; ProcessPath = '\\unreachable.invalid\share'; UserPath = $null
        MachinePath = $null; DefaultNpmPrefix = $null; EnvironmentNpmPrefix = $null
    }
    $unc = Get-AiQuotaWindowsCliDiagnostics -DiagnosticContext $uncContext -SkipProcessInventory
    foreach ($command in $unc.commands) {
        Assert-True ($command.candidates.Count -eq 0) 'UNC PATH must not be probed.'
    }
    Assert-True (-not (Test-AiQuotaFixedLocalDirectory '\\unreachable.invalid\share')) 'UNC must fail before filesystem access.'
    Assert-True (-not (Test-AiQuotaFixedLocalDirectory '.')) 'Relative paths must not be probed.'

    # A local junction needs no network target or elevated symlink privilege.
    $junctionTarget = Join-Path $fixtureRoot 'junction-target'
    $targetBin = Join-Path $junctionTarget 'bin'
    [IO.Directory]::CreateDirectory($targetBin) | Out-Null
    [IO.File]::WriteAllText((Join-Path $targetBin 'codex.cmd'), 'synthetic junction target; never execute')
    New-Item -ItemType Junction -Path $junctionPath -Target $junctionTarget | Out-Null
    $viaJunction = Join-Path $junctionPath 'bin'
    Assert-True (-not (Test-AiQuotaFixedLocalDirectory $viaJunction)) 'Reparse ancestor must be refused before examining children.'
    $junctionContext = @{
        IsWindows = $true; ProcessPath = $viaJunction; UserPath = $null
        MachinePath = $null; DefaultNpmPrefix = $null; EnvironmentNpmPrefix = $null
    }
    $junctionReport = Get-AiQuotaWindowsCliDiagnostics -DiagnosticContext $junctionContext -SkipProcessInventory
    foreach ($command in $junctionReport.commands) {
        Assert-True ($command.candidates.Count -eq 0) 'PATH through a local junction must not expose command candidates.'
    }
    Assert-True (-not ($junctionReport | ConvertTo-Json -Depth 8).Contains($fixtureRoot)) 'Junction report must remain path-free.'
    Write-Output 'PASS Windows synthetic metadata fixtures: no launch, no PATH mutation, no raw paths, no UNC or reparse probes.'
} finally {
    try {
        if (([IO.File]::GetAttributes($junctionPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            [IO.Directory]::Delete($junctionPath, $false)
        }
    } catch { }
    if ([IO.Directory]::Exists($fixtureRoot)) {
        [IO.Directory]::Delete($fixtureRoot, $true)
    }
}
