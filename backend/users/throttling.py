from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle


class TrustedBffIdentityMixin:
    """Identifica al visitante anónimo por su IP real detrás del BFF.

    En el despliegue previsto (Vercel BFF -> Django en Render), las peticiones
    a /api/v1/auth/* le llegan a Django desde las pocas IPs de salida de
    Vercel, no desde el navegador del visitante: sin esto, el throttle por IP
    de DRF comparte un único contador entre TODA la beta (por ejemplo, solo
    caben ~10 intentos de login/min en total, y cualquiera puede agotarlos).

    La solución no es fiarse sin más de X-Forwarded-For (quien llame
    directamente al backend público de Render, sin pasar por el BFF, se
    saltaría el throttle cambiando esa cabecera en cada petición): solo se
    usa la IP que manda el BFF en X-Bff-Client-Ip cuando la petición trae
    también el secreto compartido (settings.BFF_SHARED_SECRET, vacío por
    defecto) en X-Bff-Secret. Si no coincide, o si el secreto no está
    configurado, se cae al comportamiento estándar de DRF (REMOTE_ADDR /
    X-Forwarded-For según NUM_PROXIES, que debe valer 1: la única llamada
    directa posible a Django es la del propio borde de Render).
    """

    def get_ident(self, request):
        secret = settings.BFF_SHARED_SECRET
        if secret:
            sent_secret = request.headers.get("X-Bff-Secret")
            client_ip = request.headers.get("X-Bff-Client-Ip")
            if sent_secret and client_ip and sent_secret == secret:
                return client_ip.strip()
        return super().get_ident(request)


class TrustedBffScopedRateThrottle(TrustedBffIdentityMixin, ScopedRateThrottle):
    """ScopedRateThrottle con identidad de confianza (ver TrustedBffIdentityMixin).

    La usan explícitamente las vistas de auth (login, register, resend,
    password-reset...) con su propio throttle_scope.
    """


class TrustedBffAnonRateThrottle(TrustedBffIdentityMixin, UserRateThrottle):
    """Reemplaza a UserRateThrottle en DEFAULT_THROTTLE_CLASSES.

    UserRateThrottle.get_cache_key ya identifica a las peticiones
    autenticadas por request.user.pk sin llamar a get_ident, así que ahí no
    cambia nada: el scope "user" sigue siendo por usuario. Para las
    peticiones anónimas que llegan a una vista SIN throttle_classes propio
    (por ejemplo VerifyEmailView), get_cache_key sí llama a get_ident: este
    mixin hace que también esas confíen en X-Bff-Client-Ip+X-Bff-Secret en
    vez de compartir un único contador por la IP de salida del BFF.
    """
