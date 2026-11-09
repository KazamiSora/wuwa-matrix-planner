import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SeasonGeneration(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='matrix-season-generation-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for directory in ('config', 'data'):
            shutil.copytree(ROOT / directory, self.root / directory, ignore=shutil.ignore_patterns('raw'))
        (self.root / 'tools').mkdir()
        shutil.copy2(ROOT / 'tools/generate_season_configs.py', self.root / 'tools/generate_season_configs.py')
        shutil.copy2(ROOT / 'tools/update_s2_4_scores.py', self.root / 'tools/update_s2_4_scores.py')

    def read_json(self, relative):
        return json.loads((self.root / relative).read_text(encoding='utf-8'))

    def write_json(self, relative, data):
        (self.root / relative).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def generate(self, *args):
        result = subprocess.run(
            [sys.executable, str(self.root / 'tools/generate_season_configs.py'), *args],
            cwd=self.root, capture_output=True, text=True, encoding='utf-8',
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_force_preserves_each_seasons_manual_boss_details_while_regenerating_scores(self):
        expected = {}
        expected_scores = {}
        for filename in ('s2-3.json', 's2-4.json'):
            relative = f'config/seasons/{filename}'
            season = self.read_json(relative)
            expected_scores[filename] = season['scoring']['waves'][0]['fullPoints']
            expected[filename] = {
                boss['id']: {key: boss[key] for key in ('resistances', 'specialProperties')}
                for boss in season['bosses']
            }
            season['scoring']['waves'][0]['fullPoints'] = 1
            season['bosses'][0]['name'] = 'Stale generated name'
            self.write_json(relative, season)
        self.generate('--force')
        for filename, details in expected.items():
            season = self.read_json(f'config/seasons/{filename}')
            self.assertEqual({
                boss['id']: {key: boss.get(key) for key in ('resistances', 'specialProperties')}
                for boss in season['bosses']
            }, details)
            self.assertEqual(season['scoring']['waves'][0]['fullPoints'], expected_scores[filename])
            self.assertNotEqual(season['bosses'][0]['name'], 'Stale generated name')

    def test_force_matches_boss_id_after_reordering_and_does_not_copy_to_replacement(self):
        relative = 'config/seasons/s2-3.json'
        season = self.read_json(relative)
        for boss in season['bosses']:
            boss['resistances']['note'] = f"Custom resistance for {boss['id']}"
            boss['specialProperties'] = [f"Custom property for {boss['id']}"]
        expected = {
            boss['id']: {key: boss[key] for key in ('resistances', 'specialProperties')}
            for boss in season['bosses']
        }
        season['bosses'].reverse()
        self.write_json(relative, season)
        bosses = self.read_json('data/bosses_16.json')
        bosses['entries'][0]['id'] = 'replacement-boss'
        self.write_json('data/bosses_16.json', bosses)
        self.generate('--force')
        generated = self.read_json(relative)['bosses']
        self.assertEqual(generated[0]['id'], 'replacement-boss')
        self.assertNotIn('resistances', generated[0])
        self.assertNotIn('specialProperties', generated[0])
        for boss in generated[1:]:
            self.assertEqual({key: boss.get(key) for key in ('resistances', 'specialProperties')}, expected[boss['id']])

    def test_existing_files_remain_byte_identical_without_force(self):
        paths = ['config/seasons/s2-3.json', 'config/seasons/s2-4.json', 'config/seasons.json']
        original = {relative: (self.root / relative).read_bytes() for relative in paths}
        self.generate()
        for relative, content in original.items():
            self.assertEqual((self.root / relative).read_bytes(), content)

    def test_first_generation_does_not_invent_manual_boss_details(self):
        for filename in ('s2-3.json', 's2-4.json'):
            (self.root / f'config/seasons/{filename}').unlink()
        self.generate()
        for filename in ('s2-3.json', 's2-4.json'):
            season = self.read_json(f'config/seasons/{filename}')
            self.assertEqual(len(season['scoring']['waves']), 75)
            self.assertTrue(all('resistances' not in boss for boss in season['bosses']))
            self.assertTrue(all('specialProperties' not in boss for boss in season['bosses']))


if __name__ == '__main__':
    unittest.main()
