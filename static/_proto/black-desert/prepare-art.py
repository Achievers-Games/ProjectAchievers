"""Calques du hero Steam de Black Desert, application 582660."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
background = card.fill(card.rgb, card.grow(figure, 14))
card.layer("hero.png", "Tireur et cape", figure, card.clean(figure))
card.finish(background)
