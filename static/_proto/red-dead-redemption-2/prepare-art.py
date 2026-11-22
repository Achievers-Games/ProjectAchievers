"""Calques du hero Steam de Red Dead Redemption 2, application 1174180."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
# Le drapeau noir étoilé du bas ondule devant le soleil.
flag = card.poly([(0,470),(120,470),(300,462),(600,464),(680,462),(730,454),(800,460),(860,468),
    (920,460),(990,472),(1040,480),(1130,470),(1250,465),(1500,455),(1620,448),(1700,440),
    (1760,444),(1920,446),(1920,620),(0,620)], 1.2)
hole = card.grow(flag, 10)
sunless = card.grow(figure, 22)
# Le bord brossé du soleil continue derrière le chapeau, son disque derrière Arthur.
smooth = card.sky(card.rgb, np.maximum(sunless, hole), across=0.35, down=1.0)
ring, left = card.around(card.rgb, np.maximum(sunless, hole), (1386, 424), 330, 412, [-40, 40, -55, 55, -70, 70, -85, 85])
use = ((np.maximum(sunless, hole) > 0) & (left == 0))[..., None]
yy = np.mgrid[0 : card.height, 0 : card.width][0][..., None]
scenery = np.where(use & (yy < 300), ring, smooth)
# Le disque est un aplat : la teinte médiane du soleil visible.
yy, xx = np.mgrid[0 : card.height, 0 : card.width]
reach = np.hypot(xx - 1386, yy - 424)
disc = (reach < 344) & (yy < 455)
known = disc & (np.maximum(sunless, hole) == 0)
yellow = np.median(card.rgb[known], axis=0)
grain = np.random.default_rng(3).normal(0, 2.2, disc.shape)[..., None]
inside = (np.clip((346 - reach) / 8, 0, 1) * (np.maximum(sunless, hole) > 0) * (yy < 600))[..., None]
background = np.clip(scenery * (1 - inside) + (yellow + grain) * inside, 0, 255).round().astype(np.uint8)
card.check(background, sunless)
cloth = card.fill(card.rgb, card.grow(figure, 6))
card.layer("flag.png", "Drapeau étoilé", flag, cloth, crop=False)
card.layer("arthur.png", "Arthur", figure, card.clean(figure))
card.finish(background)
