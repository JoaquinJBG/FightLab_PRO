from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import (
    MeView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
)

urlpatterns = [
    path("auth/register", RegisterView.as_view(), name="register"),
    path("auth/verify-email", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/verify-email/resend", ResendVerificationView.as_view(), name="verify-email-resend"),
    path("auth/login", TokenObtainPairView.as_view(), name="login"),
    path("auth/refresh", TokenRefreshView.as_view(), name="refresh"),
    path("me", MeView.as_view(), name="me"),
]
