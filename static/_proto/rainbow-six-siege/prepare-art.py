"""Calques du hero Steam de Rainbow Six Siege, application 359550."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
left = matte * card.poly([(0,0),(960,0),(960,620),(0,620)], 0)
sledge = matte * card.poly([(1000,40),(1440,40),(1440,330),(1380,620),(1000,620)], 1)
shield = matte * card.poly([(1441,120),(1920,120),(1920,620),(1381,620),(1441,330)], 1)
hole = card.grow(matte, 12)
background = card.fill(card.rgb, hole)
card.check(background, hole)
clean = card.clean(matte)
for file, label, part in (("left.png", "Duo gauche", left), ("shield.png", "Bouclier", shield), ("sledge.png", "Masse", sledge)):
    card.layer(file, label, part, clean)
card.finish(background)
