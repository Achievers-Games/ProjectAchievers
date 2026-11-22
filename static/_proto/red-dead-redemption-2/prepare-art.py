"""Calques du hero Steam de Red Dead Redemption 2, application 1174180."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
scenery = card.fill(card.rgb, card.grow(figure, 13))
# Le drapeau noir étoilé du bas ondule devant le soleil.
flag = card.poly([(0,470),(120,470),(300,462),(600,464),(680,462),(730,454),(800,460),(860,468),
    (920,460),(990,472),(1040,480),(1130,470),(1250,465),(1500,455),(1620,448),(1700,440),
    (1760,444),(1920,446),(1920,620),(0,620)], 1.2)
background = card.fill(scenery, card.grow(flag, 8))
card.layer("flag.png", "Drapeau étoilé", flag, scenery, crop=False)
card.layer("arthur.png", "Arthur", figure, card.clean(figure))
card.finish(background)
