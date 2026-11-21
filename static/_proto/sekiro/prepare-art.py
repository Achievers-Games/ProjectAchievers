"""Calques du hero Steam de Sekiro, application 814380."""

from pathlib import Path
from runpy import run_path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
source = Image.open(ROOT / "source.jpg").convert("RGB")
size = source.size
rgb = np.asarray(source)
write_master = run_path(str(ROOT.parent / "prepare-layered-masters.py"))["write_master"]


def mask(points, feather=0.85):
    shape = Image.new("L", size)
    ImageDraw.Draw(shape).polygon(points, fill=255)
    return np.asarray(shape.filter(ImageFilter.GaussianBlur(feather)))


def part(alpha, colors=rgb):
    alpha = alpha.astype(np.uint8)
    return Image.fromarray(np.dstack((np.where(alpha[..., None] > 0, colors, 0), alpha)))


head = mask([(926,267),(928,240),(935,228),(947,220),(944,206),(940,180),
             (947,179),(954,190),(957,170),(965,179),(972,171),(976,191),
             (989,177),(992,186),(985,204),(976,219),(987,229),(993,243),(998,270)])
topknot = np.zeros_like(head)
topknot[:220] = head[:220]
fixed_head = head.copy()
fixed_head[:220] = 0
body = mask([(921,272),(946,259),(974,259),(994,267),(1003,252),(1068,150),(1084,149),
    (1090,156),(1086,165),(1032,269),(1027,285),(1048,298),(1075,313),(1087,347),
    (1100,380),(1106,419),(1116,437),(1124,465),(1122,489),(1115,507),(1114,528),
    (1124,540),(1166,543),(1173,551),(1171,559),(1119,558),(1111,569),(1091,572),
    (1064,559),(1073,577),(1090,620),(841,620),(850,591),(867,550),(855,547),
    (853,555),(839,558),(816,557),(811,545),(702,534),(700,525),(710,518),
    (812,530),(814,516),(808,497),(805,475),(808,456),(818,431),(828,411),
    (841,381),(857,349),(863,317),(880,301),(908,284)])
scarf = mask([(975,281),(990,280),(1002,300),(1005,330),(1008,359),(1009,386),
              (1013,410),(1025,441),(1023,461),(1014,475),(1004,467),(998,451),
              (988,429),(983,404),(979,371),(976,337),(968,312)])
foreground = mask([(0,620),(0,505),(273,501),(303,449),(342,469),(583,559),
                   (611,620)], 1.1)
foreground = np.maximum(foreground, mask([(824,601),(845,588),(883,582),(915,591),
    (905,620),(1138,620),(1247,509),(1254,501),(1262,521),(1274,527),
    (1270,538),(1262,532),(1258,575),(1274,620)], 1.0))

# Sous l'écharpe, reprendre le tissu de l'épaule voisine et le fond sous la nuque.
body_rgb = rgb.copy()
scarf_hole = cv2.dilate((scarf > 20).astype(np.uint8), np.ones((5, 5), np.uint8))
body_rgb = cv2.inpaint(body_rgb, scarf_hole, 5, cv2.INPAINT_TELEA)
body_alpha = body.astype(np.float32) * (1 - head.astype(np.float32) / 255)
left_arm = mask([(688,490),(793,489),(815,433),(845,359),(878,325),(900,350),
    (877,398),(860,445),(850,480),(857,521),(883,528),(872,552),(849,565),(687,550)], 2.6)
right_arm = mask([(1057,310),(1117,342),(1138,445),(1139,510),(1185,526),
    (1187,567),(1118,580),(1062,574),(1050,547),(1064,518),(1068,469),(1048,428),
    (1041,384)], 2.6)
arms = []
for label, filename, shape in [("Bras prothétique et prise", "arm-left.png", left_arm),
                              ("Bras droit et prise", "arm-right.png", right_arm)]:
    alpha = body_alpha * shape.astype(np.float32) / 255
    body_alpha = (body_alpha - alpha) / np.maximum(1 - alpha / 255, 1 / 255)
    arms.append((label, filename, part(alpha.round(), body_rgb)))
layers = [("Débris proches", "foreground.png", part(foreground)),
          ("Écharpe", "scarf.png", part(scarf)), ("Chignon", "topknot.png", part(topknot)),
          ("Tête", "head.png", part(fixed_head)),
          *arms, ("Torse, manteau et arme au dos", "body.png", part(body_alpha.round(), body_rgb))]

coverage = np.maximum.reduce((head, body, foreground))
hole = cv2.dilate((coverage > 15).astype(np.uint8), np.ones((19, 19), np.uint8))
small = (size[0] // 4, size[1] // 4)
fill = cv2.inpaint(cv2.resize(rgb, small, interpolation=cv2.INTER_AREA),
                   cv2.resize(hole, small, interpolation=cv2.INTER_NEAREST), 6, cv2.INPAINT_TELEA)
fill = cv2.resize(fill, size, interpolation=cv2.INTER_CUBIC)
soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 5)[..., None]
backdrop = Image.fromarray((rgb * (1 - soft) + fill * soft).round().astype(np.uint8))
backdrop.save(ROOT / "bg.jpg", quality=94)
for _, filename, image in layers:
    image.save(ROOT / filename, optimize=True)
write_master(ROOT.name, [(name, image) for name, _, image in layers] +
             [("Temple et incendie — fond reconstruit", backdrop.convert("RGBA"))])
source.crop((260, 8, 1552, 612)).save(ROOT / "full.jpg", quality=96)
