# 🥊 FightLab Pro

Plataforma para **atletas de combate (MMA)** y deportistas multidisciplinares que
unifica la ciencia del entrenamiento, el seguimiento de nutrición y peso, y un
**coach con IA** en una sola app instalable en el móvil.

> Proyecto personal de aprendizaje con estándares de producción.

---

## ✨ Qué hace

- **Coach integrado con evidencia.** Motor de cálculo vendorizado
  ([*AI personal coach*](https://github.com/matgarfer499/ai-personal-coach)) más un anexo propio
  para deportes de combate: plan semanal, check-in diario, revisión semanal y reglas con su grado de
  evidencia y sus fuentes. Funciona sin IA; el chat con Claude es opcional.
- **Seguridad primero.** Un único estado de seguridad (golpe en la cabeza, lesión o dolor nuevo,
  PAR-Q) que leen todas las pantallas: Hoy, Coach, Carga, plan, Mi rutina, Deportes y el chat.
  Mientras está activo, ninguna propone nada vigoroso.
- **Gimnasio al nivel de Hevy.** Rutinas con carpetas, superseries, calentamiento, RIR o RPE,
  tipos de serie, descanso por ejercicio, calculadora de discos, récords (peso, e1RM, volumen y
  reps), historial, calendario y progreso. Biblioteca de ejercicios e importación desde Hevy (CSV).
- **Carga de entrenamiento.** sRPE, monotonía, tensión y banda personal / ACWR con los deportes,
  MMA y gimnasio en un solo registro de actividad.
- **Nutrición sin nutricionista.** Objetivos de kcal y macros, diario, agua y peso. Menús
  semanales comprobados día a día contra tus objetivos, batch cooking, lista de la compra por
  sección, catálogo de tu súper, escáner de código de barras y menús hechos **con tu propia IA**
  (copias el contexto, pegas la respuesta; coste 0 para el servidor).
- **Hoy.** Una pantalla con lo que toca: plan, comidas del menú (marcarlas suma al diario),
  avisos push y accesos rápidos. Funciona sin conexión y envía lo pendiente al volver la red.
- **Importar el historial** del antiguo «Entrenador IA» (CSV y JSON).

## 📱 Producto

Es una **PWA instalable, mobile-first**: se añade a la pantalla de inicio y se abre
a pantalla completa como una app nativa, **sin pasar por App Store / Play Store**
(modelo tipo Pokémon Showdown). Pensada para el móvil, en el gym, sobre la marcha.

## 🛠️ Stack

| Capa | Tecnología |
|------|------------|
| Backend | Django 6 + Django REST Framework, patrón Services/Selectors |
| Auth | JWT (`djangorestframework-simplejwt`) sobre un `CustomUser` por email |
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript, next-intl (es/en), TanStack Query, Zod, Tailwind |
| Patrón web | BFF: Next.js proxya a la API y guarda los tokens en cookies `httpOnly` |
| Coach | Motor *AI personal coach* vendorizado + base de evidencia en la BD |
| IA (opcional) | Anthropic Claude (chat y foto→kcal); los menús usan un proveedor simulado o tu propia IA |
| Datos | PostgreSQL |
| Infra | Docker + Docker Compose (perfiles dev/prod) |

## 🗺️ Estado por módulos

| # | Módulo | Estado |
|---|--------|--------|
| **M1** | Core / Auth: CustomUser, JWT, verificación de email, recuperación de contraseña, beta por invitación, perfil y biometría | ✅ |
| **M2** | Entrenamiento: gimnasio estilo Hevy, rutinas, importación de Hevy, deportes, MMA, calendario, carga (sRPE, banda personal / ACWR) | ✅ Beta. Pendiente: rutinas generadas con IA |
| **M3** | Nutrición: diario, objetivos, menús comprobados, batch cooking, compra, catálogo del súper, escáner, menús con tu IA | ✅ Beta. Pendiente: macros periodizados por bloque |
| **M4** | Coach: plan, check-in, revisión semanal, reglas con evidencia, estado de seguridad único, chat (reglas o Claude) | ✅ Beta |
| **M5** | Hoy, avisos push, modo sin conexión e importación del Entrenador IA | ✅ Beta |

> Los datos viven en la cuenta (no solo en `localStorage`). La checklist de estado real está en
> [`docs/guia-usuario.md`](docs/guia-usuario.md); el plan vigente, en
> [`docs/superpowers/plans/2026-11-03-sustituir-entrenador-ia.md`](docs/superpowers/plans/2026-11-03-sustituir-entrenador-ia.md).

## 📂 Estructura del repositorio

```
fightlab-pro/
├── backend/                  # API Django/DRF
│   ├── core/                 # proyecto (settings, urls)
│   ├── users/ profiles/      # auth, perfil y biometría (M1)
│   ├── activities/           # registro de actividad, carga y récords
│   ├── exercises/ routines/  # biblioteca de ejercicios, rutinas e importación de Hevy
│   ├── coaching/             # coach: plan, check-in, revisión, menús, seguridad
│   ├── ai/                   # chat y foto→kcal con Claude (opcional)
│   ├── notifications/        # avisos push (Web Push)
│   ├── tickets/              # fotos de tickets (Cloudflare R2)
│   ├── userstate/            # estado de la app sincronizado
│   ├── knowledge_fightlab/   # anexo de evidencia propio (combate)
│   ├── knowledge_translations/  # reglas traducidas al español
│   └── vendor/ai-personal-coach/  # motor del coach (MIT / CC BY 4.0)
├── frontend/                 # PWA Next.js (App Router), BFF y service worker
├── docker-compose.yml        # db (PostgreSQL) + backend
├── render.yaml               # blueprint del backend en Render
└── docs/                     # despliegue, guía de usuario, specs, planes y pruebas
```

## 🚀 Puesta en marcha (desarrollo)

**Requisitos:** Docker, Python 3.12.

1. **Variables de entorno.** Copia el ejemplo y ajústalo:
   ```bash
   cp backend/.env.example .env
   # Para desarrollo con venv local, en el .env usa: POSTGRES_HOST=localhost
   ```

2. **Base de datos (Docker):**
   ```bash
   docker compose up -d db
   ```

3. **Backend (venv local):**
   ```bash
   python -m venv .venv && source .venv/bin/activate
   pip install -r backend/requirements.txt
   cd backend
   export PYTHONPATH=vendor/ai-personal-coach   # motor del coach vendorizado (paquete `coach`)
   python manage.py migrate
   python manage.py createcachetable   # los límites de uso viven en la tabla de caché
   python manage.py sync_knowledge     # base de evidencia del coach (solo si cambió)
   python manage.py runserver 8001
   ```
   La API queda en `http://localhost:8001/api/v1/` (el **8000** se deja libre para
   otros proyectos que puedan estar corriendo en la misma máquina; es el puerto
   que ya espera `frontend/.env.example` por defecto). En desarrollo, los emails
   de verificación se imprimen en la consola del servidor.

> Alternativa todo-en-Docker: `docker compose up --build` (backend en el host en
> `http://localhost:8010/`, configurable con `FL_BACKEND_PORT`). El contenedor
> backend usa `POSTGRES_HOST=db` automáticamente.

**Productos del súper (Open Food Facts).** Open Food Facts pide que cada app se identifique
con un contacto en el `User-Agent`. FightLab lo lee de `COACH_OFF_CONTACT` (la misma variable
que usa el motor del coach), que por defecto está vacía: así la búsqueda y la lectura de
productos quedan apagadas, no se hace ninguna petición a OFF y la app explica que no está
configurado. Para encenderla, pon ahí un contacto del equipo de la app, nunca el de un usuario.

**Menús.** Los platos los propone un proveedor simulado y determinista
(`MENU_LLM_PROVIDER = "fake"`); los menús no llaman a la API de Anthropic aunque haya
`ANTHROPIC_API_KEY`. El motor del coach comprueba cada día contra los objetivos.

### Tests

```bash
make test       # Postgres propio en el 54329 + pytest, lint, tsc y vitest
```

Primera vez: `make venv` (Python 3.12). Los comandos de pnpm se lanzan con
`pnpm --dir frontend lint` (o desde `frontend/`): en la raíz del repo fallan con
`ERR_PNPM_NO_PKG_MANIFEST`. Detalles, E2E, CI y protección de rama en
[`docs/DEPLOY.md`](docs/DEPLOY.md#tests-y-ci).

## 🔌 API del M1 (Core / Auth)

Base: `/api/v1`

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/auth/register` | Alta (email + contraseña) → email de verificación |
| POST | `/auth/verify-email` | Verifica el email y activa la cuenta |
| POST | `/auth/verify-email/resend` | Reenvía la verificación |
| POST | `/auth/login` | Devuelve access + refresh (JWT) |
| POST | `/auth/refresh` | Renueva el access token |
| POST | `/auth/logout` | Invalida el refresh (blacklist) |
| GET | `/me` | Datos del usuario autenticado |
| GET/PATCH | `/me/profile` | Lee/actualiza el perfil |
| GET/POST | `/me/biometrics` | Lista/registra biometría |
| DELETE | `/me/biometrics/{id}` | Elimina una entrada |

## 📜 Licencia y créditos

- **Código: MIT** ([`LICENSE`](LICENSE)). **Contenido: CC BY 4.0** ([`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)).
  Titular: Joaquín J Beltrán García. Atribución pedida para el contenido:
  *"FightLab Pro by Joaquín J Beltrán García, CC BY 4.0"*.
- **Motor de cálculo y base de evidencia:** [*AI personal coach*](https://github.com/matgarfer499/ai-personal-coach)
  de matgarfer499, en `backend/vendor/ai-personal-coach/` (versión `69e5537`, evidencia
  revisada el 2026-10-24). Código bajo MIT; contenido bajo
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Cambios de FightLab:** traducción al español de reglas y mensajes, motivos estructurados,
  adaptación a app web, almacenamiento en base de datos y mejoras propias del cálculo (lista en
  [`docs/coach-upstream-sugerencias.md`](docs/coach-upstream-sugerencias.md)). Origen, SHA y
  parches en [`backend/vendor/UPSTREAM.md`](backend/vendor/UPSTREAM.md).
- **Datos de terceros:** alimentos de [USDA FoodData Central](https://fdc.nal.usda.gov/)
  (dominio público); productos de Open Food Facts (ODbL); PAR-Q+ © PAR-Q+ Collaboration
  (versión española del Dr. Martín Rubio), que no se redistribuye.
- **Bibliotecas:** el PDF del menú y la lista de la compra usa
  [ReportLab](https://www.reportlab.com/) (licencia BSD), fijada en `backend/requirements.txt`.
- La app muestra lo mismo en `/profile/credits`.

## 📖 Documentación

- **Guía de usuario (viva):** [`docs/guia-usuario.md`](docs/guia-usuario.md) — qué hace cada vista y checklist de estado real (✅/🎭/⏳).
- **Desplegar la beta (Neon + Render + Vercel):** [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **Visión y arquitectura:** [`docs/superpowers/specs/2026-06-01-fightlab-pro-vision-design.md`](docs/superpowers/specs/2026-06-01-fightlab-pro-vision-design.md)
- **Spec M1 (Core/Auth):** [`docs/superpowers/specs/2026-06-01-m1-core-auth-design.md`](docs/superpowers/specs/2026-06-01-m1-core-auth-design.md)
- **Plan backend M1:** [`docs/superpowers/plans/2026-06-01-m1-backend-core-auth.md`](docs/superpowers/plans/2026-06-01-m1-backend-core-auth.md)
