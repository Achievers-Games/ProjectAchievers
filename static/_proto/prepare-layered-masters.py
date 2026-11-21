"""Assemble les masters OpenRaster des prototypes et isole les rochers d'Ori."""

from io import BytesIO
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
from zipfile import ZIP_DEFLATED, ZipFile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent


def artwork(folder, name):
    return Image.open(ROOT / folder / name).convert("RGBA")


def write_master(folder, layers):
    width, height = layers[0][1].size
    document = Element("image", {"version": "0.0.3", "w": str(width), "h": str(height)})
    stack = SubElement(document, "stack")
    composite = Image.new("RGBA", (width, height))
    for _, layer in reversed(layers):
        if layer.size != composite.size:
            raise ValueError(f"Calque hors repère dans {folder}")
        composite = Image.alpha_composite(composite, layer)

    with ZipFile(ROOT / folder / "master.ora", "w") as archive:
        archive.writestr("mimetype", "image/openraster")

        def save_image(path, layer):
            buffer = BytesIO()
            layer.save(buffer, format="PNG")
            archive.writestr(path, buffer.getvalue())

        for index, (name, layer) in enumerate(layers):
            path = f"data/layer{index}.png"
            SubElement(stack, "layer", {"name": name, "src": path, "opacity": "1.0",
                                        "visibility": "visible", "composite-op": "svg:src-over",
                                        "x": "0", "y": "0"})
            save_image(path, layer)
        archive.writestr("stack.xml", tostring(document, encoding="utf-8"), ZIP_DEFLATED)
        save_image("mergedimage.png", composite)
        composite.thumbnail((256, 256), Image.LANCZOS)
        save_image("Thumbnails/thumbnail.png", composite)


def named_layers(folder, layers):
    return [(label, artwork(folder, filename)) for label, filename in layers]


def polygon(size, points, feather):
    matte = Image.new("L", size)
    ImageDraw.Draw(matte).polygon(points, fill=255)
    return matte.filter(ImageFilter.GaussianBlur(feather))


def split(layer, points):
    """Sépare la pièce en haut de pile et préserve le composite au raccord."""
    alpha = np.asarray(layer.getchannel("A"), dtype=np.float32) / 255
    share = np.asarray(polygon(layer.size, points, 3), dtype=np.float32) / 255
    piece_alpha = alpha * share
    rest_alpha = (alpha - piece_alpha) / np.maximum(1 - piece_alpha, 1 / 255)
    piece, rest = layer.copy(), layer.copy()
    piece.putalpha(Image.fromarray((255 * piece_alpha).round().astype(np.uint8)))
    rest.putalpha(Image.fromarray((255 * rest_alpha).round().astype(np.uint8)))
    return piece, rest


def ori_flight():
    folder = "ori-mythique"
    backdrop = artwork(folder, "bg.jpg")
    rocks = [
        ("Rocher haut", [(900, 0), (1103, 0), (1107, 177), (1102, 244), (1083, 318),
          (1054, 386), (1024, 420), (982, 374), (947, 340), (903, 295), (882, 248), (882, 208)]),
        ("Rocher bas gauche", [(145, 424), (169, 417), (190, 436), (200, 467), (199, 526),
          (186, 562), (168, 589), (147, 579), (124, 551), (109, 521), (108, 467), (126, 439)]),
        ("Petit rocher gauche", [(425, 192), (440, 182), (450, 187), (458, 204),
          (455, 226), (444, 233), (434, 220)]),
    ]
    atlas = Image.new("RGBA", backdrop.size)
    coverage = np.zeros((backdrop.height, backdrop.width), dtype=np.uint8)
    layers = []
    for name, points in rocks:
        matte = polygon(backdrop.size, points, 3)
        rock = backdrop.copy()
        rock.putalpha(matte)
        layers.append((name, rock))
        atlas = Image.alpha_composite(atlas, rock)
        coverage = np.maximum(coverage, np.asarray(matte))

    rgb = np.asarray(backdrop.convert("RGB"))
    hole = cv2.dilate((coverage > 18).astype(np.uint8), np.ones((19, 19), np.uint8))
    size = (backdrop.width // 4, backdrop.height // 4)
    fill = cv2.inpaint(cv2.resize(rgb, size, interpolation=cv2.INTER_AREA),
                       cv2.resize(hole, size, interpolation=cv2.INTER_NEAREST), 5, cv2.INPAINT_TELEA)
    fill = cv2.resize(fill, backdrop.size, interpolation=cv2.INTER_CUBIC)
    blend = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 7)[..., None]
    clean = Image.fromarray((rgb * (1 - blend) + fill * blend).round().astype(np.uint8))
    clean.save(ROOT / folder / "sky-clean.jpg", quality=93)
    atlas.save(ROOT / folder / "rocks.png", optimize=True)
    wing, ku = split(artwork(folder, "ku.png"), [(220, 278), (702, 315), (743, 374),
                    (686, 432), (485, 481), (261, 487)])
    write_master(folder, [("Ori", artwork(folder, "ori.png")), ("Ku — aile", wing),
                          ("Ku — corps", ku), *layers, ("Ciel reconstruit", clean.convert("RGBA"))])


if __name__ == "__main__":
    ori_flight()
    folder = "ori"
    ori_head, ori_body = split(artwork(folder, "ori.png"), [(1320, 210), (1475, 210),
                               (1475, 301), (1415, 306), (1388, 312), (1320, 310)])
    ku_head, ku_body = split(artwork(folder, "ku.png"), [(1200, 150), (1360, 150),
                             (1360, 245), (1309, 276), (1265, 284), (1200, 278)])
    write_master(folder, [("Premier plan", artwork(folder, "front.png")), ("Ori — tête", ori_head),
                         ("Ori — corps", ori_body), ("Ku — tête", ku_head), ("Ku — corps", ku_body),
                         *named_layers(folder, [("Branche", "branch.png"), ("Décor reconstruit", "bg.jpg")])])
    folder = "hades"
    head, body = split(artwork(folder, "zagreus-body.png"), [(452, 45), (560, 45), (554, 139),
                       (530, 169), (480, 169), (464, 139)])
    write_master(folder, [("Épée", artwork(folder, "zagreus-sword.png")), ("Zagreus — tête", head),
                         ("Zagreus — corps", body), ("Décor reconstruit", artwork(folder, "bg.jpg"))])
    folder = "hollow-knight"
    write_master(folder, named_layers(folder, [("Cape", "cloak.png"), ("Masque", "head.png"),
                 ("Aiguillon", "nail.png"), ("Pattes", "legs.png"), ("Plateforme", "platform.png"),
                 ("Épines", "thorns.png"), ("Décor lointain", "bg-far.jpg")]))
