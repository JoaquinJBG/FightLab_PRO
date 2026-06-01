# FightLab Pro — Visión y Arquitectura Compartida

> Fecha: 2026-06-01 · Estado: aprobado · Tipo: documento marco (cross-cutting)

Este documento captura la visión global del producto y las decisiones de
arquitectura que **aplican a todos los módulos**. Cada módulo tiene además su
propia spec detallada (`*-mN-*-design.md`). Empezar siempre por aquí.

---

## 1. Visión del producto

**FightLab Pro** es una plataforma para atletas de combate (MMA) y deportistas
multidisciplinares que unifica tres dominios en una sola app:

1. **Motor fisiológico de carga** — el atleta registra sesiones (sparring,
   grappling, fuerza, cardio) y el sistema calcula automáticamente la carga de
   entrenamiento (sRPE), la monotonía, la tensión y el **ACWR** (ratio carga
   aguda/crónica) para prevención predictiva de lesiones.
2. **Nutrición periodizada** — macros que se ajustan dinámicamente según el
   bloque de entrenamiento (día de carga alta vs. recuperación), timing de
   nutrientes y suplementación basada en evidencia.
3. **Coach IA** — capa inteligente (Anthropic Claude) que genera rutinas y
   dietas personalizadas, **lee fotos de alimentos para contar kcal** (visión
   multimodal) y propone ajustes proactivos según el contexto del atleta.

### Qué NO es (alcance excluido por ahora)

- **Sin interacción por voz.** El registro manos-libres queda descartado; la IA
  es un coach por texto/visión, no por voz.
- **Mono-usuario en esta fase.** El modelo de datos conserva roles
  (Atleta/Coach/Admin) para escalar a multi-usuario después, pero la UX y los
  permisos finos de coach **no** se construyen todavía.
- **Sin facturación ni multi-tenancy.** No hay Stripe ni multi-inquilinato. Pero
  el diseño deja un **gancho para suscripciones** más adelante: no se toman
  decisiones que cierren la puerta a añadir billing (p. ej. el `role` y un futuro
  campo de plan/estado de cuenta en `CustomUser`).

### Gobernanza (nivel ligero — proyecto de aprendizaje)

No se implementa cumplimiento formal GDPR ni auditoría inmutable. Sí se aplican
buenas prácticas básicas porque se manejan datos de salud y recomendaciones de IA:

- **Disclaimers de IA:** el coach IA muestra avisos de "no es consejo médico" y
  asume **supervisión humana**; nunca emite diagnósticos.
- **Datos sensibles** (biometría, corte de peso) tratados con cuidado: secretos
  por entorno, acceso solo del propio usuario a sus datos.
- El corte de peso muestra **umbrales de referencia** informativos, sin
  prescribir manipulaciones agresivas de fluidos.

---

## 2. Stack tecnológico

### Backend
- **Django 5.x + Django REST Framework (DRF)**.
- **Custom User Model** extendiendo `AbstractUser` (email como identificador).
- **Autenticación JWT** vía `djangorestframework-simplejwt`.
- **Patrón Services/Selectors**: la lógica de negocio vive en `services.py`
  (escrituras/efectos) y `selectors.py` (lecturas/consultas), desacoplada de las
  vistas DRF. Las vistas solo orquestan: validan input, llaman a un
  service/selector y serializan la salida.

### Frontend
- **Next.js 15 (App Router) + TypeScript**.
- **TanStack Query** para estado de servidor (cache, refetch, mutaciones).
- **Zod** para validación de formularios y de respuestas de API.
- **Patrón BFF (Backend-for-Frontend)**: el navegador nunca habla directo con
  Django. Next.js expone *route handlers* que proxean a la API DRF y custodian
  los tokens en cookies `httpOnly`.

### IA (capa transversal, módulo M4)
- **Anthropic Claude** (texto + visión). Se integra al final como capa que
  consume los datos de M1–M3.

### Infraestructura y persistencia
- **PostgreSQL** como motor relacional principal.
- **Docker + Docker Compose** con perfiles separados `dev` y `prod`.
- **Credenciales por variables de entorno** (`.env`, fuera del control de
  versiones).

---

## 3. Estructura del repositorio

```
fightlab-pro/
├── backend/            # Proyecto Django (ya scaffoldeado)
│   ├── core/           # settings, urls, wsgi/asgi (nombre real del proyecto)
│   ├── users/          # CustomUser + auth (M1)
│   ├── profiles/       # UserProfile + BiometricsLog (M1)
│   ├── training/       # M2
│   ├── nutrition/      # M3
│   ├── ai_coach/       # M4
│   ├── requirements.txt
│   ├── Dockerfile
│   └── manage.py
├── frontend/           # Proyecto Next.js (App Router)
│   ├── app/            # rutas + route handlers (BFF)
│   ├── components/
│   ├── lib/            # cliente API, schemas Zod, hooks TanStack Query
│   └── middleware.ts   # protección de rutas + refresh
├── docker-compose.yml      # ya existe (db + backend)
├── docker-compose.prod.yml
├── .env / .env.example
└── docs/superpowers/specs/
```

> **Estado del scaffold:** ya existen `backend/core` (proyecto), `backend/users`
> (app vacía), `requirements.txt` (Django, DRF, simplejwt, cors-headers,
> django-environ, psycopg2), `Dockerfile` (python 3.11) y `docker-compose.yml`
> (postgres:15 + backend). M1 parte de aquí; falta configurar `settings.py`
> (DRF/JWT/CORS/env, switch de sqlite a Postgres) y crear los modelos.

Cada app Django sigue la misma anatomía: `models.py`, `services.py`,
`selectors.py`, `serializers.py`, `views.py`, `urls.py`, `tests/`.

---

## 4. Convenciones transversales

- **API:** REST/JSON, versionada bajo `/api/v1/...`. Nombres de recursos en
  plural y kebab/snake coherente con DRF.
- **Errores:** formato de error estandarizado de DRF; el frontend mapea errores
  de validación a los campos del formulario.
- **Validación doble:** Zod en el cliente para UX inmediata; DRF serializers
  como fuente de verdad en el servidor.
- **Testing (TDD):**
  - Backend: **pytest + pytest-django** (services/selectors, constraints de
    modelo, flujos de endpoint).
  - Frontend: **Vitest + Testing Library** (componentes) y **Playwright** para
    E2E de flujos críticos.
- **Seguridad:** tokens en cookies `httpOnly`/`Secure`/`SameSite`; secretos solo
  por entorno; datos de salud tratados con cuidado.

---

## 5. Mapa de módulos y orden de construcción

| #  | Módulo               | Contenido                                                                                                       | Depende de |
|----|----------------------|-----------------------------------------------------------------------------------------------------------------|------------|
| M1 | **Core / Auth**      | Next.js + Django JWT (BFF), `CustomUser`, `UserProfile`, `BiometricsLog` (incl. HRV)                            | —          |
| M2 | **Entrenamiento**    | Planes, sesiones, librería de ejercicios, logs polimórficos + motor de carga (sRPE, ACWR) + **readiness/wellness** | M1         |
| M3 | **Nutrición**        | Planes nutricionales, librería de alimentos, registro de comidas + **corte de peso básico** (peso objetivo vs. actual + countdown a pesaje) | M1         |
| M4 | **Coach IA**         | Integración Claude: generar rutinas/dietas, foto→kcal, recomendaciones proactivas, **chat con tool-calling** y persona "High-Performance Coach" | M1, M2, M3 |

**Notas de alcance por módulo (para sus specs futuras):**

- **M2 — readiness/wellness:** además del motor de carga, registrar un
  cuestionario de bienestar (sueño, ánimo, estrés, dolor muscular) y derivar un
  *score de preparación diario* que module el volumen sugerido. HRV (de M1) y
  CMJ son entradas opcionales.
- **M3 — corte de peso básico:** seguimiento de peso objetivo vs. actual y
  countdown al pesaje. **Sin** protocolos avanzados de manipulación de fluidos;
  la periodización de carbohidratos por tipo de día sí entra.
- **M4 — coach IA:** persona "High-Performance Coach" (directo, técnico,
  motivador, usa el historial del atleta). El chat no solo responde: ejecuta
  acciones vía *tool calling* (p. ej. "crea una sesión de striking mañana,
  intensidad 7"). Streaming de respuestas.

**Principio:** M1→M2→M3 se construyen con lógica **determinística** (cálculos por
fórmula, logging manual) y son funcionales por sí solos. M4 añade la **capa
inteligente** encima sin reescribir lo anterior.

Cada módulo recorre su propio ciclo **spec → plan → implementación**.
