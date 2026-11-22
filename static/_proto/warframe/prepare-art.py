"""Calques du hero Steam de Warframe, application 230410."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
hole = card.grow(figure, 14)
background = card.fill(card.rgb, hole)
card.check(background, hole)
card.layer("figure.png", "Warframe et arme de glace", figure, card.clean(figure))
card.finish(background)
