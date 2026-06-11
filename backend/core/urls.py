from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("users.urls")),
    path("api/v1/", include("profiles.urls")),
]

if settings.DEBUG:
    # Sirve las fotos subidas en desarrollo (en producción lo hará el servidor web)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
