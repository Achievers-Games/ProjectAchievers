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
background = card.fill(card.rgb, card.grow(matte, 12))
clean = card.clean(matte)
card.layer("fire.png", "Flammes", card.behind(fire, hammer, 40), card.fill(clean, card.grow(hammer, 3)))
card.layer("hammer.png", "Marteau", hammer, clean, crop=True)
card.layer("heroes.png", "Combattants", heroes, clean)
card.finish(background)
