# Deploy odds-value-analyzer to production
# Run in a terminal (interactive). Sudo asks for the VM password directly —
# no password is ever stored in this script, in askpass files, or in shell
# history (MODEL-VALIDITY-IMPLEMENTATION-REPORT 2026-08-23 §10).

$VM = "118.140.60.206"
$Port = "169"
$User = "hugo"
$Key = "$PSScriptRoot\.ssh-key"

# Reproducible-build stamp (Workstream D): taken from the LOCAL clean commit
# being deployed. Deploy only from a clean, committed working tree.
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "ERROR: working tree is dirty — commit or stash before deploying" -ForegroundColor Red
    exit 1
}
$Commit = (git rev-parse --short HEAD).Trim()
$BuildTs = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
Write-Host "Build stamp: commit=$Commit builtAt=$BuildTs" -ForegroundColor DarkGray

Write-Host "=== Syncing code from GitHub ===" -ForegroundColor Cyan
ssh -i $Key -p $Port -o StrictHostKeyChecking=no $User@$VM "cd /opt/odds-tool/build && git fetch origin && git reset --hard origin/master"
$Synced = (ssh -i $Key -p $Port $User@$VM "cd /opt/odds-tool/build && git rev-parse --short HEAD").Trim()
if ($Synced -ne $Commit) {
    Write-Host "ERROR: VM commit $Synced != local commit $Commit — aborting" -ForegroundColor Red
    exit 1
}
Write-Host "SYNCED: $Synced" -ForegroundColor Green

Write-Host "`n=== Building Docker images (sudo may ask for the VM password) ===" -ForegroundColor Cyan
ssh -t -i $Key -p $Port $User@$VM "cd /opt/odds-tool/build && sudo docker tag odds-tool-api:latest odds-tool-api:rollback 2>/dev/null; sudo docker tag odds-tool-caddy:latest odds-tool-caddy:rollback 2>/dev/null; sudo env APP_BUILD_COMMIT=$Commit APP_BUILD_TIMESTAMP='$BuildTs' docker compose build api caddy && echo BUILD-OK"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: build failed" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Deploying ===" -ForegroundColor Cyan
ssh -t -i $Key -p $Port $User@$VM "cd /opt/odds-tool/build && sudo docker compose up -d postgres && sleep 3 && sudo docker compose up -d api caddy collector && sleep 3 && sudo docker ps --filter name=odds-tool --format '{{.Names}} {{.Status}}'"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: deploy failed" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Smoke test ===" -ForegroundColor Cyan
$result = Invoke-WebRequest -Uri "https://odds.ballballchu.com.hk/" -UseBasicParsing -TimeoutSec 10
Write-Host "Public: $($result.StatusCode)" -ForegroundColor Green

Write-Host "`n=== Deploy complete! ===" -ForegroundColor Green
Write-Host "https://odds.ballballchu.com.hk"
Read-Host "Press Enter to close"
