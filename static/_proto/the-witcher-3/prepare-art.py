"""Calques du hero Steam de The Witcher 3, application 292030."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.islands(card.matte())
# Les branches fines échappent au détourage : sombres sur un ciel clair.
light = card.rgb.mean(axis=2).astype(np.float32)
twigs = np.clip((150 - light) / 40, 0, 1) * card.poly([(855,0),(1080,0),(1080,300),(1010,420),(860,440)], 3)
mass = np.maximum(matte, twigs)
background = card.fill(card.rgb, card.grow(mass, 8))
card.layer("mass.png", "Geralt et compagnons", mass, card.clean(mass))
card.finish(background)
