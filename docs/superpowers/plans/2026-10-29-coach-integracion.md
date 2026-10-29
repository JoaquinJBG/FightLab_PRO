# Integración del coach `ai-personal-coach`: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que FightLab haga todo lo que hace el Entrenador IA (`ai-personal-coach`): cribado, objetivos de energía, macros y zonas, check-in, plan y revisión semanal, menús y compra, con cada número calculado por el motor del coach y cada recomendación citando su regla y su fuente, en español e inglés. Lo propio de FightLab (carga, MMA, pesaje) se mantiene y pasa su propia revisión de evidencia.

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
- **Nunca se edita `backend/vendor/ai-personal-coach/`.** No se mandan PRs al autor.
  Las mejoras al motor se hacen en `backend/coaching/bridge/` y se apuntan en
  `docs/coach-upstream-sugerencias.md` en el mismo PR (spec §4.1). Un parche dentro
  del prefijo solo se hace como último recurso, y se apunta en `backend/vendor/UPSTREAM.md`
  con un test que falla si se pierde.
- **Dos idiomas (es/en) desde la fase 1:** toda cadena nueva de la UI va a
  `frontend/messages/es.json` y `en.json`, y todo motivo nuevo a
  `coaching/bridge/reason_texts.py` en los dos idiomas (spec §7.5).
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
│   │   ├── reasons.py                 # motivo → {code, rule_key, params} (F2)
│   │   ├── reason_texts.py            # plantillas de motivos es/en (F3)
│   │   └── energy_athletes.py         # ten Haaf / Cunningham, U04 (F4)
│   ├── management/commands/load_knowledge.py   # (F2)
│   └── tests/                         # incl. test_bridge_contract.py (F3)
├── knowledge_fightlab/                # CREATE (E) — anexo de combate
│   ├── combat-sports.md · sources.md · dropped-claims.md
├── profiles/models.py                 # MODIFY (F3, F4) — perfil ampliado, pesaje
├── ai/services.py · ai/views.py       # MODIFY (F2, F3+) — tools + citas + idioma
├── core/settings.py                   # MODIFY (F1) — LocaleMiddleware, LANGUAGES es/en
├── core/messages.py                   # CREATE (F1) — ~20 mensajes propios es/en
└── activities/                        # MODIFY (E) — textos ACWR; SetLog si va aquí
frontend/
├── messages/es.json · messages/en.json     # CREATE (F1) — catálogos next-intl
├── i18n/request.ts                         # CREATE (F1) — idioma desde cookie
├── app/(shell)/profile/credits/page.tsx    # CREATE (F1)
├── components/evidence/                    # CREATE (F2) — chip y hoja de evidencia
├── app/onboarding/                         # MODIFY (F3) — pasos de cribado
├── app/(shell)/nutrition/…                 # MODIFY (F4, F8)
├── app/(shell)/checkin/                    # CREATE (F5)
├── app/(shell)/training/plan/, review/     # CREATE (F6, F7)
├── lib/nutrition.ts                        # MODIFY (F4) — se retira targets()
└── app/**, components/**                   # MODIFY (I) — cadenas a catálogos
docs/coach-upstream-sugerencias.md          # EXISTE (F0) — se mantiene en cada fase
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
"Traer las mejoras del autor", incluido el repaso de
`docs/coach-upstream-sugerencias.md`); y una sección "Parches locales" vacía.

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
y por qué, y cerrar `U08` en `docs/coach-upstream-sugerencias.md`: pasa a `abierta`
con la solución elegida, o a `descartada` si no hay ningún problema con el locale. Si falla algo más, no se toca el prefijo: se investiga la causa (versión
de una dependencia o el locale) y se arregla en el entorno.

- [ ] **Step 5: Suite completa de FightLab**

Run: `pytest`
Expected: verde y sin tests del prefijo recogidos.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/pyproject.toml backend/requirements.txt backend/.env.example backend/coaching backend/core/settings.py
git commit -m "build(coach): motor importable desde Django y su suite pasa en 3.12"
```

### Task 1.4: Infraestructura de idiomas (es/en)

**Files:**
- Modify: `frontend/package.json` (dependencia `next-intl`)
- Create: `frontend/i18n/request.ts`, `frontend/messages/es.json`, `frontend/messages/en.json`
- Modify: `frontend/app/layout.tsx` (proveedor de mensajes), BFF (cookie `flp_lang` y
  cabecera `Accept-Language` hacia Django)
- Modify: `backend/core/settings.py` (`LocaleMiddleware`, `LANGUAGES = [("es", …), ("en", …)]`,
  `LANGUAGE_CODE = "es"`)
- Create: `backend/core/messages.py` (catálogo es/en de los mensajes propios del backend)

- [ ] **Step 1: Test que falla (frontend):** un test de Vitest compara las claves de
  `es.json` y `en.json` (anidadas) y falla si no son iguales. Otro renderiza un
  componente con `useTranslations` en los dos idiomas.
- [ ] **Step 2:** `next-intl` **sin rutas por idioma** (las URLs no cambian y no se
  rompe la PWA instalada). El idioma sale de la cookie `flp_lang`; si no existe, del
  `Accept-Language` del navegador; y si no, `es`. Fechas y números con `Intl`.
- [ ] **Step 3: Test que falla (backend):** una petición con `Accept-Language: en` a
  un endpoint que devuelve un error de validación de DRF lo recibe en inglés, y con
  `es`, en español.
- [ ] **Step 4:** `LocaleMiddleware` y `core/messages.py`. Las ~20 cadenas propias
  (p. ej. "Formato de mensajes inválido.", "IA no configurada.") pasan al catálogo
  con su versión en inglés, con `get_language()` como selector. No hace falta
  `gettext` ni `compilemessages` en la imagen.
- [ ] **Step 5:** El BFF reenvía `Accept-Language` según la cookie. El selector de
  idioma **no se muestra** todavía (aparece al acabar la fase I).
- [ ] **Step 6: Commit** `feat(i18n): infraestructura es/en en frontend y backend`.

### Task 1.5: Pantalla de Créditos y README

**Files:**
- Create: `frontend/app/(shell)/profile/credits/page.tsx`
- Modify: `frontend/app/(shell)/profile/page.tsx` (enlace "Créditos y licencias")
- Modify: `README.md`

- [ ] **Step 1:** Página estática en los dos idiomas (claves `credits.*` en los dos
  catálogos) con el texto de atribución de la spec §7.2: el coach de matgarfer499
  con enlace, MIT y CC BY 4.0, la lista de cambios, USDA FoodData Central, Open Food
  Facts (ODbL) y PAR-Q+ (© PAR-Q+ Collaboration, versión española de Dr. Martín
  Rubio). El SHA del motor y la fecha de la evidencia van en constantes; en la fase 2
  pasan a leerse de la API.
- [ ] **Step 2:** Test de Vitest: en los dos idiomas, la página muestra
  "matgarfer499", "CC BY 4.0" y "MIT".
- [ ] **Step 3:** Sección "Créditos" en `README.md` con el mismo texto.
- [ ] **Step 4: Commit** `feat(coach): pantalla de créditos y licencias del motor`.

**Aceptación de la fase 1:** imagen en 3.12; `import coach` funciona en Django; las
dos suites en verde; infraestructura es/en con su test de claves; Créditos visible en
los dos idiomas; `UPSTREAM.md` completo; ningún archivo de `data/` en el repo.

---

## Fase I — UI existente en dos idiomas (en paralelo con las fases 2-5)

**Entrega:** toda la app en español e inglés y el selector de idioma visible.
**Depende de:** Task 1.4. **Tamaño:** unas 600-800 cadenas en ~34 archivos `.tsx`
(spec §7.5). Trabajo mecánico: solo se cambia de dónde sale el texto, no la lógica.

Un PR por zona. Cada PR toca **solo** las vistas de su zona, para no chocar con las
fases 2-5:

- **Task I.1:** auth (`login`, `register`, `verify-email`) y `onboarding` (si la
  fase 3 está tocando el onboarding, se hace dentro de la fase 3).
- **Task I.2:** Home (`dashboard`) y Biometría.
- **Task I.3:** Entrenamiento (`training`: deportes, MMA, herramientas, gimnasio, Mi
  rutina, carga).
- **Task I.4:** Nutrición, Coach y perfil. Al acabar este PR, se muestra el selector
  de idioma en el perfil (escribe `profile.language` y la cookie).

En cada PR:

- [ ] Extraer las cadenas a `messages/es.json` con claves por vista
  (`nutrition.add.quickAdd`…).
- [ ] Inglés: primer borrador con el LLM y repaso a mano. El test de claves debe
  pasar.
- [ ] Las cadenas con datos (`"a {kg} kg de la categoría"`) usan los parámetros de
  ICU, no se construyen concatenando texto.
- [ ] Test de Vitest o E2E: la vista se renderiza en `en` sin claves en crudo.
- [ ] Commit `feat(i18n): <zona> en es/en`.

**Aceptación:** con `language=en` ninguna vista muestra español (salvo el texto del
usuario y los nombres de alimentos); el test de claves pasa; el selector funciona.

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
- `parse_reason("nutrition.md: \"Heading\": texto")` → `Reason(code, rule_key, params,
  original_text)`. `code` se deduce de la regla y de patrones del texto; `params`
  extrae los valores interpolados (lectura de tensión, zona, kcal). Es la parte de
  FightLab de `U03`: el mismo PR marca `U03` como `abierta` en
  `docs/coach-upstream-sugerencias.md`.
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
  (regla, "A quién se aplica", "Dónde no está claro", fuentes con DOI), con los
  textos fijos en los dos catálogos. En `en` se muestra el original. En `es` se
  muestra la traducción con la etiqueta "traducción automática" mientras no esté
  revisada, o el original con "sin traducir" si aún no hay traducción.
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
- El prompt recibe el idioma del usuario (`profile.language`) y responde en él. El
  prompt base se escribe una vez, en inglés, con la instrucción de idioma. Test: con
  `en` la respuesta simulada del cliente lleva la instrucción de idioma correcta.

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
- `language`: al registrarse se toma de `Accept-Language` (`es` si no encaja). Al
  guardarlo se actualiza la cookie `flp_lang` del BFF.

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
    `ProfileIncomplete("sex")`. Decidido (P7): la API de objetivos responde 409 con
    `field=equation_sex`, y la UI explica que no hay objetivos calóricos hasta elegirlo,
    sin bloquear el resto.
  - El peso es el último `BiometricsLog`, y se devuelve su fecha.
- `test_bridge_contract.py`: firmas de las funciones del motor que usa el puente y
  la existencia de `_validate`. Se ejecuta en cada actualización del subtree.

### Task 3.4: `GET /api/v1/coach/safety` y la puerta 409
- Devuelve flags, motivos (`code`, `rule_key`, `params`, texto en el idioma de la
  petición, profesional, severidad), `refer_gp`, la línea de derivación literal en es
  o en (de `docs/safety.md`) y `emergency_number`.
- `ProfileIncomplete` → `409 {"code": "profile_incomplete", "field": …}`, con un
  manejador de excepción común en DRF.

### Task 3.5: Catálogo `reason_texts.py` (es/en) (TDD)
- Una plantilla por `code` y por idioma. En `en` se reproduce el texto original del
  motor. El test genera un perfil por fila de la tabla de flags de `docs/safety.md` y
  falla si algún motivo no tiene plantilla en alguno de los dos idiomas.

### Task 3.6: Onboarding con cribado (frontend, es/en)
- Pasos según `setup/SKILL.md`: idioma y región → SCOFF (antes del peso) → datos
  básicos (`equation_sex` solo si hace falta) → PAR-Q+ guiado (abajo) → síntomas
  cardiacos (si hay alguno ahora, pantalla de parada con el número de emergencia) →
  medicación y condiciones (selector de tokens más texto libre) → tensión si hay
  hipertensión → ciclo → objetivo, experiencia, nivel de actividad, lesiones,
  disciplinas.
- **PAR-Q+ (spec §8.1):** pantalla con una frase de para qué sirve y un botón que abre
  el formulario oficial de eparmedx.com en el idioma del usuario, en una pestaña
  nueva. Las URLs van en configuración (`PARQ_URL_ES`, `PARQ_URL_EN`); no se copia ni
  se incrusta el formulario. Al volver: "¿Algún SÍ en las 7 preguntas generales?" →
  sí / no / no lo sé. Si es sí: "¿Algún SÍ en las de seguimiento?" → sí / no / no lo
  sé. "No lo sé" deja el campo nulo (el motor lo trata como no contestado: solo
  trabajo ligero o moderado) y la Home recuerda completarlo. Con algún SÍ o 45 años o
  más, la pregunta de `vigorous_reviewed`.
- Flag `PARQ_NATIVE_FORM=False`. Solo se activa si llega un permiso escrito de la
  PAR-Q+ Collaboration (spec §12, A1). No se construye el formulario nativo hasta
  entonces.
- Se integra con el asistente de 4 pasos del plan v1 (§1), sin hacer otro aparte.
- Banner de seguridad en el perfil y en la Home con sus motivos y chips de evidencia.
- E2E de Playwright: un perfil con SCOFF positivo ve el bloqueo del déficit y la
  línea de derivación.

**Aceptación:** una prueba de API por fila de la tabla de flags; onboarding completo
en los dos idiomas; los motivos en es y en con su regla; el PAR-Q+ nunca aparece
copiado dentro de la app.

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
- **Task 4.6 (U04):** `bridge/energy_athletes.py`, con ten Haaf o Cunningham cuando
  hay masa magra fiable (`body_fat_pct` reciente). El RMR resultante se pasa al motor
  como `tdee_kcal` (RMR × PAL del motor), así los suelos y bloqueos de
  `calorie_target` se siguen aplicando. Cita "Trained clients: Cunningham or ten Haaf"
  y "Body-fat measurement error carries into RMR". El usuario ve qué ecuación se ha
  usado. `U04` pasa a `abierta`.
- **Task 4.7 (U06):** con `no_training`, el puente calcula con el PAL de `desk`,
  etiquetado como convención de FightLab. `U06` pasa a `abierta`.

**Aceptación:** con `no_deficit` el objetivo nunca está por debajo del mantenimiento;
con `no_weight_targets` no se ve nada de pesaje; sin `equation_sex` no hay objetivos
calóricos (P7); los números coinciden con los de la CLI del motor para 3 perfiles
sintéticos sin ecuación de atletas ni `no_training` (test de paridad). Cuando
intervienen U04 o U06, los tests comprueban la diferencia esperada.

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
  pliometría ni tests de 1RM; con `no_all_out_sprints` no hay SIT ni REHIT. Si el
  anexo E ya tiene la regla, la clasificación del sparring la usa; si no, se etiqueta
  como convención. `U05` pasa a `abierta`.
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
  pasa a `MealPlan`. Se actualiza `U07` (se confirma o se descarta).
- Nombres de alimentos en el idioma del usuario: la tabla del motor ya tiene nombre
  en inglés y en español.
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

## Fase E — Anexo de evidencia de combate (arranca con la fase 1)

**Cuándo (decidido, P6):** E.1-E.3 empiezan **a la vez que la fase 1**, en su propia
rama (`docs/coach-anexo-combate`), porque no dependen de código. **Fecha límite
blanda:** antes de empezar la fase 4. Si no se llega, F4 y F6 salen con la etiqueta
"Convención de FightLab, sin revisar" y se actualizan cuando llegue E.5.

**Dónde se queda (P4):** solo en FightLab. No se le propone al autor. Licencia: la
del repo de FightLab (hoy sin `LICENSE`, todos los derechos reservados; spec §12, A2).

- **Task E.1:** Lista de temas de la spec §9 y preguntas concretas por tema. Prioridad:
  1) ACWR (el texto ya está en producción), 2) corte y pesaje, 3) conmoción en
  sparring, 4) intensidad del sparring (para `MODALITY_INTENSITY`), 5) sRPE,
  monotonía y PMC, 6) gasto energético y PAL.
- **Task E.2:** Investigación con el método de `docs/research-methodology.md`
  (investigador y verificador independiente, "ábrelo o descártalo", rúbrica de
  grados, población anotada). Puede usarse el workflow `/research` del coach sobre
  una copia limpia, nunca sobre la carpeta con `data/`, y el resultado no vuelve al
  repo del autor.
- **Task E.3:** Escribir `backend/knowledge_fightlab/combat-sports.md`, `sources.md`
  (`[Fxxx]`) y `dropped-claims.md`. Formato comprobado con
  `scripts/check_knowledge.py --knowledge-dir backend/knowledge_fightlab` del prefijo
  (o un test propio si sus comprobaciones del índice no encajan). La redacción va en
  inglés, como las reglas del coach, para que el mismo cargador y el mismo sistema
  de traducción (`RuleTranslation` es) sirvan sin cambios.
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
  Créditos (F1, F2). Seguridad §8 (F3, F4, F5, F6). Huecos §9 (E). Idiomas §7.5
  (F1, I, y cada fase). PAR-Q+ §8.1 (F3). Lista para el autor §4.1 (U01-U08,
  repartidas en F1-F8).
- **Fuera de alcance de este plan:** cambios en `ai-personal-coach` y PRs al autor
  (P5: las mejoras se hacen en FightLab y se apuntan en
  `docs/coach-upstream-sugerencias.md`), voz, multiusuario y facturación.
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
- La fase I va en paralelo con F2-F5. Cada PR de I toca solo las vistas de su zona.
  Si una fase está cambiando una vista (p. ej. F3 el onboarding o F4 Nutrición), la
  extracción de esa vista se hace dentro de esa fase y no en I.
- La fase E arranca con F1, en su propia rama. Sus resultados entran en F4 (corte y
  pesaje), F6 (sparring) y E.5.
- P1-P7 están respondidas (spec §12). Quedan abiertas A1 (permiso del PAR-Q+) y A2
  (licencia del repo), y ninguna bloquea una fase.
- Cada PR que toque una mejora `Uxx` actualiza `docs/coach-upstream-sugerencias.md`.
