# Backend de FightLab Pro

Django 6.0 + DRF. El motor del coach está vendorizado en `vendor/ai-personal-coach/` (paquete
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

El contenedor lanza `manage.py sync_knowledge --on-start` (ver `backend/Dockerfile` y
`docs/DEPLOY.md`, §6b), que carga cada conjunto de `coaching/knowledge_sync.py: knowledge_sets()`
solo si cambió la huella de sus archivos: `upstream`, `fightlab` y, el último, `translations-es`.

- Si un conjunto falla, los siguientes no se cargan (lo dice el log) y el arranque sigue.
- `translations-es` lleva `reload_after_previous`: se recarga también cuando se ha recargado una
  regla aunque sus archivos no cambien, para que una regla que vuelve a su texto anterior
  recupere su traducción al día.
- `KNOWLEDGE_SYNC_ON_START=False` lo desactiva; `manage.py sync_knowledge --force` lo carga todo.
