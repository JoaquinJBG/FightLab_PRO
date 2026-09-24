from .models import UserState


def state_get_many(*, profile, keys):
    return UserState.objects.filter(profile=profile, key__in=keys)


def state_get_range(*, profile, prefix, date_from=None, date_to=None):
    """Lee todas las claves `prefix<sufijo>` de un perfil, opcionalmente acotadas por
    un rango `[date_from, date_to]` comparado como texto sobre la clave completa.
    Funciona porque los sufijos de fecha son YYYY-MM-DD (orden lexicográfico = cronológico)."""
    qs = UserState.objects.filter(profile=profile, key__startswith=prefix)
    if date_from:
        qs = qs.filter(key__gte=f"{prefix}{date_from}")
    if date_to:
        qs = qs.filter(key__lte=f"{prefix}{date_to}")
    return qs
