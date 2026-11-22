"""Calques du hero Steam d'Overwatch, application 2357570."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# La lame lévite au-dessus des doigts, sans les toucher.
blade_zone = card.poly([(880,60),(950,60),(990,180),(985,245),(930,266),(905,240),(872,238),(872,170)], 0.6)
blade = matte * blade_zone
figure = matte * (1 - blade_zone)

# Oiseaux mécaniques devant la lune : sombres sur un disque clair, la clé se lit dans le vert.
green = card.rgb[..., 1].astype(np.float32)
bird = np.clip((112 - green) / 34, 0, 1) * card.poly([(1372,70),(1420,62),(1440,100),(1480,62),
    (1515,66),(1500,110),(1440,186),(1400,190),(1376,160)], 2)
bat = np.clip((92 - green) / 34, 0, 1) * card.poly([(1548,282),(1662,282),(1662,322),(1548,322)], 2)

# Les petits oiseaux se refont sur place, dans la texture de la lune.
scenery = card.fill(card.rgb, card.grow(np.maximum(bird, bat), 7))
hole = card.grow(matte, 12)
background = card.sky(scenery, hole)
# La lune continue derrière le personnage : même rayon, angle voisin.
disc = card.grow(matte, 12)
moon, left = card.around(scenery, hole, (1422, 280), 0, 238, [180, 150, 210, 120, 240, 90, 270, 60, 300, 40, 320, 20, 340])
yy, xx = np.mgrid[0 : card.height, 0 : card.width]
inside = cv2.GaussianBlur((np.hypot(xx - 1422, yy - 280) < 234).astype(np.float32), (0, 0), 1.2)
inside = (inside * ((disc > 0) & (left == 0)))[..., None]
background = (background * (1 - inside) + moon * inside).round().astype(np.uint8)
card.check(background, hole)
bird_left = card.poly([(1392,74),(1416,74),(1420,136),(1400,142),(1392,130)], 0.8)
bird_right = card.poly([(1418,128),(1424,112),(1490,60),(1512,70),(1448,138),(1434,150)], 0.8)
card.layer("bird-left.png", "Aile gauche de l'oiseau", bird * bird_left, crop=True)
card.layer("bird-right.png", "Aile droite de l'oiseau", bird * bird_right, crop=True)
card.layer("bird-body.png", "Corps de l'oiseau", bird * (1 - np.maximum(card.poly([(1392,60),(1418,60),(1420,128),(1400,134),(1392,122)], 0.8), card.poly([(1422,120),(1428,106),(1490,50),(1520,70),(1452,132),(1438,142)], 0.8))), crop=True)
bat_left = card.poly([(1540,280),(1596,280),(1600,322),(1540,322)], 0.8)
card.layer("bat-left.png", "Aile gauche", bat * bat_left, crop=True)
card.layer("bat-right.png", "Aile droite", bat * (1 - bat_left), crop=True)
around = cv2.GaussianBlur(card.grow(matte, 12).astype(np.float32), (0, 0), 4)
alpha, colors = card.lift(background, around, 5, 46)
card.layer("veil.png", "Lueur autour du sujet", alpha * (1 - cv2.GaussianBlur(card.grow(matte, 5).astype(np.float32), (0, 0), 1.5)), colors)
card.layer("figure.png", "Personnage et trône", figure, card.clean(figure))
card.layer("blade.png", "Lame en lévitation", blade, card.clean(blade), crop=True)
card.finish(background)
