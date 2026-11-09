"""API del catálogo de cadena privado (fase 13). Solo el dueño ve y toca sus productos.

- `GET /coach/chain-products?q=&rating=`: el catálogo con su valoración, los recuentos y los
  umbrales del motor con su fuente.
- `DELETE /coach/chain-products?chain=`: borra todo el catálogo (o el de una cadena).
- `POST /coach/chain-products/import`: multipart con `file` (el CSV), `chain` (por defecto
  Mercadona) y `dry_run` (`1`: la vista previa, sin guardar nada).
- `POST /coach/chain-products/shopping`: `{"items": [{"name", "grams"}], "chain"?}` → producto,
  formato y coste estimado de cada alimento (la lista de la compra de la fase 12).
- `GET /coach/substitutes?food=&grams=`: sustitutos isocalóricos (los `evitar`, al final).

Un archivo que no se puede leer responde 400 con `{"code", "params"}`; la app traduce `code`.
"""
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import chain_catalogue, chain_import, product_rating
from .bridge.importers import MAX_IMPORT_BYTES, ImportFileError
from .safety_views import _lang


def _bad(code: str, params: dict | None = None) -> Response:
    return Response({"code": code, "params": params or {}}, status=status.HTTP_400_BAD_REQUEST)


def _chain(value) -> str:
    return " ".join(str(value or "").split())[:80]


class ChainProductsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rating = request.query_params.get("rating", "")
        if rating and rating not in product_rating.RATINGS:
            return _bad("bad_rating")
        query = request.query_params.get("q", "")[:80]
        return Response(chain_catalogue.catalogue_data(request.user, query, rating))

    def delete(self, request):
        chain = _chain(request.query_params.get("chain")) or None
        return Response({"deleted": chain_catalogue.delete_all(request.user, chain)})


class ChainImportView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "coach-import"

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return _bad("missing_file")
        if upload.size > MAX_IMPORT_BYTES:
            return _bad("too_large", {"mb": MAX_IMPORT_BYTES // (1024 * 1024)})
        if not upload.name.lower().endswith((".csv", ".txt")):
            return _bad("not_csv")
        chain = _chain(request.data.get("chain")) or chain_import.DEFAULT_CHAIN
        dry_run = request.data.get("dry_run") in ("1", "true")
        try:
            parsed = chain_import.parse(upload.read())
        except ImportFileError as exc:
            return _bad(exc.code, exc.params)
        result = chain_import.import_catalogue(request.user, parsed, chain=chain, dry_run=dry_run)
        return Response(result, status=status.HTTP_200_OK if dry_run else status.HTTP_201_CREATED)


class ShoppingItemSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    grams = serializers.FloatField(min_value=0, max_value=100_000, required=False, allow_null=True)


class ShoppingSerializer(serializers.Serializer):
    items = ShoppingItemSerializer(many=True, max_length=chain_catalogue.SHOPPING_MAX_ITEMS)
    chain = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")


class ChainShoppingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ShoppingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        return Response(chain_catalogue.shopping_for(request.user, d["items"], _chain(d["chain"]) or None))


class SubstitutesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        food = request.query_params.get("food", "")[:200].strip()
        try:
            grams = float(request.query_params.get("grams", "100"))
        except ValueError:
            return _bad("bad_grams")
        if not food:
            return _bad("missing_food")
        if not 0 < grams <= 2000:
            return _bad("bad_grams")
        result = chain_catalogue.substitutes(request.user, food, grams, _lang())
        if result is None:
            return Response({"code": "food_unknown", "params": {}}, status=status.HTTP_404_NOT_FOUND)
        return Response(result)
