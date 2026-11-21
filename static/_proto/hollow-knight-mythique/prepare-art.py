"""Détoure le dessin source et exporte les calques dans un repère commun."""

from pathlib import Path
from runpy import run_path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
SOURCE = Image.open(ROOT / "source.png").convert("RGB")
SIZE = SOURCE.size
MASTER = run_path(str(ROOT.parent / "prepare-layered-masters.py"))["write_master"]


def matte(points, blur=0.7):
    alpha = Image.new("L", SIZE)
    ImageDraw.Draw(alpha).polygon(points, fill=255)
    return alpha.filter(ImageFilter.GaussianBlur(blur))


def layer(alpha):
    image = SOURCE.convert("RGBA")
    image.putalpha(alpha)
    return image


head = matte([(555,365),(550,293),(546,237),(535,226),(512,188),(502,150),(505,116),
    (517,84),(538,53),(559,35),(573,29),(588,29),(600,36),(619,39),(629,47),(624,56),
    (604,67),(588,84),(576,104),(565,133),(566,155),(578,168),(606,155),(633,150),
    (670,149),(710,155),(750,170),(780,186),(798,201),(818,188),(832,165),(837,143),
    (834,123),(823,103),(807,87),(803,77),(807,69),(816,66),(830,69),(842,65),(854,69),
    (867,82),(881,107),(890,137),(895,163),(894,186),(884,215),(870,237),(849,255),
    (816,277),(807,305),(798,337),(783,367),(761,392),(739,402),(705,409),(669,409),
    (627,404),(599,394),(577,379)])
cloak = matte([(310,244),(340,235),(372,232),(412,244),(392,225),(387,205),(398,215),(419,222),
    (429,219),(430,208),(420,192),(406,182),(395,176),(419,173),(443,178),(460,187),
    (481,209),(478,192),(484,176),(487,194),(501,209),(551,233),(599,251),(776,277),
    (812,279),(845,268),(875,272),(887,281),(865,286),(853,302),(865,306),(882,301),
    (871,317),(889,312),(901,300),(906,292),(910,307),(908,327),(900,347),(916,364),
    (901,358),(914,386),(894,372),(874,371),(886,392),(858,387),(844,393),(858,411),
    (862,423),(847,422),(824,409),(809,427),(781,437),(799,438),(819,433),(805,448),
    (779,455),(746,455),(748,469),(744,480),(734,467),(713,455),(655,452),(615,453),
    (578,457),(546,469),(528,463),(548,453),(544,444),(490,443),(457,456),(434,454),
    (441,435),(453,420),(477,404),(421,400),(393,401),(376,392),(402,371),(374,366),
    (348,367),(321,377),(332,361),(353,348),(393,340),(366,328),(329,323),(313,311),
    (308,282),(323,295),(366,296),(345,281),(331,263),(351,255),(333,247)])
body = matte([(579,430),(711,437),(700,474),(701,494),(721,500),(750,510),(772,525),
    (778,537),(753,546),(729,563),(714,585),(705,605),(676,604),(686,574),(701,546),
    (664,551),(625,566),(601,589),(587,625),(578,663),(550,670),(544,631),(544,592),
    (548,552),(557,512)])
nail = matte([(147,568),(261,509),(330,479),(404,445),(438,453),(491,429),(517,434),
    (535,446),(475,467),(452,469),(468,486),(350,520),(276,538)])

# Remplir la cape sous le masque avec les teintes du col et une transition courte.
cape = layer(cloak)
head_area = np.asarray(head)
cape_pixels = np.array(cape)
yy, xx = np.indices((SIZE[1], SIZE[0]))
hidden = (head_area > 8) & (cape_pixels[..., 3] > 0)
ribbon = np.sin((yy - 0.18 * (xx - 570)) * 0.14) * 0.5 + 0.5
navy = np.array([9, 22, 52]) + ribbon[..., None] * np.array([12, 19, 36])
cape_pixels[hidden, :3] = navy[hidden]
cape = Image.fromarray(cape_pixels)

# Les pixels protégés par la cape sont repeints sur le corps et la poignée.
cloak_area = np.asarray(cloak)
body_pixels = np.array(layer(body))
hidden_body = (cloak_area > 8) & (body_pixels[..., 3] > 0)
body_pixels[hidden_body, :3] = (8, 15, 45)
body_layer = Image.fromarray(body_pixels)
nail_pixels = np.array(layer(nail))
hidden_grip = (cloak_area > 8) & (nail_pixels[..., 3] > 0) & (xx > 436)
nail_pixels[hidden_grip, :3] = (19, 32, 61)
nail_layer = Image.fromarray(nail_pixels)

# Le socle est un plan indépendant et recouvre les pieds au raccord.
platform = layer(matte([(418,740),(440,726),(484,700),(524,682),(563,665),(590,655),
    (615,626),(646,611),(670,601),(704,603),(731,610),(757,620),(782,637),(796,666),
    (805,704),(834,740)]))
flower_shapes = [
    ("Fleurs bleues en haut", [(122,164),(141,151),(164,142),(183,128),(211,104),
      (238,104),(255,113),(262,133),(257,154),(233,165),(217,186),(200,192),
      (175,184),(151,190),(130,190)]),
    ("Fleurs bleues à gauche", [(0,626),(22,615),(44,626),(58,645),(68,626),
      (101,608),(125,609),(139,619),(144,635),(136,657),(105,682),(61,699),(0,710)]),
    ("Fleurs bleues sur le socle", [(793,631),(807,601),(820,602),(832,613),
      (831,634),(853,639),(854,655),(841,669),(815,682),(796,684)]),
]
flowers = [(name, layer(matte(points, 1.2))) for name, points in flower_shapes]
flower_atlas = Image.new("RGBA", SIZE)
for _, flower in flowers:
    flower_atlas = Image.alpha_composite(flower_atlas, flower)
flower_atlas.save(ROOT / "flowers.png", optimize=True)
coverage = np.maximum.reduce([np.asarray(a) for a in (head, cloak, body, nail,
    platform.getchannel("A"), flower_atlas.getchannel("A"))])
hole = cv2.dilate((coverage > 15).astype(np.uint8), np.ones((17, 17), np.uint8))
pixels = np.asarray(SOURCE)
small = (SIZE[0] // 4, SIZE[1] // 4)
fill = cv2.inpaint(cv2.resize(pixels, small, interpolation=cv2.INTER_AREA),
                   cv2.resize(hole, small, interpolation=cv2.INTER_NEAREST), 6, cv2.INPAINT_TELEA)
fill = cv2.resize(fill, SIZE, interpolation=cv2.INTER_CUBIC)
mix = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 4)[..., None]
bg = Image.fromarray((pixels * (1 - mix) + fill * mix).round().astype(np.uint8))
def extend_sides(rgb):
    """Prolonge les teintes latérales en estompant les motifs réfléchis."""
    pad = 83
    reflected = cv2.copyMakeBorder(rgb, 0, 0, pad, pad, cv2.BORDER_REFLECT_101)
    for band in (reflected[:, :pad], reflected[:, -pad:][:, ::-1]):
        blurred = cv2.GaussianBlur(band.copy(), (0, 0), 24)
        weight = np.linspace(1, 0, pad)[None, :, None] ** 0.7
        band[:] = (band * (1 - weight) + blurred * weight).round().astype(np.uint8)
    return reflected


Image.fromarray(extend_sides(np.asarray(bg))).save(ROOT / "bg.jpg", quality=94)

layers = [("Socle", "platform.png", platform), ("Masque", "head.png", layer(head)),
          ("Cape retouchée", "cloak.png", cape), ("Aiguillon", "nail.png", nail_layer),
          ("Corps retouché", "body.png", body_layer)]
for _, filename, image in layers:
    image.save(ROOT / filename, optimize=True)
MASTER(ROOT.name, [(name, image) for name, _, image in layers] + flowers +
      [("Décor reconstruit", bg.convert("RGBA"))])
poster = extend_sides(pixels)
Image.fromarray(poster).crop((10, 14, 1456, 690)).save(ROOT / "full.jpg", quality=95)
