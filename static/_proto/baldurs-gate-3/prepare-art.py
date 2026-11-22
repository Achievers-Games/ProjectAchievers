"""Calques du hero Steam de Baldur's Gate 3, application 1086940."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
dice_zone = card.poly([(88,300),(165,296),(165,352),(128,366),(95,352)], 1.2)
group = matte * (1 - dice_zone)
# Le dé, plus rouge que son halo.
red = card.rgb[..., 0].astype(np.float32) - card.rgb[..., 2]
dice = card.poly([(128,305),(140,318),(152,325),(146,340),(148,350),(128,364),(112,352),(102,350),(107,336),(103,322),(118,318)], 1.0)
region = [(60,0),(440,0),(470,90),(580,90),(610,200),(660,60),(760,60),(812,300),(812,540),(620,620),
    (330,620),(60,560)]
hole = np.maximum(card.poly(region, 0), card.grow(dice, 12))
background = card.sky(card.rgb, hole)
card.check(background, hole)
fade = card.poly(region, 22)
around, colors = card.lift(background, fade, 8, 60)
whole = np.maximum(group, around)
colors = np.where(whole[..., None] > 0.97, card.rgb, card.solve(background, whole))
card.layer("group.png", "Compagnons et nuées", whole * (1 - card.grow(dice, 5)) + whole * card.grow(dice, 5) * 0.999, card.fill(colors, card.grow(dice, 5)))
card.layer("dice.png", "Dé", dice, crop=True)
card.finish(background)
