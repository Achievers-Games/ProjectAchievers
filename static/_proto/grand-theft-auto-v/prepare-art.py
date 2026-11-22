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
woman = matte * outline * (1 - gap)
officer = matte * (1 - woman)

# Palmiers : les silhouettes sombres sur le ciel doré, hors de la façade.
green = cv2.GaussianBlur(card.rgb[..., 1].astype(np.float32), (0, 0), 0.6)
# Le ciel est orangé en haut et presque blanc en bas : le seuil suit la hauteur.
limit = np.interp(np.arange(card.height), [0, 190, 330, 620], [96, 118, 186, 196])[:, None]
palms = np.clip((limit - green) / 12 + 0.5, 0, 1)
zone = card.poly([(440,0),(690,0),(770,40),(770,300),(850,360),(850,620),(440,620)], 2)
palms = palms * zone * (1 - card.poly([(0,0),(452,0),(440,620),(0,620)], 1))

hole = np.maximum(card.grow(matte, 14), card.grow(palms, 8))
background = card.fill(card.rgb, hole)

officer_rgb = card.fill(card.clean(matte), card.grow(woman, 3))
card.layer("palms.png", "Palmiers", palms)
card.layer("officer.png", "Agente", card.behind(officer, woman, 26), officer_rgb)
card.layer("woman.png", "Passante", woman, card.clean(woman))
card.finish(background)
