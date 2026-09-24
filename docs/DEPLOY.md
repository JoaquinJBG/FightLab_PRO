# Despliegue de la beta (Neon + Render + Vercel)

> Guía paso a paso para poner la beta cerrada de FightLab Pro en internet, gratis,
> con datos reales y con invitados por email. Backend en **Render** (Docker),
> base de datos en **Neon** (Postgres), frontend en **Vercel** (Next.js).

Arquitectura: el navegador solo habla con Vercel. El frontend Next.js hace de
**BFF** (Backend For Frontend): guarda los tokens JWT en cookies `httpOnly` y
reenvía las peticiones a Django por servidor, con un secreto compartido
(`BFF_SHARED_SECRET`) para que Django sepa distinguir el tráfico real de cada
visitante del tráfico directo a su URL pública.

```
Móvil/navegador → Vercel (Next.js, BFF) → Render (Django/DRF) → Neon (Postgres)
```

---

## 0. Antes de empezar

Necesitas:
- Una cuenta en [Neon](https://neon.tech), [Render](https://render.com) y
  [Vercel](https://vercel.com) (las tres tienen plan gratis, sin tarjeta).
- Una cuenta en [Brevo](https://www.brevo.com) (antes Sendinblue) para el envío
  de emails — también gratis, sin tarjeta.
- El repo en GitHub con la rama `feat/beta-cloud` (o la rama/tag que vayas a
  desplegar).
- Una cuenta de Anthropic con una API key, si quieres que el coach y el
  análisis de fotos de comida usen IA real (opcional: sin clave, esos
  endpoints responden un 503 limpio en vez de fallar mal).

El orden importa: Neon primero (necesitas la cadena de conexión antes de crear
el servicio de Render), Render segundo (con un `FRONTEND_URL` provisional,
porque Vercel aún no existe), Vercel tercero, y luego se vuelve a Render para
poner la URL final.

---

## 1. Neon (Postgres)

1. Crea un proyecto nuevo. Región **eu-central-1** (Frankfurt) — la más cercana
   a Render (región Frankfurt) y a Vercel (`fra1`); minimiza la latencia entre
   los tres.
2. Neon crea una rama `main` con una base de datos por defecto. En
   **Connection Details**, copia la cadena **directa** (no la "pooled
   connection" con `-pooler` en el host): Django abre sus propias conexiones
   por request y no necesita el pooler de Neon; usarlo añade una capa extra
   sin beneficio aquí.
3. La cadena tiene esta forma:
   ```
   postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require
   ```
   Guárdala: es tu `DATABASE_URL` para Render. `sslmode=require` es
   obligatorio (Neon no acepta conexiones sin TLS).
4. Plan gratis de Neon: **0.5 GB** de almacenamiento. De sobra para la beta
   (texto e IDs; las fotos de progreso también viven en Postgres, pero se
   comprimen antes de subirlas — ver [Límites del plan gratis](#límites-del-plan-gratis)).

No hace falta crear tablas a mano: el contenedor de Render corre
`migrate` y `createcachetable` en cada arranque.

---

## 2. Render (backend)

El backend se despliega como **Blueprint** a partir de `render.yaml`, que ya
vive en la raíz del repo (`runtime: docker`, `rootDir: backend`,
`healthCheckPath: /health`, plan `free`).

1. En el dashboard de Render: **New → Blueprint**.
2. Conecta el repo de GitHub y elige la rama `feat/beta-cloud`.
3. Render lee `render.yaml` y propone el servicio `fightlab-backend`. Las
   variables marcadas `sync: false` en el blueprint quedan en blanco: hay que
   rellenarlas a mano (ver la tabla de abajo). Las que tienen `value:` en el
   YAML ya vienen puestas.
4. Rellena las variables obligatorias. Como Vercel todavía no existe, pon en
   `FRONTEND_URL` un valor **provisional** (por ejemplo
   `https://fightlab-beta.vercel.app`, el nombre que le vayas a dar al
   proyecto de Vercel) — se corrige en el paso 4 de más abajo.
5. Despliega. La primera build tarda unos minutos (instala dependencias,
   compila la imagen Docker). Al arrancar, el contenedor aplica las
   migraciones y crea la tabla de caché solas.
6. Comprueba `https://<tu-servicio>.onrender.com/health` → debe dar `200`.

### Variables de entorno de Render

Salvo que se diga lo contrario, el valor es texto plano (no secreto) y va como
`value:` fijo en `render.yaml`. "Secreto" = no lo compartas ni lo subas a git;
`sync: false` en el blueprint significa que Render no lo rellena solo.

| Variable | Obligatoria | Secreto | Ejemplo / cómo generarla |
|---|---|---|---|
| `DEBUG` | Sí | No | `False` (ya viene fija en `render.yaml`) |
| `SECRET_KEY` | Sí | **Sí** | `python -c "from django.core.management.utils import get_random_secret_key as f; print(f())"` |
| `ALLOWED_HOSTS` | Sí | No | `fightlab-backend.onrender.com` (el hostname de Render se añade solo, pero conviene ponerlo igual) |
| `ADMIN_URL` | Sí | Semi (no lo publiques) | Una ruta rara con barra final, ej. `panel-x7k2q9/` — nunca `admin/` |
| `NUM_PROXIES` | Sí | No | **`1`** — es la cadena real vista desde la URL pública de Render (un solo proxy de confianza delante de gunicorn). No pongas `2`: con la app detrás del BFF y llamada directamente a la URL de Render a la vez, un valor más alto deja que quien llame directo se invente la IP y salte el límite de intentos de login |
| `DATABASE_URL` | Sí | **Sí** | La cadena directa de Neon del paso 1, con `?sslmode=require` |
| `FRONTEND_URL` | Sí | No | `https://<tu-proyecto>.vercel.app` (sin barra final). Se usa en los enlaces de verificación de email y de recuperar contraseña |
| `CORS_ALLOWED_ORIGINS` | Sí | No | Vacío — el BFF llama de servidor a servidor, sin CORS |
| `CSRF_TRUSTED_ORIGINS` | Sí | No | `https://<tu-servicio>.onrender.com` (solo lo usa el admin de Django) |
| `BETA_ALLOWED_EMAILS` | Sí | No | Emails invitados separados por comas. Vacía en producción = nadie puede registrarse |
| `BFF_SHARED_SECRET` | Sí | **Sí** | Cadena aleatoria de 32+ caracteres. **Tiene que ser idéntica** a la que pongas en Vercel — es como el BFF de Next demuestra a Django que una petición viene de verdad de un visitante y no directo a la URL pública |
| `EMAIL_PROVIDER` | Sí | No | `brevo` — activa el envío por API HTTP (django-anymail) en vez de SMTP |
| `BREVO_API_KEY` | Sí | **Sí** | Se genera en Brevo → *SMTP & API* → *API Keys*. Plan gratis: 300 emails/día |
| `EMAIL_TIMEOUT` | No (recomendada) | No | `10` (segundos). Evita que una llamada a la API de email deje una petición colgada |
| `DEFAULT_FROM_EMAIL` | Sí | No | El remitente que hayas verificado en Brevo como "sender" — en el plan gratis de Brevo, tiene que ser una dirección que ya controles y confirmes (por ejemplo tu Gmail), no un dominio propio. Ej. `FightLab Pro <tu_cuenta@gmail.com>` |
| `ANTHROPIC_API_KEY` | No | **Sí** | `sk-ant-…`. Sin ella, `/ai/coach/chat` y `/ai/food/analyze` responden `503 {"detail":"IA no configurada."}` en vez de fallar mal |
| `AI_MODEL_CHAT` / `AI_MODEL_VISION` | No | No | `claude-sonnet-5` |
| `AI_DAILY_QUOTA_CHAT` | No | No | `50` (mensajes al coach por usuario y día; por defecto) |
| `AI_DAILY_QUOTA_FOOD` | No | No | `20` (fotos de comida analizadas por usuario y día; por defecto) |
| `DJANGO_LOG_LEVEL` | No | No | `INFO` |
| `SECURE_HSTS_SECONDS` | No | No | `3600` por defecto |
| `EMAIL_VERIFICATION_TIMEOUT` | No | No | `86400` (24 h) por defecto |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` / `FILE_UPLOAD_MAX_MEMORY_SIZE` | No | No | `10485760` (10 MB) por defecto — límite de subida de fotos |
| `PORT` | — | — | La pone Render sola; no la definas |

> `render.yaml` de este repo trae ya fijas `DEBUG`, `NUM_PROXIES`, `AI_MODEL_CHAT`,
> `AI_MODEL_VISION` y `DJANGO_LOG_LEVEL`. El resto de variables `sync: false`
> se rellenan a mano en el dashboard de Render la primera vez; en despliegues
> siguientes quedan guardadas y no hay que repetirlas.

---

## 3. Vercel (frontend)

1. **Add New → Project**, importa el mismo repo de GitHub.
2. **Root Directory:** `frontend` (el repo es un monorepo backend+frontend;
   si no se cambia, Vercel intenta construir desde la raíz y falla).
3. Vercel detecta Next.js solo. El gestor de paquetes se fija por
   `packageManager` en `frontend/package.json` (`pnpm@10.30.3`) — no hace
   falta tocar nada en la configuración de build.
4. Región: **`fra1`** (Frankfurt), ya fijada en `frontend/vercel.json`. Igual
   que Neon y Render: menos salto de red entre las tres piezas.
5. Variables de entorno (ver tabla) en **Production** (y también en
   **Preview** si vas a usar despliegues de rama).
6. **Deploy**. Al terminar, Vercel te da la URL definitiva
   (`https://<tu-proyecto>.vercel.app`).

### Variables de entorno de Vercel

| Variable | Obligatoria | Secreto | Ejemplo |
|---|---|---|---|
| `DJANGO_API_URL` | Sí | No | `https://<tu-servicio>.onrender.com/api/v1` — sin ella el BFF falla en cada petición en vez de hablar en silencio con `localhost` |
| `BFF_SHARED_SECRET` | Sí | **Sí** | El mismo valor exacto que pusiste en Render. Nunca con prefijo `NEXT_PUBLIC_` (eso lo expondría al navegador) |
| `NODE_ENV` | — | — | La pone Vercel sola (`production`); no la definas a mano |

---

## 4. Volver a Render: `FRONTEND_URL` final

Con la URL de Vercel ya definitiva, vuelve a las variables de entorno del
servicio de Render y corrige `FRONTEND_URL` con el dominio real. Guarda —
Render reinicia el servicio solo. Esto es lo que hace que los enlaces de
verificación de email y de recuperar contraseña apunten al sitio correcto.

---

## 5. Crear el primer superusuario

En el dashboard de Render, pestaña **Shell** del servicio `fightlab-backend`:

```bash
python manage.py createsuperuser
```

Con ese usuario entras en `https://<tu-servicio>.onrender.com/<ADMIN_URL>`
(la ruta que pusiste en `ADMIN_URL`, no `/admin/`).

---

## 6. Smoke test

Antes de invitar a nadie, comprueba de un tirón que la cadena completa
funciona:

- [ ] `GET /health` en Render → `200`.
- [ ] La app carga en la URL de Vercel y se ve el login.
- [ ] Registro con un email que **esté** en `BETA_ALLOWED_EMAILS` → `201` y
      llega el email de verificación de verdad (revisa spam la primera vez).
- [ ] Registro con un email que **no** esté en la lista → `403` (beta
      cerrada).
- [ ] El enlace del email verifica la cuenta y el login entra con cookies.
- [ ] Subir y borrar una foto de progreso.
- [ ] Guardar un dato de nutrición/agua/peso, cerrar sesión, volver a entrar
      (o entrar desde otro dispositivo) y comprobar que sigue ahí — confirma
      que el backup en servidor funciona, no solo el `localStorage`.
- [ ] Registrar una sesión de gimnasio o MMA y comprobar que aparece en el
      historial y en la carga semanal.
- [ ] *Recuperar contraseña* de punta a punta (pedirla, abrir el enlace,
      poner una nueva, entrar con ella).
- [ ] Si hay `ANTHROPIC_API_KEY`: el chat del coach responde de verdad
      ("IA real"); si no la hay, responde `503` limpio (no un error 500).
- [ ] Entrar en `/<ADMIN_URL>` con el superusuario del paso 5.

---

## 7. Instalar la PWA

FightLab Pro es una PWA instalable, sin pasar por las tiendas de apps.

**Android (Chrome):** abre la URL de Vercel → menú ⋮ → *Añadir a pantalla de
inicio* / *Instalar app*. Queda como un icono normal, a pantalla completa.

**iPhone (Safari):** abre la URL → botón compartir (el cuadrado con la
flecha hacia arriba) → *Añadir a pantalla de inicio*. En iOS **tiene que ser
Safari**: Chrome/Firefox en iPhone no pueden instalar PWAs (limitación de
Apple, no de la app).

---

## Límites del plan gratis

- **Render se duerme.** Un web service free de Render se para tras **15
  minutos** sin tráfico, y la siguiente petición tarda **~50 segundos** en
  "despertarlo" (cold start: arranca el contenedor entero). La app lo tapa
  con un aviso discreto ("Despertando el servidor…") que aparece si la
  respuesta tarda más de 3 s y desaparece solo en cuanto contesta; mientras
  tanto, la app sigue funcionando con lo que ya tenga en `localStorage`
  (fecha, peso, nutrición del día…), así que no se queda congelada. Componente:
  `frontend/components/server-warmup.tsx`.
- **Neon: 0.5 GB.** De sobra para texto y metadatos de una beta; las fotos se
  comprimen antes de subir. Si se llena, hay que pasar a un plan de pago o
  limpiar datos de prueba.
- **Cuotas de IA por usuario.** `AI_DAILY_QUOTA_CHAT` (por defecto 50
  mensajes/día) y `AI_DAILY_QUOTA_FOOD` (por defecto 20 fotos/día) evitan que
  una persona agote el presupuesto de IA de toda la beta.
- **Límite de gasto en Anthropic.** Además de las cuotas por usuario, pon un
  límite de gasto mensual en la consola de Anthropic (Settings → Limits) como
  red de seguridad: las cuotas de arriba acotan el uso normal, pero un límite
  de gasto corta cualquier escenario que no se haya previsto.
- **Brevo: 300 emails/día.** De sobra para invitar y verificar a un grupo de
  beta pequeño. El remitente tiene que ser una dirección que hayas verificado
  tú mismo en Brevo (no un dominio propio, salvo que lo verifiques con DNS).

---

## Invitar a alguien

Dos formas:

1. **La normal:** añade su email a `BETA_ALLOWED_EMAILS` en Render (separado
   por comas de los que ya haya) y guarda — Render redespliega solo. Esa
   persona ya puede registrarse por su cuenta y verificar su email.
2. **Directa desde el admin:** entra en `/<ADMIN_URL>`, crea el usuario a
   mano (email + contraseña) y márcalo activo. Salta el email de
   verificación — útil si Brevo está caído o para dar acceso inmediato en una
   demo.

---

## Problemas comunes

- **El registro se queda colgado o da 502/504.** Symptom típico de intentar
  enviar el email por SMTP en el plan free de Render: desde 2025 Render
  bloquea el tráfico saliente a los puertos SMTP (25/465/587) en los web
  services free. Por eso el envío va por la API HTTP de Brevo
  (`EMAIL_PROVIDER=brevo`), no por SMTP — si ves este error, comprueba que
  `EMAIL_PROVIDER` y `BREVO_API_KEY` están puestos y no quedó `EMAIL_BACKEND`
  apuntando a SMTP.
- **Login o registro dan 429 a las primeras de cambio, para todo el mundo a
  la vez.** Falta `BFF_SHARED_SECRET`, está vacío, o no es idéntico en Render
  y en Vercel. Sin él, todas las peticiones de auth comparten el contador de
  la IP de salida de Vercel: 10 intentos por minuto para toda la beta junta,
  no por persona.
- **El login funciona por la app pero un curl directo a la URL de Render se
  salta el límite de intentos.** Revisa que `NUM_PROXIES=1` (no `2`) — con la
  URL pública de Render solo hay un proxy de confianza real por delante de
  gunicorn.
- **Verificar el email y luego el login da 401 "No active account found".**
  El usuario se registró dos veces antes de verificar (típico: pulsó "Crear
  cuenta" otra vez porque tardaba, o por el cold start de Render). Es el
  mecanismo anti-secuestro de cuenta funcionando como debe: la segunda
  petición invalida la contraseña del primer intento. Solución: que use
  *Recuperar contraseña* con ese mismo email.
- **La app tarda ~50 s en la primera petición del día.** No es un fallo, es
  el cold start de Render en el plan free — ver
  [Límites del plan gratis](#límites-del-plan-gratis).
- **iPhone no ofrece "Instalar app".** Tiene que abrirse con Safari, no con
  Chrome/Firefox — ver [Instalar la PWA](#7-instalar-la-pwa).
- **El chat del coach o la foto de comida dan 503 "IA no configurada".**
  Falta `ANTHROPIC_API_KEY` en Render, o se ha agotado la cuota diaria del
  usuario (`AI_DAILY_QUOTA_CHAT`/`AI_DAILY_QUOTA_FOOD`) — en ese caso el
  mensaje lo dice explícitamente en vez de dar un 503 genérico.
- **`createsuperuser` no aparece o la Shell no responde.** La Shell de Render
  solo está disponible con el servicio despierto: espera al cold start (ver
  arriba) y reintenta.
