from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle


class TrustedBffScopedRateThrottle(ScopedRateThrottle):
    """ScopedRateThrottle que identifica al cliente anónimo por su IP real.

    En el despliegue previsto (Vercel BFF -> Django en Render), las peticiones
    a /api/v1/auth/* le llegan a Django desde las pocas IPs de salida de
    Vercel, no desde el navegador del visitante: sin esto, el throttle por IP
    de DRF comparte un único contador entre TODA la beta (por ejemplo, solo
    caben ~10 intentos de login/min en total, y cualquiera puede agotarlos).

    La solución no es fiarse sin más de X-Forwarded-For (quien llame
    directamente al backend público de Render se saltaría el throttle
    cambiando esa cabecera en cada petición): solo se usa la IP que manda el
    BFF cuando la petición trae el secreto compartido (settings.BFF_SHARED_SECRET,
    vacío por defecto) en X-Bff-Secret. Si no coincide, o si el secreto no
    está configurado, se cae al comportamiento estándar de DRF (REMOTE_ADDR /
    X-Forwarded-For según NUM_PROXIES).
    """

    def get_ident(self, request):
        secret = settings.BFF_SHARED_SECRET
        if secret:
            sent_secret = request.headers.get("X-Bff-Secret")
            client_ip = request.headers.get("X-Bff-Client-Ip")
            if sent_secret and client_ip and sent_secret == secret:
                return client_ip.strip()
        return super().get_ident(request)
