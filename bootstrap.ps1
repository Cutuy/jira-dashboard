[CmdletBinding()]
param(
    [string]$ProjectDir = '.',
    [ValidateSet('SetupAndStart', 'Setup', 'Start')]
    [string]$Mode = 'SetupAndStart',
    [ValidateSet('dummy', 'codex', 'claude', 'opencode')]
    [string]$Coder = 'dummy',
    [string]$CoderBin,
    [string]$Branch,
    [ValidateRange(1, 65535)]
    [int]$Port = 3006,
    [ValidateRange(0, 2147483647)]
    [int]$Worktrees = 0
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program exited with code $LASTEXITCODE."
    }
}

$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$nodeVersion = [version](& $node -p 'process.versions.node')
if ($nodeVersion.Major -ne 24 -or $nodeVersion.Minor -lt 18) {
    throw "Node.js 24.18 or later in the 24.x series is required. Found $nodeVersion."
}
$git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$project = (Resolve-Path -LiteralPath $ProjectDir).ProviderPath
$gitRoot = & $git -C $project rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) {
    throw "Select a local Git checkout with -ProjectDir."
}
$project = (Resolve-Path -LiteralPath $gitRoot).ProviderPath

$configDir = Join-Path $project '.jira-dashboard'
$envFile = Join-Path $configDir '.env'
$clientDir = Join-Path $PSScriptRoot 'client'
$server = Join-Path $PSScriptRoot 'server.js'
$previousProject = $env:JIRA_DASHBOARD_PROJECT_DIR

Push-Location -LiteralPath $PSScriptRoot
try {
    $env:JIRA_DASHBOARD_PROJECT_DIR = $project

    if ($Mode -ne 'Start') {
        $npm = (Get-Command npm.cmd -CommandType Application | Select-Object -First 1).Source
        if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
            if (-not $Branch) {
                $Branch = & $git -C $project symbolic-ref --quiet --short HEAD
                if ($LASTEXITCODE -ne 0) {
                    throw 'Specify a local base branch with -Branch when HEAD is detached.'
                }
            }
            & $git -C $project show-ref --verify --quiet "refs/heads/$Branch"
            if ($LASTEXITCODE -ne 0) {
                throw "Create or check out '$Branch' before running setup."
            }
            if (-not $CoderBin) { $CoderBin = $Coder }
            if ($Coder -ne 'dummy') {
                if (Test-Path -LiteralPath $CoderBin -PathType Leaf) {
                    $CoderBin = (Resolve-Path -LiteralPath $CoderBin).ProviderPath
                } elseif (-not (Get-Command $CoderBin -CommandType Application -ErrorAction SilentlyContinue)) {
                    throw "Coder '$CoderBin' was not found. Install it, or give its path with -CoderBin."
                }
            }

            $remote = & $git -C $project config --get remote.origin.url
            $remoteHost = ''
            $owner = ''
            $repo = ''
            $explorerUrl = ''
            if ($remote -match '^(?:https?://|ssh://(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[:/]([^/]+)/([^/]+)/?$') {
                $remoteHost = $Matches[1]
                $owner = $Matches[2]
                $repo = $Matches[3] -replace '\.git$', ''
                $explorerUrl = "https://$remoteHost/{owner}/{repo}/blob/{sha}/{path}"
            }
            New-Item -ItemType Directory -Path $configDir -Force | Out-Null
            $settings = @(
                "JIRA_PROJECT_NAME=$(Split-Path -Leaf $project)"
                "JIRA_CODER_TYPE=$Coder"
                "JIRA_CODER_BIN=$CoderBin"
                "PORT=$Port"
                "GIT_DEFAULT_BRANCH=$Branch"
                "NUM_WORKTREES=$Worktrees"
                "REMOTE_HOST=$remoteHost"
                "EXPLORER_URL=$explorerUrl"
                "GITHUB_OWNER=$owner"
                "GITHUB_REPO=$repo"
            )
            [IO.File]::WriteAllLines($envFile, [string[]]$settings, [Text.UTF8Encoding]::new($false))
            Write-Host "Created $envFile"
        } else {
            Write-Host "Using settings in $envFile"
        }

        foreach ($schema in 'clarification.schema.json', 'resolve-conflict.schema.json', 'pr-rework.schema.json') {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot $schema) -Destination $configDir -Force
        }

        $configJson = Invoke-Checked $node @('-p', 'JSON.stringify(require(''./config''))')
        $config = $configJson | ConvertFrom-Json
        if ($config.numWorktrees -gt 0) {
            $worktreeSetup = Join-Path $PSScriptRoot 'install\setup-worktrees.js'
            Invoke-Checked $node @($worktreeSetup, $config.projectDir, $config.branchDefault, $config.numWorktrees, $config.worktreesDir)
        }

        Invoke-Checked $npm @('ci', '--no-audit', '--no-fund')
        Invoke-Checked $npm @('--prefix', $clientDir, 'ci', '--no-audit', '--no-fund')
        Invoke-Checked $npm @('--prefix', $clientDir, 'run', 'build')
        Invoke-Checked $node @('-e', 'require(''better-sqlite3'')('':memory:'').close()')
    }

    if ($Mode -ne 'Setup') {
        if (-not (Test-Path -LiteralPath $envFile -PathType Leaf) -or
            -not (Test-Path -LiteralPath (Join-Path $clientDir 'dist\index.html') -PathType Leaf)) {
            throw 'Run bootstrap.ps1 with -Mode Setup before starting this dashboard.'
        }
        Push-Location -LiteralPath $project
        try {
            Invoke-Checked $node @($server)
        } finally {
            Pop-Location
        }
    }
} finally {
    $env:JIRA_DASHBOARD_PROJECT_DIR = $previousProject
    Pop-Location
}
