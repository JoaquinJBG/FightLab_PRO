"""API de menús, gustos, recetario, alimentos y productos (fase 8). Solo usuarios autenticados.

- `GET/POST /coach/menu`: el último menú y generar uno nuevo (`coaching.menus`). Sin objetivos de
  kcal, `409 {"code": "no_calorie_targets", "reasons": …}`; sin un dato, `409 profile_incomplete`.
- `POST /coach/menu/check`: comprueba un borrador con el motor, sin guardar.
- `POST /coach/menu/rate`: valora un plato (los `loved` y `liked` van al recetario).
- `GET /coach/menu/<id>/pdf`: el menú y la lista de la compra en PDF (Task 8.5), hecho en memoria.
  Solo el dueño del menú; con los mismos bloqueos que preparar un menú (409).
- `GET/PUT /coach/tastes`, `GET /coach/recipes`.
- Fase 12: `GET /coach/menu?id=` (otro menú guardado), `POST /coach/menu/import` (JSON `schema: 1` o
  YAML del coach; si el mismo `id` ya está, lo sustituye y conserva lo tachado), `DELETE
  /coach/menu/<id>`, `PUT /coach/menu/<id>/shopping` (tachar una línea) y `GET/PUT /coach/kitchen`
  (menaje y comensales).
- `GET /coach/foods?q=`: alimentos del motor y productos, con el nombre en el idioma del usuario.
- `GET /coach/products/search?q=&brand=` y `GET /coach/products/lookup/<barcode>`: el proxy de
  Open Food Facts. Sin contacto configurado, `503 {"code": "off_not_configured"}` sin llamar a OFF.
- `GET/POST /coach/products` y `DELETE /coach/products/<barcode>`: el catálogo propio.
"""
from coach import catalogue, foods
from coach import tastes as coach_tastes
from django.http import Http404, HttpResponse
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.messages import msg

from . import kitchen, menu_import, menu_pdf, menus, off_proxy, products, shopping
from .menu_llm import get_proposer
from .models import CatalogueProduct, MealPlan
from .safety_views import _lang, _today

OFF_STATUS = {
    "off_not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
    "off_rate_limited": status.HTTP_429_TOO_MANY_REQUESTS,
    "off_busy": status.HTTP_503_SERVICE_UNAVAILABLE,
    "off_unavailable": status.HTTP_502_BAD_GATEWAY,
    "barcode_invalid": status.HTTP_400_BAD_REQUEST,
    "search_empty": status.HTTP_400_BAD_REQUEST,
}
OFF_ATTRIBUTION = {"source": catalogue.SOURCE, "licence": "ODbL", "url": "https://world.openfoodfacts.org/"}


def _invalid(exc: menus.MenuInvalid, http=status.HTTP_400_BAD_REQUEST) -> Response:
    params = {"per": exc.detail} if exc.code == "per_mismatch" else {}
    return Response({"code": exc.code, "detail": msg(f"menu_{exc.code}", **params), "info": exc.detail}, status=http)


def _off_error(exc: off_proxy.OffError) -> Response:
    return Response({"code": exc.code, "detail": msg(exc.code)}, status=OFF_STATUS.get(exc.code, 502))


def _blocked(exc: menus.MenuBlocked) -> Response:
    return Response(menus.blocked_data(exc, _lang()), status=status.HTTP_409_CONFLICT)


class MenuRequestSerializer(serializers.Serializer):
    start_date = serializers.DateField(required=False)
    days = serializers.IntegerField(min_value=1, max_value=menus.MAX_DAYS, default=3)
    meals = serializers.ListField(child=serializers.ChoiceField(menus.MEALS), required=False, max_length=4)
    tupper_meals = serializers.ListField(child=serializers.ChoiceField(menus.MEALS), required=False, max_length=4)
    batch = serializers.BooleanField(required=False, default=False)


class MenuView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        raw = request.query_params.get("id", "")
        plan_id = int(raw) if raw.isdigit() else None
        return Response(menus.state(request.user, _today(request.user.profile), _lang(), plan_id))

    def post(self, request):
        serializer = MenuRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user, lang = request.user, _lang()
        today = _today(user.profile)
        req = menus.MenuRequest(
            start_date=data.get("start_date") or today,
            days=data["days"],
            meals=data.get("meals") or list(menus.DEFAULT_MEALS),
            tupper_meals=data.get("tupper_meals") or [],
            batch=data["batch"],
        )
        try:
            plan, rejected = menus.generate(user, today, req, lang, get_proposer())
        except menus.MenuBlocked as exc:
            return _blocked(exc)
        except menus.MenuRejected as exc:
            return Response(
                {"code": "menu_rejected", "detail": msg("menu_menu_rejected"), "rejected": exc.rejected},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except menus.MenuInvalid as exc:
            return _invalid(exc)
        return Response(menus.plan_data(plan, user, lang), status=status.HTTP_201_CREATED)


class MenuCheckView(APIView):
    """Comprueba un borrador (`{"days": [...]}` en el formato de `coach.mealplan`)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        days = request.data.get("days") if isinstance(request.data, dict) else None
        if not isinstance(days, list) or not 1 <= len(days) <= menus.MAX_DAYS:
            return _invalid(menus.MenuInvalid("draft_invalid", "days"))
        try:
            return Response(menus.check_days(request.user, _today(request.user.profile), days))
        except menus.MenuBlocked as exc:
            return _blocked(exc)
        except menus.MenuInvalid as exc:
            return _invalid(exc)


class MenuPdfView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        plan = MealPlan.objects.filter(pk=pk, profile=request.user.profile).first()
        if plan is None:
            raise Http404
        user, lang = request.user, _lang()
        # Los flags de hoy mandan: si ya no hay objetivos de kcal (o falta un dato), tampoco hay
        # PDF de un menú comprobado contra ellos.
        try:
            menus.menu_targets(user, _today(user.profile))
        except menus.MenuBlocked as exc:
            return _blocked(exc)
        data = menus.plan_data(plan, user, lang)
        response = HttpResponse(menu_pdf.render(data, lang), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{menu_pdf.filename(data)}"'
        response["Cache-Control"] = "private, no-store"
        return response


IMPORT_STATUS = {
    "start_taken": status.HTTP_409_CONFLICT,
    "free_meal_refused": status.HTTP_409_CONFLICT,
}
IMPORT_MESSAGES = {
    "import_invalid": "menu_import_invalid",
    "import_too_long": "menu_import_too_long",
    "start_taken": "menu_start_taken",
    "free_meal_refused": "menu_free_meal_refused",
}


class MenuImportView(APIView):
    """Importa un menú completo (multipart: `file`, `replace_start`)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "coach-import"

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"code": "missing_file", "detail": msg("menu_import_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        user, lang = request.user, _lang()
        replace_start = request.data.get("replace_start") in ("1", "true")
        try:
            if upload.size > menu_import.MAX_BYTES:
                raise menu_import.ImportInvalid("import_invalid", "size")
            parsed = menu_import.parse_file(upload.name or "", upload.read())
            result = menu_import.save(user, parsed, _today(user.profile), replace_start=replace_start)
        except menu_import.ImportInvalid as exc:
            return Response(
                {"code": exc.code, "detail": msg(IMPORT_MESSAGES[exc.code], **exc.params), "info": exc.detail, "params": exc.params},
                status=IMPORT_STATUS.get(exc.code, status.HTTP_400_BAD_REQUEST),
            )
        return Response(
            {
                "summary": menu_import.summary(parsed),
                "replaced": result["replaced"],
                "kept_checks": result["kept_checks"],
                "menu": menus.plan_data(result["plan"], user, lang),
            },
            status=status.HTTP_200_OK if result["replaced"] else status.HTTP_201_CREATED,
        )


def _own_plan(request, pk) -> MealPlan:
    plan = MealPlan.objects.filter(pk=pk, profile=request.user.profile).first()
    if plan is None:
        raise Http404
    return plan


class MenuDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        _own_plan(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ShoppingCheckSerializer(serializers.Serializer):
    item = serializers.CharField(max_length=200)
    checked = serializers.BooleanField()


class MenuShoppingView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        plan = _own_plan(request, pk)
        serializer = ShoppingCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            shopping.set_checked(plan, d["item"], d["checked"])
        except ValueError:
            return Response({"item": ["empty"]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(shopping.shopping_data(plan, request.user, _lang()))


class KitchenView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(kitchen.kitchen_data(request.user.profile))

    def put(self, request):
        try:
            return Response(kitchen.save_kitchen(request.user.profile, request.data))
        except kitchen.KitchenInvalid as exc:
            return Response(
                {"code": exc.code, "detail": msg(f"menu_{exc.code}"), "info": exc.detail}, status=status.HTTP_400_BAD_REQUEST
            )


class RateSerializer(serializers.Serializer):
    dish = serializers.CharField(max_length=160)
    rating = serializers.ChoiceField(coach_tastes.RATINGS)
    source = serializers.URLField(max_length=500, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class MenuRateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = RateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            recipe = menus.rate(request.user, d["dish"], d["rating"], d["source"], _today(request.user.profile), d["note"])
        except menus.MenuInvalid as exc:
            return _invalid(exc)
        return Response({"recipe": menus.recipe_data(recipe), "tastes": menus.tastes_data(request.user)})


class TastesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(menus.tastes_data(request.user))

    def put(self, request):
        if not isinstance(request.data, dict):
            return _invalid(menus.MenuInvalid("tastes_invalid"))
        try:
            menus.tastes_update(request.user, dict(request.data))
        except menus.MenuInvalid as exc:
            return _invalid(exc)
        return Response(menus.tastes_data(request.user))


class RecipesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"recipes": menus.recipes_data(request.user)})


class FoodsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("q", "")[:80]
        return Response({"foods": products.search_foods(request.user, query, _lang())})


class _OffThrottled(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "coach-off"


class ProductSearchView(_OffThrottled):
    def get(self, request):
        words = request.query_params.get("q", "")[:120].split()
        brand = request.query_params.get("brand", "")[:60] or None
        try:
            hits = off_proxy.search(words, brand, _lang())
        except off_proxy.OffError as exc:
            return _off_error(exc)
        return Response({**OFF_ATTRIBUTION, "hits": [{**h, "rating": products.found_rating(h)} for h in hits]})


class ProductLookupView(_OffThrottled):
    def get(self, request, barcode):
        try:
            found = off_proxy.product(barcode)
        except off_proxy.OffError as exc:
            return _off_error(exc)
        if found is None:
            return Response({"code": "off_not_found", "detail": msg("menu_off_not_found")}, status=status.HTTP_404_NOT_FOUND)
        return Response({**OFF_ATTRIBUTION, "product": {**found, "rating": products.found_rating(found)}})


class ProductAddSerializer(serializers.Serializer):
    barcode = serializers.RegexField(r"^\d{8,14}$")
    chain = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    per = serializers.ChoiceField(list(foods.PER_UNITS), required=False, allow_null=True, default=None)
    confirm_per = serializers.BooleanField(required=False, default=False)


class ProductsView(APIView):
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.request.method == "POST":  # añadir lee de OFF
            self.throttle_scope = "coach-off"
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get(self, request):
        rows = CatalogueProduct.objects.filter(profile=request.user.profile)
        return Response({**OFF_ATTRIBUTION, "products": [products.product_data(p) for p in rows]})

    def post(self, request):
        serializer = ProductAddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            product, warnings = products.add_product(
                request.user, d["barcode"], _today(request.user.profile), d["chain"], d["name"], d["per"], d["confirm_per"]
            )
        except off_proxy.OffError as exc:
            return _off_error(exc)
        except menus.MenuInvalid as exc:
            http = status.HTTP_404_NOT_FOUND if exc.code == "off_not_found" else status.HTTP_400_BAD_REQUEST
            return _invalid(exc, http)
        return Response({"product": products.product_data(product), "warnings": warnings}, status=status.HTTP_201_CREATED)


class ProductDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, barcode):
        deleted, _ = CatalogueProduct.objects.filter(profile=request.user.profile, barcode=barcode).delete()
        if not deleted:
            raise Http404
        return Response(status=status.HTTP_204_NO_CONTENT)
