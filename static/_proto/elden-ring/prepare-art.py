"""Calques du hero Steam d'Elden Ring, application 1245620."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from card_kit import Card

card = Card(__file__)
# Le Sans-éclat est petit : son détourage se refait sur une zone agrandie.
box = (700, 380, 1060, 580)
knight = card.matte(box)
ground = card.poly([(560,620),(632,578),(700,566),(778,562),(796,552),(850,546),(872,548),(900,558),
    (926,548),(950,540),(962,534),(975,522),(1000,515),(1040,512),(1062,530),(1100,545),(1142,554),
    (1146,574),(1200,588),(1234,574),(1330,598),(1350,620)], 1.6)
knight = card.islands(knight * (1 - ground * 0.0))
# La nuée dorée, en voile doux : elle dérive par-dessus le décor sans trou à combler.
cloud = np.maximum(card.poly([(660,170),(760,220),(860,330),(760,330),(650,250)], 34),
    card.poly([(1090,300),(1130,200),(1220,90),(1330,40),(1250,220),(1180,300)], 34))

hole = np.maximum(card.grow(knight, 10), card.grow(ground, 10))
background = card.fill(card.rgb, hole)
card.layer("cloud.png", "Nuée dorée", cloud)
card.layer("ground.png", "Sol et dépouille", ground, card.rgb, crop=True)
card.layer("knight.png", "Sans-éclat", knight, card.clean(knight))
card.finish(background)
