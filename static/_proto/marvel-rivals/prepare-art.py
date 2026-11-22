"""Calques du hero Steam de Marvel Rivals, application 2767030."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.islands(card.matte(), keep=2)
# Le liseré orange décalé appartient au personnage.
r, g, b = (card.rgb[..., i].astype(np.float32) for i in range(3))
orange = np.clip((205 - g) / 20, 0, 1) * np.clip((r - 150) / 30, 0, 1) * np.clip((130 - b) / 40, 0, 1)
hero = np.maximum(matte, orange * card.grow(matte, 18))
hole = np.maximum(card.grow(hero, 16), card.poly([(1490,170),(1700,180),(1740,330),(1560,340)], 0))
background = card.sky(card.rgb, hole)
# La bande blanche du X se prolonge sous le personnage.
band = np.maximum(card.poly([(1650,0),(1722,0),(1140,620),(942,620)], 2), card.poly([(1105,0),(1240,0),(1655,612),(1522,612)], 2))
band = band * cv2.GaussianBlur(card.grow(hero, 9).astype(np.float32), (0, 0), 2)
background = (background * (1 - band[..., None]) + np.array([254, 255, 250]) * band[..., None]).round().astype(np.uint8)
background = np.clip(background, 0, 255)
card.check(background, card.grow(hero, 16))
smoke = np.maximum(card.poly([(1490,170),(1700,180),(1740,330),(1560,340)], 6), card.poly([(960,300),(1330,300),(1330,620),(960,620)], 10))
wisps, _ = card.lift(background, smoke * (card.rgb[..., 2] > 70), 20, 80)
whole = np.maximum(hero, wisps)
card.layer("hero.png", "Diablo", whole, np.where(whole[..., None] > 0.97, card.rgb, card.solve(background, whole)))
card.finish(background)
