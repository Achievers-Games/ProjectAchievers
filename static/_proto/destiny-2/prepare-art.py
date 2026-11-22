"""Calques du hero Steam de Destiny 2, application 1085660."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
sphere = np.zeros((card.height, card.width), np.float32)
cv2.circle(sphere, (960, 310), 187, 1.0, -1, cv2.LINE_AA)
sphere = cv2.GaussianBlur(sphere, (0, 0), 1.2)
# Nuages en voile doux : ils dérivent par-dessus le décor intact, sans trou à combler.
clouds = np.maximum(card.poly([(1190,150),(1500,180),(1560,430),(1300,520),(1190,400)], 40),
    card.poly([(520,540),(1400,540),(1400,600),(520,600)], 30)) * (1 - card.grow(sphere, 20))
clouds = cv2.GaussianBlur(clouds, (0, 0), 6)
background = card.fill(card.rgb, card.grow(sphere, 16))
card.layer("clouds.png", "Nuages", clouds)
card.layer("sphere.png", "Le Voyageur", sphere)
card.finish(background)
