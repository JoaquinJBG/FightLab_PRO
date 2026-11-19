"""Tokens personales de API para preparar menús con la IA del propio usuario (fase 14, vía B).

El usuario crea un token en Perfil → Mi IA y lo usa la skill de Claude Code de su PC
(`tools/claude-skill/fightlab-menu`), con su propia suscripción: el servidor nunca llama a una IA.

- El token (`flm_` + 43 caracteres aleatorios) se enseña **una sola vez** al crearlo. En la base
  de datos solo queda su SHA-256 y el principio (`prefix`) para reconocerlo en la lista. Con 256
  bits aleatorios basta un hash rápido: no hay nada que adivinar por fuerza bruta.
- **Alcance:** solo lo aceptan las vistas que ponen `MenuTokenAuthentication` en sus
  `authentication_classes` (leer el contexto del menú y subir un menú). En el resto de la API el
  token no vale: la autenticación por defecto es la del JWT, que lo rechaza con 401.
- **Revocar** lo deja inservible al momento. Una cuenta desactivada tampoco puede usarlo.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions, serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.messages import msg

from .models import MenuApiToken

PREFIX = "flm_"
KEYWORD = "Bearer"
# convention (FightLab): pocos tokens a la vez (uno por PC o por IA); revocar libera el hueco.
MAX_ACTIVE = 5
PREFIX_SHOWN = 10  # "flm_" y 6 caracteres: basta para reconocerlo y no sirve para nada
# `last_used_at` no se escribe en cada petición: con este margen basta para "usado hace…".
TOUCH_EVERY = timedelta(minutes=1)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create(profile, name: str) -> tuple[MenuApiToken, str]:
    """Crea un token y devuelve la fila y el token en claro (lo único que lo enseña)."""
    raw = PREFIX + secrets.token_urlsafe(32)
    row = MenuApiToken.objects.create(profile=profile, name=name, prefix=raw[:PREFIX_SHOWN], token_hash=hash_token(raw))
    return row, raw


def active(profile):
    return MenuApiToken.objects.filter(profile=profile, revoked_at__isnull=True)


def token_data(row: MenuApiToken) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "prefix": row.prefix,
        "created_at": row.created_at.isoformat(),
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "scope": ["menu:context", "menu:import"],
    }


class MenuTokenAuthentication(authentication.BaseAuthentication):
    """`Authorization: Bearer flm_…`. Con otra cosa (un JWT, nada) devuelve `None` y deja paso a la
    siguiente autenticación de la vista."""

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1")
        keyword, _, raw = header.partition(" ")
        raw = raw.strip()
        if keyword != KEYWORD or not raw.startswith(PREFIX):
            return None
        row = (
            MenuApiToken.objects.select_related("profile__user")
            .filter(token_hash=hash_token(raw), revoked_at__isnull=True)
            .first()
        )
        user = row.profile.user if row else None
        if row is None or not user.is_active:
            raise exceptions.AuthenticationFailed(msg("menu_token_invalid"), code="menu_token_invalid")
        now = timezone.now()
        if row.last_used_at is None or now - row.last_used_at > TOUCH_EVERY:
            MenuApiToken.objects.filter(pk=row.pk).update(last_used_at=now)
        return user, row

    def authenticate_header(self, request):
        return KEYWORD


class TokenCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=MenuApiToken._meta.get_field("name").max_length, trim_whitespace=True)


class MenuTokensView(APIView):
    """`GET /coach/menu-tokens` (los activos) y `POST` (crear: el token va en la respuesta, una vez).
    Solo con la sesión de la app (JWT): un token no puede crear ni ver otros."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = active(request.user.profile)
        return Response({"tokens": [token_data(r) for r in rows], "max": MAX_ACTIVE})

    def post(self, request):
        serializer = TokenCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = request.user.profile
        if active(profile).count() >= MAX_ACTIVE:
            return Response(
                {"code": "menu_token_limit", "detail": msg("menu_token_limit", max=MAX_ACTIVE)},
                status=status.HTTP_409_CONFLICT,
            )
        row, raw = create(profile, " ".join(serializer.validated_data["name"].split()))
        return Response({**token_data(row), "token": raw}, status=status.HTTP_201_CREATED)


class MenuTokenDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        updated = active(request.user.profile).filter(pk=pk).update(revoked_at=timezone.now())
        if not updated:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
