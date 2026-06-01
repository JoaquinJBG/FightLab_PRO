# M1 — Core / Auth · Spec de diseño

> Fecha: 2026-06-01 · Estado: aprobado · Módulo: 1 de 4
> Marco compartido: [`2026-06-01-fightlab-pro-vision-design.md`](./2026-06-01-fightlab-pro-vision-design.md)

## Propósito

Cimiento de identidad y biometría de FightLab Pro. Provee autenticación segura
(JWT sobre patrón BFF), el perfil del atleta y el registro biométrico histórico.
Todos los demás módulos cuelgan de la identidad y el perfil definidos aquí.

## Decisiones tomadas (resumen)

- **Frontend:** Next.js App Router como **BFF**; tokens en cookies `httpOnly`.
- **Plataforma:** **PWA instalable, mobile-first** (online, sin offline). Bottom
  tab bar, Tailwind CSS.
- **Registro:** abierto (email + contraseña) **con verificación por email**.
- **Biometría:** entrada **manual**, con el modelo **preparado para wearables**.
- **Roles:** se modelan (Atleta/Coach/Admin) pero la UX es mono-usuario por ahora.
- **Tests backend:** pytest + pytest-django.

---

## 1. Arquitectura backend

Dos apps Django, cada una con el patrón Services/Selectors. Se parte del scaffold
existente: proyecto `core` y app `users` (vacía); se añade la app `profiles`.

> **Punto de partida real:** `backend/core/settings.py` está en su estado por
> defecto (sqlite, sin DRF). M1 debe: configurar `INSTALLED_APPS` (rest_framework,
> simplejwt, corsheaders, users, profiles), `AUTH_USER_MODEL = 'users.CustomUser'`,
> `REST_FRAMEWORK` con JWT, leer settings con `django-environ`, y cambiar la BD a
> PostgreSQL (vía `.env`). El `docker-compose.yml` ya levanta `db` (postgres:15).

### App `users`
Identidad y autenticación.

- **`CustomUser`** (extiende `AbstractUser`):
  - `email` — único, `USERNAME_FIELD` (reemplaza a `username`).
  - `role` — enum `{ATHLETE, COACH, ADMIN}`, default `ATHLETE`.
  - `is_active` — gobernado por la verificación de email.
  - `is_email_verified` — booleano.
  - `created_at`, `updated_at`.
  - Manager personalizado (`create_user` / `create_superuser` por email).
  - **Gancho billing (futuro):** se reserva espacio conceptual para un campo de
    plan/estado de suscripción; NO se implementa ahora, pero `role` + esta nota
    dejan la puerta abierta sin migración disruptiva.

### App `profiles`
Perfil y biometría.

- **`UserProfile`** (1-1 con `CustomUser`):
  - `date_of_birth`, `gender`.
  - `height_cm`.
  - `dominant_stance` — enum `{ORTHODOX, SOUTHPAW, SWITCH}`.
  - `preferred_units` — enum `{METRIC, IMPERIAL}`, default `METRIC`.
  - `timezone`.
  - Se crea automáticamente al verificar el email (signal o dentro del service).

- **`BiometricsLog`** (1-N con `UserProfile`):
  - `weight_kg`, `body_fat_pct`, `resting_heart_rate`, `sleep_quality_score`
    (1-10).
  - `hrv_ms` — variabilidad de la frecuencia cardíaca (nullable). Entrada típica
    de wearables (Oura/Apple Watch); insumo para el readiness de M2.
  - `timestamp` (default ahora; indexado para series temporales).
  - **Campos wearable-ready:**
    - `source` — enum `{MANUAL, GARMIN, APPLE_HEALTH, WHOOP, OTHER}`, default
      `MANUAL`.
    - `external_id` — string nullable (id del registro en el wearable, para
      idempotencia futura).
    - `raw_payload` — JSON nullable (volcado crudo del wearable).
  - Constraint de unicidad blanda: `(profile, source, external_id)` único cuando
    `external_id` no es nulo, para evitar duplicados en futuras importaciones.

### Services y Selectors

| Capa      | Función                | Responsabilidad                                                      |
|-----------|------------------------|----------------------------------------------------------------------|
| Service   | `user_create`          | Crea user inactivo, hashea pass, dispara email de verificación.      |
| Service   | `email_verify`         | Valida token firmado, activa user, crea `UserProfile` si falta.      |
| Service   | `verification_resend`  | Reemite el token de verificación si caducó / no llegó.               |
| Service   | `profile_update`       | Actualiza datos antropométricos/config del perfil.                   |
| Service   | `biometrics_create`    | Inserta un `BiometricsLog` (validando rangos).                       |
| Selector  | `profile_get`          | Devuelve el perfil del usuario autenticado.                          |
| Selector  | `biometrics_list`      | Lista biometría con filtros de rango de fechas y paginación.         |

---

## 2. API (DRF, `/api/v1`)

| Método | Endpoint                          | Auth | Descripción                                  |
|--------|-----------------------------------|------|----------------------------------------------|
| POST   | `/auth/register`                  | No   | Alta de usuario (email + pass).              |
| GET    | `/auth/verify-email?token=...`    | No   | Verifica email y activa la cuenta.           |
| POST   | `/auth/verify-email/resend`       | No   | Reenvía el email de verificación.            |
| POST   | `/auth/login`                     | No   | Obtiene access + refresh (simplejwt).        |
| POST   | `/auth/refresh`                   | No   | Renueva el access token.                     |
| POST   | `/auth/logout`                    | Sí   | Invalida/limpia el refresh (blacklist).      |
| GET    | `/me`                             | Sí   | Datos del usuario autenticado.               |
| GET    | `/me/profile`                     | Sí   | Lee el perfil.                               |
| PATCH  | `/me/profile`                     | Sí   | Actualiza el perfil.                         |
| GET    | `/me/biometrics`                  | Sí   | Lista biometría (filtros de fecha).          |
| POST   | `/me/biometrics`                  | Sí   | Registra una entrada biométrica.             |
| DELETE | `/me/biometrics/{id}`             | Sí   | Elimina una entrada.                         |

Configuración `simplejwt`: access ~15 min, refresh ~7 días con rotación y
blacklist activada.

---

## 3. Frontend (Next.js App Router)

### PWA y layout móvil (se establece en M1)
M1 sienta las bases de plataforma que heredan todos los módulos:

- **PWA instalable:** `manifest` (nombre, iconos, `display: standalone`,
  `theme_color`) + service worker mínimo (p. ej. con `@serwist/next`) para que sea
  instalable ("Añadir a pantalla de inicio") y abra a pantalla completa. **Sin**
  estrategia de caché offline por ahora.
- **Mobile-first:** layout base con **bottom tab bar** (Dashboard, Biometría,
  Perfil — se ampliará con Entreno/Nutrición/Coach en M2-M4), contenedor centrado
  tipo app, viewport y *safe areas* móviles. En escritorio se ve como columna
  centrada, correcto pero sin layout dedicado.
- **Tailwind CSS** para el estilado responsive mobile-first.

### Capa BFF (route handlers)
El navegador habla con Next, no con Django.

- `app/api/auth/register/route.ts` — proxy a `/auth/register`.
- `app/api/auth/login/route.ts` — pide tokens a Django y los escribe en cookies
  `httpOnly`/`Secure`/`SameSite=Lax`.
- `app/api/auth/refresh/route.ts` — refresca usando la cookie de refresh.
- `app/api/auth/logout/route.ts` — borra cookies + blacklist en Django.
- Proxy genérico autenticado para `/me/*` que adjunta el access token desde la
  cookie en cada petición a DRF.

### Middleware (`middleware.ts`)
- Protege rutas privadas (dashboard, perfil, biometría).
- Si el access expiró pero el refresh es válido → refresca de forma transparente.
- Si el refresh falla → redirect a `/login`.

### Páginas
| Ruta              | Contenido                                                        |
|-------------------|------------------------------------------------------------------|
| `/register`       | Formulario de alta (Zod) → mensaje "revisa tu email".            |
| `/verify-email`   | Consume el token del enlace; éxito → CTA a login.                |
| `/login`          | Formulario de acceso.                                            |
| `/onboarding`     | Alta del `UserProfile` tras el primer login (wizard corto).      |
| `/dashboard`      | Resumen biométrico + **gráficas de evolución** (peso, sueño…).   |
| `/profile`        | Edición de perfil y preferencias.                                |
| `/biometrics/new` | Registro de una entrada biométrica.                              |

- **Datos:** hooks de TanStack Query (`useProfile`, `useBiometrics`,
  mutaciones) contra la capa BFF.
- **Validación:** schemas Zod compartidos entre formularios y parseo de
  respuestas.
- **Gráficas:** librería de charts (p. ej. Recharts) para series temporales.

> Nota UI: el layout concreto del dashboard/gráficas se afinará en
> implementación (opción de mockups disponible si se desea).

---

## 4. Flujo de autenticación (end-to-end)

```
Registro ─▶ user inactivo + email con token firmado (SMTP; consola en dev)
        ─▶ click enlace ─▶ verify-email ─▶ is_active=True, is_email_verified=True
        ─▶ Login ─▶ Next BFF obtiene access+refresh ─▶ cookies httpOnly
        ─▶ Petición cliente ─▶ Next proxya con cookie ─▶ Django
        ─▶ access expira ─▶ middleware refresca
        ─▶ refresh falla ─▶ logout + redirect /login
```

---

## 5. Manejo de errores

- **Validación:** DRF serializers como fuente de verdad; errores mapeados por
  campo y reflejados en el formulario (Zod cliente para feedback inmediato).
- **Verificación caducada:** token con expiración → flujo de reenvío
  (`/auth/verify-email/resend`).
- **Refresh fallido / sesión inválida:** logout limpio + redirect.
- **Rangos biométricos inválidos** (p. ej. `sleep_quality_score` fuera de 1-10):
  rechazo con error claro en el service y en el serializer.

---

## 6. Testing (TDD)

### Backend (pytest + pytest-django)
- Modelos: constraints (`email` único, rangos, unicidad blanda de biometría).
- Services: `user_create` (efecto email), `email_verify` (token válido/caducado),
  `profile_update`, `biometrics_create` (validación de rangos).
- Selectors: `biometrics_list` con filtros de fecha y paginación.
- Endpoints: registro→verificación→login→refresh→logout; acceso protegido sin/
  con token; aislamiento de datos por usuario.

### Frontend
- **Vitest + Testing Library:** formularios (validación Zod), estados de carga/
  error de los hooks de TanStack Query.
- **Playwright (E2E):** flujo completo registro → verificación → login →
  dashboard.

---

## 7. Criterios de aceptación

- [ ] Un usuario puede registrarse, recibir email, verificar y hacer login.
- [ ] Los tokens viven en cookies `httpOnly`; el JS del cliente no puede leerlos.
- [ ] El refresh transparente mantiene la sesión; su fallo redirige a login.
- [ ] El usuario completa su `UserProfile` en onboarding y lo edita después.
- [ ] El usuario registra biometría manual y ve gráficas de evolución.
- [ ] La app es **instalable como PWA** en móvil (icono, modo standalone) y la
      navegación principal es una bottom tab bar mobile-first.
- [ ] `BiometricsLog` admite `source`/`external_id`/`raw_payload` sin romper la
      entrada manual (preparado para wearables).
- [ ] Cobertura de tests en services, selectors y el flujo de auth E2E.

---

## 8. Fuera de alcance de M1 (se aborda después)

- Integración real con wearables (solo se deja el modelo preparado).
- Permisos finos de Coach sobre atletas (multi-usuario).
- Cualquier funcionalidad de IA (módulo M4).
- Recuperación de contraseña (puede añadirse como extensión menor de M1 si se
  desea más adelante).
