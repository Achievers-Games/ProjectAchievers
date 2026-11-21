from pathlib import Path
import sys
sys.path.insert(0, "C:/AI/see-through")
import numpy as np
import torch
from PIL import Image
from annotators.lama_inpainter import apply_inpaint
root = Path(__file__).resolve().parent
image = np.asarray(Image.open(root / "full.jpg").convert("RGB")).copy()
mask = np.asarray(Image.open(root / "background-mask.png").convert("L")).copy()
result = apply_inpaint(image, mask, precision=torch.float32)
Image.fromarray(result).save(root / "bg.jpg", quality=95)
print("Background reconstructed.")
