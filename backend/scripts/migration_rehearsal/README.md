# Ensayo de la migración de producción (feat/beta-cloud → feat/beta-coach)

Reproduce en LOCAL lo que pasará en Neon al desplegar `feat/beta-coach`, sin tocar Neon ni usar
sus credenciales:

1. Base de datos vacía en un Postgres local (se borra y se crea).
2. `migrate` + `createcachetable` con el código de producción (`feat/beta-cloud`).
3. Datos inventados con la forma de los reales (`seed_beta.py`): usuarios verificados, sin
   verificar y admin; perfiles; biometría (peso, grasa, FC, VFC, perímetros, una de Garmin); fotos
   de progreso guardadas en Postgres; actividades de gimnasio con `detail.exercises` completo, con
   el formato compacto `ex` que usa la beta cuando no cabe, sin desglose (`volume_kg` solo), con
   una serie ilegible y sin `detail`; deporte, MMA e historial de 4 semanas; estado de `userstate`
   (`nutri_*`, `water_*`, `coach_memory`, `weigh`...); uso de la IA.
4. Foto de TODAS las tablas con SQL crudo (`snapshot.py`, independiente de los modelos).
5. `migrate --plan` y `migrate` con `feat/beta-coach`, `makemigrations --check`.
6. `verify.py`: ninguna tabla, columna ni fila de antes se pierde ni cambia; las migraciones de la
   beta siguen aplicadas con su nombre; `activities/0003_setlog_from_detail` crea las series
   esperadas (formato completo y compacto, peso corporal como null, descarta la serie ilegible,
   marca `sets_truncated` solo donde no hay desglose); los campos nuevos tienen su valor por
   defecto (`language='es'`, listas vacías, `body_fat_method=''`).

## Cómo lanzarlo

```bash
# checkout aparte del commit de producción (no cambia ninguna rama)
git worktree add --detach ../fl-beta-prod origin/feat/beta-cloud

BETA_DIR=../fl-beta-prod NEW_DIR=. \
PY=/ruta/al/python-3.12-con-requirements \
DATABASE_URL=postgres://fightlab:fightlab@127.0.0.1:5432/fightlab_rehearsal \
bash backend/scripts/migration_rehearsal/run.sh

git worktree remove ../fl-beta-prod
```

`PY` necesita `backend/requirements.txt` (vale el mismo venv para las dos ramas). Las salidas
(`before.json`, `plan.txt`, `showmigrations_*.txt`) quedan en `out/` (ignorada por git) o en
`OUT_DIR`. El script se niega a seguir si `DATABASE_URL` apunta a Neon o a Render.

Sin Docker, un Postgres local de usar y tirar sale con el paquete `pgserver`
(`pip install pgserver`; `pgserver.get_server("<carpeta>")` da la URI).
