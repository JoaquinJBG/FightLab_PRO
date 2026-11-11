"""API del escáner de código de barras (`coaching.barcode`). Solo el dueño ve lo suyo.

- `GET /coach/barcode/<código>`: `{source, product}` (`source`: `chain`, `catalogue`, `manual` u
  `off`; los de OFF llevan su atribución ODbL). Si nadie lo tiene, `404 {"code": "not_found",
  "barcode", "off"}`, donde `off` es `null` si OFF contestó que no lo tiene, o el código de por qué
  no se pudo preguntar (`off_not_configured`, `off_rate_limited`, `off_busy`, `off_unavailable`):
  la app ofrece crearlo a mano en los dos casos. Un código que no son 8 a 14 cifras es `400
  barcode_invalid` y no se pregunta a nadie.
- `POST /coach/barcode/<código>`: crea (o edita) a mano el producto de ese código con los valores
  de la etiqueta. `409 barcode_taken` si el código ya es de la cadena o de un producto de OFF
  guardado; `400 name_taken` si el nombre choca con un alimento del motor o con otro producto.
"""
import re

from coach import foods
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import barcode, off_proxy
from .menu_views import OFF_ATTRIBUTION
from .menus import MenuInvalid
from .safety_views import _today

CODE = re.compile(r"\d{8,14}")
MAX_G = 100  # g por 100 g: no puede haber más
MAX_KCAL = 900  # la grasa pura (9 kcal/g), como `coach.off.MAX_KCAL_PER_100G`


def _grams():
    return serializers.FloatField(min_value=0, max_value=MAX_G, required=False, allow_null=True, default=None)


class ManualProductSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    brand = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    chain = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    per = serializers.ChoiceField(list(foods.PER_UNITS))
    kcal = serializers.FloatField(min_value=0, max_value=MAX_KCAL)
    protein_g = _grams()
    carbs_g = _grams()
    fat_g = _grams()
    fibre_g = _grams()
    saturates_g = _grams()
    sugars_g = _grams()
    salt_g = _grams()


def _bad_code(code: str) -> Response:
    return Response({"code": "barcode_invalid", "barcode": code}, status=status.HTTP_400_BAD_REQUEST)


class BarcodeView(APIView):
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.request.method == "GET":  # puede acabar en OFF
            self.throttle_scope = "coach-off"
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get(self, request, code):
        if not CODE.fullmatch(code):
            return _bad_code(code)
        try:
            found = barcode.lookup(request.user, code)
        except off_proxy.OffError as exc:
            if exc.code == "barcode_invalid":
                return _bad_code(code)
            return Response({"code": "not_found", "barcode": code, "off": exc.code}, status=status.HTTP_404_NOT_FOUND)
        if found is None:
            return Response({"code": "not_found", "barcode": code, "off": None}, status=status.HTTP_404_NOT_FOUND)
        source, product = found
        body = {"source": source, "product": product}
        if source == "off":
            body["attribution"] = OFF_ATTRIBUTION
        return Response(body)

    def post(self, request, code):
        if not CODE.fullmatch(code):
            return _bad_code(code)
        serializer = ManualProductSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            product, warnings = barcode.create_manual(request.user, code, serializer.validated_data,
                                                      _today(request.user.profile))
        except MenuInvalid as exc:
            http = status.HTTP_409_CONFLICT if exc.code == "barcode_taken" else status.HTTP_400_BAD_REQUEST
            return Response({"code": exc.code}, status=http)
        return Response({"source": "manual", "product": barcode.catalogue_out(product), "warnings": warnings},
                        status=status.HTTP_201_CREATED)
