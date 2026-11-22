"""Calques du hero Steam de Little Nightmares, application 424840."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
six = card.islands(card.matte())
fingers = {
    "f1": [(532,452),(552,450),(571,466),(574,520),(566,600),(530,600),(528,520)],
    "f2": [(598,440),(612,423),(630,432),(640,480),(642,560),(634,606),(608,606),(602,520)],
    "f3": [(670,458),(690,450),(708,470),(718,540),(716,600),(690,602),(682,520)],
    "f4": [(784,515),(800,507),(811,520),(813,600),(782,602)],
}
masks = {name: card.poly(points, 1.3) for name, points in fingers.items()}
# La table porte Six et les doigts : elle partage leur plan, sinon les pieds glissent dessus.
table = card.poly([(0,584),(340,497),(440,468),(700,398),(716,400),(930,620),(0,620)], 1.2)
fingers_all = np.maximum.reduce(list(masks.values()))
hole = np.maximum(card.grow(six, 9), card.grow(np.maximum(table, fingers_all), 5))
under_fingers = card.fill(card.rgb, card.grow(fingers_all, 5))
background = card.fill(card.rgb, hole)
card.layer("six.png", "Six", six, card.clean(six))
card.layer("table.png", "Table", table, under_fingers)
for name, mask in masks.items():
    card.layer(f"{name}.png", "Doigt", mask, crop=True)
card.finish(background)
