from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from core.messages import msg

from .constants import MAX_ACTIVITIES_PER_DAY
from .models import Activity, SetLog
from .serializers import SetItemSerializer, SyncItemSerializer
from .sets import dropped_from_detail, set_logs_create, set_logs_for_new_activity

MAX_SYNC_ITEMS = 500


def _existing_id(user, cid: str) -> int | None:
    return (
        Activity.objects.filter(profile=user.profile, source=Activity.Source.MANUAL, external_id=cid)
        .values_list("id", flat=True)
        .first()
    )


def activity_create(*, user, raw, strict: bool = False) -> dict:
    """Crea una sesión de forma idempotente: {client_id, status, id?, errors?, warnings?}.

    status: `created` (fila nueva), `exists` (ya estaba: reintento, migración repetida o duplicado)
    o `invalid` (no pasa la validación, con el motivo en `errors`).

    Con `strict` (guardar desde la app, F17), una sesión de gimnasio sin `sets` cuyas series de
    `detail.exercises` no se pueden guardar se rechaza con el motivo. Sin él (la cola offline y la
    migración del navegador, donde un rechazo es terminal), se guarda lo que se puede y se avisa de
    lo que no en `warnings`: nunca se descarta en silencio.
    """
    cid = raw.get("client_id") if isinstance(raw, dict) else None
    ser = SyncItemSerializer(data=raw if isinstance(raw, dict) else {})
    if not ser.is_valid():
        return {"client_id": cid, "status": "invalid", "errors": ser.errors}
    data = dict(ser.validated_data)
    cid = data.pop("client_id")
    sets = data.pop("sets", None)
    existing = _existing_id(user, cid)
    if existing is not None:
        return {"client_id": cid, "status": "exists", "id": existing}
    dropped = dropped_from_detail(data.get("detail")) if data["kind"] == Activity.Kind.GYM and not sets else 0
    if dropped and strict:
        return {"client_id": cid, "status": "invalid", "errors": {"detail": [msg("sets_unreadable", n=dropped)]}}
    if sets and data["kind"] != Activity.Kind.GYM:
        return {"client_id": cid, "status": "invalid", "errors": {"sets": [msg("sets_only_gym")]}}
    day = timezone.localtime(data["started_at"]).date()
    if Activity.objects.filter(profile=user.profile, started_at__date=day).count() >= MAX_ACTIVITIES_PER_DAY:
        return {
            "client_id": cid,
            "status": "invalid",
            "errors": {"started_at": [msg("activities_max_per_day", n=MAX_ACTIVITIES_PER_DAY)]},
        }
    try:
        with transaction.atomic():
            act = Activity.objects.create(profile=user.profile, source=Activity.Source.MANUAL, external_id=cid, **data)
            set_logs_for_new_activity(act, sets)
    except IntegrityError:
        return {"client_id": cid, "status": "exists", "id": _existing_id(user, cid)}
    result = {"client_id": cid, "status": "created", "id": act.id}
    if dropped:
        result["warnings"] = {"dropped_sets": dropped}
    return result


def activities_sync(*, user, items: list) -> list[dict]:
    """Ingesta idempotente por item (la cola offline del cliente).

    `invalid` es TERMINAL: el cliente lo saca de su cola y enseña el motivo. El choque de la
    constraint única se captura con savepoint por item para no envenenar la transacción.
    Las series de gimnasio (`sets` o `detail.exercises`) se guardan en `SetLog` (Task 6.1).
    """
    return [activity_create(user=user, raw=raw) for raw in items]


def _volume(rows) -> float:
    # Como el resumen del historial: todas las series (con los calentamientos, como Hevy).
    total = sum((Decimal(r["weight_kg"] or 0) * (r["reps"] or 0) for r in rows), Decimal(0))
    return float(round(total, 2))


def activity_update(*, activity: Activity, data: dict) -> tuple[Activity | None, dict | None]:
    """Edita una sesión desde su detalle (F17): título, nota, RPE, inicio, duración y, en el
    gimnasio, sus series (las nuevas sustituyen a todas). Devuelve (actividad, None) o
    (None, errores): nada cambia si algo no es válido."""
    fields = {k: data[k] for k in ("title", "started_at", "duration_sec", "rpe", "note") if k in data}
    base = {
        "client_id": activity.external_id or "edit-00000000",
        "kind": activity.kind,
        "title": activity.title,
        "started_at": activity.started_at,
        "duration_sec": activity.duration_sec,
        "rpe": activity.rpe,
        "note": activity.note,
        **fields,
    }
    if "started_at" not in fields and base["started_at"] is not None:
        base["started_at"] = base["started_at"].isoformat()
    ser = SyncItemSerializer(data=base)
    errors = {} if ser.is_valid() else {k: v for k, v in ser.errors.items() if k in fields}
    sets = None
    if "sets" in data:
        if activity.kind != Activity.Kind.GYM:
            errors["sets"] = [msg("sets_only_gym")]
        else:
            sets_ser = SetItemSerializer(data=data["sets"], many=True)
            if not isinstance(data["sets"], list) or not sets_ser.is_valid():
                errors["sets"] = sets_ser.errors if isinstance(data["sets"], list) else [msg("sync_bad_format")]
            else:
                sets = list(sets_ser.validated_data)
                keys = [(r["exercise_index"], r["set_index"]) for r in sets]
                if len(keys) != len(set(keys)):
                    errors["sets"] = [msg("sets_duplicated")]
    if errors:
        return None, errors
    valid = ser.validated_data
    with transaction.atomic():
        for k in fields:
            setattr(activity, k, valid[k])
        if sets is not None:
            activity.sets.all().delete()
            set_logs_create(activity, sets)
            detail = dict(activity.detail or {})
            detail.pop("exercises", None)
            detail.pop("ex", None)
            detail["volume_kg"] = _volume(sets)
            activity.detail = detail
            activity.sets_truncated = False
        activity.save()
    return activity, None


def set_rows(activity: Activity) -> list[dict]:
    return [
        {
            "exercise": s.exercise,
            "exercise_key": s.exercise_key,
            "exercise_index": s.exercise_index,
            "set_index": s.set_index,
            "set_type": s.set_type,
            "weight_kg": float(s.weight_kg) if s.weight_kg is not None else None,
            "reps": s.reps,
            "rpe": float(s.rpe) if s.rpe is not None else None,
            "rir": float(s.rir) if s.rir is not None else None,
            "distance_km": float(s.distance_km) if s.distance_km is not None else None,
            "duration_s": s.duration_s,
            "superset": s.superset,
            "notes": s.notes,
            "rest_s": s.rest_s,
        }
        for s in SetLog.objects.filter(activity=activity).order_by("exercise_index", "set_index")
    ]
