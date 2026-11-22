"""Calques du hero Steam d'Overwatch, application 2357570."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from card_kit import Card

card = Card(__file__)
matte = card.matte()
# La lame lévite au-dessus des doigts, sans les toucher.
blade_zone = card.poly([(880,60),(950,60),(990,180),(985,245),(930,266),(905,240),(872,238),(872,170)], 0.6)
blade = matte * blade_zone
figure = matte * (1 - blade_zone)

# Oiseaux mécaniques devant la lune : sombres sur un disque clair, la clé se lit dans le vert.
green = card.rgb[..., 1].astype(np.float32)
bird = np.clip((112 - green) / 34, 0, 1) * card.poly([(1372,70),(1420,62),(1440,100),(1480,62),
    (1515,66),(1500,110),(1440,186),(1400,190),(1376,160)], 2)
bat = np.clip((92 - green) / 34, 0, 1) * card.poly([(1548,282),(1662,282),(1662,322),(1548,322)], 2)

hole = np.maximum(card.grow(matte, 12), card.grow(np.maximum(bird, bat), 22))
background = card.fill(card.rgb, hole)
card.layer("bird.png", "Oiseau mécanique", bird, crop=True)
card.layer("bat.png", "Silhouette volante", bat, crop=True)
card.layer("figure.png", "Personnage et trône", figure, card.clean(figure))
card.layer("blade.png", "Lame en lévitation", blade, card.clean(blade), crop=True)
card.finish(background)
