# Sugerencias para `ai-personal-coach`

Mejoras al motor del coach (matgarfer499/ai-personal-coach) que FightLab ha
necesitado y ha resuelto por su cuenta. **No se mandan PRs al autor.** Esta lista
sirve para contárselas más adelante, cuando el usuario decida.

Reglas (spec [`2026-10-29-coach-integracion-design.md`](superpowers/specs/2026-10-29-coach-integracion-design.md) §4.1):

- La mejora se hace en `backend/coaching/` (casi siempre en `coaching/bridge/`) y no
  dentro de `backend/vendor/ai-personal-coach/`. Si no queda más remedio y se parchea
  el prefijo, el parche se apunta también en `backend/vendor/UPSTREAM.md`.
- La entrada se añade o se actualiza en el mismo PR que la mejora.
- En cada `git subtree pull` se repasa la lista. Lo que el autor haya adoptado se
  cierra (`adoptada en <sha>`) y se borra el código equivalente de FightLab.
- Estados: `detectada` (vista al diseñar, sin código en FightLab), `abierta`
  (resuelta en FightLab, sin comunicar), `comunicada`, `adoptada en <sha>` o
  `descartada` (con motivo).

Leído en el commit `7c2f508` de la copia local del usuario; el código vendorizado es `69e5537`, el publicado en GitHub. La diferencia es el importador de Lyfta y no afecta a ninguna entrada.

| ID | Módulo | Problema | Cómo lo resuelve FightLab | Qué se propondría al autor | Estado |
|---|---|---|---|---|---|
| U01 | `coach/profile.py` | La validación de un perfil construido en memoria solo existe como `_validate`, que es privada. `load_profile` y `save_profile` exigen un archivo | El puente llama a `_validate` y un test de contrato avisa si cambia (fase 3) | Una función pública `profile_from_dict(data) -> Profile` que valide | detectada |
| U02 | `coach/knowledge.py`, `coach/foods.py`, empaquetado | `KNOWLEDGE_DIR` y `foods.ROOT` dependen de `Path(__file__).parent.parent`, y el wheel solo empaqueta `coach/`. Si se instala con `pip`, faltan la evidencia y los alimentos | Se integra con `git subtree` y `PYTHONPATH` (fase 1) | Incluir `knowledge/`, `foods/` y `regions/` como datos del paquete, o permitir indicar su carpeta (variable de entorno o parámetro) | detectada |
| U03 | `coach/safety.py`, `energy.py`, `zones.py`, `trend.py` | Los motivos son cadenas en inglés con la regla como prefijo de texto; para traducirlos hay que interpretar el texto | `bridge/reasons.py` los convierte en `{code, rule_key, params}` y `bridge/reason_texts.py` tiene las plantillas es/en (fases 2-3) | Motivos estructurados (código, regla y parámetros) además del texto | abierta |
| U04 | `coach/energy.py` | `nutrition.md` tiene las reglas "Trained clients: Cunningham or ten Haaf" y "Very muscular or physique-trained clients", pero el código solo calcula Mifflin-St Jeor | `bridge/energy_athletes.py` calcula ten Haaf o Cunningham cuando hay masa magra fiable, citando las reglas y "Body-fat measurement error carries into RMR" (fase 4) | Implementar esas ecuaciones en `energy` | detectada |
| U05 | `.claude/skills/plan`, `docs/safety.md` | Excluir el trabajo vigoroso (HIIT, sprints, comba, pliometría, 1RM) mientras `review_before_vigorous` o `no_all_out_sprints` depende del texto de la skill, no del código | Tabla `MODALITY_INTENSITY` en `coaching/rules.py` con su regla por modalidad y tests (fase 6) | Una tabla de modalidades por intensidad en el paquete, para que el código pueda comprobar un plan | detectada |
| U06 | `coach/energy.py` | Fallo conocido (en su README): con `no_training`, la estimación de energía sigue usando el `activity_level` del perfil | Mientras `no_training`, el puente calcula con el nivel `desk`, etiquetado como convención de FightLab (fase 4) | Que `tdee` y `calorie_target` tengan en cuenta `no_training` | detectada |
| U07 | `coach/mealplan.py`, `coach/cli.py` | Parte de la comprobación de menús parece mezclar lógica y lectura o escritura de archivos (`data/menu-draft.yaml`, `data/menus/`), y `menu_check` vive en `cli.py` | A confirmar en la fase 8. El puente usará solo las partes puras y, si hace falta, reimplementará el resto de envoltorio sin tocar el cálculo | Separar el cálculo puro de la E/S y sacar `menu_check` de la CLI | detectada, a confirmar |
| U08 | `tests/`, CI | La CI instala el locale `es_ES.UTF-8`, que no existe en `python:3.12-slim`. Algunos tests podrían depender de él | Comprobado en la fase 1: el único test que lo usa se salta solo si falta el locale (`pytest.skip`), así que no hace falta instalarlo | — | descartada (el test ya se salta limpiamente) |
