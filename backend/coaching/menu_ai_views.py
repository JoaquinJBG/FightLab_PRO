"""API de los menús con la IA del propio usuario (fase 14). El servidor nunca llama a una IA.

Con el token personal (`Authorization: Bearer flm_…`, `menu_tokens`) o con la sesión de la app:

- `GET /menu/context?start=&days=&meals=&tupper=`: objetivos, gustos, recetario, Mi cocina,
  alimentos del motor, catálogo resumido, menús recientes, un esqueleto del JSON e instrucciones,
  en el idioma del usuario (`menu_context.context_data`). Sin objetivos de kcal, 409 como
  `/coach/menu` (y sin un dato del perfil, el 409 `profile_incomplete` de `core.exceptions`).
- `POST /menu/import` `{"menu": <objeto o texto>, "dry_run": bool, "replace_start": bool}`: el
  importador de la F12 con la comprobación del motor. `dry_run` solo comprueba; si no, guarda con
  origen `user_ai` (201, o 200 si sustituye el mismo `id`).

Solo con la sesión de la app (la usa la vía C, copiar y pegar, a través del BFF):
`GET /coach/menu/context` y `POST /coach/menu/paste`, iguales pero sin aceptar el token.
"""
from __future__ import annotations

from datetime import date

from django.utils import translation
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from core.messages import msg

from . import menu_context, menu_import, menus
from .menu_tokens import MenuTokenAuthentication
from .menu_views import IMPORT_MESSAGES, IMPORT_STATUS, _blocked
from .models import MenuApiToken
from .safety_views import _lang, _today

PASTE_MESSAGES = {
    **IMPORT_MESSAGES,
    "paste_empty": "menu_paste_empty",
    "paste_not_json": "menu_paste_not_json",
    "paste_no_schema": "menu_paste_no_schema",
    "no_valid_days": "menu_no_valid_days",
}


def _import_error(exc: menu_import.ImportInvalid) -> Response:
    return Response(
        {"code": exc.code, "detail": msg(PASTE_MESSAGES.get(exc.code, "menu_import_invalid"), **exc.params),
         "info": exc.detail, "params": exc.params, **exc.extra},
        status=IMPORT_STATUS.get(exc.code, status.HTTP_400_BAD_REQUEST),
    )


def _meals(raw: str) -> list[str] | None:
    """`breakfast,lunch` → lista sin repetir, en el orden de `menus.MEALS`; `None` si no vale."""
    words = [w.strip() for w in raw.split(",") if w.strip()]
    if any(w not in menus.MEALS for w in words):
        return None
    return [m for m in menus.MEALS if m in words]


class _MenuAiView(APIView):
    """Con el token no hay navegador: el idioma es el del perfil del usuario (con la sesión de la
    app manda el de la petición, que el BFF ya toma del perfil)."""

    authentication_classes = [MenuTokenAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "menu-ai"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if isinstance(request.auth, MenuApiToken) and request.user.profile.language in ("es", "en"):
            translation.activate(request.user.profile.language)


class MenuContextView(_MenuAiView):

    def get(self, request):
        q = request.query_params
        user = request.user
        today = _today(user.profile)
        start = None
        if q.get("start"):
            try:
                start = date.fromisoformat(q["start"])
            except ValueError:
                return Response({"code": "start_invalid", "detail": msg("menu_start_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        raw_days = q.get("days", str(menu_context.DEFAULT_DAYS))
        days = int(raw_days) if raw_days.isdigit() else 0
        if not 1 <= days <= menu_context.MAX_DAYS:
            return Response({"code": "days_invalid", "detail": msg("menu_ai_days_invalid", max=menu_context.MAX_DAYS)}, status=status.HTTP_400_BAD_REQUEST)
        meals = _meals(q.get("meals", "")) if q.get("meals") else list(menus.DEFAULT_MEALS)
        tupper = _meals(q.get("tupper", "")) if q.get("tupper") else []
        if not meals or tupper is None:
            return Response({"code": "meals_invalid", "detail": msg("menu_meals_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = menu_context.context_data(user, today, _lang(), start=start, days=days, meals=meals, tupper=tupper)
        except menus.MenuBlocked as exc:
            return _blocked(exc)
        response = Response(data)
        response["Cache-Control"] = "private, no-store"
        return response


class MenuAiImportView(_MenuAiView):
    parser_classes = [JSONParser]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        user = request.user
        today = _today(user.profile)
        try:
            parsed = menu_context.parse_pasted(body.get("menu"))
            if body.get("dry_run") is True:
                return Response(menu_context.check_data(user, parsed, today))
            result = menu_import.save(user, parsed, today, replace_start=body.get("replace_start") is True)
        except menu_import.ImportInvalid as exc:
            return _import_error(exc)
        plan = result["plan"]
        checks = plan.checks or []
        # R4-1: los días que no cuadran no se guardan; vuelven con su motivo (`rejected`).
        rejected = result.get("rejected") or []
        return Response(
            {
                "summary": menu_import.summary(parsed),
                "replaced": result["replaced"],
                "kept_checks": result["kept_checks"],
                "checked": bool(checks),
                "days_ok": sum(1 for c in checks if c.get("ok")),
                "days_failing": [r["date"] for r in rejected] + [c["date"] for c in checks if not c.get("ok")],
                "rejected": rejected,
                "menu": menus.plan_data(plan, user, _lang()),
            },
            status=status.HTTP_200_OK if result["replaced"] else status.HTTP_201_CREATED,
        )


class AppMenuContextView(MenuContextView):
    """La misma vista solo con la sesión de la app (la usa «Prepararlo con mi IA»)."""

    authentication_classes = api_settings.DEFAULT_AUTHENTICATION_CLASSES


class AppMenuPasteView(MenuAiImportView):
    """Pegar en la app el JSON que devuelve la IA: el mismo importador, solo con la sesión de la app."""

    authentication_classes = api_settings.DEFAULT_AUTHENTICATION_CLASSES
