#Requires -Version 7.0
<#
Read-only command discovery. Does not execute clients, npm, installers, or network
requests; does not read credentials, .npmrc, command definitions, or log files.
Only known command filenames on fixed local drives are checked. No raw PATH,
user directory, process command line, or exception message enters the report.
#>
[CmdletBinding()]
param(
    [switch]$AsObject,
    [switch]$LibraryOnly
)

function Get-AiQuotaDiagnosticContext {
    @{
        IsWindows = $IsWindows
        ProcessPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
        UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
        MachinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
        DefaultNpmPrefix = if ($IsWindows) {
            [IO.Path]::Combine([Environment]::GetFolderPath('ApplicationData'), 'npm')
        } else { $null }
        EnvironmentNpmPrefix = [Environment]::GetEnvironmentVariable('NPM_CONFIG_PREFIX', 'Process')
    }
}

function ConvertTo-AiQuotaPathEntries {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    # Bound metadata work even when a parent process supplies an unusually long PATH.
    $Value.Split(';') | Select-Object -First 256 | ForEach-Object {
        $entry = $_.Trim().Trim('"').TrimEnd([char[]]'\/')
        if ($entry -match '^[A-Za-z]:$') { $entry += '\' }
        if (-not [string]::IsNullOrWhiteSpace($entry)) {
            $entry.ToLowerInvariant()
        }
    } | Select-Object -Unique
}

function Test-AiQuotaFixedLocalDirectory {
    param([string]$Directory)
    # Avoid UNC, device, relative and network-mapped paths. Reject reparse
    # ancestors before examining their children so a local junction cannot
    # redirect a metadata lookup to a remote location.
    if ($Directory -notmatch '^[A-Za-z]:[\\/]') { return $false }
    try {
        $drive = [IO.DriveInfo]::new($Directory.Substring(0, 3))
        if ($drive.DriveType -ne [IO.DriveType]::Fixed) { return $false }
        $fullPath = [IO.Path]::GetFullPath($Directory)
        $root = [IO.Path]::GetPathRoot($fullPath)
        $current = $root
        $parts = @($fullPath.Substring($root.Length).Split([char[]]'\/', [StringSplitOptions]::RemoveEmptyEntries))
        # Include the drive root and then walk one existing directory at a time.
        $walkParts = @('') + $parts
        foreach ($part in $walkParts) {
            if ($part) { $current = [IO.Path]::Combine($current, $part) }
            $attributes = [IO.File]::GetAttributes($current)
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { return $false }
        }
        return $true
    } catch { return $false }
}

function Get-AiQuotaSessionCommandTypes {
    param([string]$Name)
    # Application lookup is deliberately separate: Get-Command may search
    # remote PATH entries. Imported-only metadata also avoids module autoload.
    $PSModuleAutoLoadingPreference = 'None'
    try {
        @(
            Microsoft.PowerShell.Core\Get-Command -Name $Name -All -ListImported `
                -CommandType Alias, Function, Filter, Cmdlet -ErrorAction SilentlyContinue |
                ForEach-Object { $_.CommandType.ToString() } | Select-Object -Unique
        )
    } catch { @() }
}

function Get-AiQuotaKnownCommandFiles {
    param([string[]]$Directories, [string]$Origin, [string[]]$ProcessDirectories)
    $extensions = @('.exe', '.cmd', '.bat', '.ps1', '')
    foreach ($directory in $Directories) {
        if (-not (Test-AiQuotaFixedLocalDirectory $directory)) { continue }
        $safeDirectory = [IO.Path]::GetFullPath($directory)
        foreach ($name in @('codex', 'node', 'npm')) {
            foreach ($extension in $extensions) {
                try {
                    $candidate = [IO.Path]::Combine($safeDirectory, "$name$extension")
                    # GetAttributes inspects the leaf itself on Windows; do not
                    # follow it with File.Exists before rejecting reparse files.
                    $attributes = [IO.File]::GetAttributes($candidate)
                    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
                        ($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
                        [pscustomobject]@{
                            name = $name
                            extension = $extension
                            origin = $Origin
                            in_process_path = $ProcessDirectories -contains $directory
                        }
                    }
                } catch { }
            }
        }
    }
}

function Get-AiQuotaRelevantProcessMetadata {
    foreach ($name in @('node', 'npm', 'codex', 'codex-app-server')) {
        try { $items = [Diagnostics.Process]::GetProcessesByName($name) }
        catch { continue }
        $emitted = 0
        foreach ($item in $items) {
            try {
                if ($emitted -ge 32) { continue }
                $started = $null
                try { $started = $item.StartTime.ToUniversalTime().ToString('o') } catch { }
                [pscustomobject]@{ name = $name; pid = $item.Id; started_at_utc = $started }
                $emitted++
            } catch { }
            finally { $item.Dispose() }
        }
    }
}

function Get-AiQuotaWindowsCliDiagnostics {
    [CmdletBinding()]
    param(
        # Explicit fixture injection for offline tests; never modifies environment.
        [hashtable]$DiagnosticContext,
        [switch]$SkipProcessInventory
    )
    if ($null -eq $DiagnosticContext) { $DiagnosticContext = Get-AiQuotaDiagnosticContext }
    if (-not $DiagnosticContext.IsWindows) {
        return [pscustomobject]@{
            schema_version = 1
            status = 'unsupported_os'
            checks = [ordered]@{
                client_launched = $false; installer_launched = $false
                credentials_read = $false; network_requests_started = $false
                environment_modified = $false
            }
        }
    }

    $processPaths = @(ConvertTo-AiQuotaPathEntries $DiagnosticContext.ProcessPath)
    $userPaths = @(ConvertTo-AiQuotaPathEntries $DiagnosticContext.UserPath)
    $machinePaths = @(ConvertTo-AiQuotaPathEntries $DiagnosticContext.MachinePath)
    $persistentPaths = @($machinePaths + $userPaths | Select-Object -Unique)
    $missing = @($persistentPaths | Where-Object { $processPaths -notcontains $_ })
    $processOnly = @($processPaths | Where-Object { $persistentPaths -notcontains $_ })
    $candidates = @(
        Get-AiQuotaKnownCommandFiles $processPaths 'process_path' $processPaths
        Get-AiQuotaKnownCommandFiles $userPaths 'user_path' $processPaths
        Get-AiQuotaKnownCommandFiles $machinePaths 'machine_path' $processPaths
        if ($DiagnosticContext.DefaultNpmPrefix) {
            $prefix = @(ConvertTo-AiQuotaPathEntries $DiagnosticContext.DefaultNpmPrefix)
            Get-AiQuotaKnownCommandFiles $prefix 'default_user_npm_prefix' $processPaths
        }
        if ($DiagnosticContext.EnvironmentNpmPrefix) {
            $prefix = @(ConvertTo-AiQuotaPathEntries $DiagnosticContext.EnvironmentNpmPrefix)
            Get-AiQuotaKnownCommandFiles $prefix 'environment_npm_prefix' $processPaths
        }
    )
    $commands = @(
        foreach ($name in @('codex', 'node', 'npm')) {
            $sessionTypes = @(Get-AiQuotaSessionCommandTypes $name)
            $localCandidates = @($candidates | Where-Object { $_.name -eq $name })
            $visibleFiles = @($localCandidates | Where-Object { $_.in_process_path })
            $otherFiles = @($localCandidates | Where-Object { -not $_.in_process_path })
            [pscustomobject]@{
                name = $name
                loaded_session_command_types = $sessionTypes
                known_file_in_process_path = $visibleFiles.Count -gt 0
                known_file_outside_process_path = $otherFiles.Count -gt 0
                candidates = $localCandidates
                executable_version = 'not_executed'
            }
        }
    )
    $processes = @()
    if (-not $SkipProcessInventory) { $processes = @(Get-AiQuotaRelevantProcessMetadata) }
    $findings = @('command_not_found_does_not_prove_uninstalled', 'npm_install_progress_not_determined')
    $codex = @($commands | Where-Object { $_.name -eq 'codex' })[0]
    if (-not $codex.known_file_in_process_path -and $codex.known_file_outside_process_path) {
        $findings += 'codex_file_found_outside_current_process_path'
    }
    if ($codex.loaded_session_command_types.Count -gt 0) {
        $findings += 'loaded_session_command_may_shadow_external_client'
    }
    [pscustomobject]@{
        schema_version = 1
        status = 'metadata_only'
        shell = [ordered]@{ edition = $PSVersionTable.PSEdition; version = $PSVersionTable.PSVersion.ToString() }
        commands = $commands
        path_comparison = [ordered]@{
            process_entry_count = $processPaths.Count
            persistent_entry_count = $persistentPaths.Count
            persistent_entries_missing_from_process = $missing.Count
            process_only_entry_count = $processOnly.Count
            note = 'different_terminal_processes_can_inherit_different_path_values'
        }
        relevant_processes = @($processes)
        findings = $findings
        checks = [ordered]@{
            client_launched = $false; installer_launched = $false
            credentials_read = $false; network_requests_started = $false
            environment_modified = $false; raw_paths_in_report = $false
            command_lines_read = $false; npm_configuration_read = $false
        }
    }
}

if (-not $LibraryOnly) {
    $diagnosticReport = Get-AiQuotaWindowsCliDiagnostics
    if ($AsObject) { $diagnosticReport }
    else { $diagnosticReport | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 }
}
