# Integración del coach `ai-personal-coach`: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que FightLab haga todo lo que hace el Entrenador IA (`ai-personal-coach`): cribado, objetivos de energía, macros y zonas, check-in, plan y revisión semanal, menús y compra, con cada número calculado por el motor del coach y cada recomendación citando su regla y su fuente. Lo propio de FightLab (carga, MMA, pesaje) se mantiene y pasa su propia revisión de evidencia.

**Architecture:** El repo del coach entra con `git subtree --squash` en `backend/vendor/ai-personal-coach/` y no se edita. Una app Django nueva, `coaching`, contiene los modelos, los servicios y un puente (`coaching/bridge/`) que traduce entre los modelos de FightLab y los objetos del motor (`Profile`, pesajes, series) y llama solo a funciones puras. La evidencia (`knowledge/`) se carga en PostgreSQL y alimenta las citas de la API, la UI y el chat. Las skills de Claude Code se rehacen como flujos de la app.

**Tech Stack:** Python 3.12, Django 5.2 LTS, DRF, PostgreSQL 15, pytest + pytest-django; motor `coach` (pyyaml); Next.js 15 + TanStack Query + Zod en el frontend; Anthropic Claude con tool-calling en el chat.

**Spec:** [`../specs/2026-10-29-coach-integracion-design.md`](../specs/2026-10-29-coach-integracion-design.md)

---

## Conventions for the implementer

- **Fase 0 (este documento) es solo diseño.** Antes de empezar cada fase de código se
  escribe su plan detallado al estilo de `2026-06-01-m1-backend-core-auth.md`
  (TDD, pasos con código). La fase 1 ya va aquí con ese nivel de detalle; las demás
  quedan a nivel de tareas, archivos y criterios de aceptación.
- **Ramas y PR:** una rama por fase desde `staging` (`feat/coach-fN-<slug>`), PR a
  `staging` y después promoción `staging → main`, como en el resto del proyecto.
- Comandos de backend desde `backend/`, dentro del contenedor `backend` o en un venv
  con Python 3.12.
- **Nunca se edita `backend/vendor/ai-personal-coach/`.** Los cambios en el motor van
  como PR al repo del autor (spec §4). Un parche local de emergencia se apunta en
  `backend/vendor/UPSTREAM.md`.
- **Nunca se lee ni se copia nada de `entrenador IA/ai-personal-coach/data/`.** El
  subtree se trae del remoto de GitHub.
- Tests: `pytest` (suite de FightLab) y
  `pytest vendor/ai-personal-coach/tests -p no:django` (suite del autor; ver Task 1.3).
- Estilo de commit del repo: `feat(coach): …`, `build: …`, `docs(coach): …`.

## File structure (what the whole plan creates/modifies)

```
backend/
├── Dockerfile                         # MODIFY (F1) — python:3.12-slim, PYTHONPATH
├── requirements.txt                   # MODIFY (F1) — pin Django 5.2, pyyaml
├── pyproject.toml                     # MODIFY (F1) — pythonpath del motor
├── .env.example                       # MODIFY (F1) — PYTHONPATH local
├── vendor/
│   ├── UPSTREAM.md                    # CREATE (F1) — origen, SHA, licencias, parches
│   └── ai-personal-coach/             # SUBTREE (F1) — repo del autor, sin tocar
├── coaching/                          # CREATE (F2+) — app nueva
│   ├── models.py                      # KnowledgeRule/Source/RuleTranslation (F2),
│   │                                  # Screening/ScreeningEvent/Injury (F3),
│   │                                  # DailyCheckin (F5), SetLog* (F6),
│   │                                  # WeeklyPlan (F6), WeeklyReview (F7),
│   │                                  # Tastes/Recipe/CatalogueProduct/MealPlan (F8)
│   ├── rules.py                       # MODALITY_INTENSITY, gating propio (F6)
│   ├── services.py · selectors.py · serializers.py · views.py · urls.py
│   ├── bridge/
│   │   ├── adapters.py                # to_coach_profile, weigh_ins, set_records (F3+)
│   │   ├── reasons.py                 # separa "archivo.md: \"Heading\"" del texto (F2)
│   │   └── i18n_es.py                 # catálogo de plantillas de motivos (F3)
│   ├── management/commands/load_knowledge.py   # (F2)
│   └── tests/                         # incl. test_bridge_contract.py (F3)
├── knowledge_fightlab/                # CREATE (E) — anexo de combate
│   ├── combat-sports.md · sources.md · dropped-claims.md
├── profiles/models.py                 # MODIFY (F3, F4) — perfil ampliado, pesaje
├── ai/services.py · ai/views.py       # MODIFY (F2, F3+) — tools + citas
└── activities/                        # MODIFY (E) — textos ACWR; SetLog si va aquí
frontend/
├── app/(shell)/profile/credits/page.tsx    # CREATE (F1)
├── components/evidence/                    # CREATE (F2) — chip y hoja de evidencia
├── app/onboarding/                         # MODIFY (F3) — pasos de cribado
├── app/(shell)/nutrition/…                 # MODIFY (F4, F8)
├── app/(shell)/checkin/                    # CREATE (F5)
├── app/(shell)/training/plan/, review/     # CREATE (F6, F7)
└── lib/nutrition.ts                        # MODIFY (F4) — se retira targets()
README.md                                   # MODIFY (F1) — créditos
```

`*` `SetLog` va en `coaching` solo si el trabajo de gimnasio del plan v1 (fase 3) no lo
ha creado antes en otra app. En ese caso se reutiliza.

---

## Fase 1 — Plataforma (Python 3.12 + motor vendorizado + créditos)

**Entrega:** el backend corre en 3.12, `import coach` funciona dentro de Django,
pasan las dos suites y hay una pantalla de Créditos. No cambia nada más para el
usuario.

### Task 1.1: Python 3.12 y versiones fijadas (PR propio)

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Subir la imagen base**

En `backend/Dockerfile`, cambiar `FROM python:3.11-slim` por `FROM python:3.12-slim`.

- [ ] **Step 2: Fijar Django a la LTS**

En `backend/requirements.txt`, cambiar `django>=5.0` por `Django>=5.2,<5.3`.

- [ ] **Step 3: Reconstruir y pasar la suite**

Run: `docker compose build backend && docker compose run --rm backend pytest`
Expected: todo en verde (mismos tests que en 3.11). Con un venv local: recrearlo con
3.12 y `pip install -r requirements.txt`.

- [ ] **Step 4: Comprobar migraciones**

Run: `docker compose run --rm backend python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile backend/requirements.txt
git commit -m "build: Python 3.12 y Django 5.2 LTS fijado"
```

### Task 1.2: Traer el motor con `git subtree`

**Files:**
- Create (subtree): `backend/vendor/ai-personal-coach/`
- Create: `backend/vendor/UPSTREAM.md`

- [ ] **Step 1: Añadir el subtree desde el remoto, fijado a un SHA**

```bash
git subtree add --prefix backend/vendor/ai-personal-coach \
  https://github.com/matgarfer499/ai-personal-coach 7c2f5083e3e9eef21245a23029986adb1f6907ba --squash
```

Si el remoto no acepta un SHA como ref, usar `main` y comprobar que el
`git-subtree-split` del commit de squash es `7c2f508…`.

- [ ] **Step 2: Comprobar que no ha entrado nada personal**

Run: `git ls-files backend/vendor/ai-personal-coach/data`
Expected: solo `backend/vendor/ai-personal-coach/data/.gitkeep` (o nada).

Run: `git ls-files backend/vendor/ai-personal-coach | grep -iE "\.venv|settings.local"`
Expected: sin resultados.

- [ ] **Step 3: Escribir `backend/vendor/UPSTREAM.md`**

Contenido: URL del repo; autor (matgarfer499); SHA y fecha; licencias (MIT para el
código con `LICENSE` incluido en el prefijo; CC BY 4.0 para el contenido con
`LICENSE-CONTENT.md`; las citas `Supports:` de `sources.md` no son CC BY y no se
publican); el texto de atribución con la lista de cambios de FightLab (spec §7.2); la
regla de no editar el prefijo; el procedimiento de actualización (spec §4,
"Traer las mejoras del autor"); y una sección "Parches locales" vacía.

- [ ] **Step 4: Commit**

```bash
git add backend/vendor/UPSTREAM.md
git commit -m "docs(coach): origen, licencias y actualización del motor vendorizado"
```

(El `subtree add` ya ha creado su propio commit de squash y su merge.)

### Task 1.3: Hacer importable el motor y pasar sus tests

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/pyproject.toml`
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`
- Create: `backend/coaching/tests/test_engine_import.py` (con la app vacía `coaching`
  creada con `startapp` y añadida a `INSTALLED_APPS`)

- [ ] **Step 1: Test que falla**

`test_engine_import.py`: importa `coach.safety`, `coach.energy` y `coach.knowledge`;
comprueba que `coach.knowledge.KNOWLEDGE_DIR` existe y que `rule_files()` devuelve
4 archivos; que `coach.foods.ROOT / "foods" / "base.csv"` existe; y que
`coach.safety.flags(coach.profile.Profile())` devuelve `review_before_vigorous=True`
(PAR-Q+ sin contestar).

Run: `pytest coaching/tests/test_engine_import.py -v`
Expected: FAIL con `ModuleNotFoundError: coach`.

- [ ] **Step 2: Rutas**

- `backend/pyproject.toml`, en `[tool.pytest.ini_options]`:
  `pythonpath = [".", "vendor/ai-personal-coach"]` y
  `testpaths = ["."]` con `norecursedirs = ["vendor"]`, para que la suite de
  FightLab no recoja los tests del autor por accidente.
- `backend/Dockerfile`: `ENV PYTHONPATH=/app/vendor/ai-personal-coach`.
- `backend/.env.example`: documentar `PYTHONPATH=vendor/ai-personal-coach` para el
  venv local.
- `backend/requirements.txt`: añadir `pyyaml>=6.0`.

- [ ] **Step 3: El test pasa**

Run: `pytest coaching/tests/test_engine_import.py -v`
Expected: PASS.

- [ ] **Step 4: Pasar la suite del autor tal cual**

Run: `cd vendor/ai-personal-coach && python -m pytest -p no:django -q`
Expected: verde, salvo los tests que necesiten `reportlab` (extra `pdf`) o el locale
`es_ES.UTF-8`, que se saltan o se anotan. Apuntar en `UPSTREAM.md` qué se ha saltado
y por qué. Si falla algo más, no se toca el prefijo: se investiga la causa (versión
de una dependencia o el locale) y se arregla en el entorno.

- [ ] **Step 5: Suite completa de FightLab**

Run: `pytest`
Expected: verde y sin tests del prefijo recogidos.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/pyproject.toml backend/requirements.txt backend/.env.example backend/coaching backend/core/settings.py
git commit -m "build(coach): motor importable desde Django y su suite pasa en 3.12"
```

### Task 1.4: Pantalla de Créditos y README

**Files:**
- Create: `frontend/app/(shell)/profile/credits/page.tsx`
- Modify: `frontend/app/(shell)/profile/page.tsx` (enlace "Créditos y licencias")
- Modify: `README.md`

- [ ] **Step 1:** Página estática con el texto de atribución de la spec §7.2 (coach
  de matgarfer499 con enlace, MIT y CC BY 4.0, lista de cambios, USDA FoodData
  Central, Open Food Facts (ODbL), PAR-Q+ Collaboration), y el SHA del motor y la
  fecha de la evidencia en constantes. En la fase 2 pasarán a leerse de la API.
- [ ] **Step 2:** Test de Vitest: la página muestra "matgarfer499", "CC BY 4.0" y
  "MIT".
- [ ] **Step 3:** Sección "Créditos" en `README.md` con el mismo texto.
- [ ] **Step 4: Commit** `feat(coach): pantalla de créditos y licencias del motor`.

**Aceptación de la fase 1:** imagen en 3.12; `import coach` funciona en Django; las
dos suites en verde; Créditos visible; `UPSTREAM.md` completo; ningún archivo de
`data/` en el repo.

---

## Fase 2 — Base de evidencia y citas

**Entrega:** las 459 reglas y 859 fuentes en BD, consultables por API, con un chip de
evidencia en la UI y el chat sin afirmaciones sin fuente.

### Task 2.1: Modelos `KnowledgeRule`, `KnowledgeSource`, `RuleTranslation` (TDD)
- Campos de la spec §6.7. `key` único y estable: slug de `archivo/encabezado`. Hay
  que comprobar que no hay colisiones: el test carga el índice real y verifica que las
  459 claves son únicas.
- `KnowledgeSource` **sin** la línea `Supports:`. El test lo comprueba: ninguna
  fuente cargada contiene el texto citado.

### Task 2.2: `manage.py load_knowledge` (TDD)
- Parsea con `coach.knowledge.iter_rules` y lee `sources.md` por ID.
- Es idempotente (dos ejecuciones dan 0 cambios), informa de altas, bajas y cambios,
  marca como retiradas las reglas que desaparecen y pone en `stale` las traducciones
  de las reglas cuyo texto ha cambiado (`source_hash`).
- Acepta `--dir` para cargar después `knowledge_fightlab/` con `origin=fightlab`.
- Tests con las fixtures `tests/fixtures/knowledge/good|bad` del prefijo, que son
  sintéticas.

### Task 2.3: `bridge/reasons.py` (TDD)
- `parse_reason("nutrition.md: \"Heading\": texto")` → `(rule_key, texto)`.
- Test con todos los literales `*_RULE` y `PARQ`/`BP`/… de `coach.safety`,
  `coach.energy` y `coach.zones`: todos resuelven a una `KnowledgeRule` existente.
  Si el autor renombra un encabezado, este test lo detecta.

### Task 2.4: API de lectura
- `GET /api/v1/knowledge/rules/{key}`, `GET /api/v1/knowledge/rules?q=…` (búsqueda
  por encabezado y sección) y `GET /api/v1/knowledge/sources/{sid}`.
- `GET /api/v1/coach/engine`: `{sha, knowledge_checked_on}`. La pantalla de Créditos
  pasa a leerlo de aquí.
- Solo usuarios autenticados.

### Task 2.5: Componente de evidencia en el frontend
- `components/evidence/EvidenceChip.tsx` (grado con color fijo) y `EvidenceSheet.tsx`
  (regla, "A quién se aplica", "Dónde no está claro", fuentes con DOI). Etiqueta "sin
  traducir" o "traducción automática" según el estado.
- Variante "Convención de FightLab, sin revisar" para lo que no tiene regla.
- Tests de Vitest de los tres estados de grado y de la variante de convención.

### Task 2.6: Traducción inicial
- Comando `translate_rules --lang es` que usa el LLM y guarda con `status=machine`.
  Prioridad: las reglas citadas por `safety`, `energy`, `macros`, `zones` y `trend`.
- No bloquea la fase: sin traducción se muestra el original con su etiqueta.

### Task 2.7: Chat sin afirmaciones sin fuente
- `ai/services.COACH_SYSTEM`: se quitan la línea del ACWR y cualquier umbral sin
  regla; se añade la instrucción de citar solo con `[[regla:clave]]`.
- Herramientas `search_rules` y `get_rule`. Validación en el backend de las citas
  (spec §7.4) con test: una clave inventada se quita y se registra.

**Aceptación:** `load_knowledge` carga 459 reglas y 859 fuentes; el chip abre la regla
con sus fuentes; el chat no menciona "zona segura" del ACWR; los tests de
`reasons.py` cubren todos los motivos del motor.

---

## Fase 3 — Perfil ampliado, cribado y flags de seguridad

**Entrega:** onboarding con cribado y flags calculados en el servidor por el motor.

### Task 3.1: Perfil ampliado (TDD)
- Campos de la spec §6.2 en `UserProfile`, con migración. Los valores antiguos de
  `flp_nutri_goal` (localStorage) se migran en el frontend en la primera carga:
  `perder→fat_loss`, `mantener→maintenance`, `ganar→muscle_gain`.

### Task 3.2: `Screening`, `ScreeningEvent`, `Injury` (TDD)
- Nulos por defecto. El servicio `screening_set(profile, key, value, origin)` escribe
  el evento y borra `vigorous_reviewed` si cambia una respuesta del PAR-Q+ (test).
- `Injury`: si está `cleared`, exige `cleared_on`, y `cleared_on` no puede ser
  anterior a `since` (las mismas reglas que `profile._validate_injury`).

### Task 3.3: Adaptador `to_coach_profile` (TDD)
- Spec §6.8. Tests clave:
  - Una clave nula de `Screening` no aparece en `Profile.screening`. Con el PAR-Q+ sin
    contestar sale `review_before_vigorous`.
  - `gender=OTHER` sin `equation_sex` → `sex=None`, y `energy` lanza
    `ProfileIncomplete("sex")`.
  - El peso es el último `BiometricsLog`, y se devuelve su fecha.
- `test_bridge_contract.py`: firmas de las funciones del motor que usa el puente y
  la existencia de `_validate`. Se ejecuta en cada actualización del subtree.

### Task 3.4: `GET /api/v1/coach/safety` y la puerta 409
- Devuelve flags, motivos (`rule_key`, texto en español, profesional, severidad),
  `refer_gp`, la línea de derivación literal y `emergency_number`.
- `ProfileIncomplete` → `409 {"code": "profile_incomplete", "field": …}`, con un
  manejador de excepción común en DRF.

### Task 3.5: Catálogo `i18n_es.py` (TDD)
- Plantillas para cada motivo. El test genera un perfil por fila de la tabla de flags
  de `docs/safety.md` y falla si algún motivo no tiene plantilla.

### Task 3.6: Onboarding con cribado (frontend)
- Pasos según `setup/SKILL.md`: idioma y región → SCOFF (antes del peso) → datos
  básicos (`equation_sex` solo si hace falta) → PAR-Q+ (según la respuesta a P3) →
  síntomas cardiacos (si hay alguno ahora, pantalla de parada con el número de
  emergencia) → medicación y condiciones (selector de tokens más texto libre) →
  tensión si hay hipertensión → ciclo → objetivo, experiencia, nivel de actividad,
  lesiones, disciplinas.
- Se integra con el asistente de 4 pasos del plan v1 (§1), sin hacer otro aparte.
- Banner de seguridad en el perfil y en la Home con sus motivos y chips de evidencia.
- E2E de Playwright: un perfil con SCOFF positivo ve el bloqueo del déficit y la
  línea de derivación.

**Aceptación:** una prueba de API por fila de la tabla de flags; onboarding completo;
los motivos en español con su regla.

---

## Fase 4 — Objetivos de energía, macros y zonas

**Entrega:** Nutrición y el perfil usan los objetivos del motor; se aplican los
bloqueos de pesaje y corte.

- **Task 4.1:** `GET /api/v1/coach/targets`: `energy.calorie_target` +
  `macros.macro_targets`, con reglas y notas. Usa `tdee_kcal` de la última
  `WeeklyReview` aceptada cuando exista (fase 7).
- **Task 4.2:** `GET /api/v1/coach/zones`: `zones.hr_zones` con FC de reposo y máxima
  de `BiometricsLog` si las hay.
- **Task 4.3:** Frontend de Nutrición: se retira `targets()` de `lib/nutrition.ts` y
  se consume la API. Los objetivos llevan chip de evidencia; el suelo calórico se
  explica con su regla.
- **Task 4.4:** Pesaje a BD (`goal_weight_kg`, `goal_date`, `weight_class`,
  `weigh_in_at`), con migración desde `flp_weigh`.
- **Task 4.5:** Bloqueos de la spec §8.3 sobre pesaje, cuenta atrás, distancia a la
  categoría y modo corte, **en el servidor** (los endpoints no devuelven esos datos) y
  en la UI (se ocultan). Un test por flag.

**Aceptación:** con `no_deficit` el objetivo nunca está por debajo del mantenimiento;
con `no_weight_targets` no se ve nada de pesaje; los números coinciden con los de la
CLI del motor para los mismos perfiles (test de paridad con 3 perfiles sintéticos).

---

## Fase 5 — Check-in diario y tendencia

- **Task 5.1:** `DailyCheckin` y `checkin_upsert` (rellena o pisa campo a campo y
  añade las notas). El peso y la cintura van a `BiometricsLog`. Se respetan los
  rechazos del motor: con `no_weight_targets` no se aceptan peso, cintura ni kcal.
- **Task 5.2:** Señales de alarma estructuradas (lista de `checkin/SKILL.md` paso 3)
  que escriben en `Screening` o `Injury` con su `ScreeningEvent`. Pantallas de
  "urgencia ahora" para los casos de la tabla "Red flags".
- **Task 5.3:** Preguntas semanales (ciclo, tensión), solo si no hay registro en los
  últimos 7 días.
- **Task 5.4:** `GET /api/v1/coach/trend` (`trend.weight_trend`) y su uso en
  Biometría y en la Home. La EWMA queda solo como línea de la gráfica.
- **Task 5.5:** Se une con el check-in de bienestar del plan v1 §8 (un solo
  formulario matinal) y con las reglas "Simple readiness monitoring" y "HRV is
  optional".

**Aceptación:** un síntoma cardiaco en el check-in activa `no_training` en la
siguiente llamada a `safety`; con menos de 7 pesajes en 14 días la tendencia dice
"insuficiente".

---

## Fase 6 — Fuerza y plan semanal

- **Task 6.1:** `SetLog` (o reutilizar el del plan v1), migrar desde
  `Activity.detail.exercises` cuando no esté truncado. Lo truncado se marca y no se
  inventa.
- **Task 6.2:** `adapters.set_records`. Endpoints de e1RM, series duras por músculo
  (`muscle_map.yaml`, con aviso para los ejercicios sin mapear) y progresión por
  ejercicio (`hold`/`paused` con su motivo).
- **Task 6.3:** `coaching/rules.py`: `MODALITY_INTENSITY`, con cada modalidad
  enlazada a su regla o etiquetada como convención. Tests: con
  `review_before_vigorous` el plan no contiene sparring duro, HIIT, sprints, comba,
  pliometría ni tests de 1RM; con `no_all_out_sprints` no hay SIT ni REHIT.
- **Task 6.4:** Generador de `WeeklyPlan` por reglas, siguiendo `plan/SKILL.md`
  (mínimo 2 sesiones de cuerpo completo, rotación sin recuperar sesiones perdidas,
  rangos de repeticiones, cargas del motor y nunca inventadas, cardio desde la base
  semanal y nutrición del motor). Las sesiones de MMA registradas o planificadas
  ocupan su sitio en el calendario. El LLM solo escribe `narrative` y no puede cambiar
  números (test: el plan guardado es el mismo con y sin LLM).
- **Task 6.5:** Pantalla "Plan de la semana" con reglas usadas, notas de seguridad y
  chips de evidencia. "Aplicar" escribe en Mi rutina.

**Aceptación:** los ejercicios en pausa no progresan; con `no_training` no se genera
plan; cada línea del plan lleva su regla.

---

## Fase 7 — Revisión semanal

- **Task 7.1:** `WeeklyReview` con la adherencia, `trend` y la recalibración del
  TDEE. El cambio calórico solo se propone si el ritmo está fuera del rango del
  objetivo, y el motor baja de escalón en escalón (`RECALIBRATE_STEP_KCAL`).
- **Task 7.2:** Señales de descarga (`strength.deload`) desde un formulario con las 6
  señales.
- **Task 7.3:** Aceptar las propuestas genera un `WeeklyPlan` nuevo, y el `tdee_kcal`
  aceptado lo usa la fase 4.
- **Task 7.4:** Aviso de evidencia antigua (`knowledge.stale_files`), visible solo
  para el admin, no para el atleta.

---

## Fase 8 — Menús y lista de la compra

- **Task 8.1:** Confirmar qué funciones de `mealplan`, `foods` y `cli.menu_check` son
  puras y cuáles escriben en disco. El puente solo usa las puras y la persistencia
  pasa a `MealPlan`.
- **Task 8.2:** `Tastes`, `Recipe` (con URL de origen como atribución) y
  `CatalogueProduct`.
- **Task 8.3:** Proxy de Open Food Facts con `coach.off` (un solo proxy, compartido
  con el escáner del plan v1 §7), `User-Agent` con el contacto de la app, límites de
  OFF respetados y caché. Productos `unverified` con su URL (ODbL).
- **Task 8.4:** Flujo de menú: el LLM propone platos y el motor comprueba cada día
  contra los objetivos, no repite platos, detecta alergias por nombre y hace la lista
  de la compra. Si el motor rechaza un día, no se guarda.
- **Task 8.5 (opcional):** PDF con `reportlab` (extra `pdf`).

---

## Fase 9 — Importadores (opcional)

- **Task 9.1:** Subida de CSV de Hevy, Lyfta o genérico → `coach.sessions.importers`
  → `SetLog`, con la deduplicación de `ExerciseSet.key` y el aviso de filas de
  plantilla vacías.

---

## Fase E — Anexo de evidencia de combate (en paralelo)

**Puede empezar ya:** la investigación no depende de ninguna fase de código.

- **Task E.1:** Lista de temas de la spec §9 y preguntas concretas por tema.
- **Task E.2:** Investigación con el método de `docs/research-methodology.md`
  (investigador y verificador independiente, "ábrelo o descártalo", rúbrica de
  grados, población anotada). Puede usarse el workflow `/research` del coach sobre
  una copia, nunca sobre la carpeta con `data/`.
- **Task E.3:** Escribir `backend/knowledge_fightlab/combat-sports.md`, `sources.md`
  (`[Fxxx]`) y `dropped-claims.md`. Comprobación de formato (spec §9).
- **Task E.4 (requiere F2):** `load_knowledge --dir knowledge_fightlab` con
  `origin=fightlab`.
- **Task E.5 (requiere F2 y F4):** Aplicarlo:
  - Textos del ACWR en Carga, la Home y el chat según la regla resultante (sin "zona
    segura" ni "riesgo de lesión" si la evidencia no lo sostiene).
  - Decisión sobre el PMC del plan v1 §8.
  - Corte y pesaje: contenido informativo con sus reglas.
  - Flag `no_contact` por golpe en la cabeza con su regla (sustituye a la
    convención).
  - Factores de kcal del tracker.

**Aceptación:** cada número propio de FightLab que se ve en la UI tiene una regla
`[Fxxx]` o la etiqueta "Convención de FightLab, sin revisar".

---

## Self-review checklist (done while writing — kept for the implementer)

- **Spec coverage:** matriz §3 → filas 1-2 (F3), 3-5 (F3), 6-8 (F4), 9-11 (F5),
  12 (F6), 13 (F9), 14 (F6), 15 (F7), 16-19 (F8), 20 (F2), 21-22 (E, F3),
  23-25 (E, F4), 27 (F2 y siguientes), 28 (F2, F3). Subtree y Python 3.12 (F1).
  Créditos (F1, F2). Seguridad §8 (F3, F4, F5, F6). Huecos §9 (E).
- **Fuera de alcance de este plan:** cambios en `ai-personal-coach` (van como PR al
  autor, si el usuario lo aprueba: P5), voz, multiusuario y facturación.
- **Nombres consistentes:** app `coaching`, paquete `coach`, `to_coach_profile`,
  `safety_for`, `load_knowledge`, `KnowledgeRule.key`, `MODALITY_INTENSITY`,
  `[[regla:clave]]`, prefijo `backend/vendor/ai-personal-coach/`.

## Known sequencing notes for the implementer

- F1 → F2 → F3 es la columna vertebral. F4 necesita F3. F5 y F6 pueden ir en
  paralelo después de F4 si no tocan los mismos archivos (F5: check-in y Biometría;
  F6: gimnasio y plan). F7 necesita F5 y F6. F8 solo necesita F4.
- El check-in de bienestar (v1 §8) y el asistente de onboarding (v1 §1) **no** se
  hacen aparte: se construyen dentro de F5 y F3.
- Si la fase 3 del plan v1 (gimnasio en backend) avanza antes que F6, F6 reutiliza su
  `SetLog` y solo añade el adaptador.
- Las respuestas a las preguntas P1-P7 de la spec pueden cambiar F1 (P1), F3 (P2, P3,
  P7) y E (P4, P6). Hay que tenerlas antes de escribir el plan detallado de cada una.
