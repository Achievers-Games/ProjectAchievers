"""Calques du hero Steam de The Elder Scrolls V: Skyrim, application 72850."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
left = card.poly([(500,300),(662,300),(662,330),(612,400),(632,620),(500,620)], 0.6)
bow, hero = matte * left, card.islands(matte * (1 - left))
background = card.fill(card.rgb, card.grow(matte, 14))
card.layer("bow.png", "Arc", bow, card.clean(matte), crop=True)
card.layer("hero.png", "Enfant de dragon", hero, card.clean(matte))
card.finish(background)
