"""Calques du hero Steam de Apex Legends, application 1172470."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# Le drone entier : corps, aile gauche, aile droite et faisceau qui passe devant elle.
body_zone = card.poly([(1365,0),(1445,0),(1470,28),(1490,74),(1474,126),(1482,150),(1474,282),
    (1476,302),(1456,332),(1440,424),(1432,440),(1364,440),(1362,400),(1370,332),(1358,312),
    (1364,282),(1348,150),(1290,178),(1228,200),(1200,166),(1330,104),(1331,60),(1346,22)], 1.0)
drone = matte * body_zone
beam_zone = card.poly([(1430,78),(1690,76),(1700,118),(1640,124),(1672,150),(1652,180),(1600,196),
    (1800,345),(1800,400),(1700,345),(1560,230),(1480,165),(1432,104)], 7)
wing = card.poly([(1484,112),(1600,122),(1640,118),(1676,142),(1656,178),(1560,182),(1500,172),(1480,150)], 4)
beam_zone = np.maximum(beam_zone, wing)
figure = card.islands(matte * (1 - card.poly([(1190,0),(1920,0),(1920,460),(1340,460),(1190,220)], 0)))
# Éclats verts numériques autour de la veste : ils suivent le personnage.
red, green, blue = (card.rgb[..., i].astype(np.float32) for i in range(3))
glitch = ((green - red > 90) & (green > 190)).astype(np.float32) * card.grow(figure, 46)
hole = np.maximum.reduce([card.grow(figure, 14), card.grow(drone, 12), card.grow(beam_zone, 3), card.grow(glitch, 6)])
background = card.sky(card.rgb, hole)
card.check(background, hole)

alpha, colors = card.lift(background, beam_zone, 8, 60)
card.layer("beam.png", "Faisceau et aile droite", alpha, colors, crop=True)
alpha, colors = drone, np.where(drone[..., None] > 0.97, card.rgb, card.solve(background, drone))
card.layer("drone.png", "Drone", alpha, colors, crop=True)
soft = cv2.GaussianBlur(glitch.astype(np.float32), (0, 0), 0.8) * (1 - np.maximum(card.grow(drone, 6), beam_zone))
whole = np.maximum(figure, np.clip(soft, 0, 1))
card.layer("figure.png", "Crypto", whole, np.where(whole[..., None] > 0.97, card.rgb, card.solve(background, whole)))
card.finish(background)
