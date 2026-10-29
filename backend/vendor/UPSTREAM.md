# Motor vendorizado: `ai-personal-coach`

Este documento está fuera del prefijo `backend/vendor/ai-personal-coach/` a propósito:
el prefijo no se edita (spec §4).

## Origen

| | |
|---|---|
| Repositorio | https://github.com/matgarfer499/ai-personal-coach |
| Autor | matgarfer499 |
| Rama | `main` |
| SHA actual | `69e5537718069b308690491c38c10d7cfd3a5b3f` (2026-10-25, "Initial commit") |
| Traído el | 2026-10-29, con `git subtree add --squash` |
| Prefijo | `backend/vendor/ai-personal-coach/` |

> **Nota sobre el SHA.** El diseño se escribió leyendo `7c2f508`, un commit de la copia
> local del usuario (importador de CSV de Lyfta) que **no está publicado**. GitHub solo
> tiene `69e5537`, que es el que se vendoriza (decisión del usuario). La diferencia es
> solo ese importador, que FightLab no usa.

## Licencias

- **Código: MIT**, © matgarfer499. El `LICENSE` está dentro del prefijo y no se toca.
- **Contenido: CC BY 4.0** (`knowledge/`, `docs/`, textos de las skills, `assets/` y el
  resto de textos). Está en `LICENSE-CONTENT.md`, dentro del prefijo.
- **Excepción:** las citas textuales de las líneas `Supports:` de `knowledge/sources.md`
  son de las editoriales y **no** están bajo CC BY. FightLab no las publica (ni en la UI
  ni en la API): solo muestra la referencia bibliográfica.
- Alimentos: USDA FoodData Central (dominio público, con cita). Open Food Facts: ODbL.
- PAR-Q+: © PAR-Q+ Collaboration (versión española de Dr. Martín Rubio). No se
  redistribuye ni se reformula.

### Atribución (la que pide CC BY 4.0)

> Motor de cálculo y base de evidencia: *AI personal coach* de matgarfer499
> (https://github.com/matgarfer499/ai-personal-coach). Código bajo MIT; contenido bajo
> CC BY 4.0.
>
> Cambios de FightLab: traducción al español de reglas y mensajes, motivos
> estructurados, adaptación a app web, almacenamiento en base de datos y mejoras propias
> del cálculo (lista en `docs/coach-upstream-sugerencias.md`).

## Reglas

1. **No se edita nada dentro del prefijo.** La adaptación y las mejoras van en
   `backend/coaching/` (sobre todo `coaching/bridge/`).
2. No se mandan PRs al autor. Las mejoras se apuntan en
   `docs/coach-upstream-sugerencias.md` en el mismo PR que las introduce.
3. El subtree se trae **siempre del remoto de GitHub**, nunca de la carpeta local
   `entrenador IA/ai-personal-coach` (su `data/` tiene datos personales).
   Comprobación tras cada pull: `git ls-files backend/vendor/ai-personal-coach/data`
   solo lista `.gitkeep`.
4. Un parche dentro del prefijo es el último recurso: se apunta abajo y lleva un test
   en `backend/coaching/tests/` que falla si se pierde.

## Actualizar (traer las mejoras del autor)

1. Rama `chore/coach-upstream-<sha-corto>` desde `staging`.
2. `git subtree pull --prefix backend/vendor/ai-personal-coach https://github.com/matgarfer499/ai-personal-coach main --squash`.
3. Pasar los tests del autor (`pytest vendor/ai-personal-coach/tests -p no:django`, desde
   `backend/`), los tests de contrato del puente
   (`backend/coaching/tests/test_bridge_contract.py`) y el resto de la suite.
4. `python manage.py load_knowledge`: informa de reglas nuevas, cambiadas o eliminadas y
   marca como "pendiente de revisar" las traducciones de las reglas que han cambiado.
5. Si hay parches locales, volver a aplicarlos y pasar sus tests.
6. Revisar `docs/coach-upstream-sugerencias.md`: cerrar lo adoptado (`adoptada en <sha>`)
   y borrar el código equivalente de FightLab.
7. Actualizar este archivo (SHA y fecha). PR a `staging` y luego promoción a `main`.

Cadencia: cuando el autor avise o una vez al mes. Si un pull rompe el contrato del
puente, se arregla en el puente y nunca en el prefijo.

## Suite del autor

Se pasa desde `backend/` con `pytest vendor/ai-personal-coach/tests -p no:django`
(Python 3.12). Resultado en `69e5537`: **630 passed**, con estas condiciones:

- **`reportlab`** (extra `pdf` del motor): sin él, 5 tests de `tests/coach/test_export.py`
  se saltan. FightLab no lo instala hasta que llegue el PDF; con él, pasan.
- **`ruff`**: algunos tests ejecutan `python -m ruff`; hay que tenerlo instalado en el
  entorno de test (grupo `dev` del autor).
- **Locale `es_ES.UTF-8`** (U08): `test_month_names_do_not_follow_a_spanish_locale` se
  salta solo cuando falta el locale (`except locale.Error: pytest.skip`), así que en
  `python:3.12-slim` no falla. No hace falta instalar el locale en la imagen.
- **`PYTHONPATH`:** `tests/coach/test_cli.py::test_module_entry_point` lanza `python -m coach`
  en un subproceso, así que desde `backend/` necesita `PYTHONPATH=vendor/ai-personal-coach`
  (lo fija el Dockerfile; en un venv local, `.env.example`).
- **Windows:** con `core.autocrlf=true` el checkout convierte los CSV de
  `tests/fixtures` a CRLF y `test_hevy_basic` falla (un salto de línea dentro de un
  campo). En el índice y en Linux/Docker están en LF y pasa. Además hace falta
  `PYTHONUTF8=1` (los tests escriben y leen texto con tildes con la codificación por
  defecto). Ninguna de las dos cosas pide tocar el prefijo.

## Parches locales

Ninguno.
