# App Android de FightLab (TWA)

APK propio, sin Google Play. Es una *Trusted Web Activity*: Chrome abre FightLab a pantalla completa
(sin barra de direcciones), con su icono, la misma sesión de Chrome (cookies del BFF), avisos y cámara.
No hay código de la app aparte: todo sigue siendo la web.

- Paquete: `app.fightlab.pro` · Nombre: FightLab · Inicio: `/today` · Color: `#05070e`.
- Iconos: los de `frontend/public` (`icon-512.png`, `icon-maskable-512.png`).
- Avisos: delegación de notificaciones activada (los push de la web salen como avisos de la app).
- Compila con [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) 1.27.0 (fijado en `package-lock.json`).

**Regla de oro:** la llave de firma y su contraseña son TUYAS y no entran nunca al repo (es público).
Este repo no tiene ninguna.

## Atajo: todo de una vez (en este PC)

Con el JDK y el SDK de `C:l	wa\sdk` ya listos, desde `mobile	wa`:

```powershell
powershell -ExecutionPolicy Bypass -File .\hazlo-todo.ps1
```

El script hace todo esto:
1. Crea tu llave si no existe. La contraseña la eliges y escribes tú. Guarda el archivo y la contraseña en tu gestor de contraseñas.
2. Compila el APK para `fight-lab-pro.vercel.app`. Para otro dominio, usa `-Host_ <dominio>`.
3. Deja el APK en `C:l	wa\FightLab.apk` y la huella SHA-256 en `C:l	wa\FightLab-sha256.txt`.

Después pon esa huella en Vercel como `ANDROID_CERT_SHA256` y haz Redeploy. Instala el APK (paso 4) y compruébalo (paso 5).

## 0. Qué necesitas (una sola vez)

1. **Node 20 o superior** (ya lo tienes si trabajas en el frontend). Comprueba: `node -v`.
2. **JDK 17** (Temurin). En PowerShell:
   ```powershell
   winget install EclipseAdoptium.Temurin.17.JDK
   ```
   Cierra y abre PowerShell. Comprueba: `java -version` (17.x) y `$env:JAVA_HOME`. Si `JAVA_HOME` sale vacío,
   apunta a la carpeta del JDK, p. ej. `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot`.
3. **Android SDK** (solo las herramientas de línea de comandos, sin Android Studio):
   1. Baja «Command line tools only» (Windows) de <https://developer.android.com/studio#command-line-tools-only>.
   2. Crea `C:\Android\sdk\cmdline-tools\latest` y descomprime ahí el contenido del zip
      (`bin`, `lib`, ... directamente dentro de `latest`).
   3. Acepta las licencias tú mismo (son de Google, las lees y las aceptas tú):
      ```powershell
      & "C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="C:\Android\sdk" --licenses
      & "C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="C:\Android\sdk" "build-tools;36.1.0" "platforms;android-36"
      ```
   4. `$env:ANDROID_HOME = "C:\Android\sdk"` (o ponla como variable de usuario permanente).
   Si ya tienes un Android SDK (p. ej. de Android Studio), vale: necesita `build-tools;36.1.0` y
   `platforms;android-36`, con las licencias aceptadas.

Bubblewrap y Gradle se descargan solos la primera vez (carpeta `mobile\twa\node_modules` y
`mobile\twa\build\home`, ambas fuera de git). No tocan tu `~\.bubblewrap` ni tu `~\.gradle`.

## 1. Crea TU llave de firma (una sola vez)

```powershell
mkdir "$env:USERPROFILE\fightlab-keys"
keytool -genkeypair -v -storetype PKCS12 `
  -keystore "$env:USERPROFILE\fightlab-keys\fightlab.keystore" `
  -alias fightlab -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` te pide la contraseña (la escribes tú) y unos datos del certificado (nombre, etc.; pueden ser
cualquier cosa, no se publican en ningún sitio salvo dentro del certificado del APK). Con PKCS12 la
contraseña de la llave es la misma que la de la keystore.

**Guarda ya:**
- el archivo `fightlab.keystore` **y**
- su contraseña (y el alias `fightlab`)

en tu gestor de contraseñas (copia del archivo adjunta) y una copia en otro sitio. **Si pierdes la llave o la
contraseña no podrás actualizar la app instalada**: habría que desinstalarla (se pierde lo local del móvil)
y empezar de cero con otra llave. Nunca la pongas dentro de la carpeta del repo.

## 2. Saca el SHA-256 de la llave y ponlo en Vercel

```powershell
keytool -list -v -keystore "$env:USERPROFILE\fightlab-keys\fightlab.keystore" -alias fightlab
```

Pide la contraseña y, en la salida, copia la línea `SHA256:` (32 pares hexadecimales separados por `:`,
tipo `AB:CD:...`). Es público; no es secreto.

En Vercel → proyecto del frontend → Settings → Environment Variables (entorno Production):

| Variable | Valor |
|---|---|
| `ANDROID_CERT_SHA256` | el SHA-256 de arriba (varios, separados por comas, si algún día cambias de llave) |
| `ANDROID_PACKAGE` | opcional; por defecto `app.fightlab.pro` |

Haz un **redeploy** de producción. Comprueba en el navegador (sin redirecciones):

```
https://TU-DOMINIO/.well-known/assetlinks.json
```

Debe salir un JSON con tu `package_name` y tu huella. Si sale `[]`, la variable no está puesta o no es
un SHA-256 válido (o falta el redeploy).

## 3. Compila el APK

Desde la carpeta `mobile\twa`, con tu dominio de producción **sin** `https://`:

```powershell
cd mobile\twa
.\build.ps1 -Host_ TU-DOMINIO
```

(Si PowerShell bloquea el script: `powershell -ExecutionPolicy Bypass -File .\build.ps1 -Host_ TU-DOMINIO`.)

El script pide la contraseña de tu keystore (no se ve, no se guarda), genera el manifest de Bubblewrap,
descarga lo necesario y compila. Por defecto busca la llave en `%USERPROFILE%\fightlab-keys\fightlab.keystore`
con alias `fightlab`; si la tienes en otro sitio: `-Keystore "D:\ruta\mi.keystore" -Alias otroalias`.

Salida (no se versiona):

```
mobile\twa\build\project\app-release-signed.apk      <- el que instalas
mobile\twa\build\project\app-release-bundle.aab      <- no lo necesitas (es para Play)
```

Sin PowerShell también vale: `$env:FIGHTLAB_HOST`, `FIGHTLAB_KEYSTORE`, `FIGHTLAB_KEY_ALIAS`,
`BUBBLEWRAP_KEYSTORE_PASSWORD`, `BUBBLEWRAP_KEY_PASSWORD` y `node build.mjs`.

## 4. Instálalo en el móvil

1. Pasa `app-release-signed.apk` al móvil (cable USB, Drive, Telegram a ti mismo...).
2. Ábrelo desde «Archivos». Android pide permiso para **instalar apps desconocidas** para esa app
   (Archivos/Chrome/Drive): concédelo solo a la app que usas para abrir el APK. Instalar.
3. Abre FightLab. La primera vez inicia sesión; las cookies son las de Chrome del móvil, así que si ya
   estabas dentro en Chrome, entra directamente.
4. Avisos: acepta el permiso de notificaciones cuando lo pida (Android 13+). Cámara (escáner): lo pide la
   primera vez que lo usas; se gestiona en Ajustes de Chrome → Ajustes de sitios.

**Verificación de desarrolladores de Android (2026-2027).** Google exige que las apps de dispositivos
«certificados» vengan de desarrolladores verificados, también fuera de Play. Hay un modo para uso personal
con distribución **limitada (hasta 20 dispositivos)** y se mantiene el *sideload* avanzado. Las fechas y el
flujo exacto dependen del país y cambian: revisa <https://developer.android.com/developer-verification>
antes de contar con ello. Si el móvil rechazara el APK, esa es la causa probable.

## 5. Comprueba que abre sin barra de URL

Abre la app desde el icono. Debe verse a pantalla completa, con la barra de estado del color de la app y
sin barra de direcciones. **Si sale una barra arriba (con el dominio y un candado), falla Digital Asset Links**:
Chrome no ha podido comprobar que el APK es de tu dominio. Causas, por orden de probabilidad:

1. `https://TU-DOMINIO/.well-known/assetlinks.json` devuelve `[]` o 404: falta `ANDROID_CERT_SHA256`
   o falta el redeploy tras ponerla.
2. El SHA-256 no es el de la llave con la que **firmaste** (otra keystore, o una de pruebas).
3. El paquete no coincide: el APK es `app.fightlab.pro` (campo `packageId` de `twa-manifest.template.json`);
   `ANDROID_PACKAGE` debe ser igual.
4. El dominio con el que compilaste (`-Host_`) no es el mismo donde abres la app (`www.` o no, un alias de
   Vercel distinto). Recompila con el dominio definitivo.
5. La URL redirige (p. ej. `dominio.com` → `www.dominio.com`): debe responder 200 directo en el dominio exacto.
6. Chrome guarda en caché el resultado: en el móvil, Ajustes → Apps → Chrome → Almacenamiento → Borrar caché,
   desinstala y reinstala el APK, y ábrelo con datos o wifi.

Para depurar con el móvil conectado, `chrome://inspect` y la guía oficial de Google:
<https://developers.google.com/digital-asset-links/tools/generator> (verifica tu JSON contra el paquete).

## 6. Actualizar la app

1. Cambia lo que quieras en la web: se actualiza sola, **no hace falta recompilar el APK** para cambios de la web.
   Solo recompilas si cambia algo de la propia app (icono, color, nombre, dominio, Bubblewrap).
2. Sube `appVersionCode` (entero que debe crecer siempre) y, si quieres, `appVersion` en
   `mobile\twa\twa-manifest.template.json`.
3. Recompila con `.\build.ps1 -Host_ TU-DOMINIO` y **la misma llave**. Instala el APK nuevo encima
   del anterior (no hace falta desinstalar). Con otra llave, Android lo rechaza.

## Notas técnicas

- `twa-manifest.template.json` es la plantilla; `build.mjs` genera `build\twa-manifest.json` sustituyendo
  host, llave e iconos (los iconos se sirven en local desde `frontend/public` solo mientras se genera el proyecto).
- `.gitignore` excluye `*.keystore`, `*.jks`, `*.p12`, `*.apk`, `*.aab`, `build/` y ficheros con `password`.
- Si cambias el dominio de producción, recompila el APK: el host va dentro de él.
