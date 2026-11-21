"""Reprend les textures de prepare-art.py et produit la marionnette continue."""

import json
import sys
from io import BytesIO
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
from zipfile import ZIP_DEFLATED, ZipFile

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
BODY = Image.open(ROOT / "zagreus.png").convert("RGBA")
SIZE = BODY.size
SCALE = SIZE[0] / 1920
WIDTH, HEIGHT = SIZE
source_path = next((Path(arg) for arg in sys.argv[1:] if arg != "--master"), ROOT / "source.webp")
SOURCE = Image.open(source_path).convert("RGB")

# Tracé dans les pixels du master 1920 × 1079. Le bord de la lame rencontre
# l'oreille gauche vers (897, 363) et réapparaît derrière le laurier à droite.
HEAD_CONTOUR = [
    (820, 271), (862, 257), (886, 241), (866, 231), (863, 225), (879, 224),
    (870, 211), (881, 216), (864, 197), (866, 194), (892, 200), (930, 205),
    (951, 215), (945, 179), (946, 175), (971, 199), (987, 220), (984, 207),
    (992, 226), (1010, 198), (1013, 202), (1019, 226), (1027, 218), (1030, 217),
    (1028, 229), (1022, 233), (1023, 252), (1026, 266), (1028, 252), (1032, 244),
    (1037, 252), (1040, 267), (1040, 284), (1035, 298), (1033, 311),
    (1029, 323), (1020, 335), (1021, 346), (1020, 356), (1017, 364), (1013, 369),
    (1017, 378), (1014, 382), (1008, 375), (1009, 408), (1014, 442), (1022, 470),
    (901, 477), (913, 448), (916, 416), (916, 386), (914, 370), (906, 369),
    (898, 364), (893, 357), (889, 348), (887, 334), (883, 348), (878, 347),
    (869, 326), (865, 333), (863, 333), (867, 314), (856, 294), (837, 302),
    (835, 298), (850, 286), (847, 279), (858, 274), (829, 275),
]
BLADE_CONTOUR = [
    (808, 418), (1243, 137), (1304, 100), (1324, 96), (1328, 106), (1328, 118),
    (1323, 128), (1307, 142), (847, 457),
]


def artwork(name):
    return Image.open(ROOT / name).convert("RGBA")


def mask(points, feather=0):
    matte = np.zeros((HEIGHT, WIDTH), np.uint8)
    cv2.fillPoly(matte, [np.rint(np.array(points) * SCALE).astype(np.int32)], 255)
    if feather:
        matte = cv2.GaussianBlur(matte, (0, 0), feather * SCALE)
    return matte


# Réunir les pixels visibles avant de les déformer. Le même triangle porte les deux
# côtés du raccord, de sorte que l'aisselle reste fermée même en position haute.
arm = artwork("arm.png")
figure = Image.alpha_composite(Image.alpha_composite(BODY, arm), artwork("front.png"))
pixels = np.array(figure)

# Sous la garde, prolonger le raccord biceps–pectoraux avec les tons de peau proches.
# Le contour sert aussi de réserve quand la garde et le bras quittent leur pose d'origine.
join = mask(
    [(755, 494), (776, 475), (812, 473), (851, 478), (861, 495),
     (848, 555), (816, 571), (787, 606), (766, 576), (751, 535)],
    1.7,
)
opaque = pixels[..., 3]
missing = (join > 20) & (opaque < 220)
if np.any(missing):
    patch = np.zeros_like(pixels[..., :3])
    source = np.asarray(SOURCE)
    highlight = source[594, 768].astype(np.float32)
    shaded = source[538, 811].astype(np.float32)
    ys, xs = np.nonzero(missing)
    shade = np.clip((xs / SCALE - 755) / 125 + (ys / SCALE - 480) / 420, 0, 1)
    patch[ys, xs] = highlight * (1 - shade[:, None]) + shaded * shade[:, None]
    fill = np.dstack((patch, np.where(missing, join, 0).astype(np.uint8)))
    figure = Image.alpha_composite(Image.fromarray(fill), figure)

# Éliminer les îlots isolés du détourage après la fusion. Les feuilles détachées
# sont déjà un calque à part, tandis que l'épée ne fait pas partie de cette silhouette.
pixels = np.array(figure)
# Le masque du personnage d'origine contient aussi l'épée. Remplacer la zone
# de contact par le contour tracé dans le master et supprimer le métal du corps.
head = mask(HEAD_CONTOUR, 0.55).astype(np.float32) / 255
blade_matte = mask(BLADE_CONTOUR, 0.65).astype(np.float32) / 255
y, x = np.mgrid[:HEIGHT, :WIDTH].astype(np.float32)
source_rgb = np.asarray(SOURCE.resize(SIZE, Image.LANCZOS))
head_zone = (x > 808 * SCALE) & (x < 1045 * SCALE) & (y < 382 * SCALE)
pixels[head_zone, :3] = source_rgb[head_zone]
pixels[head_zone, 3] = (head[head_zone] * 255).round().astype(np.uint8)
blade_contact = (blade_matte > 0.02) & (x > 835 * SCALE) & (y < 452 * SCALE) & ~head_zone
pixels[blade_contact, 3] = np.minimum(pixels[blade_contact, 3], (head[blade_contact] * 255).round())
# Le filet original dépasse de quelques pixels sous le biseau reconstruit.
# Suivre le bord gauche de la nuque et retirer le triangle de métal résiduel.
neck_blade_spill = mask(
    [(842, 432), (862, 415), (883, 396), (915, 394), (914, 421),
     (911, 428), (900, 435), (886, 440), (865, 443), (842, 449)],
    0.6,
).astype(np.float32) / 255
pixels[..., 3] = (pixels[..., 3] * (1 - neck_blade_spill)).round().astype(np.uint8)
# Des reflets de la garde ont été prolongés verticalement dans l'ancien bras
# reconstruit. Évider cette encoche au-dessus du poignet, le biceps reste entier.
guard_spill = mask(
    [(751, 441), (818, 436), (824, 471), (809, 484), (795, 486),
     (781, 498), (773, 506), (766, 507), (764, 493), (757, 487)],
    0.75,
).astype(np.float32) / 255
pixels[..., 3] = (pixels[..., 3] * (1 - guard_spill)).round().astype(np.uint8)
_, labels, stats, _ = cv2.connectedComponentsWithStats((pixels[..., 3] > 108).astype(np.uint8))
main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
keep = cv2.dilate((labels == main).astype(np.uint8), np.ones((5, 5), np.uint8))
pixels[..., 3] *= keep
figure = Image.fromarray(pixels)


def paint_patch(outline, shade_shapes):
    """Peint une petite surface cachée avec les couleurs visibles du master."""
    patch = Image.new("RGBA", SIZE)
    for points, sample in shade_shapes:
        color = SOURCE.getpixel(sample)
        stroke = Image.new("RGBA", SIZE, (*color, 0))
        stroke.putalpha(Image.fromarray(mask(points, 0.65)))
        patch = Image.alpha_composite(patch, stroke)
    alpha = np.asarray(patch.getchannel("A"), dtype=np.float32)
    patch.putalpha(Image.fromarray((alpha * mask(outline, 0.65) / 255).round().astype(np.uint8)))
    return patch


# Retouches séparées du détourage. Les contours reprennent sous la lame et
# la garde et chaque plage de couleur est prélevée sur la même matière.
neck_outline = [(895, 447), (906, 434), (913, 422), (916, 404), (920, 425), (920, 448)]
neck_patch = paint_patch(neck_outline, [
    (neck_outline, (927, 429)),
    ([(895, 447), (907, 432), (913, 421), (913, 441), (907, 448)], (917, 451)),
])
shoulder_outline = [(772, 506), (782, 492), (795, 480), (813, 479), (830, 487), (829, 514), (802, 524)]
shoulder_patch = paint_patch(shoulder_outline, [
    (shoulder_outline, (782, 541)),
    ([(783, 491), (795, 480), (813, 479), (830, 487), (827, 502), (807, 496)], (810, 548)),
])
body_cutout = figure
figure = Image.alpha_composite(Image.alpha_composite(body_cutout, shoulder_patch), neck_patch)
figure.save(ROOT / "puppet-body.png", optimize=True)

# Prolonger le profil complet de la lame visible sous la tête. Remapper l'ancien
# tronçon déplaçait aussi ses creux et ses trous de transparence.
sword = np.array(artwork("sword.png"))
blade = sword.copy()


def blade_section(column):
    return np.flatnonzero(blade_matte[:, column] > 0.5)


left_x = round(878 * SCALE)
right_x = round(1064 * SCALE)
left_top, left_bottom = blade_section(left_x)[[0, -1]]
right_top, right_bottom = blade_section(right_x)[[0, -1]]
column_y = np.arange(HEIGHT, dtype=np.float32)
# Refaire l'alpha complet derrière la tête, y compris le bord inférieur.
concealed = cv2.dilate((head > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
for column in range(round(850 * SCALE), round(1330 * SCALE)):
    section = blade_section(column)
    if len(section) < 2:
        continue
    top, bottom = section[[0, -1]]
    band = blade_matte[:, column] > 0
    hidden = band & concealed[:, column]
    visible = band & ~concealed[:, column]
    across = np.clip((column_y[hidden] - top) / (bottom - top), 0, 1)
    left_y = np.rint(left_top + across * (left_bottom - left_top)).astype(int)
    right_y = np.rint(right_top + across * (right_bottom - right_top)).astype(int)
    mix = np.clip((column / SCALE - 923) / 99, 0, 1)
    blade[hidden, column, :3] = (
        source_rgb[left_y, left_x] * (1 - mix) + source_rgb[right_y, right_x] * mix
    ).round().astype(np.uint8)
    blade[visible, column, :3] = source_rgb[visible, column]
    # Le biseau inférieur continue derrière la nuque. Les échantillons de la
    # face noire excluent le reflet, qui doit être tracé le long du même bord.
    source_x = column / SCALE
    bevel_mix = np.clip(min((source_x - 850) / 20, (1085 - source_x) / 36), 0, 1)
    distance = (bottom - column_y) / SCALE
    bevel = band & (distance >= -0.8) & (distance <= 8)
    profile = np.exp(-((distance[bevel] - 2.7) / 2.8) ** 2) * bevel_mix
    gold = np.array([234, 220, 172], dtype=np.float32)
    metal = blade[bevel, column, :3].astype(np.float32)
    blade[bevel, column, :3] = (metal * (1 - profile[:, None]) + gold * profile[:, None]).round()
    rebuild = band | (column_y < max(bottom + 20, 435 * SCALE))
    blade[rebuild, column, 3] = (blade_matte[rebuild, column] * 255).round().astype(np.uint8)

# La lame passe derrière le personnage. Seule la garde repasse devant l'épaule.
guard_shape = mask(
    [(724, 461), (742, 431), (777, 409), (815, 409), (853, 421), (878, 412),
     (906, 414), (912, 450), (882, 481), (845, 503), (801, 513), (750, 508), (727, 491)],
    0.8,
)
guard_alpha = guard_shape.astype(np.float32) / 255
# Au contact de la nuque, seul le calque arrière porte le filet de la lame.
guard_alpha *= 1 - blade_matte * np.clip((x / SCALE - 875) / 18, 0, 1)
guard_alpha *= 1 - neck_blade_spill
sword[..., 3] = (sword[..., 3].astype(np.float32) * guard_alpha).astype(np.uint8)
Image.fromarray(sword).save(ROOT / "puppet-guard.png", optimize=True)
blade[..., 3] = (blade[..., 3] * (1 - guard_alpha)).round().astype(np.uint8)
Image.fromarray(blade).save(ROOT / "puppet-sword.png", optimize=True)

# Les poids historiques du torse et de la tête ont été effacés lors du
# redimensionnement RGBA. Les reconstruire dans le repère final, en RGB opaque.
body_weights = np.asarray(artwork("rig-body.png"))
arm_weights = np.asarray(artwork("rig-arm.png"))
arm_mix = mask(
    [(759, 473), (799, 471), (816, 511), (816, 568), (801, 644),
     (797, 725), (751, 757), (682, 780), (616, 725), (608, 526), (647, 474), (723, 465)],
    12,
).astype(np.float32) / 255
# Accrocher l'épaule au torse et assouplir le passage au coude.
fade = np.clip((825 - x / SCALE) / 65, 0, 1)
arm_mix *= fade * fade * (3 - 2 * fade)
# Dans la paume fermée, la poignée et la peau suivent strictement le même os.
grip = np.clip(1 - (((x / SCALE - 692) / 44) ** 2 + ((y / SCALE - 545) / 45) ** 2), 0, 1)
hand = np.maximum(arm_weights[..., 1] / 255, np.clip(grip * 1.7, 0, 1))
arm_mix = np.maximum(arm_mix, hand)
fore = np.minimum(arm_weights[..., 0] / 255, 1 - hand)

head_region = cv2.dilate((head > 0.5).astype(np.uint8), np.ones((23, 23), np.uint8))
head_weight = cv2.GaussianBlur(head_region.astype(np.float32), (0, 0), 4 * SCALE)
neck = np.clip((470 - y / SCALE) / 55, 0, 1)
head_weight *= neck * neck * (3 - 2 * neck)
hip_fore = body_weights[..., 3] / 255
hip_upper = np.minimum(body_weights[..., 2] / 255, 1 - hip_fore)
chest_ramp = np.clip((800 - y / SCALE) / 100, 0, 1)
chest_weight = chest_ramp * np.clip(1 - head_weight - hip_upper - hip_fore, 0, 1)
channels = np.dstack((chest_weight, head_weight, hip_upper))
Image.fromarray((channels * 255).round().astype(np.uint8)).save(
    ROOT / "puppet-weights-body.png", optimize=True
)
hip = np.dstack((body_weights[..., 3], np.zeros_like(opaque), np.zeros_like(opaque)))
Image.fromarray(hip).save(ROOT / "puppet-weights-hip.png", optimize=True)
Image.fromarray((np.dstack((arm_mix, fore, hand)) * 255).round().astype(np.uint8)).save(
    ROOT / "puppet-weights-arm.png", optimize=True
)


def bounds(alpha):
    ys, xs = np.nonzero(alpha > 5)
    return [int(xs.min()) - 10, int(ys.min()) - 10, int(xs.max()) + 10, int(ys.max()) + 10]


rig = json.loads((ROOT / "rig.json").read_text(encoding="utf-8"))
rig.pop("fistMaxX", None)
rig["meshes"] = {
    "body": bounds(pixels[..., 3]),
    "sword": bounds(blade[..., 3]),
    "guard": bounds(sword[..., 3]),
}
(ROOT / "puppet.json").write_text(json.dumps(rig, indent=2) + "\n", encoding="utf-8")

# Contours relevés dans le décor reconstruit (repère 1840 × 1034). Les
# raccords avec les encolures sont adoucis dans la brume rouge.
backdrop = artwork("bg.jpg")
head_shapes = [
    ("Cerbère — tête haute", [(405, 498), (473, 458), (479, 421), (470, 378),
      (508, 309), (533, 271), (553, 274), (598, 306), (644, 358), (694, 347),
      (718, 408), (714, 470), (650, 541), (610, 600), (561, 644), (553, 675),
      (476, 708), (457, 668), (449, 590), (402, 545)]),
    ("Cerbère — tête basse", [(580, 679), (607, 648), (653, 654), (692, 677),
      (713, 719), (701, 768), (658, 795), (594, 778), (577, 737)]),
    ("Personnage barbu — tête et laurier", [(1125, 377), (1141, 346), (1196, 317),
      (1247, 311), (1291, 334), (1336, 358), (1358, 414), (1352, 473),
      (1380, 523), (1364, 572), (1321, 616), (1250, 612), (1186, 570), (1135, 488)]),
]
heads = []
combined = Image.new("RGBA", SIZE)
coverage = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
ear_shapes = [
    [(507, 317), (513, 325), (521, 349), (524, 383), (525, 406),
     (542, 420), (505, 440), (484, 426), (481, 397), (489, 362)],
    [(535, 269), (546, 270), (577, 288), (619, 324), (645, 366),
     (650, 401), (630, 428), (600, 437), (574, 420), (559, 371), (545, 316)],
]
ear_coverage = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
for index, points in enumerate(ear_shapes):
    matte = mask([(px / SCALE, py / SCALE) for px, py in points], 2)
    ear = backdrop.copy()
    ear.putalpha(Image.fromarray(matte))
    ear.save(ROOT / f"puppet-ear-{index}.png", optimize=True)
    heads.append((f"Cerbère — oreille {index + 1}", ear))
    ear_coverage = np.maximum(ear_coverage, matte)

detail_shapes = [
    ("Cerbère — mâchoire et langue", [(444, 567), (472, 562), (512, 574), (557, 559),
      (585, 581), (563, 624), (537, 656), (505, 693), (468, 706), (459, 678),
      (466, 645), (445, 619)]),
    ("Personnage barbu — main et manchette", [(1222, 705), (1241, 685), (1269, 675),
      (1291, 689), (1311, 716), (1330, 749), (1322, 773), (1288, 794),
      (1256, 779), (1233, 750)]),
]
details = []
detail_texture = Image.new("RGBA", SIZE)
for name, points in detail_shapes:
    matte = mask([(px / SCALE, py / SCALE) for px, py in points], 6)
    piece = backdrop.copy()
    piece.putalpha(Image.fromarray(matte))
    details.append((name, piece))
    detail_texture = Image.alpha_composite(detail_texture, piece)
    coverage = np.maximum(coverage, matte)
detail_texture.save(ROOT / "puppet-background-details.png", optimize=True)
for index, (name, points) in enumerate(head_shapes):
    matte = mask([(px / SCALE, py / SCALE) for px, py in points], 9)
    coverage = np.maximum(coverage, matte)
    if index == 0:
        # Nettoyer toute la silhouette des oreilles sous les calques mobiles.
        # Garder le crâne aux attaches où les pièces se recouvrent.
        above_root = np.clip((420 - y) / 13, 0, 1)
        removal = cv2.dilate(ear_coverage, np.ones((7, 7), np.uint8)) / 255
        matte = (matte * (1 - removal * above_root)).round().astype(np.uint8)
        jaw = np.asarray(details[0][1].getchannel("A"), dtype=np.float32) / 255
        matte = (matte * (1 - jaw)).round().astype(np.uint8)
    cutout = backdrop.copy()
    cutout.putalpha(Image.fromarray(matte))
    heads.append((name, cutout))
    if index == 1:
        cutout.save(ROOT / "puppet-background-low-head.png", optimize=True)
    else:
        combined = Image.alpha_composite(combined, cutout)
coverage = np.maximum(coverage, ear_coverage)
combined.save(ROOT / "puppet-background-heads.png", optimize=True)
background_rgb = np.asarray(backdrop.convert("RGB"))
work_size = (WIDTH // 3, HEIGHT // 3)
hole = cv2.dilate((coverage > 32).astype(np.uint8), np.ones((11, 11), np.uint8))
filled = cv2.inpaint(cv2.resize(background_rgb, work_size, interpolation=cv2.INTER_AREA),
                     cv2.resize(hole, work_size, interpolation=cv2.INTER_NEAREST), 4, cv2.INPAINT_TELEA)
filled = cv2.resize(filled, SIZE, interpolation=cv2.INTER_CUBIC)
blend = (cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 4))[..., None]
clean_background = Image.fromarray((background_rgb * (1 - blend) + filled * blend).round().astype(np.uint8))
clean_background.save(ROOT / "puppet-background.jpg", quality=93)

if "--master" in sys.argv:
    # Séparation éditable. Les deux pièces conservent leur raccord dans le
    # maillage continu exporté pour le personnage.
    skin_alpha = np.asarray(body_cutout.getchannel("A"), dtype=np.float32) / 255
    head_alpha = skin_alpha * head_weight
    torso_alpha = (skin_alpha - head_alpha) / np.maximum(1 - head_alpha, 1 / 255)
    master_head = body_cutout.copy()
    master_head.putalpha(Image.fromarray((head_alpha * 255).round().astype(np.uint8)))
    master_torso = body_cutout.copy()
    master_torso.putalpha(Image.fromarray((torso_alpha * 255).round().astype(np.uint8)))
    layers = [
        ("Feuilles détachées", artwork("leaves.png")),
        ("Garde au premier plan", Image.fromarray(sword)),
        ("Retouche de la nuque", neck_patch),
        ("Retouche sous la garde", shoulder_patch),
        ("Zagreus — tête et laurier", master_head),
        ("Zagreus — corps et armure", master_torso),
        ("Lame et poignée arrière", Image.fromarray(blade)),
        *heads,
        *details,
        ("Décor reconstruit sous les têtes", clean_background.convert("RGBA")),
    ]
    document = Element("image", {"version": "0.0.3", "w": str(WIDTH), "h": str(HEIGHT)})
    stack = SubElement(document, "stack")
    composite = Image.new("RGBA", SIZE)
    for _, layer_image in reversed(layers):
        composite = Image.alpha_composite(composite, layer_image)
    with ZipFile(ROOT / "zagreus-master.ora", "w") as archive:
        archive.writestr("mimetype", "image/openraster")
        for index, (name, layer_image) in enumerate(layers):
            path = f"data/layer{index}.png"
            SubElement(stack, "layer", {"name": name, "src": path, "opacity": "1.0",
                                        "visibility": "visible", "composite-op": "svg:src-over",
                                        "x": "0", "y": "0"})
            buffer = BytesIO()
            layer_image.save(buffer, format="PNG")
            archive.writestr(path, buffer.getvalue())
        archive.writestr("stack.xml", tostring(document, encoding="utf-8"), ZIP_DEFLATED)
        for path, layer_image in [("mergedimage.png", composite),
                                  ("Thumbnails/thumbnail.png", composite.resize((256, 144), Image.LANCZOS))]:
            buffer = BytesIO()
            layer_image.save(buffer, format="PNG")
            archive.writestr(path, buffer.getvalue())
print("Marionnette continue, garde et trois textures de poids exportées.")
