"""Prépare les deux illustrations Portal 2, leurs calques et données de rig."""

import json
from pathlib import Path
from runpy import run_path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
write_master = run_path(str(ROOT / 'prepare-layered-masters.py'))['write_master']


def prepare(folder, source_url, crop, mirror, definitions, fx, underlay=None):
    target = ROOT / folder
    original = Image.open(target / 'source.jpg').convert('RGB')
    rgb = np.asarray(original)
    union = np.zeros((original.height, original.width), dtype=np.uint8)
    entries = []
    images = []
    for label, name, points, pivot, depth, peak, parent in definitions:
        mask = Image.new('L', original.size)
        ImageDraw.Draw(mask).polygon(points, fill=255)
        alpha = np.asarray(mask.filter(ImageFilter.GaussianBlur(0.7)))
        # Un pixel appartient à la pièce la plus proche quand deux contours se touchent.
        visible = (alpha.astype(np.float32) * (1 - union / 255)).round().astype(np.uint8)
        union = np.maximum(union, alpha)
        cutout = Image.fromarray(np.dstack((np.where(visible[..., None] > 0, rgb, 0), visible)))
        image = cutout.crop(cutout.getbbox())
        image.save(target / f'{name}.png', optimize=True)
        entries.append(dict(id=name, file=f'{name}.png', origin=cutout.getbbox()[:2], pivot=pivot,
                            depth=depth, peak=peak, parent=parent))
        images.append((label, cutout))

    if underlay:
        label, name, outlines, color, depth, parent, index = underlay
        matte = Image.new('L', original.size)
        for points in outlines:
            ImageDraw.Draw(matte).polygon(points, fill=255)
        cutout = Image.new('RGBA', original.size, (*color, 0))
        cutout.putalpha(matte.filter(ImageFilter.GaussianBlur(1.0)))
        bounds = cutout.getbbox()
        cutout.crop(bounds).save(target / f'{name}.png', optimize=True)
        images.insert(index, (label, cutout))
        entries.insert(index, dict(id=name, file=f'{name}.png', origin=bounds[:2], pivot=[0, 0],
                                   depth=depth, peak=[0, 0, 0], parent=parent))

    hole = cv2.dilate((union > 20).astype(np.uint8), np.ones((9, 9), np.uint8))
    small = (original.width // 3, original.height // 3)
    filled = cv2.inpaint(cv2.resize(rgb, small, interpolation=cv2.INTER_AREA),
                         cv2.resize(hole, small, interpolation=cv2.INTER_NEAREST), 6, cv2.INPAINT_TELEA)
    filled = cv2.resize(filled, original.size, interpolation=cv2.INTER_CUBIC)
    feather = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2)[..., None]
    background = Image.fromarray((rgb * (1 - feather) + filled * feather).round().astype(np.uint8))
    background.save(target / 'bg.jpg', quality=94)
    poster = original.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    if mirror:
        poster = poster.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    poster.save(target / 'full.jpg', quality=96)
    write_master(folder, images + [('Décor reconstruit', background.convert('RGBA'))])
    (target / 'scene.json').write_text(json.dumps(dict(source=source_url, crop=crop, mirror=mirror,
        background='bg.jpg', layers=list(reversed(entries)), effect=fx), ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8')


prepare('portal-2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_hero.jpg',
    [35, 0, 1326, 620], True, [
      ('Plateforme avant', 'ledge', [(0,550),(219,429),(249,412),(274,396),(311,382),(351,357),
          (367,355),(374,364),(366,373),(345,386),(327,412),(318,429),(353,425),(359,430),
          (342,441),(333,464),(333,489),(319,526),(291,568),(264,620),(0,620)], [220,435], .66, [0,0,0], None),
      ('Chell — tête', 'head', [(290,239),(297,231),(305,232),(311,240),(312,251),(307,257),
          (307,266),(293,268),(292,257),(286,252)], [300,264], .66, [3,-2,.10], 'torso'),
      ('Chell — bras libre', 'arm', [(273,270),(281,274),(277,288),(268,309),(259,332),(256,347),
          (250,350),(248,342),(251,324),(258,307),(263,288),(266,277)], [272,278], .66, [0,0,-.076], 'torso'),
      ('Chell — torse', 'torso', [(278,270),(294,261),(309,265),(319,275),(320,287),(313,313),
          (310,343),(301,353),(281,357),(267,344),(264,335),(273,315),(278,290)], [290,344], .66, [1,-2,.044], None),
      ('Chell — jambes en appui', 'legs', [(266,336),(310,337),(307,360),(299,374),(290,396),
          (277,405),(271,405),(278,385),(282,365),(271,368),(255,390),(244,405),(224,434),
          (216,431),(227,405),(237,383),(251,365),(254,348)], [286,353], .66, [0,0,0], None),
      ('Câble suspendu', 'cable', [(473,0),(523,0),(514,80),(496,153),(491,231),(494,321),
          (508,410),(521,500),(551,620),(516,620),(488,535),(476,433),(464,324),(458,235),(460,138)],
          [495,0], .37, [0,0,-.021], None),
    ], dict(center=[895,244], color=[134,225,222], intensity=.16, speed=.7, motif='dust'),
    ('Chell — raccords sous la silhouette', 'joints', [
        [(293,253),(305,252),(307,272),(290,274)],
        [(267,337),(280,334),(307,339),(305,359),(268,357)],
        [(270,271),(283,270),(283,283),(266,288)],
    ], (3, 10, 10), .66, None, 5))

prepare('portal-2-mythique',
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_0cdd90fafc160b52d08b303d205f9fd4e83cf164.1920x1080.jpg?t=1790187113',
    [0, 90, 1920, 897], False, [
      ('Support et rail inférieur', 'rail', [(258,748),(390,721),(555,708),(620,678),(630,650),
          (658,642),(746,680),(854,724),(981,768),(1102,812),(1274,870),(1374,937),(1411,1080),
          (1103,1080),(817,991),(515,889),(257,811)], [850,900], .82, [0,0,0], None),
      ('Wheatley — iris bleu mobile', 'iris', [(891,462),(902,428),(924,403),(949,386),
          (976,377),(1006,377),(1041,386),(1069,401),(1092,423),(1110,459),(1120,493),
          (1121,532),(1110,568),(1091,594),(1066,613),(1035,625),(1003,629),(973,621),
          (943,607),(919,586),(902,556),(891,520),(887,491)], [1006,507], .58, [0,0,0], 'gimbal'),
      ('Wheatley — bague mobile', 'gimbal', [(846,475),(862,428),(888,386),(924,354),(991,366),
          (1089,401),(1178,442),(1194,474),(1197,529),(1184,586),(1159,636),(1119,670),
          (1068,687),(1013,689),(959,679),(909,651),(873,618),(850,570),(840,519)],
          [1010,520], .58, [27,-16,.031], 'optic'),
      ('Wheatley — anneau optique fixe', 'optic', [(840,461),(858,409),(891,368),(922,352),(1004,368),
          (1097,403),(1191,446),(1205,503),(1206,555),(1184,618),(1149,668),(1099,703),
          (1023,716),(956,703),(895,670),(858,620),(833,558),(830,506)], [1010,525], .58, [0,0,0], 'housing'),
      ('Wheatley — poignée haute', 'handle', [(782,12),(809,3),(834,12),(965,25),(1125,58),(1174,70),
          (1422,127),(1426,157),(1410,175),(1342,164),(1182,126),(1168,111),(985,83),(824,56),
          (806,65),(790,53)], [1161,99], .58, [0,0,0], 'housing'),
      ('Wheatley — carter', 'housing', [(710,502),(725,391),(762,287),(820,204),(897,133),
          (973,91),(1060,85),(1180,104),(1301,144),(1389,194),(1456,267),(1497,365),
          (1510,469),(1492,580),(1446,678),(1381,762),(1310,827),(1230,860),(1113,845),
          (984,813),(866,766),(782,707),(727,629)], [1120,756], .58, [0,0,0], None),
    ], dict(center=[1006,507], color=[66,149,255], intensity=.82, speed=1.1, motif='scan',
        parent='iris', driver='gimbal', aperture=[[840,465],[861,405],[893,365],[926,349],
        [1004,368],[1113,407],[1194,445],[1208,508],[1207,558],[1187,619],[1150,673],
        [1102,705],[1024,719],[954,705],[892,671],[854,618],[829,552],[830,503]]),
    ('Wheatley — logement sous l’optique', 'socket', [[(841,457),(875,389),(921,349),(1004,365),
        (1101,398),(1195,442),(1213,509),(1213,559),(1188,627),(1151,674),(1100,705),
        (1026,719),(954,707),(892,672),(854,618),(827,554),(828,494)]],
        (12, 24, 42), .58, 'housing', 4))
