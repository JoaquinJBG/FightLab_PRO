from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, validators=[validate_password])


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    # Sin validators=[validate_password] a propósito: aquí no hay usuario
    # todavía (el uid se resuelve dentro del servicio), y sin usuario
    # UserAttributeSimilarityValidator no puede comparar la contraseña con
    # el email. La fuerza de la contraseña se valida en
    # services.password_reset_confirm, ya con el usuario resuelto.
    password = serializers.CharField(write_only=True)


class NormalizedTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Normaliza el email (strip + lower) antes de autenticar.

    CustomUserManager.normalize_email (heredado de BaseUserManager) solo pone
    en minúsculas el DOMINIO, no la parte local: un superusuario creado con
    createsuperuser o un alta desde el admin con mayúsculas en esa parte
    (p. ej. "Joaquin@x.com") se guarda tal cual. Como el login busca por
    coincidencia exacta, ese usuario no podría entrar aunque escriba su email
    en minúsculas. Se resuelve el email tal y como está guardado (búsqueda
    case-insensitive) antes de delegar en la autenticación estándar de
    simplejwt/Django, que sí compara de forma exacta.
    """

    def validate(self, attrs):
        field = self.username_field  # "email"
        value = attrs.get(field)
        if isinstance(value, str):
            value = value.strip().lower()
            existing = User.objects.filter(email__iexact=value).first()
            attrs[field] = existing.email if existing is not None else value
        return super().validate(attrs)


class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "role", "is_email_verified")
        read_only_fields = fields
