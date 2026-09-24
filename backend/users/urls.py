from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .logout import LogoutView
from .views import (
    MeView,
    NormalizedTokenObtainPairView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
)

urlpatterns = [
    path("auth/register", RegisterView.as_view(), name="register"),
    path("auth/verify-email", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/verify-email/resend", ResendVerificationView.as_view(), name="verify-email-resend"),
    path("auth/login", NormalizedTokenObtainPairView.as_view(), name="login"),
    path("auth/refresh", TokenRefreshView.as_view(), name="refresh"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("auth/password-reset", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "auth/password-reset/confirm",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("me", MeView.as_view(), name="me"),
]
