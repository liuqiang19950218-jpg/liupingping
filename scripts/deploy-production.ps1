param(
  [ValidateSet('preflight', 'foundation', 'verify', 'deploy', 'all')]
  [string]$Action = 'all',
  [string]$ConfigPath = 'deploy.production.config.psd1'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedConfig = Join-Path $ProjectRoot $ConfigPath

if (-not (Test-Path -LiteralPath $ResolvedConfig)) {
  throw "缺少部署配置：$ResolvedConfig。请复制 deploy.production.config.example.psd1 后填写。"
}

$Config = Import-PowerShellDataFile -LiteralPath $ResolvedConfig
$SshPort = if ($Config.SshPort) { [int]$Config.SshPort } elseif ($Config.Port) { [int]$Config.Port } else { 22 }
$PublicPort = if ($Config.PublicPort) { [int]$Config.PublicPort } elseif ($Config.ApplicationPort) { [int]$Config.ApplicationPort } else { 8000 }
$RemotePath = if ($Config.RemotePath) { [string]$Config.RemotePath } else { '/home/liupp/apps/quarterly-recon' }
$Namespace = if ($Config.KubernetesNamespace) { [string]$Config.KubernetesNamespace } else { 'quarterly-recon' }
$OfflineBaseImage = if ($Config.OfflineBaseImage) { [string]$Config.OfflineBaseImage } else { 'quarterly-recon:current-v14' }
$Remote = "$($Config.User)@$($Config.Host)"

if (-not $Config.Host -or -not $Config.User) { throw '部署配置必须包含 Host 和 User。' }
if ($RemotePath -notmatch '^/home/[A-Za-z0-9._-]+/') { throw "RemotePath 不安全：$RemotePath" }

function Invoke-Ssh([string]$Command) {
  & ssh -p $SshPort $Remote $Command
  if ($LASTEXITCODE -ne 0) { throw "远程命令执行失败：$Command" }
}

function Invoke-Preflight {
  Write-Host '检查 182 生产服务器...'
  Invoke-Ssh "set -eu; command -v docker; command -v k3s; test -d /var/lib/quarterly-recon/database/wrangler; df -h /; free -h; sudo k3s kubectl -n $Namespace get deployment quarterly-recon"
}

function New-ApplicationArchive([string]$ArchivePath) {
  Push-Location $ProjectRoot
  try {
    & git rev-parse --verify HEAD *> $null
    if ($LASTEXITCODE -ne 0) { throw '当前目录不是可发布的 Git 仓库。' }

    & git diff --quiet --exit-code
    if ($LASTEXITCODE -ne 0) { throw '存在未提交的已跟踪文件，请先提交 Git 后再发布。' }

    & git diff --cached --quiet --exit-code
    if ($LASTEXITCODE -ne 0) { throw '存在已暂存但未提交的文件，请先完成 Git 提交。' }

    & git archive --format=tar.gz --output=$ArchivePath HEAD
    if ($LASTEXITCODE -ne 0) { throw '从当前 Git 提交创建应用发布包失败。' }
  }
  finally { Pop-Location }
}

function Send-Foundation {
  $Bundle = Join-Path ([System.IO.Path]::GetTempPath()) 'quarterly-recon-foundation.tgz'
  try {
    Push-Location $ProjectRoot
    try { & tar -czf $Bundle infra }
    finally { Pop-Location }
    Invoke-Ssh "set -eu; mkdir -p '$RemotePath'"
    & scp -P $SshPort $Bundle ($Remote + ':' + $RemotePath + '/foundation.tgz')
    if ($LASTEXITCODE -ne 0) { throw '上传数据服务基础设施失败。' }
    Invoke-Ssh "set -eu; cd '$RemotePath'; tar -xzf foundation.tgz; sudo sh infra/scripts/apply-foundation.sh"
  }
  finally { Remove-Item -LiteralPath $Bundle -Force -ErrorAction SilentlyContinue }
}

function Invoke-ApplicationDeploy {
  $ReleaseId = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Image = "quarterly-recon:prod-$ReleaseId"
  $Bundle = Join-Path ([System.IO.Path]::GetTempPath()) "quarterly-recon-$ReleaseId.tgz"
  $ReleasePath = "$RemotePath/releases/$ReleaseId"
  try {
    Write-Host "打包生产版本 $ReleaseId..."
    New-ApplicationArchive $Bundle
    Invoke-Ssh "set -eu; mkdir -p '$ReleasePath' '$RemotePath/backups'; if [ -d /var/lib/quarterly-recon/database/wrangler ]; then sudo tar -czf '$RemotePath/backups/wrangler-$ReleaseId.tgz' -C /var/lib/quarterly-recon/database wrangler; sudo chown `$(id -u):`$(id -g) '$RemotePath/backups/wrangler-$ReleaseId.tgz'; fi"
    & scp -P $SshPort $Bundle ($Remote + ':' + $ReleasePath + '/application.tgz')
    if ($LASTEXITCODE -ne 0) { throw '上传应用发布包失败。' }
    $DeployCommand = "set -eu; cd '$ReleasePath'; tar -xzf application.tgz; if docker image inspect '$OfflineBaseImage' >/dev/null 2>&1; then echo '使用服务器现有生产镜像离线构建'; docker build -f Dockerfile.offline --build-arg BASE_IMAGE='$OfflineBaseImage' -t '$Image' .; else echo '未找到离线基础镜像，使用标准 Dockerfile'; docker build -f Dockerfile -t '$Image' .; fi; docker save '$Image' | sudo k3s ctr images import -; sudo k3s kubectl -n '$Namespace' set image deployment/quarterly-recon web='$Image'; sudo k3s kubectl -n '$Namespace' annotate deployment/quarterly-recon deployment.quarterly-recon/release='$ReleaseId' --overwrite; sudo k3s kubectl -n '$Namespace' rollout status deployment/quarterly-recon --timeout=420s; ln -sfn '$ReleasePath' '$RemotePath/current'"
    Invoke-Ssh $DeployCommand
    Invoke-HealthCheck
  }
  finally { Remove-Item -LiteralPath $Bundle -Force -ErrorAction SilentlyContinue }
}

function Invoke-HealthCheck {
  $BaseUrl = "http://$($Config.Host):$PublicPort"
  Write-Host "检查生产服务 $BaseUrl ..."
  $Home = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 30
  if ($Home.StatusCode -ne 200) { throw "首页健康检查失败：$($Home.StatusCode)" }
  $State = Invoke-WebRequest -Uri "$BaseUrl/api/local-state" -UseBasicParsing -TimeoutSec 30
  if ($State.StatusCode -ne 200) { throw "业务状态接口检查失败：$($State.StatusCode)" }
  Write-Host '生产服务健康检查通过。'
}

function Invoke-Verify {
  Invoke-Ssh "set -eu; sudo k3s kubectl -n '$Namespace' get deployment,pod,service; sudo k3s kubectl -n '$Namespace' get deployment quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}'; echo"
  Invoke-HealthCheck
}

switch ($Action) {
  'preflight' { Invoke-Preflight }
  'foundation' { Invoke-Preflight; Send-Foundation }
  'verify' { Invoke-Verify }
  'deploy' { Invoke-Preflight; Invoke-ApplicationDeploy }
  'all' { Invoke-Preflight; Invoke-ApplicationDeploy; Invoke-Verify }
}
