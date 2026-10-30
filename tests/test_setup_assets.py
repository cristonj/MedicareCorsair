import ast
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
class SetupAssetTests(unittest.TestCase):
 def test_browser_guides_reference_real_packaged_screenshots(self):
  guide=json.loads((ROOT/'setup-guides.json').read_text(encoding='utf-8-sig'))
  for browser in ('edge','chrome','firefox'):
   for card in guide[browser]['downloadCards']:
    with self.subTest(browser=browser,image=card['image']), Image.open(ROOT/'assets'/'setup'/card['image']) as image:
     image.verify()
   with Image.open(ROOT/'assets'/'setup'/f'{browser}-extensions.png') as image:image.verify()
  sources=json.loads((ROOT/'assets'/'setup'/'sources.json').read_text())
  for browser in ('edge','chrome','firefox'):self.assertIn(f'{browser}-extensions.png',sources)
 def test_choosing_browser_does_not_launch_or_navigate_a_browser(self):
  tree=ast.parse((ROOT/'desktop.py').read_text(encoding='utf-8-sig'))
  prepare=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='prepare')
  for n in ast.walk(prepare):
   if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute):
    self.assertNotIn(n.func.attr,('Popen','open_new_tab','open_new'))

if __name__=='__main__':unittest.main()
