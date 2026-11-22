"""Calques du hero Steam d'ARK: Survival Evolved, application 346110."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
# Ptérosaures : plus sombres que le ciel lissé autour d'eux.
light = card.rgb.mean(axis=2).astype(np.float32)
sky = cv2.medianBlur(card.rgb, 101).mean(axis=2)
dark = np.clip((sky - light - 14) / 22, 0, 1).astype(np.float32)
large = dark * card.poly([(612,70),(700,70),(740,95),(806,110),(806,134),(735,152),(700,150),(670,110),(612,90)], 3)
small = dark * card.poly([(596,150),(640,165),(680,180),(680,196),(630,200),(596,186)], 3)
# Herbes du premier plan : un voile doux, par-dessus le décor intact.
grass = card.poly([(1440,560),(1500,470),(1600,455),(1700,380),(1800,440),(1920,470),(1920,566),(1440,566)], 12)

background = card.fill(card.rgb, np.maximum(card.grow(figure, 13), card.grow(np.maximum(large, small), 8)))
card.layer("large.png", "Grand ptérosaure", large, crop=True)
card.layer("small.png", "Petit ptérosaure", small, crop=True)
card.layer("grass.png", "Herbes", grass * (1 - card.grow(figure, 2)), crop=False)
card.layer("rider.png", "Cavalière et baryonyx", figure, card.clean(figure))
card.finish(background)
