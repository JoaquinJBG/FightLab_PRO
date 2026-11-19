"""Foto de la base de datos con SQL crudo (no depende de los modelos de ninguna rama).

    python snapshot.py <DATABASE_URL> <salida.json>

Guarda, por cada tabla del esquema `public`, sus columnas y todas sus filas ordenadas por la
clave primaria. Los binarios (bytea) se guardan como sha256 + tamaño. `verify.py` compara la
foto de antes de migrar con la base de datos migrada: toda fila y toda columna que existía
tiene que seguir ahí con el mismo valor.
"""
import hashlib
import json
import sys
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

import psycopg2


def _plain(value):
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes):
        return {"sha256": hashlib.sha256(value).hexdigest(), "len": len(value)}
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    return value


def snapshot(dsn: str) -> dict:
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    )
    out = {}
    for (table,) in cur.fetchall():
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position",
            [table],
        )
        columns = [c for (c,) in cur.fetchall()]
        cur.execute(
            "SELECT a.attname FROM pg_index i JOIN pg_attribute a "
            "ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
            "WHERE i.indrelid = %s::regclass AND i.indisprimary",
            [f'public."{table}"'],
        )
        pk = [c for (c,) in cur.fetchall()]
        order = ", ".join(f'"{c}"' for c in (pk or columns))
        cols = ", ".join(f'"{c}"' for c in columns)
        cur.execute(f'SELECT {cols} FROM "{table}" ORDER BY {order}')
        rows = [[_plain(v) for v in row] for row in cur.fetchall()]
        out[table] = {"columns": columns, "pk": pk, "rows": rows}
    conn.close()
    return out


if __name__ == "__main__":
    data = snapshot(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, default=str)
    print(f"{len(data)} tablas, {sum(len(t['rows']) for t in data.values())} filas -> {sys.argv[2]}")
