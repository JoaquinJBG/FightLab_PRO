"""El menú y la lista de la compra en PDF (Task 8.5), generado en memoria.

El coach tiene `coach.export.write`, pero escribe el archivo en disco (`data/menus/*.pdf`). Aquí
el PDF se hace en un `BytesIO` y la API lo devuelve sin guardarlo (U20 en
`docs/coach-upstream-sugerencias.md`). Del motor se reutiliza lo que no toca disco: los textos
fijos en es/en (`export.LABELS`), la limpieza del texto para la fuente Latin-1 (`export._text`),
los números con coma o punto (`export._number`), qué fuente es un enlace web (`export.web_link`)
y el tamaño del QR (`export.QR_CM`). La maquetación sigue a `export.write`.

Fase 12: el PDF lleva también lo de los menús completos: lo que se prepara ese día (`prep`), lo que
se deja hecho la víspera, si el tupper sale de la nevera o del congelador, las sesiones de batch con
su cronograma por aparato y la lista de la compra por sección, con formato, semana y casilla.

No se calcula nada: todo sale de `menus.plan_data` (lo que el motor comprobó al guardar el menú y
la lista de la compra de `mealplan.shopping`). Cada receta con fuente web lleva su enlace y su QR
como atribución, y el pie cita las fuentes de los datos.
"""
from __future__ import annotations

from datetime import date
from io import BytesIO
from xml.sax.saxutils import escape

from coach import export
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Lo que `export.LABELS` no tiene: los nombres de las comidas (en FightLab son claves) y la
# atribución, que en el coach va en su README.
EXTRA = {
    "es": {
        "meals": {"breakfast": "Desayuno", "lunch": "Comida", "dinner": "Cena", "snack": "Merienda"},
        "own_dish": "Plato de ejemplo de FightLab, sin receta de origen",
        "unverified": "Open Food Facts, sin verificar",
        "status": {"ok": "bien", "under": "por debajo", "over": "por encima", "missing": "sin dato"},
        "check": "Comprobado por el motor del coach",
        "credits": "Alimentos: USDA FoodData Central (dominio público). Productos: Open Food Facts (ODbL), "
                   "datos colaborativos sin verificar. Cálculos: motor ai-personal-coach {sha}. "
                   "Cada receta enlaza a su fuente original.",
        "amounts": "Cantidades para la forma que dice cada nombre (crudo, cocido, escurrido).",
        "prep": "Ese día",
        "eve": "La víspera",
        "defrost": "pasar {dish} del congelador a la nevera",
        "storage": {"fridge": "de la nevera", "freezer": "del congelador"},
        "sessions": "Sesiones de batch",
        "session": "Sesión del {date} ({minutes} min)",
        "appliances": {"pressure_cooker": "Olla exprés", "pot": "Olla", "wok": "Wok", "frying_pan": "Sartén",
                       "air_fryer": "Air fryer", "oven": "Horno", "microwave": "Microondas", "hands": "Manos libres"},
        "substituted": "en lugar de {what}",
        "missing": "Sin aparato en tu cocina: {step}",
        "safety": "Enfriar y a la nevera antes de 2 h (el arroz, 1 h); etiquetar con plato y fecha; recalentar hasta que humee "
                  "(74 °C). Reglas de batch cooking del anexo de FightLab (AESAN, FSA, FSAI, USDA).",
        "weeks": {1: "semana 1", 2: "semana 2"},
        "both_weeks": "las dos semanas",
        "for_two": "para dos: {amount}",
        "other_section": "Otros",
        "free_budget": "libre (unas {kcal} kcal)",
    },
    "en": {
        "meals": {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "snack": "Snack"},
        "own_dish": "Sample FightLab dish, no source recipe",
        "unverified": "Open Food Facts, unverified",
        "status": {"ok": "on target", "under": "below", "over": "above", "missing": "no data"},
        "check": "Checked by the coach's engine",
        "credits": "Foods: USDA FoodData Central (public domain). Products: Open Food Facts (ODbL), "
                   "crowd-sourced and unverified. Calculations: ai-personal-coach engine {sha}. "
                   "Each recipe links to its original source.",
        "amounts": "Amounts are for the form each name gives (raw, cooked, drained).",
        "prep": "On the day",
        "eve": "The evening before",
        "defrost": "move {dish} from the freezer to the fridge",
        "storage": {"fridge": "from the fridge", "freezer": "from the freezer"},
        "sessions": "Batch sessions",
        "session": "Session on {date} ({minutes} min)",
        "appliances": {"pressure_cooker": "Pressure cooker", "pot": "Pot", "wok": "Wok", "frying_pan": "Frying pan",
                       "air_fryer": "Air fryer", "oven": "Oven", "microwave": "Microwave", "hands": "Hands free"},
        "substituted": "instead of {what}",
        "missing": "No appliance in your kitchen for: {step}",
        "safety": "Cool and refrigerate within 2 h (rice, 1 h); label with dish and date; reheat until steaming hot "
                  "(74 °C). Batch-cooking rules from FightLab's annex (AESAN, FSA, FSAI, USDA).",
        "weeks": {1: "week 1", 2: "week 2"},
        "both_weeks": "both weeks",
        "for_two": "for two: {amount}",
        "other_section": "Other",
        "free_budget": "free (about {kcal} kcal)",
    },
}
CHECK_KEYS = ("kcal", "protein_g", "fat_g", "fibre_g")


def filename(menu: dict) -> str:
    return f"fightlab-menu-{menu['start_date']}.pdf"


def render(menu: dict, lang: str) -> bytes:
    """El PDF de `menu` (lo que devuelve `menus.plan_data`) en `lang`."""
    lang = lang if lang in export.LABELS else "es"
    words, extra = export.LABELS[lang], EXTRA[lang]
    comma = lang == "es"

    def num(value) -> str:
        return export._number(value, comma)

    sheet = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=sheet["BodyText"], fontSize=10, leading=13)
    small = ParagraphStyle("small", parent=body, fontSize=9, leading=11, textColor=colors.grey)
    day_style = ParagraphStyle("day", parent=sheet["Heading2"], spaceBefore=6, spaceAfter=4, keepWithNext=1)
    meal_style = ParagraphStyle("meal", parent=body, fontName="Helvetica-Bold", fontSize=11, keepWithNext=1)
    dish_style = ParagraphStyle("dish", parent=body, fontName="Helvetica-Bold", leftIndent=8)
    indent = ParagraphStyle("indent", parent=body, leftIndent=18)

    def qr_code(url: str):
        widget = QrCodeWidget(url)
        x0, y0, x1, y1 = widget.getBounds()
        size = export.QR_CM * cm
        drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
        drawing.add(widget)
        return drawing

    days = menu["days"]
    first, last = days[0]["date"], days[-1]["date"]
    title = menu.get("title") or f"{words['menu']} {first} {words['to']} {last}"
    story = [Paragraph(export._text(title), sheet["Title"])]
    targets = menu["targets"]
    for day in days:
        when = date.fromisoformat(day["date"])
        block = [Paragraph(f"{words['days'][when.weekday()]} {when.isoformat()}", day_style)]
        for task in day.get("eve") or []:
            text = task.get("text") or extra["defrost"].format(dish=task.get("dish") or "")
            block.append(Paragraph(f"{extra['eve']}: {export._text(text)}", small))
        for meal in day["meals"]:
            name = meal.get("label") or extra["meals"].get(meal["meal"], meal["meal"])
            heading = export._text(name) + (f" ({words['tupper']})" if meal["tupper"] else "")
            storage = meal.get("storage")
            if storage:
                heading += f", {extra['storage'][storage['where']]}"
            if meal["free"]:
                budget = meal.get("free_budget_kcal")
                label = extra["free_budget"].format(kcal=num(budget)) if budget else words["free"]
                block.append(Paragraph(f"{heading}: {export._text(label)}", meal_style))
                continue
            for line in meal.get("prep") or []:
                block.append(Paragraph(f"{extra['prep']}: {export._text(line)}", small))
            head = [Paragraph(heading, meal_style)]
            for dish in meal["dishes"]:
                parts = head + [Paragraph(export._text(dish["dish"]), dish_style)]
                head = []  # el nombre de la comida va con su primer plato
                if dish["servings"] > 1:
                    parts.append(Paragraph(words["batch"].format(n=dish["servings"]), small))
                for item in dish["items"]:
                    line = f"{item['name']}: {num(item['amount'])} {item['unit']}"
                    if item["product"]:
                        line += f" ({extra['unverified']})"
                    parts.append(Paragraph("&bull; " + export._text(line), indent))
                if dish["seasoning"]:
                    parts.append(Paragraph(f"{words['seasoning']}: {export._text(', '.join(dish['seasoning']))}", indent))
                for n, step in enumerate(dish["steps"], 1):
                    parts.append(Paragraph(f"{n}. {export._text(step)}", indent))
                source = (dish["source"] or "").strip()
                url = export.web_link(source) if source else None
                if url:
                    link = Paragraph(
                        f'{words["source"]}: <link href="{escape(url, {chr(34): "&quot;"})}" color="blue">'
                        f"{export._text(url)}</link>",
                        small,
                    )
                    grid = Table([[link, qr_code(url)]], colWidths=[12.5 * cm, 3.4 * cm])
                    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
                    parts.append(grid)
                elif source:  # no es una dirección web: solo el texto
                    parts.append(Paragraph(f"{words['source']}: {export._text(source)}", small))
                else:
                    parts.append(Paragraph(export._text(extra["own_dish"]), small))
                block.append(KeepTogether(parts))
                block.append(Spacer(1, 4))
        check = day.get("check")
        if check:
            tot = check["totals"]
            cells = [
                f"kcal {num(tot['kcal'])} / {words['target']} {num(targets['kcal'])}",
                f"{words['protein']} {num(tot['protein_g'])} / {words['target']} {num(targets['protein_g'])}",
                f"{words['carbs']} {num(tot['carbs_g'])}",
                f"{words['fat']} {num(tot['fat_g'])} / {words['target']} {num(targets['fat_min_g'])}",
                f"{words['fibre']} {num(tot['fibre_g'])} / {words['target']} {num(targets['fibre_g'])}",
            ]
            labels = {"kcal": "kcal", "protein_g": words["protein"], "fat_g": words["fat"], "fibre_g": words["fibre"]}
            status = ", ".join(f"{labels[k]}: {extra['status'][check['check'][k]]}" for k in CHECK_KEYS)
            block.append(Paragraph(f"<b>{words['totals']}</b>: {export._text('; '.join(cells))}", small))
            block.append(Paragraph(export._text(f"{extra['check']}: {status}"), small))
        story += block

    sessions = menu.get("batch_sessions") or []
    if sessions:
        story.append(PageBreak())
        story.append(Paragraph(extra["sessions"], sheet["Title"]))
        for session in sessions:
            story.append(Paragraph(extra["session"].format(date=session["date"], minutes=session["total_min"]), day_style))
            for task in session.get("eve") or []:
                story.append(Paragraph(f"{extra['eve']}: {export._text(task)}", small))
            rows = []
            for line in session["timeline"]:
                where = extra["appliances"].get(line["where"], line["where"])
                if line.get("substituted_from"):
                    what = extra["appliances"].get(line["substituted_from"], "")
                    where += " (" + extra["substituted"].format(what=what) + ")"
                rows.append([f"{line['min']}-{line['until']}", Paragraph(export._text(where), body),
                             Paragraph(export._text(line["step"]), body)])
            if rows:
                grid = Table(rows, colWidths=[2 * cm, 4 * cm, 10 * cm])
                grid.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                                          ("VALIGN", (0, 0), (-1, -1), "TOP")]))
                story.append(grid)
            for miss in session.get("missing") or []:
                story.append(Paragraph(export._text(extra["missing"].format(step=miss["step"])), small))
        story.append(Spacer(1, 6))
        story.append(Paragraph(export._text(extra["safety"]), small))

    shopping = menu["shopping"]
    listing = menu.get("shopping_list") or {"sections": []}
    story.append(PageBreak())
    story.append(Paragraph(words["shopping"], sheet["Title"]))
    if listing.get("note"):
        story.append(Paragraph(export._text(listing["note"]), small))
    for group in listing["sections"]:
        story.append(Paragraph(export._text(group["section"] or extra["other_section"]), day_style))
        rows = []
        for line in group["items"]:
            name = line["name"] + (f" ({line['pack']})" if line.get("pack") else "")
            if line.get("chain"):
                name += f" - {line['chain']}"
            amount = f"{num(line['amount'])} {line['unit']}" if line.get("amount") is not None else ""
            if line.get("amount_two"):
                amount += " / " + extra["for_two"].format(amount=f"{num(line['amount_two'])} {line['unit']}")
            weeks = line.get("when") or []
            when = extra["both_weeks"] if len(weeks) > 1 else (extra["weeks"].get(weeks[0], "") if weeks else "")
            rows.append(["[x]" if line.get("checked") else "[  ]", Paragraph(export._text(name), body),
                         Paragraph(export._text(amount), body), Paragraph(export._text(when), small)])
        grid = Table(rows, colWidths=[1 * cm, 8 * cm, 4.5 * cm, 2.5 * cm])
        grid.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                                  ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(grid)
    if shopping["batches"]:
        story.append(Paragraph(words["batches"], day_style))
        for batch in shopping["batches"]:
            line = f"{batch['dish']}: {batch['servings']} {words['servings']}"
            if batch["left_over"]:
                line += f" ({words['left_over'].format(n=batch['left_over'])})"
            story.append(Paragraph("&bull; " + export._text(line), body))
    if shopping["pantry_skipped"]:
        story.append(Paragraph(words["pantry"], day_style))
        story.append(Paragraph(export._text(", ".join(shopping["pantry_skipped"])), body))
    story.append(Spacer(1, 8))
    story.append(Paragraph(export._text(extra["amounts"]), small))
    story.append(Paragraph(export._text(extra["credits"].format(sha=menu["engine_sha"])), small))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"{words['page']} {doc.page}")
        canvas.restoreState()

    out = BytesIO()
    SimpleDocTemplate(
        out,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title=title,
        creator="FightLab",
    ).build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()
