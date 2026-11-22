"""Calques du hero Steam de Brawlhalla, application 291550."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
tip = card.poly([(1570,89),(1645,66),(1725,94),(1731,135),(1676,153),(1680,238),(1775,275),(1804,375),(1661,398),(1566,484),(1504,385),(1394,342),(1455,253),(1566,233),(1600,151),(1553,125)], 0.8)
# Le trait noir du contour appartient au marteau.
tip = cv2.GaussianBlur(card.grow(tip, 6).astype(np.float32), (0, 0), 0.8)
hammer = matte * tip
zone = card.poly([(1225,620),(1225,500),(1270,470),(1340,470),(1390,440),(1430,340),(1920,340),(1920,620)], 1.0)
fire = matte * zone * (1 - tip)
heroes = matte * (1 - np.maximum(tip, zone))
hole = np.maximum(card.grow(matte, 14), card.grow(fire, 70))
background = card.sky(card.rgb, hole)
card.check(background, hole)
whole, colors = card.subject(matte, background, reach=10, low=40, high=110)
ember = card.poly([(1190,620),(1190,470),(1300,400),(1420,380),(1560,470),(1740,390),(1920,420),(1920,620)], 8) * card.grow(fire, 66) * (1 - tip) * (1 - card.grow(heroes, 4))
glow, glow_rgb = card.lift(background, ember, 8, 60)
fire_alpha = np.maximum(glow, fire)
fire_rgb = np.where(fire_alpha[..., None] > 0.97, card.rgb, card.solve(background, fire_alpha))
# Sous la pointe du marteau, la flamme continue ; ailleurs, rien à inventer.
jet = card.poly([(1500,395),(1700,395),(1690,520),(1520,520)], 8)
under = np.where((card.grow(hammer, 3) > 0)[..., None], np.array([255, 246, 236], np.uint8), fire_rgb)
card.layer("fire.png", "Flammes", np.maximum(fire_alpha * (1 - hammer), hammer * jet * 0.96), under)
card.layer("hammer.png", "Marteau", hammer, card.clean(hammer), crop=True)
card.layer("heroes.png", "Combattants", whole * card.grow(heroes, 3) * (1 - np.maximum(tip, zone * (1 - card.grow(heroes, 2)))), colors)
card.finish(background)
