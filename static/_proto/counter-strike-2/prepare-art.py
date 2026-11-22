"""Calques du hero Steam de Counter-Strike 2, application 730."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# Le CT passe devant le terroriste ; leur frontière tombe dans le noir des deux silhouettes.
front = card.poly([(1080,60),(1500,60),(1520,240),(1548,310),(1556,390),(1600,430),(1586,480),
    (1600,540),(1600,620),(1080,620)], 1.0)
ct = matte * front
terro = matte * (1 - front)
background = card.fill(card.rgb, card.grow(matte, 14))
under = card.fill(card.clean(matte), card.grow(ct, 3))
card.layer("terro.png", "Terroriste", card.behind(terro, ct, 20), under)
card.layer("ct.png", "Antiterroriste", ct, card.clean(matte))
card.finish(background)
