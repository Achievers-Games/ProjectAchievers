# Script de configuration SMTP pour Project Achievers
# Usage : .\scripts\setup-mail.ps1 <smtp-host> <smtp-port> <smtp-user> <smtp-pass>
# Exemple (Gmail)   : .\scripts\setup-mail.ps1 smtp.gmail.com 587 achievers.query@gmail.com <app-password>
# Exemple (Resend)  : .\scripts\setup-mail.ps1 smtp.resend.com 587 resend <api-key>

param(
    [Parameter(Mandatory=$true)]
    [string]$SmtpHost,

    [Parameter(Mandatory=$true)]
    [int]$SmtpPort,

    [Parameter(Mandatory=$true)]
    [string]$SmtpUser,

    [Parameter(Mandatory=$true)]
    [string]$SmtpPass
)

$EnvFile = ".env"

# Copie .env.example vers .env si nécessaire
if (-not (Test-Path $EnvFile)) {
    if (Test-Path ".env.example") {
        Write-Host "Copie .env.example vers .env..."
        Copy-Item ".env.example" $EnvFile
    } else {
        Write-Host "Aucun .env.example trouvé, création d'un fichier vide."
        New-Item -ItemType File -Path $EnvFile | Out-Null
    }
}

# Lit le contenu actuel du .env
$content = Get-Content $EnvFile -Raw

# Supprime les anciennes lignes SMTP si elles existent
$lines = $content -split "`n" | Where-Object {
    $_ -notmatch '^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM|SMTP_FROM_NAME)='
}

# Reconstruit le contenu sans les anciennes lignes SMTP
$newContent = ($lines -join "`n").TrimEnd()

# Ajoute la nouvelle configuration SMTP
$newContent = @"
$newContent

# Configuration SMTP - envoi d'email depuis contact@achievers.games
SMTP_HOST="$SmtpHost"
SMTP_PORT=$SmtpPort
SMTP_USER="$SmtpUser"
SMTP_PASS="$SmtpPass"
SMTP_FROM="contact@achievers.games"
SMTP_FROM_NAME="Project Achievers"
"@

# Écrit le fichier
Set-Content -Path $EnvFile -Value $newContent -Encoding UTF8

Write-Host "`n✅ Variables SMTP ajoutées à .env :" -ForegroundColor Green
Write-Host "   SMTP_HOST=$SmtpHost"
Write-Host "   SMTP_PORT=$SmtpPort"
Write-Host "   SMTP_USER=$SmtpUser"
Write-Host "   SMTP_FROM=contact@achievers.games"
Write-Host ""
Write-Host "⚠️  Rappel : les variables SMTP sont déjà ajoutées à src/lib/server/env.ts pour validation." -ForegroundColor Yellow
