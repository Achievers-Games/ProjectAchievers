"""Outils communs aux scripts `prepare-art.py` des cartes du moteur partagé.

Demande rembg, simple-lama-inpainting, pymatting, OpenCV et Pillow (voir WORKFLOW-CREATION.md).
Lancer depuis un dossier sans répertoire `coverage/`, qui masque un module Python :
    python -I static/_proto/<jeu>/prepare-art.py

Le repère est celui du hero Steam. Les détourages et les fonds LaMa sont gardés dans `work/`,
ignoré par git : relancer un script ne refait que ce qui a changé.
"""

import hashlib
import json
from pathlib import Path
from runpy import run_path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
RATIO = 460 / 215
_lama = None
_sam = None


def lama(picture, hole):
    """Remplit `hole` avec LaMa, sur CPU."""
    global _lama
    if _lama is None:
        import torch
        from simple_lama_inpainting import SimpleLama

        # Le modèle publié est sérialisé pour CUDA.
        load = torch.jit.load
        torch.jit.load = lambda path, **kw: load(path, map_location="cpu")
        _lama = SimpleLama(device=torch.device("cpu"))
    result = _lama(Image.fromarray(picture), Image.fromarray((hole > 0).astype(np.uint8) * 255))
    return np.asarray(result.convert("RGB"))[: picture.shape[0], : picture.shape[1]]


class Card:
    def __init__(self, script):
        self.dir = Path(script).resolve().parent
        self.work = self.dir / "work"
        self.work.mkdir(exist_ok=True)
        self.rgb = np.asarray(Image.open(self.dir / "source.jpg").convert("RGB"))
        self.height, self.width = self.rgb.shape[:2]
        self.scene = json.loads((self.dir / "scene.json").read_text(encoding="utf-8"))
        self.layers = []

    # --- Masques, en flottants de 0 à 1 ---

    def matte(self, box=None, model="birefnet-general"):
        """Le sujet, détouré par BiRefNet. `box` relance le détourage sur une zone agrandie."""
        path = self.work / f"matte-{'-'.join(map(str, box)) if box else 'full'}.png"
        if not path.exists():
            from rembg import new_session, remove

            picture = Image.fromarray(self.rgb)
            if box:
                picture = picture.crop(box)
            remove(picture, session=new_session(model), only_mask=True).save(path)
        alpha = np.asarray(Image.open(path).convert("L")).astype(np.float32) / 255
        if box:
            full = np.zeros((self.height, self.width), np.float32)
            x0, y0, x1, y1 = box
            full[y0:y1, x0:x1] = alpha
            alpha = full
        return np.where(alpha < 0.04, 0, alpha).astype(np.float32)

    def poly(self, points, feather=1.0):
        shape = np.zeros((self.height, self.width), np.uint8)
        cv2.fillPoly(shape, [np.array(points, np.int32)], 255, cv2.LINE_AA)
        mask = shape.astype(np.float32) / 255
        return cv2.GaussianBlur(mask, (0, 0), feather) if feather else mask

    def islands(self, alpha, keep=1):
        """Ne garde que les plus grandes composantes d'un masque."""
        count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.5).astype(np.uint8))
        order = 1 + np.argsort(stats[1:, cv2.CC_STAT_AREA])[::-1][:keep]
        kept = cv2.dilate(np.isin(labels, order).astype(np.uint8), np.ones((9, 9), np.uint8))
        return alpha * kept

    def grow(self, alpha, pixels):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * pixels + 1,) * 2)
        return cv2.dilate((alpha > 0.05).astype(np.uint8), kernel)

    def sam(self, box, points, grow=0, feather=0.8):
        """Une pièce découpée par SAM. `box` cadre la pièce, `points` la désigne : `(x, y)` dedans,
        `(x, y, 0)` dehors. La zone est agrandie avant découpe : une petite pièce garde ses bords."""
        key = hashlib.sha1(json.dumps([box, points]).encode()).hexdigest()[:12]
        path = self.work / f"sam-{key}.png"
        x0, y0, x1, y1 = box
        pad = int(0.18 * max(x1 - x0, y1 - y0)) + 8
        cx0, cy0 = max(0, x0 - pad), max(0, y0 - pad)
        cx1, cy1 = min(self.width, x1 + pad), min(self.height, y1 + pad)
        if not path.exists():
            global _sam
            if _sam is None:
                from rembg import new_session

                _sam = new_session("sam")
            from rembg import remove

            crop = Image.fromarray(self.rgb[cy0:cy1, cx0:cx1])
            zoom = 1024 / max(crop.size)
            big = crop.resize((round(crop.width * zoom), round(crop.height * zoom)), Image.LANCZOS)
            prompt = [
                {
                    "type": "point",
                    "data": [(p[0] - cx0) * zoom, (p[1] - cy0) * zoom],
                    "label": p[2] if len(p) > 2 else 1,
                }
                for p in points
            ]
            prompt.append(
                {"type": "rectangle", "data": [(x0 - cx0) * zoom, (y0 - cy0) * zoom, (x1 - cx0) * zoom, (y1 - cy0) * zoom]}
            )
            mask = remove(big, session=_sam, only_mask=True, sam_prompt=prompt).convert("L")
            mask.resize(crop.size, Image.LANCZOS).save(path)
        alpha = np.zeros((self.height, self.width), np.float32)
        alpha[cy0:cy1, cx0:cx1] = np.asarray(Image.open(path)).astype(np.float32) / 255
        # Boucher les trous et écarter les éclats détachés.
        solid = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
        if count > 1:
            area = stats[1:, cv2.CC_STAT_AREA]
            solid = np.isin(labels, 1 + np.nonzero(area > 0.04 * area.max())[0]).astype(np.uint8)
        if grow:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * abs(grow) + 1,) * 2)
            solid = cv2.dilate(solid, kernel) if grow > 0 else cv2.erode(solid, kernel)
        return cv2.GaussianBlur(solid.astype(np.float32), (0, 0), feather)

    def behind(self, core, front, reach=30):
        """Prolonge `core` sous `front` de `reach` pixels : la matière qu'un geste découvre."""
        return np.clip(core + self.grow(core, reach).astype(np.float32) * front, 0, 1)

    # --- Matière ---

    def clean(self, alpha):
        """Couleurs du sujet seul : les bords ne gardent pas la teinte du décor."""
        from pymatting import estimate_foreground_ml

        picture = estimate_foreground_ml(self.rgb / 255.0, alpha.astype(np.float64))
        return (np.clip(picture, 0, 1) * 255).round().astype(np.uint8)

    def fill(self, picture, hole, soft=3):
        """LaMa sous `hole`, mis en cache."""
        key = hashlib.sha1(picture.tobytes() + np.packbits(hole > 0).tobytes()).hexdigest()[:12]
        path = self.work / f"fill-{key}.png"
        if path.exists():
            filled = np.asarray(Image.open(path).convert("RGB"))
        else:
            filled = lama(picture, hole)
            Image.fromarray(filled).save(path)
        edge = cv2.GaussianBlur((hole > 0).astype(np.float32), (0, 0), soft)[..., None]
        edge = np.where((hole > 0)[..., None], 1.0, edge)
        return (picture * (1 - edge) + filled * edge).round().astype(np.uint8)

    def sky(self, picture, hole, across=1.0, down=1.0, grain=True):
        """Un fond lisse sous `hole` : une membrane tendue entre les pixels connus du bord.
        `across` et `down` règlent ce qui domine : `down=0.05` suit les lignes, pour un ciel en
        dégradé vertical. Le trou doit contenir toute trace du sujet, ombre et contour compris."""
        from scipy.sparse import coo_matrix
        from scipy.sparse.linalg import spsolve

        step = 4
        h, w = self.height // step, self.width // step
        unknown = cv2.resize((hole > 0).astype(np.uint8), (w, h), interpolation=cv2.INTER_AREA) > 0
        unknown = cv2.dilate(unknown.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        small = cv2.resize(cv2.GaussianBlur(picture, (0, 0), 1.5), (w, h), interpolation=cv2.INTER_AREA).astype(np.float64)
        index = -np.ones((h, w), int)
        ys, xs = np.nonzero(unknown)
        index[ys, xs] = np.arange(len(ys))
        rows, cols, vals = [], [], []
        rhs = np.zeros((len(ys), 3))
        diagonal = np.zeros(len(ys))
        for dy, dx, weight in ((0, 1, across), (0, -1, across), (1, 0, down), (-1, 0, down)):
            ny, nx = ys + dy, xs + dx
            inside = (ny >= 0) & (ny < h) & (nx >= 0) & (nx < w)
            here = np.nonzero(inside)[0]
            ny, nx = ny[inside], nx[inside]
            diagonal[here] += weight
            near = index[ny, nx]
            free = near >= 0
            rows.append(here[free])
            cols.append(near[free])
            vals.append(-weight * np.ones(free.sum()))
            rhs[here[~free]] += weight * small[ny[~free], nx[~free]]
        rows.append(np.arange(len(ys)))
        cols.append(np.arange(len(ys)))
        vals.append(diagonal)
        matrix = coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols)))).tocsc()
        small[ys, xs] = spsolve(matrix, rhs)
        smooth = cv2.resize(np.clip(small, 0, 255).astype(np.float32), (self.width, self.height), interpolation=cv2.INTER_CUBIC)
        if grain:
            # Le grain du décor connu, pour que la partie refaite ne paraisse pas plastique.
            known = hole == 0
            detail = picture.astype(np.float32) - cv2.GaussianBlur(picture.astype(np.float32), (0, 0), 2)
            spread = min(5.0, float(np.median(np.abs(detail[known])) * 1.3))
            noise = np.random.default_rng(5).normal(0, spread, (self.height, self.width, 1)).astype(np.float32)
            smooth = smooth + cv2.GaussianBlur(noise, (0, 0), 0.7)[..., None] * 1.6
        edge = cv2.GaussianBlur((hole > 0).astype(np.float32), (0, 0), 4)[..., None]
        edge = np.where((hole > 0)[..., None], 1.0, edge)
        return np.clip(picture * (1 - edge) + smooth * edge, 0, 255).round().astype(np.uint8)

    def streak(self, picture, hole, direction, reach=900):
        """Prolonge un motif rayé sous `hole`, le long de `direction` : chaque pixel mêle ce qui est
        connu en amont et en aval sur sa rayure, selon la distance."""
        step = np.array(direction, np.float32) / np.hypot(*direction)
        ys, xs = np.nonzero(hole > 0)
        found = []
        for sense in (1, -1):
            color = np.zeros((len(ys), 3), np.float32)
            far = np.full(len(ys), np.inf, np.float32)
            for k in range(1, reach):
                todo = np.isinf(far)
                if not todo.any():
                    break
                px = np.rint(xs[todo] + sense * k * step[0]).astype(int)
                py = np.rint(ys[todo] + sense * k * step[1]).astype(int)
                inside = (px >= 0) & (px < self.width) & (py >= 0) & (py < self.height)
                clear = np.zeros(len(px), bool)
                clear[inside] = hole[py[inside], px[inside]] == 0
                index = np.nonzero(todo)[0][clear]
                color[index] = picture[py[clear], px[clear]]
                far[index] = k
            found.append((color, far))
        (a, da), (b, db) = found
        wa, wb = 1 / np.where(np.isinf(da), 1e9, da), 1 / np.where(np.isinf(db), 1e9, db)
        result = picture.copy()
        result[ys, xs] = ((a * wa[:, None] + b * wb[:, None]) / (wa + wb)[:, None]).round().astype(np.uint8)
        return result

    def around(self, picture, hole, center, inner, outer, turns):
        """Refait un anneau ou un disque caché : chaque pixel de `hole` entre les rayons `inner` et
        `outer` prend celui qui est au même rayon, tourné du premier angle de `turns` (en degrés) où
        l'image est connue."""
        cx, cy = center
        ys, xs = np.nonzero(hole > 0)
        dx, dy = xs - cx, ys - cy
        radius = np.hypot(dx, dy)
        ring = (radius >= inner) & (radius <= outer)
        ys, xs, dx, dy = ys[ring], xs[ring], dx[ring], dy[ring]
        result, left = picture.copy(), hole.copy()
        for turn in turns:
            c, s = np.cos(np.radians(turn)), np.sin(np.radians(turn))
            px = np.rint(cx + dx * c - dy * s).astype(int)
            py = np.rint(cy + dx * s + dy * c).astype(int)
            good = (px >= 0) & (px < self.width) & (py >= 0) & (py < self.height)
            good[good] = hole[py[good], px[good]] == 0
            good &= left[ys, xs] > 0
            result[ys[good], xs[good]] = picture[py[good], px[good]]
            left[ys[good], xs[good]] = 0
        return result, left

    def solve(self, background, alpha):
        """Les couleurs qui, avec cet alpha posé sur ce décor, redonnent la source."""
        source, under = self.rgb.astype(np.float32), background.astype(np.float32)
        colors = (source - under * (1 - alpha[..., None])) / np.maximum(alpha[..., None], 1e-3)
        return np.clip(colors, 0, 255).round().astype(np.uint8)

    def lift(self, background, zone, low=10, high=70, sign=None):
        """Ce qui distingue la source du décor refait, dans `zone` : lueur, faisceau, fumée, contour.
        Renvoie `(alpha, couleurs)` ; posé sur ce décor, le calque redonne la source."""
        source, under = self.rgb.astype(np.float32), background.astype(np.float32)
        gap = np.abs(source - under).max(axis=2)
        # `dark` ou `light` : ne garder que ce qui est plus sombre, ou plus clair, que le décor.
        if sign:
            gap = np.clip((under - source if sign == "dark" else source - under).mean(axis=2), 0, 255)
        alpha = np.clip((gap - low) / (high - low), 0, 1) * zone
        # L'alpha minimal qui laisse une couleur possible (entre 0 et 255) pour chaque canal.
        room = np.where(source > under, 255 - under, under)
        need = (np.abs(source - under) / np.maximum(room, 1)).max(axis=2) * (alpha > 0.02) * zone
        alpha = np.clip(np.maximum(alpha, need), 0, 1).astype(np.float32)
        return alpha, self.solve(background, alpha)

    def subject(self, matte, background, reach=16, low=14, high=60, zone=None):
        """Le sujet, avec le liseré, l'ombre et la lueur qui l'entourent : `(alpha, couleurs)`."""
        around = cv2.GaussianBlur(self.grow(matte, reach).astype(np.float32), (0, 0), 3)
        if zone is not None:
            around = around * zone
        alpha, _ = self.lift(background, around, low, high)
        mixed = np.maximum(alpha, matte)
        # Au cœur du sujet, ses propres pixels ; au bord, la couleur qui redonne la source.
        return mixed, np.where(mixed[..., None] > 0.97, self.rgb, self.solve(background, mixed))

    def check(self, background, hole):
        """Le décor refait se fond-il dans le décor connu ? Compare, le long du bord, l'intérieur du
        trou à l'extérieur. Une traînée sombre ou un reste de sujet donne un écart élevé."""
        hole = (hole > 0).astype(np.uint8)
        inner = hole - cv2.erode(hole, np.ones((41, 41), np.uint8))
        outer = cv2.dilate(hole, np.ones((61, 61), np.uint8)) - cv2.dilate(hole, np.ones((9, 9), np.uint8))
        picture = background.astype(np.float32)

        def local(mask):
            weight = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 14)
            return cv2.GaussianBlur(picture * mask[..., None], (0, 0), 14) / np.maximum(weight[..., None], 1e-4), weight

        inside, wi = local(inner)
        outside, wo = local(outer)
        gap = np.abs(inside - outside).max(axis=2) * ((wi > 0.08) & (wo > 0.08) & (inner > 0))
        x, y, w, h = self.scene["view"]
        window = gap[y : y + h, x : x + w]
        worst = float(np.percentile(window[window > 0], 97)) if (window > 0).any() else 0.0
        at = np.unravel_index(window.argmax(), window.shape)
        print(f"  décor : raccord {worst:.0f} (97e centile), pire {window.max():.0f} vers ({at[1] + x}, {at[0] + y})")

    # --- Exports ---

    def layer(self, file, label, alpha, colors=None, crop=False):
        """Un calque dans le repère de la source ; `crop` l'enregistre recadré (champ `origin`)."""
        colors = self.rgb if colors is None else colors
        alpha = np.clip(alpha, 0, 1)
        data = np.dstack([np.where(alpha[..., None] > 0, colors, 0), (alpha * 255).round()])
        picture = Image.fromarray(data.astype(np.uint8), "RGBA")
        self.layers.append((label, picture))
        ys, xs = np.nonzero(alpha > 0.01)
        x0, y0 = max(0, int(xs.min()) - 2), max(0, int(ys.min()) - 2)
        x1, y1 = min(self.width, int(xs.max()) + 3), min(self.height, int(ys.max()) + 3)
        if crop:
            picture.crop((x0, y0, x1, y1)).save(self.dir / file, optimize=True)
        else:
            picture.save(self.dir / file, optimize=True)
        # La scène reçoit le décalage du recadrage, et le maillage couvre tout l'alpha.
        for entry in self.scene["layers"]:
            if entry.get("file") != file:
                continue
            if crop:
                entry["origin"] = [x0, y0]
            if "mesh" in entry:
                step = entry["mesh"].pop("step", None)
                w, h = x1 - x0, y1 - y0
                entry["mesh"]["rect"] = [x0, y0, w, h]
                if step or "grid" not in entry["mesh"]:
                    step = step or 24
                    entry["mesh"]["grid"] = [max(4, round(w / step)), max(4, round(h / step))]
                # Les cases pleines : le contrôle de déformation ignore le vide autour du sujet.
                cols, rows = entry["mesh"]["grid"]
                solid = (alpha[y0:y1, x0:x1] > 0.5).astype(np.float32)
                share = cv2.resize(solid, (cols, rows), interpolation=cv2.INTER_AREA)
                entry["mesh"]["filled"] = ["".join("1" if v > 0.35 else "0" for v in line) for line in share]
        return picture

    def finish(self, background):
        """Le fond, le master et l'image fixe au cadrage de `view` (miroir compris)."""
        backdrop = Image.fromarray(background)
        backdrop.save(self.dir / "bg.jpg", quality=93)
        # Les calques sont déclarés du fond vers l'avant.
        write = run_path(str(ROOT / "prepare-layered-masters.py"))["write_master"]
        stack = list(reversed(self.layers))
        write(self.dir.name, stack + [("Décor reconstruit", backdrop.convert("RGBA"))])
        (self.dir / "scene.json").write_text(
            json.dumps(self.scene, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        x, y, w, h = self.scene["view"]
        if abs(w / h - RATIO) > 0.01:
            raise ValueError(f"La fenêtre {w} × {h} n'est pas au ratio 460:215")
        if x < 0 or y < 0 or x + w > self.width or y + h > self.height:
            raise ValueError("La fenêtre sort de la source")
        # Le décor glisse sous le pointeur : sans réserve, une bande vide apparaît au bord.
        reserve = abs(self.scene["background"].get("parallax", [0, 0])[0])
        if x < reserve or x + w + reserve > self.width:
            raise ValueError(f"Garder {reserve} px de réserve à gauche et à droite de la fenêtre")
        still = Image.fromarray(self.rgb).crop((x, y, x + w, y + h))
        if self.scene.get("mirror"):
            still = still.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        still.save(self.dir / "full.jpg", quality=94)
        # Écart entre la pose source et la recomposition au repos.
        pose = backdrop.convert("RGBA")
        for _, picture in self.layers:
            pose = Image.alpha_composite(pose, picture)
        gap = np.abs(np.asarray(pose.convert("RGB")).astype(int) - self.rgb).max(axis=2)
        Image.fromarray(np.clip(gap * 4, 0, 255).astype(np.uint8)).save(self.work / "gap.png")
        window = gap[y : y + h, x : x + w]
        served = [p for p in self.dir.iterdir() if p.suffix in (".png", ".jpg", ".js", ".json")]
        size = sum(p.stat().st_size for p in served if not p.name.startswith("source."))
        print(
            f"{self.dir.name} : écart moyen {window.mean():.2f}, "
            f"{100 * (window > 24).mean():.2f} % au-dessus de 24, {size / 1e6:.2f} Mo"
        )
