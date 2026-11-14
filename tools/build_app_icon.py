"""Convert the existing Lily portrait to app icons (requires Pillow to regenerate)."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / 'assets/app'
output.mkdir(parents=True, exist_ok=True)
with Image.open(ROOT / 'assets/characters/Lily_UserPortrait_v1.png') as portrait:
    icon = portrait.convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS)
    icon.save(output / 'lily.png', optimize=True)
    icon.save(output / 'lily.ico', sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
print('Generated assets/app/lily.png and lily.ico from the existing portrait.')
