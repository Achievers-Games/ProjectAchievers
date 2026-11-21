"""Prépare les calques de la Mythique Hades (Zagreus, épée à l'épaule).

Lancer avec un Python qui contient rembg, simple-lama-inpainting, OpenCV et Pillow, depuis un
dossier sans répertoire `coverage/` (il masque un module Python) :
    ~/.venvs/cards/Scripts/python.exe -I static/_proto/hades-mythique/prepare-art.py

Repère : Zagreus est centré dans la source (1920 × 1079), l'image garde donc son orientation.
La fenêtre de la carte (WINDOW, 460:215) prend toute la largeur et est exportée en 1840 × 860.
Les calques couvrent toute la source, réduite du même facteur, pour laisser de la marge
verticale à la caméra ; la marge horizontale vient du léger zoom du shader.
"""

import json
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from rembg import new_session, remove
from simple_lama_inpainting import SimpleLama

ROOT = Path(__file__).resolve().parent
WINDOW = (0, 60, 1920, 897)  # x, y, largeur, hauteur dans la source (460:215)
OUTPUT = (1840, 860)
SCALE = OUTPUT[0] / WINDOW[2]
# Feuilles de laurier qui flottent au-dessus des cheveux.
LEAVES_BOX = (820, 70, 1045, 214)
# Épée reconstruite en une pièce entière. La garde à crâne et son ruban s'arrêtent au bord
# rouge du ruban, au-dessus de la peau du torse.
GUARD = [(742, 445), (760, 425), (800, 415), (835, 410), (870, 398), (915, 383), (918, 440),
         (900, 462), (880, 480), (850, 495), (820, 503), (790, 507), (760, 505), (742, 498),
         (734, 470)]
# Pommeau et bout de poignée visibles sous le poing.
POMMEL = [(558, 606), (590, 586), (625, 572), (652, 560), (670, 574), (662, 593), (632, 606),
          (618, 642), (585, 650), (562, 638)]
# Axe de la lame, de la garde à la pointe, et demi-largeur de la bande qui la contient.
BLADE = ((830, 428), (1325, 115), 62)
# Tronçon intact de la lame (distance le long de l'axe) : sa section moyenne prolonge la
# lame derrière la tête, sans répéter les gravures.
BLADE_SAMPLE = (300, 420)
BLADE_HIDDEN = (40, 280)
# Axe de la poignée, du bas du poing jusqu'à la garde ; section prise juste sous le poing.
HANDLE = ((652, 576), (752, 492), 15)
HANDLE_SAMPLE = (-22, -6)
# La tête et le poing passent devant l'épée.
HEAD = [(800, 150), (1062, 150), (1040, 255), (1034, 330), (1034, 392), (1004, 428), (992, 482),
        (908, 482), (908, 450), (900, 428), (884, 405), (870, 380), (864, 340),
        (842, 330), (796, 300)]
FIST = [(628, 520), (650, 482), (705, 476), (745, 496), (766, 530), (764, 582), (736, 606),
        (690, 602), (655, 592), (624, 560)]
# Sous la garde et le ruban, l'épée recouvre l'épaule : la reconstruction y reste opaque.
SHOULDER = [(790, 470), (905, 430), (960, 405), (1070, 372), (1078, 452), (930, 540), (770, 540)]
# Bras qui tient l'épée : biceps, avant-bras replié coude vers le bas, poignet bandé et poing.
ARM = [(762, 505), (800, 512), (814, 540), (816, 600), (812, 650), (800, 668), (790, 720),
       (742, 752), (695, 765), (655, 732), (640, 690), (642, 640), (648, 600), (660, 585),
       (640, 560), (625, 540), (650, 480), (705, 476), (745, 496)]
# Haut du biceps et de l'épaule, cachés sous la garde : complétés pour que le bras reste
# entier quand l'épée se soulève.
ARM_HIDDEN = [(756, 476), (812, 470), (834, 502), (822, 560), (762, 552), (750, 505)]
FOREARM = [(640, 590), (705, 590), (745, 600), (800, 668), (790, 720), (740, 752), (695, 765),
           (655, 730), (640, 690)]
# Flanc du torse caché par le bras : reconstruit et opaque quand le bras s'écarte.
FLANK = [(800, 520), (870, 520), (870, 790), (786, 790), (790, 700), (797, 610)]
# Bras gauche qui pend le long de la hanche, sous l'épaulière, puis l'avant-bras.
HIP_ARM = [(1095, 600), (1250, 600), (1255, 820), (1095, 820)]
HIP_FOREARM = [(1085, 800), (1262, 800), (1262, 1079), (1085, 1079)]
# Squelette : pivot de chaque os (repère de la source) et os parent.
BONES = {
    "chest": ((950, 770), None),
    "head": ((945, 478), "chest"),
    "upperArm": ((805, 535), "chest"),
    "forearm": ((700, 745), "upperArm"),
    "hand": ((690, 600), "forearm"),
    "sword": ((695, 545), "hand"),
    "hipArm": ((1160, 640), "chest"),
    "hipForearm": ((1170, 800), "hipArm"),
}

image = Image.open(ROOT / "source.webp").convert("RGB")
source = np.asarray(image)
height, width = source.shape[:2]
rows = np.arange(height, dtype=np.float32)[:, None]

# 1. Zagreus et son épée : BiRefNet garde les contours encrés, l'épée et la garde.
mask = np.asarray(remove(image, session=new_session("birefnet-general"), only_mask=True))
body = mask.astype(np.float32) / 255.0
body[body < 0.04] = 0.0
# Ne garder que la composante principale (supprime les îlots isolés du fond).
count, labels, stats, _ = cv2.connectedComponentsWithStats((body > 0.5).astype(np.uint8))
main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
keep = cv2.dilate((labels == main).astype(np.uint8), np.ones((9, 9), np.uint8))
body *= keep

# 2. Feuilles flottantes : écart de couleur au fond lissé, hors du corps.
x0, y0, x1, y1 = LEAVES_BOX
box = source[y0:y1, x0:x1].astype(np.float32)
backdrop = cv2.medianBlur(source[y0:y1, x0:x1], 31).astype(np.float32)
delta = np.linalg.norm(box - backdrop, axis=2)
leaves = np.zeros((height, width), np.float32)
leaves[y0:y1, x0:x1] = np.clip((delta - 16.0) / 28.0, 0, 1)
leaves = cv2.dilate(leaves, np.ones((3, 3), np.uint8))
leaves = cv2.GaussianBlur(leaves, (3, 3), 0) * (1.0 - np.clip(body * 2.0, 0, 1))

# 3. Décor sans le personnage. Le masque d'effacement déborde du détourage pour ne pas
#    laisser de double contour quand Zagreus bouge.
hole = ((body > 0.03) | (leaves > 0.03)).astype(np.uint8)
hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
# Le modèle publié est sérialisé pour CUDA : le charger sur CPU.
_jit_load = torch.jit.load
torch.jit.load = lambda path, **kw: _jit_load(path, map_location="cpu")
lama = SimpleLama(device=torch.device("cpu"))
filled = lama(image, Image.fromarray(hole * 255))
filled = np.asarray(filled.convert("RGB"))[:height, :width]
soft = cv2.GaussianBlur(hole.astype(np.float32), (9, 9), 0)[:, :, None]
bg = (filled * soft + source * (1 - soft)).astype(np.uint8)



def polygon(points, feather=1.5):
    target = np.zeros((height, width), np.float32)
    cv2.fillPoly(target, [np.array(points, np.int32)], 1.0)
    return cv2.GaussianBlur(target, (0, 0), feather)


def along_axis(axis, s_range):
    """Grilles de coordonnées source d'une bande redressée le long d'un axe."""
    (ax, ay), (bx, by), half = axis
    length = np.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length
    s = np.arange(*s_range, dtype=np.float32)[None, :]
    n = np.arange(-half, half + 1, dtype=np.float32)[:, None]
    return (ax + s * ux - n * uy).astype(np.float32), (ay + s * uy + n * ux).astype(np.float32)


def straighten(picture, axis, s_range):
    xs, ys = along_axis(axis, s_range)
    return cv2.remap(picture, xs, ys, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def unstraighten(strip, axis, s0):
    """Replace une bande redressée dans le repère de la source (transparent hors de la bande)."""
    (ax, ay), (bx, by), half = axis
    length = np.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    s = (xs - ax) * ux + (ys - ay) * uy - s0
    n = -(xs - ax) * uy + (ys - ay) * ux + half
    s, n = s.astype(np.float32), n.astype(np.float32)
    return cv2.remap(strip, s, n, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def extend(axis, visible, s_range, hidden, sample, mirror=True):
    """Complète une pièce droite : là où elle est cachée, recopie un tronçon intact."""
    rgba = np.dstack([source.astype(np.float32), visible * 255]).astype(np.float32)
    strip = straighten(rgba, axis, s_range)
    s0 = s_range[0]
    cut = strip[:, sample[0] - s0 : sample[1] - s0]
    if not mirror:
        cut = np.repeat(cut.mean(axis=1, keepdims=True), cut.shape[1], axis=1)
    period = cut.shape[1]
    for s in range(*hidden):
        k = (s - hidden[0]) % (2 * period)
        column = cut[:, k if k < period else 2 * period - 1 - k]
        keep = strip[:, s - s0, 3:4] / 255.0
        strip[:, s - s0] = strip[:, s - s0] * keep + column * (1 - keep)
    placed = unstraighten(strip, axis, s0)
    return placed[..., :3], placed[..., 3] / 255.0


# 4. Pièces de la marionnette, chacune complétée là où une autre la cachait.
#    Épée : la lame continue derrière la tête, la poignée traverse le poing.
front_zone = np.maximum(polygon(HEAD), polygon(FIST))
front = body * front_zone
blade_length = int(np.hypot(BLADE[1][0] - BLADE[0][0], BLADE[1][1] - BLADE[0][1])) + 16
blade_band = unstraighten(np.ones((2 * BLADE[2] + 1, blade_length + 10), np.float32), BLADE, -10)
blade_seen = body * blade_band * (1.0 - front_zone)
blade_rgb, blade_a = extend(BLADE, blade_seen, (-10, blade_length), BLADE_HIDDEN, BLADE_SAMPLE,
                          mirror=False)
handle_length = int(np.hypot(HANDLE[1][0] - HANDLE[0][0], HANDLE[1][1] - HANDLE[0][1])) + 6
handle_band = unstraighten(np.ones((2 * HANDLE[2] + 1, handle_length + 30), np.float32), HANDLE, -30)
handle_seen = body * handle_band * polygon(POMMEL) * (1.0 - polygon(FIST))
handle_rgb, handle_a = extend(HANDLE, handle_seen, (-30, handle_length), (-6, handle_length),
                              HANDLE_SAMPLE, mirror=False)
guard_a = body * polygon(GUARD, 1.2) * (1.0 - polygon(HEAD))
pommel_a = body * polygon(POMMEL) * (1.0 - polygon(FIST))
# Superposition : poignée, puis lame, puis pommeau et garde d'origine par-dessus.
sword_rgb = handle_rgb * handle_a[..., None]
sword = handle_a.copy()
for rgb, alpha in ((blade_rgb, blade_a), (source, pommel_a), (source, guard_a)):
    sword_rgb = rgb * alpha[..., None] + sword_rgb * (1 - alpha[..., None])
    sword = alpha + sword * (1 - alpha)
sword_rgb = np.where(sword[..., None] > 0.01, sword_rgb / np.maximum(sword, 0.01)[..., None], 0)
sword_rgb = np.clip(sword_rgb, 0, 255).astype(np.uint8)
# Ce que l'épée occupait vraiment à l'écran, à retirer du corps et du bras.
sword_seen = np.clip(np.maximum.reduce([blade_seen, handle_seen, guard_a, pommel_a]), 0, 1)

#    Bras : le haut du biceps, caché sous la garde, est reconstruit sans l'épée.
no_sword_hole = cv2.dilate((sword_seen > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8))
no_sword = np.asarray(lama(image, Image.fromarray(no_sword_hole * 255)).convert("RGB"))[:height, :width]
arm_seen = body * polygon(ARM) * (1.0 - np.clip(sword_seen * 1.5, 0, 1)) * (1.0 - polygon(HEAD))
hidden_arm = polygon(ARM_HIDDEN, 2.5) * (1.0 - polygon(HEAD))
arm = np.maximum(arm_seen, hidden_arm)
# Le biceps est prolongé vers le haut sous la garde : chaque colonne reprend la couleur de
# son premier pixel visible, puis un filet sombre redessine le contour encré de l'épaule.
known = (arm_seen > 0.5).astype(np.uint8)
skin = source.astype(np.float32).copy()
for x in range(740, 840):
    column = np.nonzero(known[480:620, x])[0]
    if len(column):
        top = 480 + column[0] + 3
        skin[440:top, x] = source[min(top, height - 1), x]
inside = (hidden_arm > 0.5).astype(np.uint8)
rim = (inside - cv2.erode(inside, np.ones((5, 5), np.uint8))).astype(np.float32)
rim = cv2.GaussianBlur(rim * (1 - known), (3, 3), 0)[..., None]
skin = skin * (1 - 0.75 * rim)
arm_rgb = np.where(arm_seen[..., None] > 0.5, source, skin).astype(np.uint8)

#    Corps : sous le bras et l'épée, LaMa reconstruit l'épaule, le cou et le flanc.
moving = np.maximum(sword_seen, arm_seen)
under = cv2.dilate((moving > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8))
uncovered = np.asarray(lama(image, Image.fromarray(under * 255)).convert("RGB"))[:height, :width]
cover = cv2.GaussianBlur(under.astype(np.float32), (5, 5), 0)[:, :, None]
rest_rgb = (uncovered * cover + source * (1 - cover)).astype(np.uint8)
# Hors de l'épaule et du flanc, ces pièces passaient devant le décor : le corps y devient
# transparent. Seules les pièces, à 3 px près, sont retirées : le poignet bandé reste intact.
gone = cv2.dilate((moving > 0.05).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
behind = np.maximum(polygon(SHOULDER, 6), polygon(FLANK, 6))
rest = body * (1.0 - gone * (1.0 - behind))

# 5. Poids des os, peints par zones adoucies. Chaque canal donne l'influence d'un os ; le reste
#    suit la racine (jambes et bassin, immobiles).
chest_ramp = np.clip((800.0 - rows) / 100.0, 0, 1) * np.ones((1, width), np.float32)
head_w = np.clip(polygon(HEAD, 10) * np.clip((488.0 - rows) / 45.0, 0, 1), 0, 1)
hip_fore = polygon(HIP_FOREARM, 14)
hip_upper = polygon(HIP_ARM, 14) * (1.0 - hip_fore)
remain = np.clip(1.0 - head_w - hip_upper - hip_fore, 0, 1)
body_weights = np.dstack([remain * chest_ramp, head_w, hip_upper, hip_fore])
hand_w = polygon(FIST, 8)
fore_w = polygon(FOREARM, 10) * (1.0 - hand_w)
arm_weights = np.dstack([fore_w, hand_w, np.zeros_like(hand_w)])

# 6. Exports, tous dans le même repère réduit.
size = (round(width * SCALE), round(height * SCALE))


def layer(alpha, rgb=source):
    rgba = np.dstack([rgb, np.clip(alpha * 255, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA").resize(size, Image.LANCZOS)


def weights(channels, mode):
    data = np.clip(channels * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(data, mode).resize(size, Image.BILINEAR)


def bounds(alpha, margin=12):
    ys, xs = np.nonzero(alpha > 0.02)
    box = [xs.min() - margin, ys.min() - margin, xs.max() + margin, ys.max() + margin]
    return [round(float(v) * SCALE, 1) for v in box]


Image.fromarray(bg).resize(size, Image.LANCZOS).save(ROOT / "bg.jpg", quality=92)
body_layer = layer(rest, rest_rgb)
body_layer.save(ROOT / "zagreus.png", optimize=True)
arm_layer = layer(arm, arm_rgb)
arm_layer.save(ROOT / "arm.png", optimize=True)
sword_layer = layer(sword, sword_rgb)
sword_layer.save(ROOT / "sword.png", optimize=True)
front_layer = layer(front)
front_layer.save(ROOT / "front.png", optimize=True)
leaves_layer = layer(leaves)
leaves_layer.save(ROOT / "leaves.png", optimize=True)
weights(body_weights, "RGBA").save(ROOT / "rig-body.png", optimize=True)
weights(arm_weights, "RGB").save(ROOT / "rig-arm.png", optimize=True)


def point(xy):
    return [round(xy[0] * SCALE, 1), round(xy[1] * SCALE, 1)]


# Squelette et boîtes des maillages, dans le repère des calques.
rig = {
    "bones": {name: {"pivot": point(xy), "parent": parent} for name, (xy, parent) in BONES.items()},
    "meshes": {
        "body": bounds(rest),
        "arm": bounds(arm),
        "sword": bounds(sword),
        "front": bounds(front),
    },
    "fistMaxX": round(max(x for x, _ in FIST) * SCALE + 8, 1),
}
(ROOT / "rig.json").write_text(json.dumps(rig, indent=2) + "\n", encoding="utf-8")

wx, wy, ww, wh = WINDOW
still = image.crop((wx, wy, wx + ww, wy + wh)).resize(OUTPUT, Image.LANCZOS)
still.save(ROOT / "full.jpg", quality=92)

# Planches de contrôle (non servies) : pièces sur fond vert, corps seul, poids des os.
(ROOT / "work").mkdir(exist_ok=True)
check = Image.new("RGB", size, (0, 200, 0))
for part in (body_layer, arm_layer, sword_layer, front_layer, leaves_layer):
    check.paste(part, mask=part)
check.save(ROOT / "work" / "layers-check.jpg", quality=85)
bare = Image.new("RGB", size, (0, 200, 0))
bare.paste(body_layer, mask=body_layer)
bare.save(ROOT / "work" / "body-only.jpg", quality=85)
tint = np.dstack([body_weights[..., 0], body_weights[..., 1] + fore_w, body_weights[..., 2] + hand_w])
heat = (source * 0.45 + np.clip(tint, 0, 1) * 140).clip(0, 255).astype(np.uint8)
Image.fromarray(heat).resize(size).save(ROOT / "work" / "weights.jpg", quality=85)
print("layer size", size, "window offset", wx * SCALE, wy * SCALE, "scale", SCALE)
