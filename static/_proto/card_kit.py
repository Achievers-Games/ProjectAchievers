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
