# deploy.ps1 — Deploy current branch to NAS via production
# Usage: .\deploy.ps1
# Or with a message: .\deploy.ps1 "my deploy message"

param(
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

# Get current branch
$branch = git branch --show-current
if (-not $branch) {
    Write-Host "ERROR: Not in a git repository" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== NAS Deploy ===" -ForegroundColor Cyan
Write-Host "Branch: $branch" -ForegroundColor Yellow

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host ""
    Write-Host "Uncommitted changes found:" -ForegroundColor Yellow
    git status --short

    # Auto-commit
    if (-not $Message) {
        $Message = "deploy: $branch $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }
    
    Write-Host ""
    Write-Host "Committing: $Message" -ForegroundColor Cyan
    git add -A
    git commit -m $Message
} else {
    Write-Host "Working tree clean" -ForegroundColor Green
}

# Push current branch
Write-Host ""
Write-Host "Pushing $branch..." -ForegroundColor Cyan
git push origin $branch

# Merge into production
Write-Host ""
Write-Host "Merging into production..." -ForegroundColor Cyan
git checkout production
git merge $branch --no-edit

# Push production (triggers GitHub Actions -> Docker build -> Watchtower pulls)
Write-Host ""
Write-Host "Pushing production..." -ForegroundColor Cyan
git push origin production

# Switch back
git checkout $branch

Write-Host ""
Write-Host "=== Deployed! ===" -ForegroundColor Green
Write-Host "GitHub Actions will build the Docker image" -ForegroundColor Gray
Write-Host "Watchtower will pull it to NAS within ~5 min" -ForegroundColor Gray
Write-Host ""
