"""Calques du hero Steam de Subnautica, application 264710."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
shape = card.poly([(509,364),(618,353),(673,314),(673,273),(705,218),(707,145),(750,116),(793,124),(791,182),(847,207),(850,238),(895,238),(956,262),(1011,323),(1013,353),(956,371),(909,318),(873,314),(859,359),(882,386),(945,396),(982,397),(1027,402),(1055,385),(1082,367),(1114,365),(1118,382),(1098,409),(1055,421),(1004,425),(1018,436),(1068,436),(1127,468),(1314,550),(1300,616),(1191,607),(1077,518),(1036,482),(995,511),(956,491),(936,551),(900,551),(791,436),(768,382),(700,338),(609,402),(518,432)], 0.8)
diver = card.islands(matte * shape)
sub = matte * (1 - shape) * card.poly([(930,0),(1920,0),(1920,500),(1380,500),(1000,390),(930,180)], 1)
background = card.fill(card.rgb, card.grow(matte, 12))
card.layer("sub.png", "Cyclops", card.behind(sub, diver * card.poly([(1000,330),(1200,330),(1200,470),(1000,470)], 3), 30), card.fill(card.clean(matte), card.grow(diver, 3)), crop=True)
card.layer("diver.png", "Plongeur", diver, card.clean(diver))
card.finish(background)
