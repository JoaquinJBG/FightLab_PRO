"""El menú y la lista de la compra en PDF (Task 8.5), generado en memoria.

El coach tiene `coach.export.write`, pero escribe el archivo en disco (`data/menus/*.pdf`). Aquí
el PDF se hace en un `BytesIO` y la API lo devuelve sin guardarlo (U17 en
`docs/coach-upstream-sugerencias.md`). Del motor se reutiliza lo que no toca disco: los textos
fijos en es/en (`export.LABELS`), la limpieza del texto para la fuente Latin-1 (`export._text`),
los números con coma o punto (`export._number`), qué fuente es un enlace web (`export.web_link`)
y el tamaño del QR (`export.QR_CM`). La maquetación sigue a `export.write`.

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
    title = f"{words['menu']} {first} {words['to']} {last}"
    story = [Paragraph(export._text(title), sheet["Title"])]
    targets = menu["targets"]
    for day in days:
        when = date.fromisoformat(day["date"])
        block = [Paragraph(f"{words['days'][when.weekday()]} {when.isoformat()}", day_style)]
        for meal in day["meals"]:
            name = extra["meals"].get(meal["meal"], meal["meal"])
            heading = export._text(name) + (f" ({words['tupper']})" if meal["tupper"] else "")
            if meal["free"]:
                block.append(Paragraph(f"{heading}: {words['free']}", meal_style))
                continue
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

    shopping = menu["shopping"]
    story.append(PageBreak())
    story.append(Paragraph(words["shopping"], sheet["Title"]))
    for group in shopping["chains"]:
        chain = words["any_chain"] if group["chain"] == "any" else group["chain"]
        story.append(Paragraph(export._text(chain), day_style))
        rows = [
            [Paragraph(export._text(line["name"]), body),
             f"{num(line['grams'])} g" if "grams" in line else f"{num(line['ml'])} ml"]
            for line in group["items"]
        ]
        grid = Table(rows, colWidths=[11 * cm, 4 * cm])
        grid.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
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
