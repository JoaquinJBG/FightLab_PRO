from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        token_str = request.data.get("refresh")
        if not token_str:
            return Response({"detail": "refresh required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            RefreshToken(token_str).blacklist()
        except TokenError:
            return Response({"detail": "invalid token"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_205_RESET_CONTENT)
