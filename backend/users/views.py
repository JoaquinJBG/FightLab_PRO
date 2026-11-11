from django.utils.translation import get_language
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.messages import msg

from . import services
from .serializers import (
    MeSerializer,
    NormalizedTokenObtainPairSerializer,
    PasswordResetCheckSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    VerifyEmailSerializer,
)
from .throttling import TrustedBffScopedRateThrottle
from .tokens import generate_password_reset_uid_and_token


class NormalizedTokenObtainPairView(TokenObtainPairView):
    """Login (email+password -> access/refresh) con throttle propio y el
    email normalizado (strip + lower) antes de autenticar."""

    serializer_class = NormalizedTokenObtainPairSerializer
    throttle_classes = [TrustedBffScopedRateThrottle]
    throttle_scope = "login"


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [TrustedBffScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        if not services.is_beta_email_allowed(email):
            return Response(
                {"detail": msg("register_invite_only")},
                status=status.HTTP_403_FORBIDDEN,
            )
        services.user_create(**serializer.validated_data, language=get_language())
        return Response(status=status.HTTP_201_CREATED)


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = services.email_verify(**serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        # Cuentas heredadas sin contraseña utilizable (por ejemplo, de antes
        # de este fix, cuando un re-registro sí la invalidaba): el email
        # queda verificado, pero un login normal daría 401 sin ninguna pista
        # de qué hacer. Se manda ya un uid/token de reset para que el
        # frontend pueda saltar directo a /reset-password.
        if not user.has_usable_password():
            uid, token = generate_password_reset_uid_and_token(user)
            return Response(
                {"detail": "Email verified", "needs_password": True, "uid": uid, "token": token},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"detail": "Email verified", "needs_password": False},
            status=status.HTTP_200_OK,
        )


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [TrustedBffScopedRateThrottle]
    throttle_scope = "resend"

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.verification_resend(**serializer.validated_data)
        # Always 200 to avoid leaking which emails are registered.
        return Response({"detail": "If the account exists, an email was sent"})


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [TrustedBffScopedRateThrottle]
    throttle_scope = "password-reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.password_reset_request(**serializer.validated_data)
        # Siempre 200: no revela si el email existe.
        return Response({"detail": "If the account exists, an email was sent"})


class PasswordResetCheckView(APIView):
    """¿Vale el enlace de recuperación? Si vale, el email de la cuenta (F27)."""

    permission_classes = [AllowAny]
    throttle_classes = [TrustedBffScopedRateThrottle]
    throttle_scope = "password-reset-check"

    def post(self, request):
        serializer = PasswordResetCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = services.password_reset_email(**serializer.validated_data)
        if email is None:
            return Response({"detail": "Invalid or expired reset link"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"email": email}, status=status.HTTP_200_OK)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [TrustedBffScopedRateThrottle]
    throttle_scope = "password-reset-confirm"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.password_reset_confirm(**serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Password updated"}, status=status.HTTP_200_OK)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)
