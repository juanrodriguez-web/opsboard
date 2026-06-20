# Script para configurar la API key de Anthropic en Vercel
# Abre la consola de Anthropic para obtener la clave

Write-Host "Configuracion de API Key para OpsBoard" -ForegroundColor Cyan
Write-Host ""

Write-Host "Este script necesita tu Anthropic API Key configurada en Vercel." -ForegroundColor Yellow
Write-Host ""

# Verificar si ya existe en Vercel
Write-Host "Verificando Vercel CLI..." -ForegroundColor Cyan
$vercelPath = & where vercel 2>$null
if (-not $vercelPath) {
    Write-Host "ERROR: Vercel CLI no encontrada. Por favor instala: npm install -g vercel" -ForegroundColor Red
    exit 1
}

Write-Host "OK: Vercel CLI encontrada" -ForegroundColor Green
Write-Host ""

Write-Host "Pasos para obtener y configurar la API Key:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Abre tu consola de Anthropic:"
Write-Host "   https://console.anthropic.com/account/keys" -ForegroundColor Blue
Write-Host ""
Write-Host "2. Si no existe una key, haz click en 'Create Key'"
Write-Host ""
Write-Host "3. Copia la key (empieza con 'sk-ant-')"
Write-Host ""
Write-Host "Cuando tengas la key, ejecuta:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   vercel env add CLAUDE_API_KEY" -ForegroundColor Cyan
Write-Host ""
Write-Host "Y pega tu API key cuando lo pida."
Write-Host ""

$response = Read-Host "Ya tienes tu API key? (s/n)"
if ($response -eq 's' -or $response -eq 'S') {
    Write-Host ""
    Write-Host "Ejecutando: vercel env add CLAUDE_API_KEY" -ForegroundColor Yellow
    & vercel env add CLAUDE_API_KEY

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "OK! API Key configurada en Vercel" -ForegroundColor Green
        Write-Host ""
        Write-Host "Ahora prueba:" -ForegroundColor Cyan
        Write-Host "   npm run process-intake" -ForegroundColor Cyan
    }
} else {
    Write-Host ""
    Write-Host "Por favor, obtén tu API key de https://console.anthropic.com/account/keys" -ForegroundColor Yellow
    Write-Host "Luego ejecuta este script de nuevo." -ForegroundColor Yellow
}
