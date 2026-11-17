# Enregistre le jeton d'API Cloudflare (WAF, robots) dans le .env du NAS, puis vérifie qu'il voit la
# zone. Le jeton est demandé ici, passe par l'entrée de SSH et ne reste que là-bas.
# Usage : powershell -ExecutionPolicy Bypass -File scripts\nas-cloudflare-api.ps1
$ErrorActionPreference = 'Stop'

$dir = if ($env:NAS_DIR) { $env:NAS_DIR } else { '/share/CACHEDEV1_DATA/project-achievers' }
# Par défaut, le tunnel Cloudflare (`nas-achievers` dans ~/.ssh/config) : marche hors de la maison.
$hostName = if ($env:NAS_HOST) { $env:NAS_HOST } else { 'nas-achievers' }

$secure = Read-Host -AsSecureString "Colle le jeton Cloudflare, puis Entrée"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) -replace '\s', ''
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
# Ctrl+V ne colle pas toujours dans une saisie masquée : un clic droit, si.
if ($token.Length -lt 30) {
  Write-Host "Jeton de $($token.Length) caractères : trop court, rien n'est enregistré. Colle-le par clic droit."
  exit 1
}
Write-Host "Jeton de $($token.Length) caractères, envoi au NAS…"

# Exécuté sur le NAS ; le jeton y arrive dans $t.
$remote = @'
cd '__DIR__' || exit 1
sed -i '/^CLOUDFLARE_API_TOKEN=/d' .env
printf '\nCLOUDFLARE_API_TOKEN=%s\n' "$t" >> .env
echo "Enregistre sur le NAS."
api() { curl -s -H "Authorization: Bearer $t" "https://api.cloudflare.com/client/v4/$1"; }
# Un jeton de compte ne se vérifie que sous son compte, un jeton d'utilisateur sous /user.
a=$(grep '^CLOUDFLARE_ACCOUNT_ID=' .env | tail -1 | cut -d= -f2-)
if { api user/tokens/verify; api "accounts/$a/tokens/verify"; } | grep -q '"status":"active"'; then echo "  jeton actif"; else echo "  jeton refuse par Cloudflare"; fi
if api 'zones?name=achievers.games' | grep -q '"name":"achievers.games"'; then
  echo "  zone achievers.games visible : c'est bon"
else
  echo "  zone achievers.games invisible : il manque les droits Zone sur le jeton"
fi
'@ -replace '__DIR__', $dir

# Première ligne : le jeton ; le reste : le script. PowerShell envoie des fins de ligne Windows,
# retirées sur le NAS avant de lire. En ASCII : l'UTF-8 de PowerShell 5.1 colle un BOM devant le jeton.
$OutputEncoding = [System.Text.Encoding]::ASCII
# La console peut aussi coller un BOM devant : le NAS ne garde du jeton que ce qu'un jeton contient.
"$token`n$remote" | ssh $hostName "tr -d '\r' | { read -r t; t=`$(printf %s `"`$t`" | tr -cd 'A-Za-z0-9_-'); export t; sh -s; }"
$token = $null
