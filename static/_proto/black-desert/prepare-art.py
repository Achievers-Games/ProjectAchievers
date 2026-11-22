"""Calques du hero Steam de Black Desert, application 582660."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from card_kit import Card

card = Card(__file__)
figure = card.islands(card.matte())
# Le rocher entrevu entre la cape et l'épaule n'a pas de suite visible : il part avec le sujet.
gapzone = card.poly([(640,110),(800,150),(810,350),(730,340)], 0)
hole = np.maximum(card.grow(figure, 16), gapzone)
background = card.fill(card.rgb, hole)
card.check(background, hole)
clean = card.clean(figure)
# Le bras armé d'un bloc : manche, mains et pistolet.
arm = figure * card.poly([(764,186),(772,168),(788,150),(822,150),(846,160),(850,182),(836,196),(846,208),
    (880,214),(905,207),(922,198),(920,184),(932,166),(1004,174),(1022,184),(1018,238),(1000,242),
    (960,234),(947,240),(952,262),(942,286),(916,294),(892,284),(872,270),(840,279),(802,272),
    (778,250),(764,220)], 0.9)
head = figure * card.poly([(836,44),(970,44),(958,140),(934,158),(926,176),(900,196),(882,184),(862,170),
    (850,160),(846,140),(856,120)], 1.0)
left = card.poly([(330,90),(650,90),(700,140),(742,230),(752,300),(772,332),(786,348),(770,372),(764,400),
    (730,430),(690,478),(600,520),(330,520)], 1.2)
right = card.poly([(966,130),(1060,140),(1200,260),(1200,392),(1086,382),(1092,330),(1084,296),(1052,282),
    (1014,290),(994,262),(1004,242),(1020,236),(1024,184),(1004,172)], 1.0)
cape, cape_right = figure * left * (1 - arm), figure * right * (1 - arm)
rest = figure * (1 - np.maximum.reduce([left, right]))
body = np.clip(rest, 0, 1)
# Sous chaque pièce, la matière de la pièce qui la porte.
jacket = card.fill(clean, np.maximum(card.grow(arm, 4), card.grow(head, 4)))
torso = card.poly([(764,186),(800,160),(850,150),(930,165),(960,240),(960,300),(900,310),(800,300),(772,250)], 2)
body_alpha = np.maximum(body * (1 - head * (1 - torso)) * (1 - arm * (1 - torso)), np.minimum(np.maximum(arm, head), torso))
cloth = card.fill(clean, card.grow(np.maximum(body, arm), 4))
card.layer("cape.png", "Cape et ruban", card.behind(cape, np.maximum(body, arm), 40), cloth)
card.layer("cape-right.png", "Pan droit", card.behind(cape_right, np.maximum(body, arm), 24), cloth)
card.layer("body.png", "Corps", body_alpha, jacket)
card.layer("head.png", "Tête", head, clean)
card.layer("arm.png", "Bras, mains et pistolet", arm, clean)
card.finish(background)
