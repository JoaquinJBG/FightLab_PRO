# Traducciones de las reglas de evidencia

Las reglas de la base de evidencia están en inglés: las del coach en
`vendor/ai-personal-coach/knowledge/` y las del anexo de combate en `knowledge_fightlab/`. Aquí
están sus traducciones, como archivos del repo, y `manage.py load_translations` las lleva a la
tabla `RuleTranslation`. No se llama a ninguna API para cargarlas.

## Formato

Un archivo por archivo de reglas: `<lang>/<origin>/<file>.yaml` (`es/upstream/nutrition.yaml`
traduce `knowledge/nutrition.md`; `es/fightlab/combat-sports.yaml`, el anexo).

```yaml
lang: es
origin: upstream
file: nutrition
rules:
- key: nutrition/default-rmr-equation-mifflin-st-jeor   # KnowledgeRule.key
  source_hash: 3f1c…                                    # KnowledgeRule.source_hash del inglés traducido
  status: machine                                       # machine (sin revisar) o reviewed
  heading: 'Ecuación de RMR por defecto: Mifflin-St Jeor'
  rule_text: |-
    …
  applies_to: |-
    …
  conflicts: |-
    …
```

`source_hash` es el que calcula `coaching.knowledge_loader.content_hash` sobre los campos en
inglés (título, regla, evidencia, a quién se aplica y conflictos). Si la regla cambia en origen,
su hash deja de coincidir y la traducción se guarda como `stale`: la hoja de evidencia muestra el
original en inglés con la etiqueta "Sin traducir" hasta que se actualice la entrada.

`evidence` (el resumen de los estudios) es opcional: la hoja de evidencia no lo muestra y hoy no
se traduce.

## Carga

Detrás de las reglas, siempre:

```bash
python manage.py load_knowledge
python manage.py load_knowledge --dir knowledge_fightlab --origin fightlab
python manage.py load_translations --lang es
```

Es idempotente (la segunda pasada informa `0 altas, 0 cambios`). `--dry-run` informa sin guardar.
Avisa de las entradas obsoletas (con sus claves), de las entradas sin regla y de cuántas reglas
vigentes se quedan sin traducción al día. Los archivos mandan sobre la BD: una traducción editada
a mano en la BD se sobrescribe en la siguiente carga si su regla tiene entrada aquí.

## Actualizar una traducción

1. `python manage.py load_translations --lang es --dry-run` lista las obsoletas.
2. Compara el inglés nuevo con el anterior (`git log -p` del `.md` de origen), corrige la entrada
   y pon en `source_hash` el `KnowledgeRule.source_hash` actual de la regla
   (`manage.py shell -c "from coaching.models import KnowledgeRule as K; print(K.objects.get(key='…').source_hash)"`).
3. Una regla nueva necesita una entrada nueva en el archivo de su origen.
4. El test `coaching/tests/test_load_translations.py::test_every_loaded_rule_has_an_up_to_date_spanish_translation`
   falla mientras quede alguna regla sin traducción al día.

Criterios de la traducción: español de España; términos como en `frontend/messages/es.json`
(RPE, ACWR, e1RM, déficit, TDEE; "entrenador" para la persona y "coach" para la app); sin
traducir las etiquetas `[Sxxx]`/`[Fxxx]`, los DOI, los nombres de estudios, ecuaciones y escalas,
las cifras (con el punto decimal del original) ni los símbolos de unidad; las referencias a otra
regla entre comillas usan su título traducido.

## Licencia

Las traducciones de las reglas del coach son adaptaciones de contenido CC BY 4.0 de
[AI personal coach](https://github.com/matgarfer499/ai-personal-coach), de matgarfer499, y llevan
las dos atribuciones que indica `LICENSE-CONTENT.md` (la del autor, señalando que se han
traducido al español, y la de FightLab Pro por la traducción). Las del anexo de combate son
contenido propio de FightLab Pro, CC BY 4.0.
