#!/usr/bin/env bash
# Ensayo de la migración de producción (feat/beta-cloud -> feat/beta-coach) en LOCAL.
# No toca Neon: usa una base de datos vacía de un Postgres local. Ver README.md.
#
#   BETA_DIR=<checkout de feat/beta-cloud>  NEW_DIR=<checkout de feat/beta-coach> \
#   PY=<python 3.12 con requirements.txt> DATABASE_URL=postgres://.../fightlab_beta_prod \
#   bash backend/scripts/migration_rehearsal/run.sh
#
# La base de datos de DATABASE_URL se BORRA y se vuelve a crear: no apuntes nunca a producción.
set -euo pipefail

: "${BETA_DIR:?checkout del commit de producción (git worktree add --detach <dir> origin/feat/beta-cloud)}"
: "${NEW_DIR:?checkout de feat/beta-coach}"
: "${PY:?python con las dependencias de backend/requirements.txt}"
: "${DATABASE_URL:?base de datos LOCAL de usar y tirar}"
case "$DATABASE_URL" in
  *neon.tech*|*render.com*) echo "DATABASE_URL parece de producción: abortado" >&2; exit 2 ;;
esac

# pwd -W: ruta de Windows en Git Bash (el Python de Windows no entiende /c/...)
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
OUT="${OUT_DIR:-$HERE/out}"
mkdir -p "$OUT"
export ENV_FILE=/nonexistent DEBUG=True PYTHONUTF8=1 SECRET_KEY=rehearsal-not-a-secret
DB_NAME="${DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
ADMIN_URL_DB="${DATABASE_URL%/*}/postgres"

echo "== 1. Base de datos vacía: $DB_NAME"
"$PY" - "$ADMIN_URL_DB" "$DB_NAME" <<'EOF'
import sys, psycopg2
conn = psycopg2.connect(sys.argv[1]); conn.autocommit = True
cur = conn.cursor()
cur.execute(f'DROP DATABASE IF EXISTS "{sys.argv[2]}"')
cur.execute(f'CREATE DATABASE "{sys.argv[2]}"')
EOF

echo "== 2. migrate + createcachetable con el código de producción ($(git -C "$BETA_DIR" rev-parse --short HEAD))"
(cd "$BETA_DIR/backend" && "$PY" manage.py migrate --noinput && "$PY" manage.py createcachetable)
(cd "$BETA_DIR/backend" && "$PY" manage.py showmigrations --list) > "$OUT/showmigrations_beta.txt"

echo "== 3. Datos inventados con la forma de los reales"
(cd "$BETA_DIR/backend" && "$PY" manage.py shell -c "exec(open(r'$HERE/seed_beta.py', encoding='utf-8').read())")
"$PY" "$HERE/snapshot.py" "$DATABASE_URL" "$OUT/before.json"

echo "== 4. Plan y migrate con feat/beta-coach ($(git -C "$NEW_DIR" rev-parse --short HEAD))"
cd "$NEW_DIR/backend"
export PYTHONPATH=vendor/ai-personal-coach
"$PY" manage.py migrate --plan > "$OUT/plan.txt"
cat "$OUT/plan.txt"
"$PY" manage.py migrate --noinput
"$PY" manage.py createcachetable
"$PY" manage.py makemigrations --check --dry-run
"$PY" manage.py showmigrations --list > "$OUT/showmigrations_beta_coach.txt"

echo "== 5. Comprobación"
(cd "$HERE" && "$PY" verify.py "$DATABASE_URL" "$OUT/before.json")
