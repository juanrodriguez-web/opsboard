param(
    [string]$ApiKey
)

$projectPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $ApiKey) {
    Write-Host "Uso: .\bin\add-claude-key.ps1 -ApiKey 'sk-ant-...'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "O de forma interactiva:" -ForegroundColor Cyan
    Write-Host "  vercel env add CLAUDE_API_KEY" -ForegroundColor Cyan
    exit 1
}

if (-not $ApiKey.StartsWith('sk-ant-')) {
    Write-Host "ERROR: La key debe empezar con 'sk-ant-'" -ForegroundColor Red
    exit 1
}

Write-Host "Anadiendo CLAUDE_API_KEY a Vercel (entorno development)..." -ForegroundColor Cyan
Write-Host ""

# Try to add it using vercel CLI
# Note: This would require interactive input, so we'll provide instructions instead
Write-Host "La key debe ser anadida a Vercel manualmente. Ejecuta:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  vercel env add CLAUDE_API_KEY" -ForegroundColor Cyan
Write-Host ""
Write-Host "Cuando pregunte, selecciona 'development' y pega la key." -ForegroundColor Gray
Write-Host ""

# Alternative: Try using API
Write-Host "O si prefieres hacerlo via API:" -ForegroundColor Gray
Write-Host "  `$key = 'sk-ant-...'" -ForegroundColor Cyan
Write-Host "  vercel api --method POST /v10/projects/prj_jZjwULmppj9W3H0iiRdhAk2o7ff9/env --data '{\"key\":\"CLAUDE_API_KEY\",\"value\":\"\$key\",\"target\":[\"development\"]}'  " -ForegroundColor Cyan
