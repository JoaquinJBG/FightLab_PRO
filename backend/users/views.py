from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from . import services
from .serializers import (
    MeSerializer,
    NormalizedTokenObtainPairSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    VerifyEmailSerializer,
)
from .throttling import TrustedBffScopedRateThrottle


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
                {"detail": "Registro solo por invitación"},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            services.user_create(**serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_201_CREATED)


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.email_verify(**serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Email verified"}, status=status.HTTP_200_OK)


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
