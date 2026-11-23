# IA de planes: bloques de entrenamiento, ajuste diario y sugerencias de comida

- **Fecha:** 2026-09-24
- **Rama:** `feat/ia-planes` (sale de `feat/beta-cloud`)
- **Estado:** diseño aprobado en conversación; pendiente de revisión de esta spec

## 1. Objetivo

Que la IA (Claude) **recomiende y aplique** en la app:

- **Gimnasio:** rutinas con ejercicios, series, repeticiones y objetivo de intensidad.
- **MMA:** sesiones con tipo de trabajo, rounds, drills técnicos y condicionamiento.
- **Nutrición:** comidas concretas que cuadren con los macros del día.

Lo que dijo el usuario:

- Lo recomendado se aplica a la app: calendario, logger, timer y diario. No es solo texto para leer.
- Hay plan de varios días **y** ajuste del día.
- Se entrena **3-4 semanas la misma plantilla semanal** (mesociclo) teniendo en cuenta lo anterior. Repetir el bloque previo con progresión es válido.
- Enfoque elegido: **el más versátil**, con IA también en el ajuste diario (enfoque B). Un solo usuario, así que el coste no es una restricción fuerte.
- Tras probar el coach con Claude real: **la conversación debe guardarse** y **lo que el coach propone en el chat debe poder pasar a la rutina**.

Supuestos, validados en el diseño:

- Un bloque incluye a la vez gimnasio y MMA para que la carga cuadre.
- La nutrición se adapta al tipo de día.
- La progresión semana a semana se apoya en los registros reales.
- Se respetan cuotas diarias de IA como las que ya existen (chat y foto → kcal).

**Criterio de éxito:** generar un bloque de 3-4 semanas, verlo en el calendario, abrir cada día la sesión ya cargada en el logger o el timer, ajustarla a cómo se llega ese día y añadir al diario comidas sugeridas que encajen en los macros restantes.

**Fuera de alcance:**

- Corte de peso con deshidratación (P1). Sigue bloqueado hasta revisar las fuentes ISSN.
- Rol de entrenador y rutinas asignadas por terceros (`my-routine`).
- Generación asíncrona con cola de trabajos.
- Notificaciones push.

## 2. Arquitectura y modelo de datos

### Backend: app nueva `planning`

Sigue el patrón Services/Selectors del proyecto.

**`TrainingBlock`**

| Campo | Tipo | Notas |
|---|---|---|
| `profile` | FK `UserProfile` | dueño |
| `start_date` | date | lunes de la semana 1 |
| `weeks` | int (3–4) | |
| `goal` | str | `fuerza`, `hipertrofia`, `pico_pelea`, `mantenimiento` o `recomposicion` |
| `status` | str | `draft` (propuesta sin aplicar; caduca a los 7 días), `active` o `archived`. **Como mucho un `active` por perfil** (restricción única condicional) |
| `inputs` | JSON | respuestas del formulario: días disponibles, material, preferencias |
| `template` | JSON | plantilla semanal (ver §3) |
| `progression` | JSON | regla por semana y `deload_week` |
| `nutrition` | JSON | menú tipo por `day_type` (`gym`, `mma`, `doble`, `descanso`) |
| `rationale` | text | explicación breve de la IA |
| `source` | str | `ai` o `rules` (plantilla predefinida) |
| `source_context` | JSON | instantánea acotada del contexto usado, para auditar y generar el siguiente bloque |
| `created_at` / `updated_at` | datetime | |

**`DayPlan`**

| Campo | Tipo | Notas |
|---|---|---|
| `block` | FK `TrainingBlock` | |
| `date` | date | único por `(block, date)` |
| `session` | JSON | sesión concreta ya ajustada, con la forma de un día de `template` y los objetivos de la semana resueltos |
| `adjustment` | JSON | `{changes: [...], reason}` o vacío |
| `source` | str | `ai`, `rules` o `template` (sin ajustar) |

**`CoachMessage`** (historial del chat del coach)

| Campo | Tipo | Notas |
|---|---|---|
| `profile` | FK `UserProfile` | dueño |
| `role` | str | `user` o `assistant` |
| `text` | text | máx. 4000 caracteres |
| `action` | JSON o null | tarjeta de acción propuesta por el coach (ver §4) con su `status`: `proposed`, `applied` o `dismissed` |
| `created_at` | datetime | índice por `(profile, created_at)` |

No se usa `UserState` para el chat porque su límite de 64 KB por clave se queda corto.

**Reglas de negocio:**

- Generar un bloque nuevo archiva el activo.
- Al generar, se pasa el bloque anterior a la IA **con la adherencia real**: sesiones planificadas frente a registradas, y kilos y repeticiones reales frente a los objetivos.
- Los datos de otro usuario nunca se ven: todos los selectors filtran por `request.user.profile` y un recurso ajeno devuelve 404.

### Endpoints

Todos bajo `/api/v1/`, autenticados y con prefijo permitido en la allowlist del BFF (`me`).

| Método y ruta | Qué hace |
|---|---|
| `POST me/plan/blocks/generate` | Genera una **propuesta** con IA o plantilla, sin activarla. Devuelve el bloque en borrador |
| `POST me/plan/blocks/<id>/apply` | Activa el bloque (archiva el anterior) |
| `PATCH me/plan/blocks/<id>` | Edición manual: cambiar un ejercicio, mover un día |
| `GET me/plan/active` | Bloque activo con semana actual |
| `GET me/plan/day?date=` | `DayPlan` del día; si no existe, lo materializa desde la plantilla sin IA |
| `POST me/plan/day/adjust` | Ajuste del día con IA; fallback a reglas |
| `POST me/plan/day/regenerate` | Regenera la sesión de un día con IA |
| `POST me/plan/meals/suggest` | Sugerencias de comida para los macros restantes |
| `GET me/coach/messages?before=` | Historial del chat paginado, de 50 en 50, del más nuevo al más antiguo |
| `DELETE me/coach/messages` | Borra la conversación |
| `POST me/coach/actions/<message_id>/apply` | Aplica la acción de una tarjeta del chat, con las mismas validaciones que el endpoint equivalente |
| `POST me/coach/actions/<message_id>/dismiss` | Descarta la tarjeta |
| `GET/PUT me/plan/preferences` | Preferencias de nutrición: alergias, alimentos que no gustan, presupuesto. Se guardan en `UserState` con la clave `plan_prefs`, añadida a la allowlist |

Los borradores (`draft`) se limpian de forma perezosa al generar otro.

### IA: `backend/ai/services.py`

Tres funciones nuevas, con salida estructurada mediante *tool use* con `input_schema` JSON:

- `generate_block(context) -> dict`
- `adjust_day(block, day_session, today_state) -> dict`
- `suggest_meals(day_type, remaining_macros, prefs, recents) -> dict`

Modelos configurables por variable de entorno:

- `AI_MODEL_PLAN`, por defecto `claude-opus-5-5`, para el bloque.
- `AI_MODEL_CHAT`, por defecto `claude-sonnet-5`, para el ajuste y las comidas.

### Frontend

`lib/plan.ts` contiene:

- Tipos y schemas Zod.
- Lectura del bloque y del día con **caché en localStorage** (`flp_plan_active`, `flp_plan_day_<fecha>`), para que la sesión de hoy funcione sin conexión una vez obtenida.
- Helpers puros:
  - semana actual del bloque
  - resolver los objetivos de una semana según `progression`
  - mapear la sesión al logger del gimnasio, al timer y registro de MMA, y una comida sugerida a items del diario

`clearDeviceState` (logout) borra las claves `flp_plan_*`.

## 3. Contrato con la IA

### Contexto

Lo monta el servidor desde la base de datos; el cliente nunca lo manda.

- **Perfil:** edad, sexo, altura, peso actual y tendencia (EWMA), unidades, disciplinas, experiencia y frecuencia (`profile_extra`).
- **Memoria del coach:** lesiones y molestias activas, fase del campamento, fecha de pelea, objetivo de peso y tono (reutiliza `sanitize_coach_memory`).
- **Carga:**
  - banda de carga, ACWR y monotonía
  - resumen de las últimas 28 sesiones: tipo, RPE, AU, y en el gimnasio los ejercicios con su mejor serie
- **Recuperación:** HRV, FC en reposo y últimas biometrías.
- **Bloque anterior y adherencia**, si existen.
- **Solo en `adjust_day`:**
  - estado de hoy: readiness y su motivo
  - sesión de ayer
  - carga de la semana frente a la banda
  - sesión planificada de hoy

Tamaño acotado. Se resume y no se envía el historial crudo; hay un tope de caracteres por sección.

### Esquema de salida

```text
day_session = {
  day_type: "gym" | "mma" | "doble" | "descanso",
  gym?:  [{ exercise, sets, reps, target_rpe?, pct_1rm?, rest_s }],
  mma?:  { work_type, rounds, round_s, rest_s, drills: [str], conditioning?: str },
  notes?: str
}

generate_block → {
  weeks, goal,
  template: { mon..sun: day_session },
  progression: { week_n: { volume_pct, rpe_delta, note } }, deload_week?,
  nutrition: { gym|mma|doble|descanso: { meals: [meal] } },
  rationale
}

adjust_day    → { session: day_session, adjustment: { changes: [str], reason: str } }

suggest_meals → { meals: [meal] }
meal = { name, items: [{ name, grams, kcal, protein_g, carbs_g, fat_g }] }   // mismo formato que los items del diario
```

### Validación en el servidor

Con serializers de DRF:

- **Ejercicios:** se normalizan contra el catálogo de la app (`FOCUS_EXERCISES`, portado al backend como constante compartida). Si no coinciden, se aceptan como texto libre y se marca `custom: true`.
- **Límites de cordura:**

  | Campo | Rango |
  |---|---|
  | `sets` | 1–10 |
  | `reps` | 1–30 |
  | `rounds` | 1–15 |
  | `round_s` | 30–600 |
  | `rest_s` | 0–600 |
  | kcal por comida | ≤ 2000 |

  Ningún día con más de 12 ejercicios.
- **Reintento:** si no valida, se reintenta **una vez** con los errores como feedback. Si vuelve a fallar, se usa el fallback.

### Reglas de seguridad

Van en el system prompt **y** se comprueban en el servidor.

- **Lesiones:** si hay una lesión activa en la memoria del coach, se excluyen los patrones afectados mediante un mapa zona → patrones (hombro → press por encima de la cabeza y dips; rodilla → saltos pliométricos…). El servidor rechaza una sesión que contenga ejercicios de un patrón excluido.
- **Carga:** la semana planificada no puede superar el `overreach` de la banda personal. Con readiness en rojo, `adjust_day` debe bajar volumen o intensidad, y el servidor lo comprueba.
- **Nutrición:**
  - suelo de kcal diarias ≥ BMR estimado (Mifflin-St Jeor)
  - sin deshidratación ni cortes agresivos
  - las alergias de `plan_prefs` son una exclusión estricta
- **Aviso fijo en la UI:** "Orientativo, no sustituye a un entrenador ni a un médico".

## 4. Integración en las vistas

**Entreno: "Generar bloque con IA"**

- **Formulario:** objetivo, 3 o 4 semanas, días disponibles para gimnasio y MMA, material (`gimnasio`, `casa`, `peso_corporal`) y la casilla "repetir el anterior con progresión".
- **Valores precargados:** vienen de la memoria del coach y del historial.
- **Vista previa:** plantilla semanal, progresión por semanas y el porqué. Botones Aplicar, Regenerar y Editar.

**Gimnasio**

- Al aplicar, el calendario semanal (`gym_week`) se rellena con el foco de cada día.
- "Empezar sesión de hoy" abre el logger **con los ejercicios del día** y, en cada serie, el objetivo de la semana (kilos y repeticiones o RPE) junto al valor anterior al estilo Hevy.
- Los valores reales registrados alimentan la adherencia y la progresión.
- Botón **"Ajustar hoy"**: muestra los cambios en una línea y el motivo.

**MMA**

- El "Plan sugerido" que hoy es una demo pasa a ser la sesión del bloque para ese día.
- "Empezar" abre el **timer** configurado con los rounds y los tiempos.
- Al terminar, el registro de MMA sale precargado (tipo, rounds y duración), y solo queda poner el RPE y las notas.
- "Ajustar hoy" funciona igual que en el gimnasio.

**Nutrición**

- Tarjeta **"Sugerencias para hoy"** según el `day_type` del bloque y los macros que faltan.
- Muestra de 2 a 3 comidas; cada una se añade al diario con un toque. Botón "Otra opción".
- Pantalla de preferencias con alergias, alimentos que no gustan y presupuesto.
- **Sin bloque activo**, las sugerencias usan el `day_type` que se deduce de las actividades del día.

**Dashboard**

- "Próxima acción" muestra la sesión de hoy del bloque con la semana (por ejemplo "S2/4").
- Avisos de semana de descarga y de fin de bloque ("¿Generamos el siguiente?").

**Coach (chat)**

- Recibe el bloque activo y el `DayPlan` de hoy como contexto (claves nuevas en `CONTEXT_KEYS`, montadas en el servidor).
- **Historial persistente:**
  - Cada mensaje del usuario y del coach se guarda en `CoachMessage`, y la vista carga el historial al abrirse (con caché local de los últimos 50 mensajes en `flp_coach_chat`, que se borra en el logout).
  - La IA recibe los últimos ~20 mensajes y, si hay más, un resumen breve de los anteriores. El resumen se guarda y se regenera cada 20 mensajes nuevos.
  - Botón "Borrar conversación".
- **Acciones desde el chat** con tool use:
  - Herramientas del coach: `propose_block` (generar un bloque), `modify_day` ("cámbiame el jueves"), `adjust_today` y `suggest_meals`.
  - Cuando Claude las usa, el servidor ejecuta la misma generación y validación que los endpoints de §2 (esquema, límites de cordura, lesiones, banda y suelo de kcal) y guarda el resultado como `action` del mensaje, en estado `proposed`.
  - En el chat se ve como una **tarjeta de acción** con el resumen del cambio y los botones **Aplicar** y **Descartar**. **Nunca se aplica nada sin confirmación.**
  - Aplicar llama a `me/coach/actions/<id>/apply`, que reutiliza los services de `planning`. Si el estado cambió desde la propuesta (por ejemplo, ya hay otro bloque activo), se vuelve a validar y se avisa.
  - Las tarjetas caducan a los 7 días.
- El formulario "Generar bloque" sigue existiendo: el chat es otra forma de llegar a lo mismo.

## 5. Errores, modo sin IA y coste

**Qué pasa si algo falla**

| Fallo | Comportamiento |
|---|---|
| `generate_block` devuelve 503 (sin clave), 429 (cuota o límite) o timeout | Mensaje claro y opción **"Crear desde plantilla"**: plantillas predefinidas por reglas (full-body 3 días + MMA 2 días, torso/pierna 4 días + MMA 2 días) con la misma estructura, `source: rules` |
| `adjust_day` falla | Se aplica el ajuste por reglas en el servidor (readiness y banda: rojo → −1 serie y RPE −1; ámbar → RPE −0,5; carga por encima de `high` → −20 % de volumen), con `source: rules`. La UI muestra "Ajuste automático (sin IA)" |
| `suggest_meals` falla | Se muestran recientes y favoritos del diario que encajan en los macros. **Nunca se inventa un plato** |
| Sin conexión o backend despertando | El bloque y los días ya obtenidos salen de la caché local. "Ajustar hoy" usa las reglas locales de `lib/recovery.ts` y lo indica |

**Tiempos:** la generación del bloque puede tardar entre 20 y 40 s. El frontend muestra progreso y el BFF tiene `maxDuration` de 60 s. Si se supera, habría que pasar a generación en segundo plano con polling; queda fuera de este alcance y se deja anotado.

**Cuotas** (variables de entorno, por usuario y día):

| Variable | Por defecto |
|---|---|
| `AI_DAILY_QUOTA_PLAN` | 5 |
| `AI_DAILY_QUOTA_ADJUST` | 10 |
| `AI_DAILY_QUOTA_MEALS` | 20 |

Hay además límites por minuto (`throttle_scope` `ai-plan`, `ai-adjust` y `ai-meals`). Como con el chat, la cuota solo se consume si la llamada a la IA tiene éxito.

**Coste estimado** para un solo usuario (un bloque al mes, un ajuste al día y unas 2 sugerencias de comida al día): pocos dólares al mes. Se recomienda un límite de gasto en la consola de Anthropic.

## 6. Tests

**Backend (pytest)**

- **Modelos:** un solo bloque activo, aplicar archiva el anterior, caducidad de los borradores.
- **Seguridad de acceso:** el bloque o el día de otro usuario da 404; sin token, 401.
- **Endpoints:** respuestas 200, 400, 429 y 503.
- **IA con el SDK mockeado:**
  - salida válida
  - JSON inválido → reintento → fallback
  - límites de cordura
  - rechazo de un patrón que choca con una lesión
  - suelo de kcal
  - la cuota no se consume si hay fallo
- **Contexto acotado:** tamaño y ausencia de datos de otros usuarios.
- **Chat:** el historial se guarda y se pagina, está aislado por usuario (404 para mensajes ajenos) y se puede borrar. Con el SDK mockeado, una llamada a una herramienta genera una tarjeta `proposed` validada; aplicarla crea o modifica el bloque y descartarla no cambia nada. Una tarjeta caducada o ajena se rechaza.
- **Reglas:** ajuste por readiness y banda, plantillas predefinidas válidas contra el esquema.

**Frontend (Vitest)**

- `lib/plan.ts`: semana actual, resolución de objetivos por semana, caché, y mapeos a logger, timer y registro de MMA.
- Comida sugerida → items del diario.
- `clearDeviceState` borra `flp_plan_*` y `flp_coach_chat`.
- Render de las tarjetas de acción del chat: los estados `proposed`, `applied` y `dismissed`.
- Lint a 0, `tsc` y `next build`.

**Prueba de punta a punta** contra el despliegue real con la clave: generar, aplicar, sesión de hoy, ajustar, añadir una comida sugerida y el modo sin IA (quitando la clave).

## 7. Orden de implementación

Rama `feat/ia-planes`, con commits pequeños y **push tras cada commit**.

1. **Backend base:** app `planning`, modelos y migraciones, selectors y services, endpoints `apply`, `active`, `day` y `PATCH`, y plantillas predefinidas (`source: rules`), con sus tests. Incluye el **historial persistente del chat** (`CoachMessage`, endpoints de mensajes y la vista del coach cargando y guardando el historial), porque es independiente y se ve enseguida.
2. **IA:** `generate_block`, `adjust_day` y `suggest_meals`, con salida estructurada, validación, seguridad, fallback, cuotas y throttles, con sus tests.
3. **Gimnasio:** formulario y vista previa del bloque, aplicar al calendario, logger precargado con objetivos y "Ajustar hoy".
4. **MMA:** sesión del bloque en lugar de la demo, "Empezar" abre el timer configurado y el registro llega precargado.
5. **Nutrición:** tarjeta de sugerencias, añadir con un toque, preferencias.
6. **Dashboard y chat:** sesión de hoy y semana en Home, bloque como contexto del coach, y **acciones desde el chat** (herramientas, tarjetas y aplicar o descartar).
7. **Documentación:** guía de usuario y `DEPLOY.md` (`AI_MODEL_PLAN` y `AI_DAILY_QUOTA_*`).

Los pasos 3, 4 y 5 son independientes una vez terminado el 2. Si se paralelizan, se hace en worktrees creados a mano desde la rama correcta.
