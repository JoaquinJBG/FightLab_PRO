<#
  Compila el APK de FightLab (TWA). Uso, desde mobile\twa:
    .\build.ps1 -Host_ mi-app.vercel.app
  o con la variable:  $env:FIGHTLAB_HOST = "mi-app.vercel.app"; .\build.ps1
  Pide la contraseña de TU keystore (no se muestra, no se guarda). Ver README.md.
#>
param(
  [string]$Host_ = $env:FIGHTLAB_HOST,
  [string]$Keystore = $(if ($env:FIGHTLAB_KEYSTORE) { $env:FIGHTLAB_KEYSTORE } else { Join-Path $env:USERPROFILE "fightlab-keys\fightlab.keystore" }),
  [string]$Alias = $(if ($env:FIGHTLAB_KEY_ALIAS) { $env:FIGHTLAB_KEY_ALIAS } else { "fightlab" })
)
$ErrorActionPreference = "Stop"
# El SDK de FightLab manda sobre tu ANDROID_HOME (que no se toca).
if (-not $env:FIGHTLAB_SDK -and (Test-Path "C:\fl\twa\sdk")) { $env:FIGHTLAB_SDK = "C:\fl\twa\sdk" }
if (-not $Host_) { throw "Falta el dominio: .\build.ps1 -Host_ mi-app.vercel.app (sin https://)" }
$env:FIGHTLAB_HOST = $Host_
$env:FIGHTLAB_KEYSTORE = $Keystore
$env:FIGHTLAB_KEY_ALIAS = $Alias

if (-not $env:BUBBLEWRAP_KEYSTORE_PASSWORD) {
  $sec = Read-Host "Contraseña de la keystore ($Keystore)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  # Solo vive en el entorno de este proceso.
  $env:BUBBLEWRAP_KEYSTORE_PASSWORD = $plain
  $plain = $null
}
# keytool con PKCS12: la llave usa la misma contraseña que la keystore, salvo que se indique otra.
if (-not $env:BUBBLEWRAP_KEY_PASSWORD) { $env:BUBBLEWRAP_KEY_PASSWORD = $env:BUBBLEWRAP_KEYSTORE_PASSWORD }

try {
  node (Join-Path $PSScriptRoot "build.mjs")
  if ($LASTEXITCODE -ne 0) { throw "build.mjs terminó con error ($LASTEXITCODE)" }
}
finally {
  Remove-Item Env:BUBBLEWRAP_KEYSTORE_PASSWORD, Env:BUBBLEWRAP_KEY_PASSWORD -ErrorAction SilentlyContinue
}
