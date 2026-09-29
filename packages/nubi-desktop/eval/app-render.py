# Draws the window of a simulated app as a picture: labels, values and states
# at the place of each control. Evaluation only. Reads one JSON object from
# standard input and writes a PNG to its "output" path.
# Needs Pillow and a font with Korean glyphs. When either is missing it exits
# with status 3 and the caller writes a plain picture instead.
import json, os, sys
try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    sys.exit(3)

FONTS = ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
         "C:\\Windows\\Fonts\\malgun.ttf", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
         "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]

def font(size):
    for path in FONTS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    sys.exit(3)

def text_of(control):
    kind, name = control["type"], control["name"]
    if kind == "Edit":
        value = "●●●●●●" if control.get("password") else control.get("value", "")
        return f"{name}: [{value}]" + ("  (읽기 전용)" if control.get("readOnly") else "")
    if kind == "ComboBox":
        return f"{name}: [{control.get('value', '')} ▼]"
    if kind == "CheckBox":
        return ("[✓] " if control.get("toggle") == "On" else "[  ] ") + name
    if kind == "ListItem":
        return ("(선택됨) " if control.get("selected") == "True" else "") + name
    if kind == "Button":
        return f"[ {name} ]"
    return name

def main():
    spec = json.load(sys.stdin)
    image = Image.new("RGB", (spec["width"], spec["height"]), (250, 250, 250))
    draw, face = ImageDraw.Draw(image), font(15)
    draw.rectangle([0, 0, spec["width"] - 1, 18], fill=(225, 230, 238))
    draw.text((8, 1), spec["title"], fill=(30, 30, 30), font=font(12))
    for control in spec["controls"]:
        x, y, w, h = control["x"], control["y"], control["width"], control["height"]
        fill = (235, 235, 235) if control.get("enabled") is False else (255, 255, 255)
        if control["type"] not in ("Group", "Text"):
            draw.rectangle([x, y, x + w - 1, y + h - 1], fill=fill, outline=(150, 150, 150))
        draw.text((x + 6, y + 4), text_of(control), fill=(20, 20, 20), font=face)
    crop = spec.get("crop")
    if crop:
        image = image.crop((crop["x"], crop["y"], crop["x"] + crop["width"], crop["y"] + crop["height"]))
    image.save(spec["output"], "PNG")

main()
