# 🥊 FightLab Pro

Plataforma para **atletas de combate (MMA)** y deportistas multidisciplinares que
unifica la ciencia del entrenamiento, la nutrición periodizada y un **coach con IA**
en una sola app instalable en el móvil.

> Proyecto personal de aprendizaje con estándares de producción.

---

## ✨ Qué hace

- **Motor fisiológico de carga.** Registras tus sesiones (sparring, grappling,
  fuerza, cardio) y el sistema calcula la carga de entrenamiento (sRPE), la
  monotonía, la tensión y el **ACWR** (ratio carga aguda/crónica) para prevenir
  lesiones.
- **Nutrición periodizada.** Macros que se ajustan según el bloque de
  entrenamiento, timing de nutrientes y seguimiento de peso de cara al pesaje.
- **Coach IA (Anthropic Claude).** Genera rutinas y dietas, **cuenta kcal a partir
  de una foto del plato** y propone ajustes proactivos según tu fatiga y tu ACWR.

## 📱 Producto

Es una **PWA instalable, mobile-first**: se añade a la pantalla de inicio y se abre
a pantalla completa como una app nativa, **sin pasar por App Store / Play Store**
(modelo tipo Pokémon Showdown). Pensada para el móvil, en el gym, sobre la marcha.

## 🛠️ Stack

| Capa | Tecnología |
|------|------------|
| Backend | Django 5 + Django REST Framework, patrón Services/Selectors |
| Auth | JWT (`djangorestframework-simplejwt`) sobre un `CustomUser` por email |
| Frontend | Next.js (App Router) + TypeScript, TanStack Query, Zod, Tailwind |
| Patrón web | BFF: Next.js proxya a la API y guarda los tokens en cookies `httpOnly` |
| IA | Anthropic Claude (texto + visión) |
| Datos | PostgreSQL |
| Infra | Docker + Docker Compose (perfiles dev/prod) |

## 🗺️ Hoja de ruta por módulos

| # | Módulo | Contenido | Estado |
|---|--------|-----------|--------|
| **M1** | Core / Auth | CustomUser, JWT + verificación email, perfil y biometría | ✅ Backend implementado |
| **M2** | Entrenamiento | Planes, sesiones, librería de ejercicios, motor de carga (sRPE/ACWR), readiness | ⏳ Planificado |
| **M3** | Nutrición | Planes, librería de alimentos, registro de comidas, corte de peso básico | ⏳ Planificado |
| **M4** | Coach IA | Generación de rutinas/dietas, foto→kcal, recomendaciones proactivas, chat | ⏳ Planificado |

> Cada módulo recorre su propio ciclo **spec → plan → implementación**. La IA es una
> capa transversal que se monta al final.

## 📂 Estructura del repositorio

```
fightlab-pro/
├── backend/                # API Django/DRF
│   ├── core/               # proyecto (settings, urls)
│   ├── users/              # CustomUser + auth (M1)
│   ├── profiles/           # UserProfile + BiometricsLog (M1)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # PWA Next.js (próximamente)
├── docker-compose.yml      # db (PostgreSQL) + backend
└── docs/superpowers/
    ├── specs/              # especificaciones de diseño
    └── plans/              # planes de implementación
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
   python manage.py migrate
   python manage.py runserver
   ```
   La API queda en `http://localhost:8000/api/v1/`. En desarrollo, los emails de
   verificación se imprimen en la consola del servidor.

> Alternativa todo-en-Docker: `docker compose up --build` (requiere el puerto 8000
> libre). El contenedor backend usa `POSTGRES_HOST=db` automáticamente.

### Tests

```bash
cd backend
pytest          # requiere el contenedor `db` levantado
```

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

## 📖 Documentación

- **Visión y arquitectura:** [`docs/superpowers/specs/2026-06-01-fightlab-pro-vision-design.md`](docs/superpowers/specs/2026-06-01-fightlab-pro-vision-design.md)
- **Spec M1 (Core/Auth):** [`docs/superpowers/specs/2026-06-01-m1-core-auth-design.md`](docs/superpowers/specs/2026-06-01-m1-core-auth-design.md)
- **Plan backend M1:** [`docs/superpowers/plans/2026-06-01-m1-backend-core-auth.md`](docs/superpowers/plans/2026-06-01-m1-backend-core-auth.md)
