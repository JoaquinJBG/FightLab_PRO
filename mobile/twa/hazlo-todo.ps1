<#
  FightLab en el móvil, de una vez. Desde mobile\twa:
    powershell -ExecutionPolicy Bypass -File .\hazlo-todo.ps1

  1. Si no existe tu llave, la crea en %USERPROFILE%\fightlab-keys\fightlab.keystore.
     keytool te pide la contraseña: elígela tú y guárdala, junto con el archivo,
     en tu gestor de contraseñas. Sin ellos no podrás actualizar la app.
  2. Compila el APK firmado para el dominio de producción.
  3. Lo copia a C:\fl\twa\FightLab.apk y escribe la huella SHA-256 de la llave
     (no es secreta) en C:\fl\twa\FightLab-sha256.txt, para ponerla en Vercel
     como ANDROID_CERT_SHA256.
#>
param(
  [string]$Host_ = $(if ($env:FIGHTLAB_HOST) { $env:FIGHTLAB_HOST } else { "fight-lab-pro.vercel.app" }),
  [string]$OutDir = "C:\fl\twa"
)
$ErrorActionPreference = "Stop"

# El SDK de FightLab (licencias aceptadas, build-tools 36.1.0) manda sobre tu ANDROID_HOME, que no se toca.
if (-not $env:FIGHTLAB_SDK -and (Test-Path "C:\fl\twa\sdk")) { $env:FIGHTLAB_SDK = "C:\fl\twa\sdk" }
$keytool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin\keytool.exe" } else { "keytool" }
$keyDir = Join-Path $env:USERPROFILE "fightlab-keys"
$keystore = Join-Path $keyDir "fightlab.keystore"

if (-not (Test-Path $keystore)) {
  Write-Host "Creando tu llave en $keystore. keytool te pedirá una contraseña (mínimo 6 caracteres) dos veces."
  New-Item -ItemType Directory -Force $keyDir | Out-Null
  & $keytool -genkeypair -storetype PKCS12 -keystore $keystore -alias fightlab `
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=FightLab, O=FightLab"
  if ($LASTEXITCODE -ne 0) { throw "keytool no pudo crear la llave" }
  Write-Host "Llave creada. Guarda AHORA el archivo y la contraseña en tu gestor de contraseñas."
}

Write-Host "Compilando para $Host_ (la primera vez tarda 5-15 min). Te pedirá la contraseña de la llave."
& (Join-Path $PSScriptRoot "build.ps1") -Host_ $Host_ -Keystore $keystore -Alias fightlab

$apk = Join-Path $PSScriptRoot "build\project\app-release-signed.apk"
if (-not (Test-Path $apk)) { throw "No encuentro el APK en $apk" }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$dest = Join-Path $OutDir "FightLab.apk"
Copy-Item $apk $dest -Force

# Huella del certificado que firma el APK (sin contraseña: se lee del propio APK).
$sha = (& $keytool -printcert -jarfile $dest | Select-String "SHA256:" | Select-Object -First 1).ToString().Trim() -replace "^SHA256:\s*", ""
Set-Content -Path (Join-Path $OutDir "FightLab-sha256.txt") -Value $sha -Encoding ascii

Write-Host ""
Write-Host "Listo."
Write-Host "  APK:     $dest"
Write-Host "  SHA-256: $sha"
Write-Host "Pon ese SHA-256 en Vercel como ANDROID_CERT_SHA256 y haz Redeploy."
