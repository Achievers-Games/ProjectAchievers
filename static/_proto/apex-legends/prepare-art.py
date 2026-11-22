"""Calques du hero Steam d'Apex Legends, application 1172470."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# Le drone, sans son faisceau ni l'aile qu'il éclaire : eux restent peints dans le décor.
drone_zone = card.poly([(1365,0),(1445,0),(1468,28),(1486,74),(1466,126),(1478,150),(1470,282),
    (1474,302),(1452,332),(1438,424),(1430,438),(1366,438),(1364,400),(1372,332),(1360,312),
    (1366,282),(1350,150),(1290,176),(1230,198),(1204,166),(1330,108),(1333,60),(1348,24)], 0.8)
drone = np.maximum(matte, 0.0) * drone_zone
figure = matte * (1 - card.poly([(1190,0),(1920,0),(1920,460),(1340,460),(1190,220)], 0))
figure = card.islands(figure)

hole = card.grow(np.maximum(figure, drone), 13)
background = card.fill(card.rgb, hole)
card.layer("drone.png", "Drone", drone, card.clean(matte), crop=True)
card.layer("figure.png", "Crypto", figure, card.clean(figure))
card.finish(background)
