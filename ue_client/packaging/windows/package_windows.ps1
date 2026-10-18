# Build, cook, stage and package ValdradaUE for Windows x64 (the Windows counterpart of build_linux.sh + package_linux.sh;
# Unreal Engine builds Windows applications only on Windows). Run from a PowerShell prompt in the repository:
#
#   powershell -ExecutionPolicy Bypass -File ue_client\packaging\windows\package_windows.ps1 -UERoot C:\UE_5.8
#   ... -Config Development             a build with logging and the console
#   ... -SkipBuild                      cook and package with the binaries already built
#   ... -SkipCook                       re-stage and re-package the last cook
#   ... -CheckOnly                      only check the engine, Visual Studio, the Windows SDK and the project
#
# Output under -Out (default ue_client\packaging\out): archive\<Config>\Windows\ (the packaged app: ValdradaUE.exe,
# Engine\, ValdradaUE\Binaries\Win64\, ValdradaUE\Content\Paks\pakchunk<N>-Windows.*), logs\, package_<Config>.json
# (stage times, the cooked size, every pak file and its size) and times.tsv. The release files are then made by
# ue_release.py --platform win64 (here, with Python 3.8 or later, or on the Linux machine after copying the archive).
param(
  [string]$UERoot = $env:UE_ROOT,
  [ValidateSet('Shipping', 'Development')][string]$Config = 'Shipping',
  [string]$Project = '',
  [string]$Out = '',
  [switch]$SkipBuild,
  [switch]$SkipCook,
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$Pkg = Split-Path -Parent $PSScriptRoot
if (-not $Project) { $Project = Join-Path (Split-Path -Parent $Pkg) 'ValdradaUE\ValdradaUE.uproject' }
if (-not $Out) { $Out = Join-Path $Pkg 'out' }
$Project = [IO.Path]::GetFullPath($Project); $Out = [IO.Path]::GetFullPath($Out)
$Name = [IO.Path]::GetFileNameWithoutExtension($Project)
$ProjDir = Split-Path -Parent $Project
New-Item -ItemType Directory -Force -Path (Join-Path $Out 'logs') | Out-Null
function Say($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format HH:mm:ss), $m) }
function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
function Timed($label, [scriptblock]$block) {
  $t0 = Get-Date
  & $block
  $rc = $LASTEXITCODE
  $s = [int]((Get-Date) - $t0).TotalSeconds
  Add-Content -Path (Join-Path $Out 'times.tsv') -Value ("{0}`t{1}`t{2}`t{3}`t{4}" -f (Get-Date -Format s), $Name, $label, $s, $rc)
  Say "${label}: $s s, exit $rc"
  if ($rc -ne 0) { Fail "$label (see the logs in $Out\logs)" }
}

# ------------------------------------------------------------------ checks
if (-not $UERoot) { Fail 'set -UERoot (or UE_ROOT) to the engine folder, the one that holds Engine\' }
$ver = Get-Content (Join-Path $UERoot 'Engine\Build\Build.version') -Raw | ConvertFrom-Json
$verText = "$($ver.MajorVersion).$($ver.MinorVersion).$($ver.PatchVersion)"
if ($ver.MajorVersion -ne 5 -or $ver.MinorVersion -ne 8) { Fail "the engine at $UERoot is $verText; ValdradaUE needs 5.8" }
$installed = Test-Path (Join-Path $UERoot 'Engine\Build\InstalledBuild.txt')
Say "engine $verText at $UERoot ($(if ($installed) { 'installed build (Epic Games Launcher)' } else { 'source build' }))"
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { Fail 'Visual Studio is not installed (see docs\ue-client-build.md, Windows)' }
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { Fail 'no Visual Studio with the C++ x64 tools (workload "Game development with C++")' }
$msvc = Get-ChildItem (Join-Path $vs 'VC\Tools\MSVC') -Directory | Sort-Object Name | Select-Object -Last 1
Say "Visual Studio at $vs, MSVC $($msvc.Name)"
$sdk = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\Include' -Directory -ErrorAction SilentlyContinue | Where-Object Name -like '10.0.*' | Sort-Object Name | Select-Object -Last 1
if (-not $sdk) { Fail 'no Windows 10/11 SDK (install 10.0.22621.0 with Visual Studio)' }
Say "Windows SDK $($sdk.Name)"
if (-not (Test-Path $Project)) { Fail "no project at $Project" }
if (-not (Select-String -Path (Join-Path $ProjDir 'Config\DefaultGame.ini') -Pattern '^; valdrada-packaging' -Quiet)) {
  Fail "$ProjDir\Config\DefaultGame.ini lacks the packaging block (ue_client\packaging\config\DefaultGame.packaging.ini)"
}
foreach ($d in 'CCB', 'CF', 'Kit', 'MatLib', 'Tex') {
  if (-not (Test-Path (Join-Path $ProjDir "Content\$d"))) { Fail "the city's content is missing: $ProjDir\Content\$d (see docs\ue-client-build.md, the content)" }
}
$free = (Get-PSDrive -Name ([IO.Path]::GetPathRoot($Out).Substring(0, 1))).Free / 1GB
Say ("free on the output drive: {0:N0} GB" -f $free)
if ($free -lt 180) { Say 'warning: a cook and package of the whole city needs about 180 GB free (cooked files 108 GB, staging and archive 26 GB each on Linux)' }
if ($CheckOnly) { Say 'checks passed'; exit 0 }

$env:uebp_LogFolder = Join-Path $Out ("logs\uat_{0}_{1}" -f $Config, (Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Force -Path $env:uebp_LogFolder | Out-Null
$Build = Join-Path $UERoot 'Engine\Build\BatchFiles\Build.bat'
$UAT = Join-Path $UERoot 'Engine\Build\BatchFiles\RunUAT.bat'
$log = Join-Path $Out ("logs\package_{0}_{1}.log" -f $Config, (Get-Date -Format yyyyMMdd-HHmmss))

# ------------------------------------------------------------------ build (editor modules for the cook, then the game)
if (-not $SkipBuild) {
  Timed 'build-editor' { & $Build "${Name}Editor" Win64 Development "-Project=$Project" -WaitMutex -NoHotReload *>> $log }
  Timed "build-$Config" { & $Build $Name Win64 $Config "-Project=$Project" -WaitMutex -NoHotReload *>> $log }
}

# ------------------------------------------------------------------ cook, then stage + IoStore + package + archive
$common = @('BuildCookRun', "-project=$Project", "-target=$Name", '-platform=Win64', "-clientconfig=$Config",
            '-unattended', '-utf8output', '-nop4', '-nocompileeditor', '-skipbuild')
if (-not $SkipCook) {
  Timed "cook-$Config" { & $UAT @common -cook -manifests *>> $log }
}
$arch = Join-Path $Out "archive\$Config"
if (Test-Path $arch) { Remove-Item -Recurse -Force $arch }
$stage = @('-skipcook', '-stage', '-package', '-pak', '-iostore', '-compressed', '-manifests', '-prereqs', '-nodebuginfo',
           '-archive', "-archivedirectory=$arch", "-stagingdirectory=$(Join-Path $Out "staging\$Config")")
if ($Config -eq 'Shipping') { $stage += '-distribution' }
Timed "stage-$Config" { & $UAT @common @stage *>> $log }

# ------------------------------------------------------------------ measure
$app = Join-Path $arch 'Windows'
$paks = Get-ChildItem (Join-Path $app "$Name\Content\Paks") -File | Sort-Object Name
$cooked = Join-Path $ProjDir 'Saved\Cooked\Windows'
$cookedBytes = (Get-ChildItem $cooked -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$appBytes = (Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum
$largest = ($paks | Measure-Object Length -Maximum).Maximum
$info = [ordered]@{ config = $Config; engine = $verText; msvc = $msvc.Name; sdk = $sdk.Name; cooked_bytes = $cookedBytes;
                    app_bytes = $appBytes; app = $app; largest_file = $largest;
                    paks = @($paks | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length } }) }
$info | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Out "package_$Config.json")
Say ("packaged {0}: app {1:N2} GB, cooked {2:N2} GB, {3} pak files, largest {4:N0} MiB" -f $Config, ($appBytes / 1e9), ($cookedBytes / 1e9), $paks.Count, ($largest / 1MB))
if ($largest -ge 2GB) { Fail 'a pak file is over 2 GiB: check MaxIoStorePartitionSizeMB in the packaging block' }
Say "done: $app"
Say "next: python ue_client\packaging\ue_release.py --version <v> --platform win64 --app `"$app`" --core <core bundle> --out <release folder>"
