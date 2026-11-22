"""Calques du hero Steam de R.E.P.O., application 3241660."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
shape = card.poly([(1173,627),(1214,427),(1233,360),(1250,356),(1251,300),(1242,227),(1264,164),(1298,107),(1345,78),(1395,73),(1447,84),(1497,116),(1529,182),(1536,264),(1530,336),(1540,353),(1556,418),(1547,509),(1547,627)], 0.8)
red = matte * shape
green = matte * (1 - shape) * card.poly([(900,100),(1390,100),(1390,620),(900,620)], 0)
blue = matte * (1 - shape) * card.poly([(1391,100),(1920,100),(1920,620),(1391,620)], 0)
background = card.fill(card.rgb, card.grow(matte, 12))
# Pupilles mobiles : le blanc de l'œil est repeint dessous.
eyes = {"r1":[1264,226,13,18],"r2":[1417,229,15,17],"g1":[1053,219,9,12],"g2":[1001,252,8,12],"b1":[1669,336,14,15],"b2":[1781,342,13,14]}
spots = {}
for name, (x, y, rx, ry) in eyes.items():
    disc = np.zeros((card.height, card.width), np.float32)
    cv2.ellipse(disc, (x, y), (rx, ry), 12, 0, 360, 1.0, -1, cv2.LINE_AA)
    spots[name] = cv2.GaussianBlur(disc, (0, 0), 1.0)
white = card.clean(matte).astype(np.float32)
for name, (x, y, rx, ry) in eyes.items():
    ring = np.zeros((card.height, card.width), np.uint8)
    cv2.circle(ring, (x, y), round(max(rx, ry) * 2.1), 1, -1)
    bright = white[(ring > 0) & (card.rgb.mean(axis=2) > 165)]
    cover = cv2.GaussianBlur(card.grow(spots[name], 3).astype(np.float32), (0, 0), 1.2)[..., None]
    white = white * (1 - cover) + np.median(bright, axis=0) * cover
white = white.round().astype(np.uint8)
under = card.fill(white, card.grow(red, 3))
card.layer("green.png", "Robot vert", card.behind(green, red, 18), under)
card.layer("g1.png", "Pupille", spots["g1"], crop=True)
card.layer("g2.png", "Pupille", spots["g2"], crop=True)
card.layer("blue.png", "Robot bleu", card.behind(blue, red, 18), under)
card.layer("b1.png", "Pupille", spots["b1"], crop=True)
card.layer("b2.png", "Pupille", spots["b2"], crop=True)
card.layer("red.png", "Robot rouge", red, white)
card.layer("r1.png", "Pupille", spots["r1"], crop=True)
card.layer("r2.png", "Pupille", spots["r2"], crop=True)
card.finish(background)
