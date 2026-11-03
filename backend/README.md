# Backend de FightLab Pro

Django 5.2 + DRF. El motor del coach está vendorizado en `vendor/ai-personal-coach/` (paquete
`coach`): ejecuta los comandos y los tests con `PYTHONPATH=vendor/ai-personal-coach`
(y `PYTHONUTF8=1` en Windows).

## Base de evidencia y sus traducciones

Las reglas de evidencia y sus traducciones viven en archivos y se cargan en la BD en este orden
(cada paso es idempotente):

```bash
python manage.py load_knowledge                                            # 1. reglas del coach (knowledge/ del motor)
python manage.py load_knowledge --dir knowledge_fightlab --origin fightlab # 2. anexo de combate
python manage.py load_translations --lang es                               # 3. traducciones (knowledge_translations/)
```

Las traducciones van siempre detrás de las reglas: cada entrada lleva el `source_hash` del
inglés que se tradujo, y `load_translations` lo compara con el de la regla cargada; si no
coincide, la guarda como `stale` (la app muestra el original). `load_knowledge` también marca
`stale` las traducciones de una regla cuyo texto cambia. Formato y cómo actualizar una
traducción: [`knowledge_translations/README.md`](knowledge_translations/README.md).

`translate_rules` (traducción con la API de Anthropic, de pago) ya no hace falta para el
español: las traducciones están en el repo.

### Carga al arrancar, solo si cambiaron los archivos

En la rama de la beta (`feat/beta-coach`), el contenedor lanza `manage.py sync_knowledge
--on-start`, que carga cada conjunto de `coaching/knowledge_sync.py: knowledge_sets()` solo si
cambió la huella de sus archivos. Las traducciones se encadenan como un conjunto más, el último:

```python
from .translation_loader import TRANSLATIONS_DIR, load_translations

KnowledgeSet(
    "translations-es",
    TRANSLATIONS_DIR,
    lambda d: load_translations(d, "es"),
    patterns=("es/**/*.yaml",),
),
```

- Va detrás de `upstream` y `fightlab`: si cualquiera de los dos falla, `sync_knowledge` ya no
  carga los siguientes.
- Conviene recargarlo también cuando se haya recargado un conjunto anterior aunque sus archivos
  no cambien (p. ej. forzándolo si algún resultado previo es `loaded`): así una regla que vuelve
  a su texto anterior recupera su traducción al día. Sin eso, la traducción queda `stale` (la app
  muestra el inglés) hasta el siguiente cambio de los archivos de traducción, que es lo seguro.
- `load_translations` devuelve un `TranslationReport` (`created`, `updated`, `unchanged`,
  `stale_keys`, `unknown_keys`, `missing`), no el `Report` de `load_knowledge`: el mensaje de
  `sync_knowledge` debe leer esos campos para este conjunto.
