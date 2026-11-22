"""Calques du hero Steam de The Witcher 3, application 292030."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.islands(card.matte())
# Les branches fines échappent au détourage : sombres sur un ciel clair.
light = card.rgb.mean(axis=2).astype(np.float32)
twig_zone = card.poly([(855,0),(1080,0),(1080,300),(1010,420),(860,440)], 3)
twigs = np.clip((170 - light) / 30, 0, 1) * twig_zone
# Tout ce qui appartient à l'arbre, aux compagnons, à la pente et aux cavaliers fantômes. Les
# montagnes de droite, le navire et le cerf restent dans le décor.
region = [(845,0),(1430,0),(1430,150),(1470,200),(1545,215),(1580,320),(1625,430),(1735,490),(1860,620),
    (752,620),(840,590),(905,560),(920,520),(885,500),(905,440),(835,400),(850,330),(840,200)]
hole = card.poly(region, 0)
background = card.sky(card.rgb, hole, across=1.0, down=0.3)
matte = matte * hole
card.check(background, hole)
alpha, colors = card.lift(background, card.poly(region, 5), 12, 60)
mass_alpha = np.maximum(alpha, matte)
mass_rgb = np.where(mass_alpha[..., None] > 0.97, card.rgb, card.solve(background, mass_alpha))

# Les pièces mobiles, découpées une à une ; la matière dessous est refaite.
yen = np.maximum(card.sam((1250,28,1395,122), [(1290,80),(1300,50),(1340,75),(1370,90),(1262,70),(1285,125,0),(1240,110,0)]),
    0) * card.poly([(1248,20),(1420,20),(1420,130),(1330,122),(1308,112),(1296,118),(1280,108),(1262,104),(1248,96)], 1)
parts = {
    "triss": card.sam((1098,0,1256,132), [(1200,30),(1195,60),(1180,78),(1125,78),(1235,75),(1200,95),(1100,20,0),(1290,60,0),(1130,110,0)]) * (1 - card.poly([(1246,20),(1300,20),(1300,130),(1246,112)], 1)),
    "geralt-head": card.sam((1080,94,1216,208), [(1105,140),(1130,115),(1150,130),(1170,150),(1120,180),(1100,165),(1200,120,0),(1150,215,0),(1120,215,0)]) * card.poly([(1070,90),(1180,90),(1215,160),(1190,178),(1160,190),(1120,196),(1085,196)], 1.5),
    "ciri-head": card.sam((988,312,1062,404), [(1020,335),(1015,370),(1035,340),(1012,385),(1050,420,0),(975,400,0)]) * card.poly([(980,305),(1066,305),(1062,400),(1040,400),(1015,398),(1000,392),(985,370)], 1.5),
    "ciri-hand": card.sam((915,362,1000,460), [(935,385),(950,375),(955,400),(975,430),(930,405),(1000,370,0),(915,440,0)]),
    "crow": card.sam((1335,515,1490,592), [(1450,560),(1400,545),(1365,532),(1478,548)]),
}
for name in parts:
    parts[name] = np.clip(parts[name], 0, 1)
moving = np.maximum.reduce([yen] + [parts[k] for k in parts])
under = card.fill(mass_rgb, card.grow(moving, 5))
# Hors de la masse, sous les cheveux de Yennefer, c'est le ciel qui apparaît.
# De même derrière sa tête et à droite de Triss.
open_sky = card.poly([(1248,0),(1430,0),(1430,124),(1336,120),(1318,104),(1300,96),(1262,96),(1250,104),(1244,70),(1226,40)], 2)
free = card.grow(np.maximum(yen, parts["triss"]), 9).astype(np.float32) * (1 - parts["triss"] * card.poly([(1090,0),(1226,0),(1250,132),(1090,132)], 1))
mass_alpha = mass_alpha * (1 - np.clip(cv2.GaussianBlur(free, (0, 0), 1.5), 0, 1) * open_sky)
card.layer("mass.png", "Arbre, compagnons et montagne", mass_alpha, under)
card.layer("triss.png", "Triss", parts["triss"], mass_rgb)
hair = card.poly([(1296,20),(1430,20),(1430,135),(1322,124),(1308,100),(1300,60)], 4)
strands, strand_rgb = card.lift(background, card.poly([(1306,18),(1430,18),(1430,128),(1330,122),(1312,92)], 4), 22, 80)
card.layer("yen-hair.png", "Cheveux de Yennefer", np.maximum(strands, yen * hair * (card.rgb.mean(axis=2) < 90)), np.where(strands[..., None] > 0.02, strand_rgb, card.rgb))
head_zone = card.poly([(1246,24),(1308,24),(1318,60),(1312,100),(1300,112),(1284,108),(1268,98),(1250,94)], 2.5)
head_alpha, head_rgb = card.lift(background, head_zone, 10, 40)
card.layer("yen-head.png", "Tête de Yennefer", head_alpha, np.where(head_alpha[..., None] > 0.97, card.rgb, head_rgb))
card.layer("geralt-head.png", "Tête de Geralt", parts["geralt-head"], card.rgb)
card.layer("ciri-hand.png", "Main de Ciri", parts["ciri-hand"], card.rgb)
card.layer("ciri-head.png", "Tête de Ciri", parts["ciri-head"], card.rgb)
crow = parts["crow"]
left = card.poly([(1320,505),(1432,530),(1436,566),(1320,566)], 1)
right = card.poly([(1448,530),(1500,530),(1500,562),(1458,572)], 1)
card.layer("crow-left.png", "Aile gauche du corbeau", crow * left, card.rgb)
card.layer("crow-right.png", "Aile droite du corbeau", crow * right, card.rgb)
card.layer("crow-body.png", "Corbeau", crow * (1 - np.maximum(card.poly([(1320,505),(1424,530),(1428,566),(1320,566)], 1), card.poly([(1456,530),(1500,530),(1500,560),(1464,568)], 1))), card.rgb)
card.finish(background)
