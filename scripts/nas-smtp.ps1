# Enregistre la configuration SMTP dans le .env du NAS, puis redémarre le site.
# Usage : .\scripts\nas-smtp.ps1
# La clé SSH par défaut est %USERPROFILE%\.ssh\pa_nas (NAS_KEY pour la changer).

param(
    [string]$SmtpHost = "smtp.gmail.com",
    [int]$SmtpPort = 587,
    [string]$SmtpUser = "contact@achievers.games",
    [string]$SmtpPass,
    [string]$NasHost = $(if ($env:NAS_HOST) { $env:NAS_HOST } else { "BasicRem@192.168.1.162" }),
    [string]$SshKey = $(if ($env:NAS_KEY) { $env:NAS_KEY } else { "$HOME\.ssh\pa_nas" }),
    [string]$NasDir = $(if ($env:NAS_DIR) { $env:NAS_DIR } else { "/share/CACHEDEV1_DATA/project-achievers" })
)

if (-not $SmtpPass) {
    $secure = Read-Host "Mot de passe SMTP (rien ne s'affiche)" -AsSecureString
    $SmtpPass = [System.Net.NetworkCredential]::new("", $secure).Password
}

$envBlock = @(
    "SMTP_HOST=`"$SmtpHost`""
    "SMTP_PORT=$SmtpPort"
    "SMTP_USER=`"$SmtpUser`""
    "SMTP_PASS=`"$SmtpPass`""
    "SMTP_FROM=`"contact@achievers.games`""
    "SMTP_FROM_NAME=`"Project Achievers`""
    "CONTACT_INBOX=`"contact@achievers.games`""
) -join "`n"

# Base64 : garde les valeurs intactes (espaces, guillemets) et évite les fins de ligne Windows.
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$envBlock`n"))
$write = "cd $NasDir && sed -i '/^SMTP_\(HOST\|PORT\|USER\|PASS\|FROM\|FROM_NAME\)=/d; /^CONTACT_INBOX=/d' .env && echo $encoded | base64 -d >> .env"

& ssh -i $SshKey -o BatchMode=yes -o IdentitiesOnly=yes $NasHost $write
if ($LASTEXITCODE -ne 0) { throw "Écriture du .env impossible sur le NAS (clé $SshKey)." }

$restart = ". /etc/profile; export HOME=/share/homes/`${USER:-BasicRem} DOCKER_CONFIG=$NasDir/.docker; cd $NasDir; export SITE_IMAGE=`$(docker inspect -f '{{.Config.Image}}' project-achievers-site-1); docker compose -f docker-compose.nas.yml --profile tunnel up -d --no-build site"
& ssh -i $SshKey -o BatchMode=yes -o IdentitiesOnly=yes $NasHost $restart
if ($LASTEXITCODE -ne 0) { throw "Le .env est écrit, mais le redémarrage du site a échoué." }

Write-Host "SMTP enregistré sur le NAS, le site a redémarré." -ForegroundColor Green
