"""Comprueba la base de datos tras `migrate` con feat/beta-coach frente a la foto de antes.

    python verify.py <DATABASE_URL> <antes.json>

1. Ninguna tabla, columna ni fila de antes se ha perdido ni ha cambiado de valor
   (salvo `django_migrations`, que solo gana filas, y la caché de BD, que es volátil).
2. Las migraciones de datos de la integración hacen lo esperado con los datos de la beta:
   `activities/0003_setlog_from_detail` (series desde `detail.exercises` y desde el formato
   compacto `ex`; las sesiones sin desglose quedan `sets_truncated`; nada inventado) y los campos
   nuevos del perfil y de la biometría con su valor por defecto.
Sale con código 1 si algo falla.
"""
import json
import sys

import psycopg2

from snapshot import snapshot

VOLATILE = {"django_cache_table"}
# Las rellena Django tras migrar (post_migrate): ganan filas por los modelos nuevos, sin perder ninguna.
GROWS = {"auth_permission", "django_content_type"}
failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("OK   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def main(dsn: str, before_path: str) -> None:
    before = json.load(open(before_path, encoding="utf-8"))
    after = snapshot(dsn)

    # 1. Nada de antes se pierde
    for table, old in before.items():
        if table in VOLATILE:
            continue
        new = after.get(table)
        check(new is not None, f"tabla {table} sigue existiendo")
        if new is None:
            continue
        missing = [c for c in old["columns"] if c not in new["columns"]]
        check(not missing, f"{table}: conserva sus {len(old['columns'])} columnas" + (f" (faltan {missing})" if missing else ""))
        if missing:
            continue
        idx = [new["columns"].index(c) for c in old["columns"]]
        projected = [[row[i] for i in idx] for row in new["rows"]]
        if table == "django_migrations":
            old_rows = {json.dumps(r[1:], default=str) for r in old["rows"]}  # sin el id
            new_rows = {json.dumps(r[1:], default=str) for r in projected}
            check(old_rows <= new_rows, f"django_migrations: las {len(old_rows)} aplicadas siguen aplicadas")
            continue
        if table in GROWS:
            old_rows = {json.dumps(r, default=str) for r in old["rows"]}
            new_rows = {json.dumps(r, default=str) for r in projected}
            check(old_rows <= new_rows, f"{table}: sus {len(old_rows)} filas siguen igual (+{len(new_rows) - len(old_rows)} nuevas)")
            continue
        check(projected == old["rows"], f"{table}: {len(old['rows'])} filas idénticas a antes")

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    def one(sql, params=()):
        cur.execute(sql, params)
        return cur.fetchall()

    # 2a. Migraciones de la beta: mismo nombre (no renombradas) y aplicadas
    applied = {(a, n) for a, n in one("SELECT app, name FROM django_migrations")}
    for name in [
        "0003_progressphoto_add_data_fields", "0004_backfill_progressphoto_data", "0005_progressphoto_drop_image",
        "0006_backfill_profiles", "0007_biometric_range_validators",
        "0008_profile_coach_fields", "0009_biometrics_body_fat_method",
    ]:
        check(("profiles", name) in applied, f"profiles.{name} aplicada")
    check(("profiles", "0003_profile_coach_fields") not in applied, "sin el nombre viejo profiles.0003_profile_coach_fields")
    for app, name in [("ai", "0001_initial"), ("userstate", "0001_initial"), ("userstate", "0002_clamp_future_updated_at"),
                      ("activities", "0002_setlog"), ("activities", "0003_setlog_from_detail"),
                      ("coaching", "0006_weeklyreview")]:
        check((app, name) in applied, f"{app}.{name} aplicada")

    # 2b. SetLog desde detail
    def sets_of(cid):
        return one(
            "SELECT s.exercise, s.exercise_index, s.set_index, s.weight_kg, s.reps "
            "FROM activities_setlog s JOIN activities_activity a ON a.id = s.activity_id "
            "WHERE a.external_id = %s ORDER BY s.exercise_index, s.set_index", [cid])

    def truncated(cid):
        return one("SELECT sets_truncated FROM activities_activity WHERE external_id = %s", [cid])[0][0]

    full = sets_of("c-gym-full")
    check(len(full) == 5 and full[0][0] == "Sentadilla" and str(full[2][3]) == "102.50" and full[3][3] is None,
          f"GYM completo: 5 series, 102.5 kg, dominadas con peso corporal (null) -> {full}")
    check(not truncated("c-gym-full"), "GYM completo: no truncada")
    compact = sets_of("c-gym-compact")
    check([(r[0], r[2], r[4]) for r in compact] == [("Press banca", 0, 10), ("Press banca", 1, 8), ("Fondos", 0, 12)],
          f"GYM compacto (`ex`): 3 series -> {compact}")
    check(not truncated("c-gym-compact"), "GYM compacto: no truncada")
    check(sets_of("c-gym-cut") == [] and truncated("c-gym-cut"), "GYM sin desglose: 0 series y sets_truncated")
    odd = sets_of("c-gym-odd")
    check([(r[3] is not None and str(r[3]), r[4]) for r in odd] == [("50.00", 10)], f"GYM con serie ilegible: solo la válida -> {odd}")
    check(sets_of("c-gym-bare") == [] and not truncated("c-gym-bare"), "GYM sin detail: nada y no truncada")
    others = one("SELECT count(*) FROM activities_setlog s JOIN activities_activity a ON a.id = s.activity_id WHERE a.kind <> 'GYM'")[0][0]
    check(others == 0, "ninguna serie en deporte ni MMA")

    # 2c. Campos nuevos con su valor por defecto
    langs = one("SELECT DISTINCT language FROM profiles_userprofile")
    check(langs == [("es",)], f"perfiles existentes con language='es' -> {langs}")
    lists = one("SELECT count(*) FROM profiles_userprofile WHERE medications <> '[]'::jsonb OR conditions <> '[]'::jsonb OR disciplines <> '[]'::jsonb")[0][0]
    check(lists == 0, "medicaciones, condiciones y disciplinas vacías")
    methods = one("SELECT DISTINCT body_fat_method FROM profiles_biometricslog")
    check(methods == [("",)], f"biometría existente con body_fat_method='' -> {methods}")
    conn.close()

    print()
    print("RESULTADO:", "todo bien" if not failures else f"{len(failures)} fallos")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
