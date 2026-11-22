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
background = card.fill(card.rgb, card.grow(hero, 9))
# La bande blanche du X se prolonge sous le personnage.
band = card.poly([(1650,0),(1722,0),(1140,620),(942,620)], 2) * cv2.GaussianBlur(card.grow(hero, 9).astype(np.float32), (0, 0), 2)
background = (background * (1 - band[..., None]) + np.array([254, 255, 250]) * band[..., None]).round().astype(np.uint8)
card.layer("hero.png", "Diablo", hero, card.clean(hero))
card.finish(background)
