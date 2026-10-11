[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$previousToken = [Environment]::GetEnvironmentVariable('SWA_CLI_DEPLOYMENT_TOKEN', 'Process')
$secureToken = $null
$tokenPointer = [IntPtr]::Zero
$token = $null

Push-Location $projectRoot
try {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction Stop
    }

    Write-Host 'Building the app...'
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE."
    }

    if (-not (Test-Path (Join-Path $projectRoot 'dist') -PathType Container)) {
        throw 'The build completed but the dist folder was not found.'
    }

    $secureToken = Read-Host 'Azure Static Web Apps deployment token' -AsSecureString
    if ($null -eq $secureToken -or $secureToken.Length -eq 0) {
        throw 'A deployment token is required.'
    }

    # The SWA CLI reads this supported environment variable, keeping the token
    # out of the command-line arguments and shell history.
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $token

    $swa = Get-Command swa -ErrorAction SilentlyContinue
    if ($swa) {
        Write-Host 'Deploying dist to the production environment...'
        & $swa.Source deploy ./dist --env production
    }
    else {
        $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
        if (-not $npx) {
            $npx = Get-Command npx -ErrorAction Stop
        }

        Write-Host 'SWA CLI was not found globally; running it with npx...'
        & $npx.Source --yes @azure/static-web-apps-cli deploy ./dist --env production
    }

    if ($LASTEXITCODE -ne 0) {
        throw "SWA CLI deployment failed with exit code $LASTEXITCODE."
    }

    Write-Host 'Deployment completed.'
}
finally {
    if ($null -ne $secureToken) {
        $secureToken.Dispose()
    }
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $token = $null

    if ($null -eq $previousToken) {
        Remove-Item Env:SWA_CLI_DEPLOYMENT_TOKEN -ErrorAction SilentlyContinue
    }
    else {
        $env:SWA_CLI_DEPLOYMENT_TOKEN = $previousToken
    }

    Pop-Location
}
