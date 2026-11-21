"""Prépare les silhouettes du duel et leur décor dans le repère du master Steam."""

from pathlib import Path
from runpy import run_path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
source = Image.open(ROOT / 'source.jpg').convert('RGB')
rgb = np.asarray(source)
width, height = source.size
write_master = run_path(str(ROOT.parent / 'prepare-layered-masters.py'))['write_master']


def mask(points, blur=0.9):
    alpha = Image.new('L', source.size)
    ImageDraw.Draw(alpha).polygon(points, fill=255)
    return np.asarray(alpha.filter(ImageFilter.GaussianBlur(blur)))


# Feuilles au premier plan, relevées sur le JPEG avant de reconstruire le décor.
leaf_shapes = [
    [(170,452),(180,462),(192,473),(196,456),(201,446),(207,429),(210,470),(215,478),
     (226,477),(237,483),(250,473),(244,485),(230,499),(219,502),(225,518),(239,541),
     (225,532),(212,510),(213,530),(217,545),(207,534),(201,511),(198,500),(181,502),
     (167,514),(171,503),(188,496),(179,485),(172,469)],
    [(261,602),(273,623),(277,620),(276,590),(284,611),(291,630),(300,627),(307,627),(314,634),
     (303,632),(301,646),(294,650),(320,657),(305,661),(290,660),(301,673),(290,669),(276,660),
     (274,652),(269,654),(271,643),(266,639),(272,637),(270,626)],
    [(1841,282),(1855,282),(1851,271),(1859,278),(1857,268),(1867,274),(1875,295),(1887,280),
     (1890,279),(1879,294),(1898,297),(1891,300),(1900,306),(1887,304),(1909,321),(1892,314),
     (1881,310),(1880,315),(1886,324),(1874,319),(1867,312),(1865,303),(1852,308),(1843,308),
     (1851,304),(1847,302),(1862,289)],
    [(1340,814),(1351,825),(1372,837),(1375,829),(1379,820),(1395,813),(1403,810),(1397,823),
     (1396,833),(1391,849),(1412,847),(1439,847),(1418,853),(1400,867),(1414,878),(1426,886),
     (1413,883),(1396,879),(1383,862),(1370,878),(1360,882),(1360,878),(1375,859),(1360,861),
     (1342,856),(1325,842),(1346,850),(1356,851),(1347,830)],
]
painted_leaves = np.zeros((height, width), dtype=np.uint8)
leaf_atlas = Image.new('RGBA', (512, 128))
for index, points in enumerate(leaf_shapes):
    alpha = mask(points, 0.55)
    painted_leaves = np.maximum(painted_leaves, alpha)
    leaf_image = source.convert('RGBA')
    leaf_image.putalpha(Image.fromarray(alpha))
    leaf_image = leaf_image.crop(leaf_image.getbbox())
    leaf_image.thumbnail((114, 114), Image.Resampling.LANCZOS)
    leaf_atlas.paste(leaf_image, (128 * index + (128 - leaf_image.width) // 2,
                                (128 - leaf_image.height) // 2))
leaf_atlas.save(ROOT / 'maple-leaves.png', optimize=True)
leaf_holes = cv2.dilate((painted_leaves > 12).astype(np.uint8), np.ones((13, 13), np.uint8))
rgb = cv2.inpaint(rgb, leaf_holes, 4, cv2.INPAINT_TELEA)


def layer(alpha, colors=rgb):
    return Image.fromarray(np.dstack((np.where(alpha[..., None] > 0, colors, 0), alpha)))


wolf = mask([(274,463),(276,380),(291,319),(354,340),(400,376),(422,414),(419,365),
    (419,324),(437,280),(450,253),(479,243),(512,241),(522,251),(498,272),(535,283),
    (600,288),(616,250),(634,219),(657,202),(665,177),(690,150),(699,117),(714,89),
    (707,72),(713,58),(732,78),(745,74),(743,93),(766,111),(770,134),(760,160),
    (780,174),(794,172),(805,184),(846,173),(883,172),(930,184),(967,197),(992,180),
    (1012,175),(1018,184),(982,216),(978,230),(964,240),(946,236),(958,218),(858,220),
    (805,239),(801,282),(792,315),(807,334),(850,340),(931,375),(978,393),(1013,399),
    (1009,406),(970,416),(949,415),(969,438),(932,432),(908,454),(873,445),(845,420),
    (874,453),(921,491),(949,540),(978,565),(991,603),(1023,651),(1047,685),(1079,712),
    (1092,741),(1082,759),(1063,764),(1042,749),(1014,719),(1006,697),(970,660),
    (947,625),(915,595),(883,568),(835,515),(775,470),(735,458),(723,475),(746,489),
    (751,510),(754,579),(748,593),(733,598),(716,583),(709,557),(710,530),(675,514),
    (641,511),(605,493),(586,474),(556,492),(531,484),(503,468),(470,450),(465,471),
    (385,480),(346,472)])
katana = mask([(835,312),(914,251),(953,224),(958,230),(843,313)], 0.55)
wolf = np.maximum(wolf, katana)
monk = mask([(978,591),(1002,575),(1076,557),(1120,519),(1143,474),(1104,471),(1097,454),
    (1113,438),(1118,423),(1138,415),(1162,415),(1185,431),(1215,409),(1233,389),(1246,391),
    (1244,372),(1234,354),(1245,338),(1267,332),(1292,351),(1312,370),(1341,356),(1353,333),
    (1374,324),(1391,333),(1383,354),(1400,358),(1427,335),(1454,323),(1484,329),(1517,331),
    (1570,322),(1602,317),(1618,325),(1623,355),(1614,405),(1614,485),(1605,520),(1580,554),
    (1615,586),(1659,606),(1710,632),(1750,667),(1780,720),(1795,764),(1803,787),(1795,808),
    (1750,827),(1733,877),(1698,878),(1714,911),(1740,931),(1700,970),(1653,997),(1613,1013),
    (1580,1008),(1547,977),(1540,941),(1485,965),(1427,963),(1386,948),(1352,970),(1335,1002),
    (1303,998),(1266,977),(1253,953),(1259,901),(1261,864),(1248,844),(1255,815),(1233,804),
    (1249,773),(1254,728),(1261,680),(1267,646),(1275,609),(1270,565),(1269,542),(1240,521),
    (1217,544),(1194,584),(1150,616),(1093,634),(1046,637),(1005,622)])
shaft = mask([(172,657),(227,630),(701,539),(1051,468),(1101,442),(1118,439),(1433,360),
    (1678,338),(1686,343),(1680,353),(1439,377),(1120,460),(1058,485),(706,554),(234,643),(176,664)], 0.75)

# La hampe passe derrière le Loup. Prolonger son profil dans les zones occultées.
shaft_rgb = rgb.copy()
obscured = (shaft > 0) & (wolf > 12)
rows, cols = np.nonzero(obscured)
distance = rows - (665 - cols * 0.193)
shade = np.clip(1 - abs(distance) / 14, 0, 1)
shaft_rgb[obscured] = np.array([28, 25, 24]) + shade[:, None] * np.array([38, 34, 26])
shaft_alpha = (shaft.astype(np.float32) * (1 - monk.astype(np.float32) / 255)).round().astype(np.uint8)

coverage = np.maximum.reduce((wolf, monk, shaft))
hole = cv2.dilate((coverage > 15).astype(np.uint8), np.ones((11, 11), np.uint8))
small = (width // 3, height // 3)
filled = cv2.inpaint(cv2.resize(rgb, small, interpolation=cv2.INTER_AREA),
                    cv2.resize(hole, small, interpolation=cv2.INTER_NEAREST), 7, cv2.INPAINT_TELEA)
filled = cv2.resize(filled, source.size, interpolation=cv2.INTER_CUBIC)
mix = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2.5)[..., None]
background = Image.fromarray((rgb * (1 - mix) + filled * mix).round().astype(np.uint8))
background.save(ROOT / 'bg.jpg', quality=94)

def separate(alpha, shape):
    moved = alpha * (shape.astype(np.float32) / 255)
    base = (alpha - moved) / np.maximum(1 - moved / 255, 1 / 255)
    return moved.round().astype(np.uint8), base.round().astype(np.uint8)


flap, wolf_base = separate(wolf, mask([(815,339),(874,340),(946,370),(1020,393),
    (1016,449),(917,461),(855,421),(832,389)], 5))
sleeve, monk_base = separate(monk, mask([(980,575),(1056,549),(1109,507),(1159,463),
    (1198,474),(1192,536),(1169,595),(1105,646),(970,644)], 5))


def cut_parts(base, shapes):
    parts = []
    for label, file, points in shapes:
        alpha, base = separate(base, mask(points, 4))
        parts.append((label, file, layer(alpha)))
    return parts, base


wolf_parts, wolf_core = cut_parts(wolf_base, [
    ('Loup — tête et chignon', 'wolf-head.png', [(671,52),(780,51),(778,153),(761,171),(696,173),(666,153)]),
    ('Loup — prothèse et hache', 'wolf-axe.png', [(260,224),(599,224),(654,199),(683,229),
      (675,283),(648,325),(601,345),(532,328),(515,379),(483,482),(264,488)]),
    ('Loup — bras droit et katana', 'wolf-katana.png', [(782,171),(1019,165),(1022,244),
      (884,310),(828,324),(819,293),(864,253),(815,240),(789,247),(779,214)]),
    ('Loup — jambe repliée', 'wolf-bent-leg.png', [(591,464),(647,430),(681,429),(733,460),
      (763,493),(770,606),(705,607),(697,552),(664,530),(603,508)]),
    ('Loup — jambe tendue', 'wolf-extended-leg.png', [(752,432),(825,416),(860,432),(939,483),
      (1100,695),(1111,773),(1040,774),(985,709),(914,625),(818,527),(767,490)]),
])
monk_parts, monk_core = cut_parts(monk_base, [
    ('Moine — masque et capuche', 'monk-head.png', [(1210,322),(1248,319),(1287,335),(1312,361),
      (1357,316),(1397,312),(1402,345),(1371,391),(1322,406),(1251,408),(1222,387)]),
    ('Moine — deux prises sur la hampe', 'monk-grips.png', [(1085,414),(1140,395),(1196,412),
      (1276,399),(1399,351),(1423,342),(1476,346),(1513,379),(1501,408),(1443,421),(1398,410),
      (1208,478),(1157,491),(1101,489),(1084,465)]),
    ('Moine — pan droit', 'monk-robe.png', [(1513,589),(1606,571),(1692,608),(1798,694),
      (1822,819),(1743,902),(1657,884),(1583,819),(1536,728)]),
])
layers = [('Loup — pan du manteau', 'flap.png', layer(flap)), *wolf_parts,
          ('Loup — torse', 'wolf.png', layer(wolf_core)),
          ('Moine — manche', 'sleeve.png', layer(sleeve)), *monk_parts,
          ('Moine — buste et appuis', 'monk.png', layer(monk_core)),
          ('Hampe reconstituée', 'shaft.png', layer(shaft_alpha, shaft_rgb))]
for _, file, image in layers:
    image.save(ROOT / file, optimize=True)
write_master(ROOT.name, [(label, image) for label, _, image in layers]
             + [('Pont, temple et forêt — fond reconstruit', background.convert('RGBA'))])
Image.fromarray(rgb).crop((0, 46, 1920, 943)).save(ROOT / 'full.jpg', quality=96)
