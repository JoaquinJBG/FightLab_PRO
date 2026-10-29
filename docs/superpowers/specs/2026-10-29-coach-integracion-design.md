# Integración del coach `ai-personal-coach` en FightLab Pro

> Fecha: 2026-10-29 · Estado: aprobada con las respuestas del usuario a P1-P7 (§12) ·
> Fase 0, solo diseño · Tipo: spec transversal
> Depende de: [`2026-06-01-fightlab-pro-vision-design.md`](2026-06-01-fightlab-pro-vision-design.md),
> [`2026-06-11-v1-plan-mejora-por-vista.md`](2026-06-11-v1-plan-mejora-por-vista.md)
> Plan: [`../plans/2026-10-29-coach-integracion.md`](../plans/2026-10-29-coach-integracion.md) ·
> Lista para el autor: [`../../coach-upstream-sugerencias.md`](../../coach-upstream-sugerencias.md)

FightLab tiene que hacer, como mínimo, todo lo que hace el Entrenador IA
(`ai-personal-coach`, de matgarfer499, con permiso del autor): nutrición, plan de
entrenamiento, check-in y revisión semanal, menús, cribado de seguridad, y todo con
evidencia citada. Esta spec decide cómo entra ese proyecto en FightLab y en qué
fases. No incluye código de producto.

---

## 1. Qué es `ai-personal-coach`, medido

Leído en el commit `7c2f5083e3e9eef21245a23029986adb1f6907ba` (2026-10-26). No se ha
abierto `data/`.

| Pieza | Qué hay | Dato |
|---|---|---|
| `coach/` | Paquete Python: cálculo y CLI | ~5.000 líneas en 29 archivos `.py`; `cli.py` ocupa 984. Única dependencia: `pyyaml` (`reportlab` opcional para el PDF) |
| `tests/` | pytest | 28 archivos de test, más fixtures sintéticas y tests que validan las skills y los docs |
| `knowledge/` | Base de evidencia | 4 archivos de reglas (`strength-hypertrophy`, `cardio-health`, `nutrition`, `recovery-habits`), más `index.md` y `sources.md`: **459 reglas** (92 + 126 + 137 + 104) y **859 fuentes** |
| `foods/`, `regions/es/` | Tablas de alimentos | 154 alimentos genéricos (USDA, dominio público) y 17 españoles; la región `es` aporta el 112 |
| `.claude/skills/` | La conversación | 7 skills: `setup`, `checkin`, `import`, `plan`, `review`, `menu`, `research` (~1.040 líneas) |
| `docs/` | Seguridad, método, convenciones | `safety.md`, `research-methodology.md`, `conventions.md`, `dropped-claims.md` |

### Correcciones al enfoque de partida

El enfoque inicial era correcto en lo esencial. Al leer el código salen siete datos
que cambian el diseño:

1. **No son 6 archivos de reglas, son 4.** Los otros dos son el índice y la lista de
   fuentes.
2. **El coach hace más que lo que se pensaba.** Además de `energy`, `macros`,
   `safety`, `zones`, `trend` y `strength`, trae `mealplan`, `recipes`, `tastes`,
   `foods`, `catalogue`, `regions`, `off` (Open Food Facts), `export` (PDF) e
   importadores de Hevy, Lyfta y CSV genérico. La matriz (§3) los cubre todos.
3. **Rutas relativas al repo.** `coach/knowledge.py` y `coach/foods.py` buscan
   `knowledge/`, `foods/` y `regions/` en `Path(__file__).parent.parent`. El wheel
   (`hatch`, `packages = ["coach"]`) solo empaqueta `coach/`. **Instalarlo con
   `pip install git+…` lo rompe**: faltarían la evidencia y los alimentos. Hay que
   meter el repo entero con su estructura de carpetas (§4).
4. **El sexo solo admite `female` y `male`.** Las ecuaciones y los suelos calóricos
   solo están definidos para esos dos. `UserProfile.gender` de FightLab tiene `OTHER`
   y puede ser nulo. Hace falta un campo aparte (§6.2).
5. **Los textos salen en inglés.** Los motivos de `safety.flags`, las notas de
   `energy` y los nombres de las reglas están en inglés y llevan el formato
   `nutrition.md: "Heading": texto`. FightLab va a tener español e inglés (P2). Para el
   inglés el texto ya existe; para el español hace falta una capa de traducción con
   clave de regla (§7.3).
6. **Varias protecciones son texto de skill, no código.** `docs/safety.md` ("What
   protects what") lo dice: hacer las preguntas del cribado, detectar señales de
   alarma en la conversación y dejar fuera del plan el trabajo vigoroso (HIIT,
   sprints, comba, pliometría) depende de que el modelo obedezca. En una app con
   formularios esto pasa a código, y es una mejora (§8).
7. **La población del coach no es la de FightLab.** `research-methodology.md`: "Not
   elite athletes". No hay ni una regla sobre ACWR, sRPE, deportes de combate, corte
   de peso ni conmociones (búsqueda en los 4 archivos: 0 resultados). Sí hay reglas
   útiles para FightLab que el código todavía no usa: ecuaciones de RMR para atletas
   (`nutrition.md` "Trained clients: Cunningham or ten Haaf"), "Carbohydrate by
   training load", "Simple readiness monitoring", "HRV is optional" y "REDs: red
   flags and referral" (§9).

### Licencias

- **MIT** para el código (`coach/`, `scripts/`, `tests/`, `.github/`,
  `.claude/workflows/`). Hay que conservar `LICENSE` con el copyright de matgarfer499.
- **CC BY 4.0** para `knowledge/`, `docs/`, el texto de las skills, `assets/` y el
  resto de textos. Atribución pedida: *"AI personal coach by matgarfer499
  (https://github.com/matgarfer499/ai-personal-coach), CC BY 4.0"*, **indicando los
  cambios hechos**. Traducir las reglas al español es un cambio y hay que decirlo.
- **Excepción importante:** las citas textuales de las líneas `Supports:` de
  `knowledge/sources.md` son de las editoriales y **no** están bajo CC BY 4.0.
  FightLab no las muestra en la UI ni las devuelve en la API. Solo muestra la
  referencia bibliográfica (autores, año, título, revista, DOI o URL).
- Alimentos: USDA FoodData Central, dominio público, con cita a USDA. Productos de
  Open Food Facts: ODbL, cada fila guarda su URL.
- **PAR-Q+:** el coach no redistribuye el formulario (`forms/README.md`) y prohíbe
  reformularlo, abreviarlo o traducirlo. El PDF oficial en español dice "Copyright ©
  PAR-Q+ Collaboration", lleva el crédito del traductor (Dr. Martín Rubio) y solo
  concede esto: *"Le animamos a fotocopiar el PAR-Q+"*, con la condición de usar el
  cuestionario entero y sin cambios. Eso permite fotocopiarlo en papel, pero
  no da licencia para reproducir el texto dentro de una app. Decisión en §8.1.
- **Contenido propio de FightLab** (el anexo de combate de §9, las traducciones al
  español de reglas y mensajes, y los textos de la app): sigue la licencia del repo
  de FightLab. Hoy el repo no tiene `LICENSE`, así que es "todos los derechos
  reservados" del propietario. El anexo no se manda al repo del autor (P4). Las
  traducciones de reglas del coach son obra derivada de contenido CC BY 4.0, así
  que conservan la atribución y la nota de cambios aunque estén en un repo cerrado
  (CC BY lo permite). Si un día FightLab elige licencia, el anexo pasa a tenerla.

---

## 2. Decisión: mezcla (integrar el motor y la evidencia, rehacer la conversación)

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **Rehacer desde cero** en FightLab | Todo en un solo estilo y en español | Reescribir ~5.000 líneas y 28 archivos de tests, y volver a enlazar 459 reglas a cada constante. Se pierden las mejoras futuras del autor. Es justo lo que hace valioso al coach: cada número sale de código probado | Descartada |
| **Meterlo tal cual** (CLI y skills) | Cero trabajo de adaptación | Las skills necesitan Claude Code y no corren en una web. La persistencia en YAML y CSV de `data/` es de un solo usuario y no sirve para PostgreSQL multiusuario. Lanzar la CLI en un subproceso por petición sería lento y frágil | Descartada |
| **Mezcla** | Reutiliza el núcleo probado y la evidencia, y la UI y los datos quedan nativos de FightLab | Hay que escribir un adaptador y una capa de traducción | **Elegida** |

En concreto:

1. **Motor (`coach/`) como librería sin modificar**, llamada en el mismo proceso
   desde una app Django nueva, `coaching`, a través de un *puente*
   (`coaching/bridge/`). El puente solo usa funciones puras: nunca la CLI ni las
   funciones de E/S (`load_profile`, `save_profile`, `append_checkin`,
   `sessions.store`, `tastes`/`recipes`/`catalogue` en disco).
2. **Evidencia (`knowledge/`) como datos.** Un comando de gestión la carga en
   PostgreSQL y alimenta las citas de la API, la UI y el chat.
3. **Skills como especificación.** Cada `SKILL.md` se convierte en un flujo de la
   app (formularios y pantallas) más servicios deterministas. El LLM solo redacta y
   conversa, y los números siempre salen del motor.
4. **Lo propio de FightLab se queda:** motor de carga sRPE/ACWR
   (`backend/activities/selectors.py`), sesiones de MMA, timer, deportes, pesaje y
   foto→kcal. Para cumplir "todo con evidencia", estas partes pasan su propia
   revisión con el método del coach (§9).

---

## 3. Matriz función por función

Leyenda: **Reutilizar** = se llama al código del coach sin cambios. **Adaptar** =
código del coach más un adaptador o modelo nuevo en FightLab. **Rehacer** = se
reescribe como flujo de la app con la skill como especificación. **Propio** = solo
existe en FightLab. **Fuera** = no entra.

| # | Función | En el coach | En FightLab hoy | Decisión | Notas |
|---|---|---|---|---|---|
| 1 | Datos básicos (sexo, nacimiento, altura, peso) | `profile.Profile` | `UserProfile` (`gender` con `OTHER`, sin peso; el peso está en `BiometricsLog`) | Adaptar | Campo nuevo `equation_sex`; el peso es la última medida de `BiometricsLog` (§6.2) |
| 2 | Objetivo, experiencia, nivel de actividad, idioma, región, nº de emergencia | `profile` (enums `GOALS`, `EXPERIENCE`, `ACTIVITY_LEVELS`) | No existen (el plan v1 pedía `goal`, `experience_level`, `disciplines`, `training_frequency`) | Adaptar | Se usan los enums del coach. `disciplines` y la frecuencia son propios de FightLab |
| 3 | Cribado: SCOFF, PAR-Q+, síntomas cardiacos, tensión, ciclo, medicación y condiciones | Skill `setup` + `profile.SCREENING_KEYS` | No existe | Rehacer el flujo y reutilizar las claves | Onboarding con pasos de cribado (§8.1) |
| 4 | Lesiones (zona, desde, profesional, alta, ejercicios afectados) | `profile.injuries` + `strength.find_pause` | Flag "lesión/golpe" previsto en sesión de MMA (plan v1 §5) | Adaptar | Modelo `Injury`; el flag de MMA crea una lesión activa sin evaluar |
| 5 | Flags de seguridad | `safety.flags()` | No existe | **Reutilizar** | Una sola fuente de verdad (§8) |
| 6 | RMR, TDEE y kcal objetivo, con suelos y bloqueos | `energy` | `frontend/lib/nutrition.ts`: Mifflin × 1,55 fijo, −500/+300, sin suelos ni bloqueos | **Reutilizar** | Sustituye al cálculo del frontend. Es una mejora de seguridad directa |
| 7 | Macros (proteína por g/kg según caso, grasa, carbohidratos, fibra) | `macros` | `targets()` en el frontend | **Reutilizar** | |
| 8 | Zonas de FC y RPE (ACSM, Tanaka, betabloqueantes, embarazo) | `zones` | No existe | **Reutilizar** | FC de reposo y máxima salen de `BiometricsLog` si las hay |
| 9 | Tendencia de peso y recalibración del TDEE | `trend` (medias semanales, mín. 7 pesajes en 14 días, recalibra a los 28) | Gráfica EWMA en Biometría (solo visual) | **Reutilizar** para decidir | La EWMA se queda como gráfica. El ritmo semanal que se muestra y que decide sale de `trend` |
| 10 | Check-in diario (peso, cintura, ingesta, sueño, notas) | `checkins` + skill `checkin` | `BiometricsLog` (peso, cintura, FC reposo, VFC, sueño 1-10); check-in de bienestar previsto en v1 §8 | Adaptar | Peso y cintura siguen en `BiometricsLog`; lo demás va a `DailyCheckin` (§6.4) |
| 11 | Señales de alarma en el check-in y preguntas semanales (ciclo, tensión) | Texto de la skill `checkin` | No existe | Rehacer en código | Preguntas estructuradas que escriben en `Screening` |
| 12 | e1RM, series duras por músculo, progresión doble, pausa por lesión, descarga | `strength` + `muscle_map.yaml` | Gimnasio: series dentro de `Activity.detail` (JSON que se trunca a 8.000 caracteres) | Reutilizar sobre `SetLog` | Necesita series estructuradas (modelo `SetLog`, §6.5) |
| 13 | Importar Hevy, Lyfta y CSV | `sessions/importers` | No existe | Reutilizar | Fase opcional. `ExerciseSet` → `SetLog` |
| 14 | Plan semanal (fuerza, cardio, nutrición, notas de seguridad, reglas usadas) | Skill `plan` | Mi rutina fija en el código; asistente de rutinas con `setTimeout` | Rehacer | Generador por reglas y el LLM solo redacta (§6.6) |
| 15 | Revisión semanal (adherencia, ritmo, recalibración, descarga, propuestas) | Skill `review` | No existe | Rehacer | Las propuestas aceptadas generan un plan nuevo |
| 16 | Menús, comprobación contra objetivos, no repetir, lista de la compra | `mealplan`, `foods`, `cli.menu_check` | Nutrición en localStorage con 15 alimentos de ejemplo | Reutilizar el cálculo y rehacer el flujo | |
| 17 | Gustos, alergias, valoraciones y recetario | `tastes`, `recipes` | No existe | Adaptar | Se guardan en BD; las alergias se cruzan por nombre (es una red, no una garantía) |
| 18 | Productos del súper (Open Food Facts) | `off`, `catalogue` | Escáner y proxy de OFF previstos en v1 §7 | Reutilizar | Un solo proxy en el servidor. El `User-Agent` lleva el contacto de la app, nunca el del usuario |
| 19 | Exportar menú a PDF con QR | `export` (`reportlab`) | No existe | Reutilizar (opcional) | Fase tardía |
| 20 | Base de evidencia con grados y fuentes | `knowledge/` + `knowledge.py` | Ninguna. El prompt del chat afirma "ACWR zona segura 0.8–1.3" sin fuente | **Reutilizar como datos** | §7 |
| 21 | `/research` (actualizar la evidencia con agentes) | Skill + workflow de Claude Code | No existe | Fuera de la app | Se usa como proceso offline para el anexo de combate (§9) |
| 22 | Línea de derivación y número de emergencia | `docs/safety.md`, `safety.emergency_number` | Aviso genérico de IA | Reutilizar | Texto en español copiado literal, con atribución |
| 23 | Carga sRPE, ACWR, monotonía y tensión | No existe | `activities/selectors.load_metrics` | Propio | Necesita revisión de evidencia; el ACWR está discutido (§9) |
| 24 | Sesiones de MMA, timer, deportes en vivo | No existe | Sí | Propio | Las sesiones de combate cuentan como días de entreno en el plan |
| 25 | Categoría de peso, pesaje, corte | No existe (sí hay reglas de pérdida rápida y REDs) | Pesaje en localStorage (`flp_weigh`) | Propio, con bloqueos del coach | `no_weight_targets` oculta el pesaje y el corte (§8.3) |
| 26 | Foto→kcal | No existe | `ai/services.food_photo_analyze` | Propio | Sin cambios |
| 27 | Chat del coach | La conversación es Claude Code | `ai/services.coach_chat` con un contexto pequeño | Adaptar | Con herramientas que llaman al puente y citas validadas (§7.4) |
| 28 | Idiomas | es y en | Solo es, con los textos escritos en el código | Adaptar | ES y EN desde la fase 1 (§7.5); traducción con clave de regla (§7.3) |

---

## 4. Cómo entra el código

### Opciones

| Opción | A favor | En contra |
|---|---|---|
| **A. Copia** en `backend/vendor/` con `LICENSE` y un archivo con el commit de origen | La más simple de entender | Traer mejoras es un diff a mano y es fácil que la copia se desvíe en silencio |
| **B. `git subtree add --squash`** en `backend/vendor/ai-personal-coach/` | Repo entero con su estructura (las rutas relativas funcionan). El commit de squash guarda el SHA de origen (`git-subtree-split`). `git subtree pull` trae mejoras y las fusiona. Quien clona no necesita nada especial y el contexto de Docker lo incluye | Comandos menos conocidos. Si se edita dentro del prefijo, cada pull puede tener conflictos |
| **C. Dependencia de git** (`coach @ git+https://…@SHA`) | Lo más limpio en `requirements.txt` | **No funciona tal cual:** el wheel no incluye `knowledge/`, `foods/` ni `regions/` (§1, punto 3). Además necesita que el repo sea alcanzable en cada build y cualquier parche obliga a un fork |
| D. Submódulo | Historia separada | Complica Docker, los clones y OneDrive. Descartada sin más |

### Decisión cerrada: B (subtree con squash), con una regla

El usuario dejó la elección a criterio técnico (P1). Se elige B por tres motivos:

1. Es la única opción que conserva la estructura del repo sin trabajo extra. La C no
   funciona y la A obliga a recrear esa estructura a mano.
2. Las mejoras del autor llegan con un comando, y el SHA de origen queda escrito en
   el historial.
3. Las mejoras propias se hacen en la capa adaptadora y no en el prefijo (ver más
   abajo), así que los pulls no deberían tener conflictos. La única ventaja real de A
   era su sencillez, y no compensa tener que traer las mejoras a mano.

- Prefijo: `backend/vendor/ai-personal-coach/`, desde
  `https://github.com/matgarfer499/ai-personal-coach`, rama `main`, fijado a un SHA.
  Primer SHA: `7c2f508`.
- **Se trae siempre del remoto y nunca de la carpeta local**
  `entrenador IA/ai-personal-coach`. En esa carpeta, `data/` tiene datos personales
  (git los ignora, pero la carpeta los tiene). Tras el `subtree add` se comprueba que
  `git ls-files backend/vendor/ai-personal-coach/data` solo lista `.gitkeep`.
- **Regla: no se edita nada dentro del prefijo.** Toda la adaptación y toda mejora
  del motor viven en `backend/coaching/` (sobre todo en `coaching/bridge/`). No se
  mandan PRs al autor (P5): las mejoras se hacen en FightLab y se apuntan en una lista
  para comentárselas más adelante (§4.1).
- `backend/vendor/UPSTREAM.md` (fuera del prefijo): URL, SHA actual, fecha, licencias,
  parches locales y el procedimiento de actualización.

### 4.1 Mejoras propias al motor y la lista para el autor

**Dónde se hace cada mejora:**

| Dónde | Cuándo | Qué pasa al traer actualizaciones |
|---|---|---|
| **Capa adaptadora** (`coaching/bridge/`): envolver, completar o sustituir una función del motor sin tocarla. Por ejemplo, ecuaciones de RMR para atletas en `bridge/energy_athletes.py`, motivos estructurados en `bridge/reasons.py` o la tabla de modalidades en `coaching/rules.py` | **Siempre que se pueda**, que es casi siempre: el motor son funciones puras y se pueden envolver | `subtree pull` sin conflictos. Si el autor adopta la mejora, el test de contrato o el de paridad lo detecta, se borra nuestro código y se usa el suyo |
| **Parche dentro del prefijo** | Solo para un fallo de seguridad o de cálculo que no se pueda envolver (por ejemplo, una constante equivocada dentro de una función que el puente necesita) | Cada `subtree pull` puede dar conflicto en esas líneas y hay que volver a aplicarlo a mano. Por eso cada parche va en `UPSTREAM.md` (archivo, motivo, commit) y tiene un test en `coaching/tests/` que falla si se pierde |

**La lista para el autor** vive en
[`docs/coach-upstream-sugerencias.md`](../../coach-upstream-sugerencias.md). Cada
entrada lleva:

- ID (`U01`, `U02`…), módulo del motor y problema.
- Cómo lo resuelve FightLab: archivo y si es adaptador o parche.
- Qué se le propondría al autor.
- Estado: `abierta`, `comunicada` o `adoptada en <sha>`.

La lista se actualiza en el mismo PR que introduce la mejora. Al hacer
`subtree pull`, se revisa: las entradas adoptadas se cierran y se borra el código
equivalente de FightLab. `UPSTREAM.md` guarda el detalle técnico (SHA y parches);
la lista guarda lo que hay que contarle al autor. La lista ya tiene las mejoras
detectadas al escribir esta spec (U01-U08).
- **Importación:** `PYTHONPATH=/app/vendor/ai-personal-coach` en el Dockerfile, y
  `pythonpath = [".", "vendor/ai-personal-coach"]` en `backend/pyproject.toml`
  (pytest). Para el venv local, la misma variable en `.env.example`. No se hace
  `pip install` del paquete: copiaría `coach/` a `site-packages` y rompería las rutas
  relativas.
- **Nombre:** el paquete se llama `coach`. Ninguna app de Django de FightLab puede
  llamarse `coach`; la nueva se llama `coaching`.
- `pyyaml` se añade a `backend/requirements.txt`. `reportlab` solo cuando llegue el
  PDF.

### Traer las mejoras del autor

1. Rama `chore/coach-upstream-<sha-corto>` desde `staging`.
2. `git subtree pull --prefix backend/vendor/ai-personal-coach <url> main --squash`.
3. Pasar los tests del autor (`pytest backend/vendor/ai-personal-coach/tests`), los
   tests de contrato del puente (`backend/coaching/tests/test_bridge_contract.py`) y
   el resto de la suite.
4. `python manage.py load_knowledge`: informa de reglas nuevas, cambiadas o
   eliminadas y marca como "pendiente de revisar" las traducciones de las reglas que
   han cambiado.
5. Si hay parches locales, volver a aplicarlos y pasar sus tests.
6. Revisar `docs/coach-upstream-sugerencias.md`: cerrar lo adoptado y quitar nuestro
   código equivalente.
7. Actualizar `UPSTREAM.md` (SHA y fecha). PR a `staging` y luego promoción a `main`.

Cadencia: cuando el autor avise o una vez al mes. Si un pull rompe el contrato del
puente, se arregla en el puente y nunca en el prefijo.

---

## 5. Python 3.11 → 3.12

- **Por qué:** `pyproject.toml` del coach declara `requires-python = ">=3.12"` y su
  CI solo prueba 3.12. Buscando sintaxis exclusiva de 3.12 (`type X =`, genéricos
  PEP 695, `itertools.batched`, `@override`) no aparece nada, así que quizá
  funcionaría en 3.11. Pero el contrato del autor es 3.12 y no conviene depender de
  algo que no prueba.
- **Cambio:** `backend/Dockerfile` de `python:3.11-slim` a `python:3.12-slim`; el
  venv local, a 3.12.
- **Riesgo bajo:** Django 5.2 LTS, DRF, simplejwt, psycopg2-binary, Pillow y anthropic
  tienen wheels para 3.12. Se aprovecha para fijar versiones: hoy `requirements.txt`
  pone `django>=5.0` sin límite superior, y conviene fijar `Django>=5.2,<5.3`.
- Va en un PR propio, el primero, sin más cambios, para que si algo falla se sepa que
  es por la versión.

---

## 6. Modelo de datos

App nueva `backend/coaching/` (anatomía de siempre: `models`, `services`,
`selectors`, `serializers`, `views`, `urls`, `tests/`) más `coaching/bridge/`.

### 6.1 Principio

Los modelos guardan **lo mismo que guarda el coach, con la misma semántica**. Sobre
todo: *pregunta sin contestar* ≠ *contestada con NO*. El coach trata la ausencia de
`parq_any_yes` como "PAR-Q+ no contestado" y eso activa `review_before_vigorous`.
Por eso los campos del cribado son nulos por defecto, y el adaptador omite los nulos
en lugar de convertirlos en `False`.

### 6.2 Perfil ampliado (`profiles.UserProfile`)

Campos nuevos:

| Campo | Tipo | Origen |
|---|---|---|
| `equation_sex` | `female`/`male`/null | Se pregunta solo si `gender` es `OTHER` o nulo, explicando para qué sirve (las ecuaciones solo existen para esos dos). **Decidido (P7):** si queda nulo, no hay objetivos calóricos ni de macros, igual que en el coach. La UI lo explica y ofrece elegirlo más tarde; zonas, plan y check-in funcionan igual |
| `goal` | `fat_loss`/`maintenance`/`muscle_gain`/`recomposition` | `profile.GOALS`. Sustituye a `flp_nutri_goal` (`perder`/`mantener`/`ganar`) |
| `experience` | `novice`/`intermediate`/`advanced` | `profile.EXPERIENCE`, con la convención de los 12 meses |
| `activity_level` | `desk`/`desk_training`/`active` | `profile.ACTIVITY_LEVELS` |
| `language` | `es`/`en` | Al registrarse se toma del navegador (`Accept-Language`) y, si no encaja, `es`. Se puede cambiar en el perfil. Decide el idioma de la UI, de la API y del chat (§7.5) |
| `region` | `es`/null | Solo regiones con carpeta en el motor |
| `emergency_number` | 2 a 6 dígitos | Si es nulo, el de la región |
| `medications`, `conditions` | lista JSON de tokens más lista de texto libre sin clasificar | Tabla de tokens de `docs/safety.md` |
| `disciplines`, `training_frequency` | Propios de FightLab | Plan v1 §1 |
| `goal_weight_kg`, `goal_date`, `weight_class`, `weigh_in_at` | Propios de FightLab | Pasa a BD el pesaje que hoy está en localStorage |

### 6.3 Cribado y lesiones

- **`Screening`** (uno por perfil): `scoff_yes_count` (0-5), `scoff_positive`,
  `parq_any_yes`, `parq_followup_yes`, `vigorous_reviewed`, `cardiac_symptoms`,
  `menstrual`, `bp_systolic`, `bp_diastolic`, todos nulos por defecto, más
  `updated_at`. Igual que en el coach: si cambia `parq_any_yes` o `parq_followup_yes`,
  `vigorous_reviewed` se borra (lo impone el servicio y tiene test). Solo se guardan
  resultados, nunca el texto de las preguntas.
- **`ScreeningEvent`** (solo se añade): quién, cuándo, qué clave, valor anterior y
  nuevo, y desde dónde (onboarding, check-in, revisión). Deja trazabilidad sin
  montar una auditoría formal (la visión pide gobernanza ligera).
- **`Injury`**: `area` (en palabras del usuario), `status` (`active`/`cleared`),
  `since`, `professional`, `cleared_on` (obligatorio si `cleared`), `exercises`
  (nombres; cuando exista el catálogo, relación con `Exercise`) y `origin` (onboarding,
  check-in o sesión de MMA).

### 6.4 Check-in

- **`DailyCheckin`** (`profile`, `date`, único por día): `intake_kcal`,
  `sleep_hours`, bienestar (sueño, fatiga, agujetas por zona, estrés, como en el plan
  v1 §8), `notes`. Si llegan dos check-ins el mismo día, el segundo rellena o pisa
  campo a campo y añade sus notas (semántica de `checkins.append_checkin`).
- Peso y cintura siguen en `BiometricsLog` (ya tiene `weight_kg` y `waist_cm`). El
  servicio de check-in escribe en los dos.
- Las respuestas a señales de alarma no se guardan como texto. Su efecto va a
  `Screening` o a `Injury` y queda en `ScreeningEvent`.

### 6.5 Entrenamiento estructurado

- **`SetLog`** (`activity` FK a `Activity` de tipo GYM, `exercise`, `exercise_index`,
  `set_index`, `set_type`, `weight_kg`, `reps`, `rir`, `rpe`, `distance_km`,
  `duration_s`). Hoy las series van en `Activity.detail`, que se trunca. Este modelo
  coincide con el pendiente del plan v1 (fase 3: `Exercise`/`WorkoutSession`/`SetLog`).
  Si para entonces ese trabajo ya está hecho, se reutiliza.

### 6.6 Plan, revisión y menús

- **`WeeklyPlan`**: `week_start`, `status` (`draft`/`active`/`superseded`),
  `target_kcal`, `in_deficit`, `training_schedule` (JSON con día y hora),
  `sessions` (JSON: por sesión, lista de `{exercise, sets, rep_range, load_kg,
  action, rule_key}`), `cardio` (JSON), `nutrition` (copia de las macros),
  `safety_reasons` (JSON), `rules_used` (claves de regla), `engine_sha` y `narrative`
  (texto del LLM, opcional).
- **`WeeklyReview`**: `week_end`, adherencia (sesiones hechas/planificadas, cercanía
  al objetivo calórico), copia de la tendencia, `recalibrated_tdee`, señales de
  descarga, `proposals` (JSON), `accepted_at` y el plan que generó.
- **`Tastes`** (uno por perfil), **`Recipe`** (nombre, URL de origen, items,
  valoración), **`CatalogueProduct`** (código de barras, valores por 100 g o 100 ml,
  cadena, URL de OFF, `unverified=True`), **`MealPlan`** (fecha de inicio, días en el
  formato de borrador de `mealplan`, resultado de la comprobación, lista de la compra).

### 6.7 Evidencia

- **`KnowledgeRule`**: `key` (slug estable `archivo/encabezado`, p. ej.
  `nutrition/default-rmr-equation-mifflin-st-jeor`), `file`, `section`, `heading`
  (exacto, porque es el que aparece en los motivos del motor), `grade`, `rule_text`,
  `evidence`, `applies_to`, `conflicts`, `source_ids`, `checked_on`, `origin`
  (`upstream` o `fightlab`), `engine_sha`.
- **`KnowledgeSource`**: `sid` (`S819`, o `F001` para el anexo propio), cita, tipo,
  DOI y URL. **Sin la línea `Supports:`** (§1, licencias).
- **`RuleTranslation`**: `rule` (FK), `lang`, campos traducidos, `status`
  (`machine`/`reviewed`/`stale`) y `source_hash` (si la regla cambia, pasa a `stale`).
- `manage.py load_knowledge`: parsea con `coach.knowledge.iter_rules`, es
  idempotente, informa de altas, bajas y cambios, y no borra una regla que tenga
  referencias: la marca como retirada.

### 6.8 El adaptador

`coaching/bridge/adapters.py`:

- `to_coach_profile(user, today) -> coach.profile.Profile`: `sex` ←
  `equation_sex`, o `gender` si es MALE o FEMALE. `birth_date` ← `date_of_birth`.
  `weight_kg` ← último `BiometricsLog.weight_kg` (se devuelve también su fecha para
  avisar si es antiguo). `screening` ← solo las claves no nulas de `Screening`.
  `injuries` ← filas de `Injury`. El resto de campos, uno a uno. Valida con las mismas
  reglas que `save_profile`. Hoy esa validación es `coach.profile._validate`, que es
  privada: el puente la usa y un test de contrato avisa si cambia. Queda apuntado como
  `U01` en la lista de sugerencias (§4.1).
- `weigh_ins(user) -> list[tuple[date, float]]`: desde `BiometricsLog`, con la fecha
  en la zona horaria del perfil.
- `set_records(user, since)`: objetos con los atributos que lee `strength`
  (`exercise`, `date`, `set_type`, `weight_kg`, `reps`, `rir`, `rpe`).
- La tabla de alimentos se lee del prefijo con `coach.foods.load_foods`, en modo
  lectura. Los productos del usuario salen de `CatalogueProduct`.

Funciones del motor que usa el puente: `safety.flags`, `energy.rmr_mifflin`/`tdee`/
`calorie_target`, `macros.macro_targets`, `zones.hr_zones`, `trend.weight_trend`/
`recalibrate_tdee`, `strength.e1rm`/`weekly_hard_sets`/`progression`/`deload`,
`foods` y la comprobación de `mealplan` (en la fase 8 hay que confirmar qué partes de
`mealplan` son puras), y `knowledge.iter_rules`/`section`.

---

## 7. Citas: regla y fuente en la API, la UI y el chat

### 7.1 API

Toda respuesta con un número o una recomendación del motor lleva sus reglas:

```json
{
  "kcal": 2350,
  "rules": [{"key": "nutrition/default-rmr-equation-mifflin-st-jeor", "grade": "moderate",
             "title": "Ecuación de RMR por defecto: Mifflin-St Jeor"}],
  "reasons": [{"code": "floor_raised", "rule_key": "nutrition/…", "text": "…",
               "refer": "gp"}],
  "engine": {"sha": "7c2f508", "knowledge_checked_on": "2026-10-24"}
}
```

Endpoints de lectura: `GET /api/v1/knowledge/rules/{key}` (regla, grado, población,
conflictos y fuentes) y `GET /api/v1/knowledge/sources/{sid}`. Son públicos para
usuarios autenticados y no tienen datos personales.

### 7.2 UI

- Chip de evidencia junto a cada número o recomendación: "Evidencia fuerte",
  "moderada" o "emergente", con colores fijos en toda la app.
- Al tocarlo se abre una hoja inferior con la regla en el idioma del usuario. En
  inglés es el original; en español es la traducción, o el original con la etiqueta
  "sin traducir" si aún no hay. Debajo, "A quién se aplica", "Dónde no está claro" y
  las fuentes con enlace al DOI.
- Lo que no tenga regla se etiqueta "Convención de FightLab, sin revisar". Nunca se
  disfraza de evidencia.
- **Créditos** (`/profile/credits`): "Motor de cálculo y base de evidencia: *AI
  personal coach* de matgarfer499 (enlace). Código bajo MIT; contenido bajo CC BY 4.0.
  Cambios de FightLab: traducción al español de reglas y mensajes, motivos
  estructurados, adaptación a app web, almacenamiento en base de datos y mejoras
  propias del cálculo (lista en `docs/coach-upstream-sugerencias.md`)". Debajo, el SHA
  del motor, la fecha de la evidencia y las demás atribuciones: USDA FoodData Central,
  Open Food Facts (ODbL) y PAR-Q+ (© PAR-Q+ Collaboration; versión española de Dr.
  Martín Rubio), con enlace al formulario oficial. El anexo de combate es contenido de
  FightLab y no lleva atribución al coach. El mismo texto va en el `README.md` y en
  `UPSTREAM.md`.

### 7.3 Traducción

- Los motivos del motor empiezan por `archivo.md: "Encabezado"`. El puente separa la
  referencia (de ahí sale `rule_key`) del texto y lo convierte en un motivo
  estructurado: `{code, rule_key, params}`. Por ejemplo, `params` lleva la lectura de
  tensión, la zona de la lesión o las kcal.
- El texto final sale del catálogo `coaching/bridge/reason_texts.py`, con una
  plantilla por `code` y por idioma (`es`, `en`). La plantilla `en` reproduce el texto
  original del motor, así que el inglés no cuesta traducción. Pedir motivos
  estructurados al motor es la sugerencia `U03`.
- Un test pasa los perfiles de la tabla de flags de `docs/safety.md` y falla si
  aparece un motivo sin plantilla en alguno de los dos idiomas. Si en producción llega
  uno desconocido, se muestra el texto original del motor con su regla y se registra
  en el log.
- Las reglas se traducen al español una vez con el LLM (`status=machine`) y se
  revisan a mano (`reviewed`). La UI muestra qué traducciones no están revisadas. En
  inglés se muestra el original.

### 7.5 Español e inglés (P2)

El usuario quiere los dos idiomas desde el principio si no es difícil. **Para todo
lo que viene del coach no lo es**: el motor, las reglas, la línea de derivación de
`docs/safety.md` y el PAR-Q+ oficial ya existen en inglés, y en español había que
traducir de todos modos. **Lo que sí cuesta es la UI que ya existe**, porque hoy
tiene el español escrito directamente en el código: unos 34 archivos `.tsx` y
~7.500 líneas de TS/TSX, con unos 300 nodos de texto en JSX y unos 530 literales
de texto. Calculo entre 600 y 800 cadenas. En el backend hay unas 20 cadenas propias
para el usuario más los prompts de IA.

Diseño:

- **Frontend:** `next-intl` sin rutas por idioma, para que las URLs no cambien y no
  se rompa la PWA instalada. El idioma sale de `profile.language`, guardado en una
  cookie que lee el BFF, o del navegador antes del login. Catálogos `messages/es.json`
  y `messages/en.json`. Fechas y números con `Intl` (64,59 frente a 64.59). Las
  unidades siguen siendo métricas (el coach no tiene imperiales).
- **Backend:** `LocaleMiddleware` de Django para que los mensajes de validación de DRF
  lleguen traducidos sin hacer nada. El idioma de la petición lo marca
  `Accept-Language`, que el BFF fija según `profile.language`. Los mensajes propios
  (unas 20 cadenas) van a un catálogo pequeño en Python y los motivos del coach a
  `reason_texts.py`. No hace falta `gettext` ni `compilemessages` en la imagen.
- **IA:** el prompt del chat recibe el idioma del usuario y responde en él. Las
  herramientas devuelven motivos ya traducidos. La foto→kcal no cambia (sus claves
  JSON son internas), salvo el nombre del plato, que se pide en el idioma del
  usuario.
- **Regla desde la fase 1:** toda pantalla o cadena nueva entra en los dos catálogos.
  Hay un test que compara las claves de `es.json` y `en.json` y falla si no son
  iguales.

**Coste y cuándo:**

- **Infraestructura** (librería, cookie, middleware, test de claves): pequeña. Entra
  en la fase 1.
- **Pantallas nuevas del coach** (fases 2-8): un ~10-15 % más por pantalla, solo por
  escribir dos catálogos. El contenido en inglés ya existe.
- **UI existente:** es el coste grande. Es mecánico, sin cambiar la lógica, y va en
  una **fase I** propia, de 3 o 4 PRs por zonas: auth y onboarding; Home y
  Biometría; Entrenamiento (deportes, MMA, gimnasio, carga); Nutrición y Coach. Se
  puede hacer en paralelo con las fases 2-5 si cada PR toca solo las vistas de su
  zona. El inglés se activa para los usuarios cuando acabe la fase I. Hasta
  entonces, el selector de idioma no se muestra, para que nadie vea la app mezclada.

### 7.4 Chat del coach

- `ai/services.coach_chat` pasa a usar herramientas (tool-calling), que ya preveía la
  visión §5: `get_targets`, `get_safety`, `get_trend`, `get_load`, `get_plan`,
  `search_rules(query)` y `get_rule(key)`. Las herramientas llaman al puente. El
  modelo no hace cuentas y cita solo números devueltos por las herramientas (es la
  regla del coach: "never from the model's own arithmetic").
- Las citas van en el texto como `[[regla:clave]]`. El backend comprueba que la clave
  exista y que haya salido en alguna herramienta de ese turno. Las válidas se
  convierten en chips; las inválidas se quitan y se registran.
- Al modelo le llegan los **flags y sus motivos, nunca las respuestas del cribado**.
- Se reescribe el prompt actual: se quitan "ACWR: zona segura 0.8–1.3; por encima,
  riesgo de lesión" y cualquier otra afirmación sin regla (§9).
- Si hay `refer_gp`, la respuesta termina con la línea de derivación en el idioma del
  usuario, copiada literal de `docs/safety.md` (existe en es y en). La añade el
  backend, no el modelo.

---

## 8. Seguridad

### 8.1 Una sola fuente de verdad, en código

- `coaching.services.safety_for(user, today)` = `coach.safety.flags(to_coach_profile(user))`.
  Cualquier endpoint que dé kcal, macros, zonas, plan, progresión, pesaje o
  sugerencias de carga lo llama **en el servidor**. El frontend nunca decide.
- **Puertas:**
  - Sin `scoff_yes_count` o `scoff_positive` contestados, el motor lanza
    `ProfileIncomplete("screening.scoff_yes_count")`. La API responde `409
    {"code": "profile_incomplete", "field": …}` y la UI lleva al paso de onboarding
    que falta.
  - Menor de 18: sin objetivos calóricos, déficit, pesajes, categoría de peso ni
    corte. En deportes de combate esto importa especialmente.
- Onboarding con cribado, siguiendo `setup/SKILL.md`: el SCOFF antes de preguntar el
  peso; el PAR-Q+ (abajo); síntomas cardiacos; medicación y condiciones mapeadas a
  tokens con un selector (sin texto libre que interpretar); tensión si hay
  hipertensión; ciclo. Si aparece un síntoma ahora o en reposo, se para el flujo y se
  muestra el número de emergencia.

#### PAR-Q+ (P3: lo mejor para el usuario, dentro de la ley)

| Opción | Usuario | Legal |
|---|---|---|
| Copiar las preguntas oficiales dentro de la app | La mejor: todo en un sitio | **No, sin permiso.** La única licencia del formulario es para fotocopiarlo entero (§1) |
| Reescribir las preguntas con nuestras palabras | Buena | No: el propio formulario prohíbe cambios, y además dejaría de ser el PAR-Q+ validado |
| **Formulario oficial desde su web + 2 preguntas en la app** | Buena si el paso está bien guiado | Sí: no se copia ni se cambia nada |

**Decisión: la tercera, con el paso guiado**, y con la primera preparada por si llega
un permiso:

1. Un paso del onboarding explica en una frase para qué sirve y abre el formulario
   oficial en el idioma del usuario (español o inglés) desde eparmedx.com, en una
   pestaña o el visor del sistema. No se incrusta: el sitio puede bloquearlo y
   copiarlo sería redistribuirlo. La URL va en configuración, no en el código.
2. Al volver, dos preguntas grandes de sí o no, con la misma redacción que el coach:
   "¿Algún SÍ en las 7 preguntas generales?" y, si es sí, "¿Algún SÍ en las preguntas
   de seguimiento?". Hay una tercera respuesta, "No lo sé o no lo he rellenado", que
   deja el campo nulo. Así se aplica la regla conservadora del motor (PAR-Q+ sin
   contestar → solo trabajo ligero o moderado), sin bloquear el resto del
   onboarding, y la app lo vuelve a pedir más tarde.
3. Con algún SÍ, o 45 años o más, se pregunta si un profesional cualificado ha revisado
   el trabajo vigoroso (`vigorous_reviewed`), como en `setup/SKILL.md`.
4. **Opción mejor si llega el permiso:** si el usuario consigue permiso escrito de la
   PAR-Q+ Collaboration para reproducir el formulario dentro de la app, se activa un
   formulario nativo con el texto exacto en es y en (preguntas, seguimiento con sus
   saltos, crédito del traductor) detrás de un flag de configuración. Los modelos no
   cambian: se siguen guardando solo `parq_any_yes` y `parq_followup_yes`.

### 8.2 Lo que en el coach era texto de skill y aquí pasa a código

| Protección | En el coach | En FightLab |
|---|---|---|
| Sin trabajo vigoroso mientras `review_before_vigorous` | Skill `plan` | Tabla `MODALITY_INTENSITY` en `coaching/rules.py` (sparring duro, competición, HIIT, sprints, comba, pliometría, test de 1RM → vigoroso, cada uno con su regla o etiquetado como convención). El generador del plan los excluye; registrar a mano una sesión así muestra un aviso con el motivo. No bloquea registrar lo ya hecho |
| Sin SIT/REHIT mientras `no_all_out_sprints` | Skill | Igual |
| Señales de alarma en el check-in | Conversación | Preguntas estructuradas; si la respuesta es "sí", se escribe en `Screening` o `Injury` |
| Línea de derivación | Skill | La añade el backend |

### 8.3 Bloqueos propios de FightLab

| Flag del coach | Efecto añadido en FightLab |
|---|---|
| `no_deficit`, `hold_deficit` | El objetivo calórico no baja. Tampoco se ofrecen el modo corte, "a X kg de tu categoría" ni la proyección al pesaje con pérdida |
| `no_weight_targets` | Se ocultan el pesaje, la cuenta atrás, la categoría como objetivo, la tendencia y los recordatorios de pesarse. El check-in no pide peso ni cintura |
| `no_training` | La tarjeta "Estado de hoy" muestra "Sin entrenar hasta revisión médica"; no hay plan ni sugerencias de carga. Se puede seguir registrando (no se borran datos) |
| `hold_progression`, `paused_exercises` | `strength.progression` responde `hold` o `paused` y la UI lo explica con su regla |
| `cap_moderate`, `review_before_vigorous` | Sparring duro y competición fuera del plan (§8.2) |
| (nuevo, propio) golpe en la cabeza con síntomas | Flag `no_contact` y derivación. **Hasta que exista la regla del anexo (§9) es una convención de producto conservadora** y se etiqueta así |

### 8.4 Tests

- Una prueba por fila de la tabla de flags de `docs/safety.md`, a nivel de API
  (perfil → endpoint → bloqueo esperado).
- Tests de los bloqueos de §8.3.
- Tests de contrato del puente (§4) que se ejecutan en cada `subtree pull`.

---

## 9. Huecos de evidencia de los deportes de combate

El coach no cubre la población de FightLab. Sin una revisión propia, FightLab no
puede decir que *todo* tiene evidencia. Este es el inventario:

| Tema | FightLab hoy | Coach | Estado | Qué hacer hasta tener la regla |
|---|---|---|---|---|
| ACWR y riesgo de lesión | Semáforo 0,8-1,3, "riesgo de lesión" en el prompt | Nada | **Discutido** en la literatura (acoplamiento matemático, causalidad dudosa) | Mostrarlo como dato descriptivo ("carga de esta semana frente a tu media"), sin "zona segura" ni "riesgo de lesión". Grado previsto: emergente, con conflictos explícitos |
| Validez del sRPE (min × RPE) en combate | Motor de carga | Nada | Por revisar | Etiqueta de convención |
| Monotonía y tensión (Foster) | Calculadas | Nada | Por revisar | Etiqueta de convención |
| PMC (CTL/ATL/TSB), planificado en v1 §8 | No construido | Nada | Por revisar | **No construirlo antes de la revisión** |
| Pérdida rápida de peso y corte para el pesaje | Pesaje y cuenta atrás | Pérdida gradual, REDs, deshidratación leve y fuerza | Hueco grande y sensible | Solo información, sin prescripción (como ya decía v1 §7); aplican todos los bloqueos de §8.3 |
| Rehidratación entre pesaje y combate | Nada | "Sodium in long sessions and rehydration" (no es lo mismo) | Por revisar | Nada |
| Conmoción y golpes en la cabeza en sparring | Nada | Nada | Hueco de seguridad | Flag `no_contact` conservador (§8.3) |
| Gasto energético de las sesiones de combate (factores de kcal del tracker) | Factores fijos por intensidad | "Exercise calories do not add linearly" | Por revisar (Compendio de Actividades Físicas) | Etiqueta de convención |
| RMR de atletas (masa magra alta) | — | Reglas de ten Haaf y Cunningham, pero el código solo usa MSJ | La regla existe y falta código | Se implementa en el puente (`bridge/energy_athletes.py`, fase 4) citando esas reglas y con la advertencia de "Body-fat measurement error carries into RMR"; queda apuntado como `U04` |
| PAL con doble sesión diaria (por encima de 2,0) | — | PAL tope 2,0 "recreational" | Por revisar | Usar el tope del coach |
| Readiness y bienestar | Plan v1 §8 | "Simple readiness monitoring", "HRV is optional" | **Cubierto** | Reutilizar esas reglas |
| Carbohidratos según la carga del día | Plan v1 §7 | "Carbohydrate by training load" | **Cubierto** | Reutilizar |
| Agua ~35 ml/kg (plan v1 §7) | Previsto | Reglas de hidratación | Por contrastar | Quitar la cifra si ninguna regla la respalda |

### Cómo se cubren

- Mismo método que `docs/research-methodology.md`: investigador e **investigador
  independiente que intenta refutar**, "ábrelo o descártalo" (no se cita de memoria),
  la misma rúbrica de grados (strong/moderate/emerging), conflictos explícitos,
  población anotada (en combate suelen ser hombres jóvenes y de élite) y lista de
  afirmaciones descartadas.
- Resultado: `backend/knowledge_fightlab/combat-sports.md` y `sources.md`, en el mismo
  formato (`### regla`, un `**Grade:**`, IDs `[Fxxx]` para no chocar con `[Sxxx]`, la
  línea "Evidence checked on" y sin rayas largas), cargado por el mismo
  `load_knowledge` con `origin=fightlab`, más `dropped-claims.md` propio.
- Las comprobaciones de formato reutilizan `scripts/check_knowledge.py` del prefijo,
  que ya admite `--knowledge-dir`. Si sus comprobaciones del índice o del README no
  encajan con el anexo, se envuelve en un test propio que aplique las mismas reglas.
- **El anexo se queda en FightLab (P4).** No se le propone al autor. Licencia: la
  del repo de FightLab (§1); hoy, todos los derechos reservados. Las fuentes `[Fxxx]`
  guardan solo la referencia bibliográfica, igual que las del coach.
- La investigación puede usar como herramienta el workflow `/research` del coach,
  sobre una copia limpia del repo (nunca la carpeta con `data/`). El resultado se
  escribe en `backend/knowledge_fightlab/` y no vuelve al repo del autor.
- **Cuándo (P6, decisión técnica que el usuario delegó):** la investigación (E.1-E.3) **arranca a la vez que la
  fase 1**. Motivos: no depende de código; el texto del ACWR ya está en producción; y
  sus resultados se necesitan en la fase 4 (contenido de corte y pesaje) y en la
  fase 6 (si el sparring cuenta como vigoroso en `MODALITY_INTENSITY`). Fecha límite
  blanda: antes de empezar la fase 4. Si no llega, la fase 4 sale igual con la
  etiqueta "Convención de FightLab, sin revisar" y no se bloquea.
- Las fuentes candidatas (las revisiones del ACWR de Impellizzeri y otros, las de
  pérdida rápida de peso en combate, la declaración de consenso sobre conmoción en el
  deporte, el Compendio de Actividades Físicas) **se dejan a propósito sin cifras en
  esta spec**: por el propio método, nada entra hasta que alguien lo abra y lo
  compruebe.
- **Mientras no haya regla:** todo lo de la tabla marcado como "por revisar" se
  etiqueta en la UI como "Convención de FightLab, sin revisar" y no se presenta como
  evidencia.

---

## 10. Fases

Cada fase es un PR (o pocos) a `staging` y luego a `main`, y se puede entregar sola:
deja la app usable y mejor que antes. Antes de cada fase de código se escribe su plan
detallado.

| Fase | Entrega | Depende de | Qué ve el usuario |
|---|---|---|---|
| **0** | Esta spec y el plan | — | Nada |
| **1. Plataforma** | Python 3.12 y versiones fijadas; subtree en `backend/vendor/`; `UPSTREAM.md`; `docs/coach-upstream-sugerencias.md`; `PYTHONPATH`; `pyyaml`; tests del autor dentro de la suite; **infraestructura i18n** (`next-intl`, cookie de idioma, `LocaleMiddleware`, test de claves es/en); pantalla de Créditos en los dos idiomas | — | Créditos |
| **I. UI existente en dos idiomas** | Pasar a catálogos las ~600-800 cadenas actuales en 3-4 PRs por zonas (§7.5) y activar el selector de idioma al terminar | 1. **En paralelo con 2-5** | La app entera en inglés |
| **2. Evidencia** | Modelos `KnowledgeRule`/`Source`/`RuleTranslation`; `load_knowledge`; API de lectura; componente de chip y hoja de evidencia; prompt del chat sin afirmaciones sin fuente | 1 | Ver las reglas y sus fuentes; el chat ya no afirma lo que no puede citar |
| **3. Perfil y cribado** | Perfil ampliado (incl. `language`), `Screening`, `ScreeningEvent`, `Injury`, adaptador, `GET /coach/safety`, onboarding con cribado y PAR-Q+ guiado (§8.1), línea de derivación es/en, puerta 409, catálogo de motivos `reason_texts.py` (es/en) | 1, 2 | Onboarding con cribado y banner de seguridad con su regla |
| **4. Objetivos** | `energy`, `macros` y `zones` vía API con citas; Nutrición usa estos objetivos (se retira `targets()` del frontend); bloqueos de §8.3 sobre pesaje y corte; pesaje a BD | 3 | Kcal, macros y zonas con suelos y bloqueos |
| **5. Check-in** | `DailyCheckin`, señales de alarma estructuradas, preguntas semanales, `trend` en Biometría y en la Home; se une con el check-in de bienestar del plan v1 | 3, 4 | Check-in diario y ritmo semanal del motor |
| **6. Fuerza y plan semanal** | `SetLog` (o el del plan v1), `strength` (progresión, series, pausas, descarga), `MODALITY_INTENSITY`, generador de `WeeklyPlan` con sesiones de combate en el calendario y el LLM solo para redactar | 3, 4 | Plan semanal con cargas y reglas |
| **7. Revisión semanal** | `WeeklyReview`, recalibración del TDEE, señales de descarga, aceptar propuestas genera un plan nuevo | 5, 6 | Revisión semanal |
| **8. Menús y compra** | `Tastes`, `Recipe`, `CatalogueProduct`, proxy de OFF (compartido con el escáner de v1), comprobación de menús del motor, lista de la compra; el LLM propone platos y el motor los valida; PDF opcional | 4 | Menús y lista de la compra |
| **9. Importadores** (opcional) | Hevy, Lyfta y CSV → `SetLog` | 6 | Importar el histórico |
| **E. Anexo de combate** | Investigación (§9) → `knowledge_fightlab/`; después, aplicarlo: rehacer textos del ACWR, gating del corte, regla de conmoción | Investigación: ninguna; **arranca con la fase 1** y conviene que acabe antes de la 4. Aplicación: 2 y 4 | Carga y corte con evidencia o etiquetados con honestidad |

El chat va ganando herramientas en cada fase: citas en la 2, seguridad en la 3,
objetivos en la 4 y así sucesivamente. No es una fase aparte.

Impacto de P2 en las fases: la 1 crece un poco (infraestructura); las 2-8 añaden un
~10-15 % por pantalla (dos catálogos; el contenido en inglés ya existe); aparece la
fase I, mecánica, que va en paralelo y no retrasa la ruta crítica 1→2→3→4.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un cambio del autor rompe el puente | Tests de contrato; regla de no editar el prefijo; la actualización es un PR propio |
| El puente usa `_validate`, que es privada | Test de contrato; apuntado como `U01` |
| Motivos sin plantilla en algún idioma | Catálogo es/en con test que falla si falta una plantilla; si llega uno desconocido, se muestra el texto original del motor |
| Traducción de 459 reglas al español | Traducción por LLM marcada como tal más revisión progresiva, empezando por las que salen en la UI; en inglés, el original |
| App a medio traducir durante la fase I | El selector de idioma no aparece hasta que acaba la fase I; test de claves es/en desde la fase 1 |
| El PAR-Q+ no se puede reproducir | Formulario oficial desde su web más 2 preguntas (§8.1); formulario nativo solo con permiso escrito |
| Un parche dentro de `vendor/` se pierde en un `subtree pull` | Parches solo como último recurso, apuntados en `UPSTREAM.md` y con un test que falla si desaparecen |
| Las mejoras propias se separan del motor del autor | Lista `docs/coach-upstream-sugerencias.md`, que se revisa en cada `subtree pull` |
| Datos de salud | Solo el dueño accede; al LLM llegan flags y no respuestas; nada de salud en logs |
| Coste del LLM | Las cuentas son deterministas; el LLM solo redacta, una vez por plan o revisión y en caché |
| Prometer evidencia que FightLab no tiene | Etiqueta "Convención de FightLab, sin revisar" y fase E |
| Choque de nombres (`coach`) | App `coaching`; prohibido crear una app `coach` |

---

## 12. Decisiones del usuario (P1-P7) y lo que queda abierto

| # | Pregunta | Respuesta | Dónde se aplica |
|---|---|---|---|
| P1 | ¿Subtree o copia? | "Como mejor se haga" → **subtree con squash**, decisión cerrada | §4 |
| P2 | ¿Solo español o también inglés? | Los dos desde el principio si no es difícil → **es y en**. Fácil para el contenido del coach; la UI existente va en la fase I | §7.5, §10 |
| P3 | PAR-Q+ | "Lo mejor para el que lo use", sin incumplir la licencia → **formulario oficial desde su web + 2 preguntas**, y formulario nativo si hay permiso | §1, §8.1 |
| P4 | ¿Anexo de combate al repo del autor? | No, **se queda en FightLab** con la licencia del repo | §1, §9 |
| P5 | ¿PRs al autor? | No. **Mejoras en FightLab** (capa adaptadora) y lista para comunicárselas | §4.1, `docs/coach-upstream-sugerencias.md` |
| P6 | ¿Cuándo empieza la fase E? | A mi criterio → **a la vez que la fase 1** | §9, §10 |
| P7 | `gender=OTHER` sin `equation_sex` | Sí: **sin objetivos calóricos**, como el coach | §6.2 |

**Queda abierto (no bloquea ninguna fase):**

- **A1.** ¿Pide el usuario permiso escrito a la PAR-Q+ Collaboration para mostrar el
  formulario dentro de la app? Es la única forma de tener la opción ideal (§8.1). Es
  un mensaje que tendría que mandar el usuario.
- **A2.** ¿Quiere el usuario poner una licencia al repo de FightLab? Hoy no tiene
  ninguna, así que el anexo y las traducciones quedan con todos los derechos
  reservados. Esto no afecta al cumplimiento de MIT y CC BY del coach.
