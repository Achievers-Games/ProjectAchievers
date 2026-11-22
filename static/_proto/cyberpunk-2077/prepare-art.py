"""Calques du hero Steam de Cyberpunk 2077, application 1091500."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
v = card.islands(card.matte())
band = card.poly([(0,592),(1920,592),(1920,620),(0,620)], 0.4)
v = np.clip(v, 0, 1) * (1 - band)
background = card.fill(card.rgb, np.maximum(card.grow(v, 13), card.grow(band, 4)))
card.layer("v.png", "V", card.behind(v, band, 14), card.clean(card.matte()))
card.layer("band.png", "Bandeau", np.maximum(band, 0), crop=False)
card.finish(background)
