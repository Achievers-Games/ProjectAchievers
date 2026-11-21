"""Prepare the original Steam artwork as animation layers with guided masks."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
CROP = (297, 0, 1623, 620)
image = Image.open(ROOT / "source.jpg").convert("RGB")

HEAD = [
    (742, 180), (728, 163), (717, 142), (712, 119), (716, 94),
    (728, 72), (740, 60), (754, 58), (770, 59), (779, 65),
    (778, 73), (768, 85), (760, 104), (756, 126), (778, 119),
    (810, 110), (842, 106), (872, 107), (900, 112), (918, 122),
    (932, 109), (939, 91), (938, 75), (930, 62), (914, 48),
    (900, 38), (895, 30), (898, 22), (909, 17), (926, 18),
    (948, 25), (967, 38), (980, 56), (989, 79), (995, 104),
    (997, 127), (994, 145), (986, 159), (976, 170), (978, 195),
    (981, 226), (980, 252), (975, 276), (967, 293), (953, 307),
    (933, 320), (909, 330), (882, 339), (855, 343), (830, 342),
    (805, 336), (780, 325), (761, 308), (747, 285), (738, 257),
    (733, 230), (734, 204),
]
CLOAK = [
    (836, 319), (840, 308), (865, 299), (889, 296), (921, 300),
    (953, 311), (985, 324), (1010, 329), (1035, 325), (1061, 317),
    (1088, 307), (1110, 294), (1125, 277), (1132, 259), (1126, 245),
    (1144, 259), (1156, 279), (1158, 296), (1151, 308),
    (1174, 308), (1187, 314), (1194, 323), (1176, 320),
    (1160, 326), (1145, 338), (1149, 348), (1165, 354),
    (1181, 349), (1193, 334), (1197, 351), (1192, 371),
    (1182, 383), (1190, 397), (1178, 393), (1158, 391),
    (1140, 397), (1135, 406), (1140, 415), (1152, 418),
    (1146, 430), (1135, 433), (1120, 426), (1106, 414),
    (1096, 401), (1081, 402), (1087, 423), (1104, 447),
    (1116, 467), (1101, 461), (1082, 452), (1072, 453),
    (1070, 464), (1060, 475), (1047, 469), (1041, 460),
    (1047, 482), (1066, 499), (1047, 501), (1031, 494),
    (1027, 503), (1044, 520), (1020, 519), (1005, 508),
    (994, 523), (981, 536), (977, 524), (962, 527),
    (949, 542), (945, 553), (930, 562), (930, 545),
    (938, 526), (940, 514), (918, 524), (896, 526),
    (876, 519), (860, 511), (850, 507), (839, 508),
    (827, 500), (838, 486), (850, 468), (851, 449),
    (840, 425), (835, 406), (828, 382), (822, 362),
    (812, 347), (811, 334), (818, 325),
]
LEGS = [
    [(818, 440), (822, 426), (841, 419), (864, 417), (884, 420),
     (898, 440), (901, 456), (888, 469), (871, 471), (869, 486),
     (885, 512), (875, 521), (856, 508), (841, 488), (830, 470)],
    [(997, 488), (1046, 491), (1069, 512), (1084, 546),
     (1097, 578), (1104, 590), (1077, 586), (1057, 570),
     (1034, 548), (1015, 520)],
]
NAIL = [
    (1064, 415), (1110, 441), (1150, 461), (1190, 482),
    (1230, 503), (1270, 524), (1310, 546), (1350, 569),
    (1399, 598), (1400, 603), (1350, 587), (1310, 574),
    (1270, 561), (1230, 548), (1190, 535), (1150, 521),
    (1110, 508), (1093, 498), (1080, 479),
]
PLATFORM = [
    (752, 620), (754, 593), (758, 570), (768, 548), (783, 535),
    (797, 531), (799, 520), (813, 514), (837, 515), (860, 520),
    (883, 516), (901, 522), (924, 529), (942, 540), (963, 546),
    (984, 549), (1006, 557), (1027, 568), (1045, 578),
    (1064, 596), (1083, 609), (1097, 620),
]
ROOT_BRANCH = [
    (1090, 620), (1108, 596), (1128, 580), (1152, 570),
    (1177, 565), (1201, 566), (1222, 572), (1237, 583),
    (1246, 599), (1248, 620), (1228, 620), (1227, 600),
    (1218, 586), (1201, 580), (1180, 579), (1159, 584),
    (1138, 598), (1120, 616), (1116, 620),
]


def mask_for(polygons, refine=False, blue_cloth=False, black_legs=False):
    mask = Image.new("L", image.size)
    draw = ImageDraw.Draw(mask)
    for points in polygons:
        draw.polygon(points, fill=255)
    binary = np.asarray(mask).copy()
    if refine:
        kernel = np.ones((9, 9), np.uint8)
        outside = cv2.dilate(binary, kernel, iterations=1)
        inside = cv2.erode(binary, kernel, iterations=1)
        labels = np.full(binary.shape, cv2.GC_BGD, np.uint8)
        labels[outside > 0] = cv2.GC_PR_BGD
        labels[binary > 0] = cv2.GC_PR_FGD
        labels[inside > 0] = cv2.GC_FGD
        colors = np.asarray(image).astype(np.int16)
        if blue_cloth:
            gray_background = (colors[:, :, 2] < colors[:, :, 0] + 7) & (colors.max(axis=2) > 85)
            labels[gray_background] = cv2.GC_BGD
        if black_legs:
            labels[colors.mean(axis=2) > 90] = cv2.GC_BGD
        cv2.grabCut(np.asarray(image), labels, None,
                    np.zeros((1, 65)), np.zeros((1, 65)), 3, cv2.GC_INIT_WITH_MASK)
        binary = np.where((labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    return Image.fromarray(binary).filter(ImageFilter.GaussianBlur(0.35))


masks = {
    "head": mask_for([HEAD]),
    "cloak": mask_for([CLOAK], refine=True, blue_cloth=True),
    "legs": mask_for(LEGS, refine=True, black_legs=True),
    "nail": mask_for([NAIL]),
    "platform": mask_for([PLATFORM, ROOT_BRANCH], refine=True),
}
union = np.zeros((image.height, image.width), np.uint8)
for name, mask in masks.items():
    layer = image.convert("RGBA")
    layer.putalpha(mask)
    layer.crop(CROP).save(ROOT / f"{name}.png", optimize=True)
    union = np.maximum(union, np.asarray(mask))

image.crop(CROP).save(ROOT / "full.jpg", quality=95)
hole = np.zeros_like(union)
cv2.fillConvexPoly(hole, cv2.convexHull(cv2.findNonZero(union)), 255)
hole = cv2.dilate(hole, np.ones((25, 25), np.uint8))
Image.fromarray(hole).crop(CROP).save(ROOT / "background-mask.png")
preview = Image.new("RGBA", image.size)
for name in ["legs", "nail", "head", "cloak", "platform"]:
    layer = image.convert("RGBA")
    layer.putalpha(masks[name])
    preview.alpha_composite(layer)
preview.crop(CROP).save(ROOT / "character.png", optimize=True)
print("Prepared five layers from the original pixels.")
