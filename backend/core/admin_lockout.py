import functools

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse

from users.throttling import client_ip


def _key(request) -> str:
    return f"admin-login-failures:{client_ip(request)}"


def lockout_login(login_view):
    """Envuelve admin.site.login: bloquea una IP tras demasiados fallos.

    Un POST de login que no redirige (se vuelve a pintar el formulario) es un
    fallo; un acceso correcto redirige y borra el contador.
    """

    @functools.wraps(login_view)
    def wrapper(request, *args, **kwargs):
        if request.method != "POST":
            return login_view(request, *args, **kwargs)
        key = _key(request)
        if cache.get(key, 0) >= settings.ADMIN_LOGIN_MAX_FAILURES:
            return HttpResponse(
                "Demasiados intentos fallidos. Inténtalo más tarde.",
                status=429,
                content_type="text/plain; charset=utf-8",
            )
        response = login_view(request, *args, **kwargs)
        if response.status_code in (301, 302):
            cache.delete(key)
        else:
            cache.add(key, 0, settings.ADMIN_LOGIN_LOCKOUT_SECONDS)
            try:
                cache.incr(key)
            except ValueError:
                cache.set(key, 1, settings.ADMIN_LOGIN_LOCKOUT_SECONDS)
        return response

    return wrapper
