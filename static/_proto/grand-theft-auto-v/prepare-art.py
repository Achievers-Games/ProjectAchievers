"""Calques du hero Steam de Grand Theft Auto V, application 271590."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# La passante passe devant l'agente. Entre le bras et le tee-shirt, on voit l'uniforme.
outline = card.poly([(1420,20),(1395,150),(1386,200),(1386,262),(1380,290),(1383,312),(1370,322),
    (1340,330),(1300,339),(1275,350),(1258,353),(1245,367),(1215,373),(1180,383),(1150,399),
    (1133,419),(1128,437),(1134,451),(1165,486),(1200,529),(1231,556),(1235,569),(1246,571),
    (1256,567),(1281,584),(1278,600),(1268,607),(1262,620),(1900,620),(1900,20)], 0.8)
gap = card.poly([(1240,465),(1261,460),(1269,463),(1269,499),(1261,493)], 0.8)

# Le ciel entier est refait : personnages, ombre portée de leur contour et palmiers compris.
green = cv2.GaussianBlur(card.rgb[..., 1].astype(np.float32), (0, 0), 0.6)
limit = np.interp(np.arange(card.height), [0, 190, 330, 620], [100, 122, 190, 200])[:, None]
dark = (green < limit).astype(np.float32)
left_zone = card.poly([(440,0),(690,0),(770,40),(770,300),(850,360),(850,620),(440,620)], 0)
left_zone = left_zone * (1 - card.poly([(0,0),(452,0),(440,620),(0,620)], 0))
right_zone = card.poly([(1620,0),(1920,0),(1920,620),(1620,620)], 0)
hole = np.maximum(card.grow(matte, 30), card.grow(dark * np.maximum(left_zone, right_zone), 9))
background = card.sky(card.rgb, hole, across=1.0, down=0.12)
card.check(background, hole)

far = 1 - card.grow(matte, 12)
for file, label, zone in (("palms.png", "Palmiers gauches", left_zone), ("palms-right.png", "Palmiers droits", right_zone)):
    alpha, colors = card.lift(background, cv2.GaussianBlur(card.grow(dark * zone, 4).astype(np.float32), (0, 0), 1.5) * np.maximum(far, 0), 14, 46)
    if file == "palms-right.png":
        # Le palmier continue derrière le bras de la passante.
        blind = ((card.grow(matte, 14) > 0) & (right_zone > 0)).astype(np.uint8)
        blind[:395] = 0
        # Sa couronne est presque symétrique : le côté caché reprend le côté visible, en miroir.
        ys, xs = np.nonzero(blind * (np.arange(card.width)[None, :] < 1782))
        mirror = np.clip(2 * 1782 - xs, 0, card.width - 1)
        alpha[ys, xs], colors[ys, xs] = alpha[ys, mirror], colors[ys, mirror]
        # Les restes isolés du trait de la passante ne sont pas des palmes.
        count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.3).astype(np.uint8))
        small = np.isin(labels, np.nonzero(stats[:, cv2.CC_STAT_AREA] < 420)[0])
        alpha = np.where(small, 0, alpha)
        alpha[:470, :1700] = 0
    card.layer(file, label, alpha, colors)

# Le contour noir épais des personnages fait partie d'eux.
ink = cv2.GaussianBlur((card.rgb.max(axis=2) < 92).astype(np.float32), (0, 0), 0.8) * card.grow(matte, 22)
ink = ink * (1 - card.poly([(1700,0),(1920,0),(1920,620),(1700,620)], 2) * (1 - card.grow(matte, 14)))
alpha, colors = card.subject(np.maximum(matte, ink), background, reach=1, low=40, high=90)
front = np.clip(outline * (1 - gap), 0, 1)
woman, officer = alpha * front, alpha * (1 - front)
under = card.fill(colors, card.grow(woman, 3))
card.layer("officer.png", "Agente", card.behind(officer, woman, 26), under)
card.layer("woman.png", "Passante", woman, colors)
card.finish(background)
