"""Calques du hero Steam de Borderlands 2, application 49520."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# Le décor sans le Psycho : les deux collages y continuent derrière son masque.
scenery = card.fill(card.rgb, card.grow(matte, 14))
# Le collage déchiré : tout ce qui n'est ni orange ni jaune, au-dessus de sa lisière.
red, blue = (scenery[..., i].astype(np.float32) for i in (0, 2))
paint = ((red - blue > 95) & (red > 170)).astype(np.uint8)
collage = cv2.morphologyEx(1 - paint, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)).astype(np.float32)
left_zone = card.poly([(0,0),(905,0),(905,260),(850,300),(800,370),(700,360),(560,300),(0,300)], 0)
right_zone = card.poly([(985,0),(1920,0),(1920,290),(1500,360),(1420,385),(1300,350),(1000,300),(985,200)], 0)
collage = cv2.GaussianBlur(collage, (0, 0), 0.8)
left, right = collage * left_zone, collage * right_zone
# La turbine du masque tourne sur elle-même.
fan = np.zeros((card.height, card.width), np.float32)
cv2.circle(fan, (967, 325), 25, 1.0, -1, cv2.LINE_AA)
fan = cv2.GaussianBlur(fan, (0, 0), 1.0)

background = card.fill(scenery, card.grow(np.maximum(left, right), 4))
card.layer("left.png", "Collage gauche", left, scenery, crop=True)
card.layer("right.png", "Collage droit", right, scenery, crop=True)
card.layer("psycho.png", "Psycho", matte, card.clean(matte))
card.layer("fan.png", "Turbine du masque", fan, crop=True)
card.finish(background)
