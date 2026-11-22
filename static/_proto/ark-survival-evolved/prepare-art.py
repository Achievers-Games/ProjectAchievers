"""Calques du hero Steam de ARK: Survival Evolved, application 346110."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
wings = {
    "large-tip": [(610,70),(688,80),(690,92),(680,102),(660,98),(610,88)],
    "large-left": [(674,84),(690,82),(716,104),(728,122),(724,142),(706,140),(704,124),(688,118),(676,100)],
    "large-body": [(706,96),(748,96),(748,130),(734,136),(734,154),(700,154),(702,136),(714,124),(724,122)],
    "large-right": [(730,126),(748,122),(790,108),(808,118),(808,138),(790,132),(745,138),(732,144)],
    "small-tip": [(540,128),(612,146),(612,158),(600,164),(540,158)],
    "small-left": [(598,146),(612,148),(626,170),(630,180),(620,188),(612,178),(602,166)],
    "small-body": [(612,162),(644,160),(644,184),(634,192),(634,200),(610,200),(612,184),(620,176)],
    "small-right": [(628,180),(646,176),(672,176),(682,186),(682,198),(664,190),(630,194)],
}
zones = {name: card.poly(points, 0.8) for name, points in wings.items()}
whole = np.maximum.reduce(list(zones.values()))
# Plus sombres que le ciel lissé autour d'eux.
light = card.rgb.mean(axis=2).astype(np.float32)
sky_light = cv2.medianBlur(card.rgb, 101).mean(axis=2)
dark = (sky_light - light > 9).astype(np.float32) * card.grow(whole, 4)
hole = np.maximum(card.grow(figure, 14), card.grow(np.maximum(dark, whole > 0.5), 5))
background = card.sky(card.rgb, np.maximum(card.grow(np.maximum(dark, whole > 0.5), 5), 0))
background = card.fill(background, card.grow(figure, 14))
card.check(background, hole)
for name, zone in zones.items():
    alpha, colors = card.lift(background, zone, 12, 34, sign="dark")
    card.layer(f"{name}.png", name, alpha, colors, crop=False)
# Herbes du premier plan : un voile doux, par-dessus le décor intact.
grass = card.poly([(1440,560),(1500,470),(1600,455),(1700,380),(1800,440),(1920,470),(1920,566),(1440,566)], 12)
card.layer("grass.png", "Herbes", grass * (1 - card.grow(figure, 2)))
clean = card.clean(figure)
top = figure * card.poly([(1110,70),(1410,70),(1410,172),(1352,206),(1322,218),(1300,234),(1264,236),(1254,224),(1110,228)], 1.0)
card.layer("rider.png", "Selle et baryonyx", card.behind(figure * (1 - top), top, 10), card.fill(clean, card.grow(top, 3)))
card.layer("woman.png", "Cavalière et fusil", top, clean)
card.finish(background)
