from django.db import IntegrityError, transaction

from .models import Activity
from .serializers import SyncItemSerializer

MAX_SYNC_ITEMS = 500


def activities_sync(*, user, items: list) -> list[dict]:
    """Ingesta idempotente por item.

    Cada resultado es {client_id, status, id?, errors?} con status:
    - created: fila nueva
    - exists:  ya estaba (reintento, migración repetida o duplicado en el lote)
    - invalid: no pasa validación — TERMINAL: el cliente debe sacarlo de su cola
    El choque de la constraint única se captura con savepoint por item para no
    envenenar la transacción (Postgres aborta la transacción tras un IntegrityError).
    """
    results: list[dict] = []
    for raw in items:
        cid = raw.get("client_id") if isinstance(raw, dict) else None
        ser = SyncItemSerializer(data=raw if isinstance(raw, dict) else {})
        if not ser.is_valid():
            results.append({"client_id": cid, "status": "invalid", "errors": ser.errors})
            continue
        data = dict(ser.validated_data)
        cid = data.pop("client_id")
        try:
            with transaction.atomic():
                act = Activity.objects.create(
                    profile=user.profile,
                    source=Activity.Source.MANUAL,
                    external_id=cid,
                    **data,
                )
            results.append({"client_id": cid, "status": "created", "id": act.id})
        except IntegrityError:
            existing = (
                Activity.objects.filter(
                    profile=user.profile, source=Activity.Source.MANUAL, external_id=cid
                )
                .values_list("id", flat=True)
                .first()
            )
            results.append({"client_id": cid, "status": "exists", "id": existing})
    return results
