import copy
import json
import unittest
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

from tools.generate_season_configs import make_season
from tools.update_s2_4_scores import build_scoring, read_source

ROOT = Path(__file__).resolve().parents[1]
IMAGE_POINTS = [
    [4680, 4680, 4680, 4680, 6667],
    [9159, 9159, 9159, 9159, 14457],
    [20222, 20222, 20222, 20222, 23239],
    [21233, 22244, 23256, 24267, 28798],
    [26289, 27300, 28311, 29322, 34358],
    [31345, 32356, 33367, 34378, 39918],
    [36400, 37411, 38423, 39434, 45478],
    [41456, 42467, 43478, 44489, 51038],
    [46512, 47523, 48534, 49545, 56597],
]
IMAGE_CUMULATIVE = [
    [4680, 9360, 14040, 18720, 25387],
    [34546, 43705, 52864, 62023, 76480],
    [96702, 116924, 137146, 157368, 180607],
    [201840, 224084, 247340, 271607, 300405],
    [326694, 353994, 382305, 411627, 445985],
    [477330, 509686, 543053, 577431, 617349],
    [653749, 691160, 729583, 769017, 814495],
    [855951, 898418, 941896, 986385, 1037423],
    [1083935, 1131458, 1179992, 1229537, 1286134],
]


class LatestScoringTable(unittest.TestCase):
    def setUp(self):
        self.source = read_source()
        self.scoring = build_scoring(self.source)

    def test_all_45_supplied_integer_scores_and_cumulatives_match_image(self):
        points = [value for row in IMAGE_POINTS for value in row]
        cumulative = [value for row in IMAGE_CUMULATIVE for value in row]
        self.assertEqual([row['fullPoints'] for row in self.source['hpRows']], points)
        self.assertEqual([row['cumulativePoints'] for row in self.source['hpRows']], cumulative)
        self.assertEqual([wave['fullPoints'] for wave in self.scoring['waves'][:45]], points)
        running = 0
        for wave, expected in zip(self.scoring['waves'], cumulative):
            running += wave['fullPoints']
            self.assertEqual(running, expected)
        self.assertEqual(running, 1286134)

    def test_coefficients_round_each_boss_before_accumulation_and_keep_bonus_separate(self):
        self.assertEqual(self.scoring['rounding'], 'floor-per-boss')
        for wave in self.scoring['waves']:
            coefficient = (self.source['damageRules'][0 if wave['round'] == 1 else 1 if wave['round'] == 2 else 2]
                           ['chest' if wave['position'] == 5 else 'normal'])
            self.assertEqual(Decimal(str(wave['pointsPerDamage'])), coefficient)
            self.assertEqual(wave['killBonus'], 1000 if wave['position'] == 5 else 0)
            expected = (Decimal(str(wave['maxHp'])) * coefficient).to_integral_value(rounding=ROUND_FLOOR) + wave['killBonus']
            self.assertIsInstance(wave['fullPoints'], int)
            self.assertEqual(Decimal(wave['fullPoints']), expected)
        raw_round1 = sum(Decimal(str(wave['maxHp'])) * Decimal(str(wave['pointsPerDamage'])) + wave['killBonus']
                         for wave in self.scoring['waves'][:5])
        self.assertEqual(int(raw_round1), 25390)
        self.assertEqual(sum(wave['fullPoints'] for wave in self.scoring['waves'][:5]), 25387)

    def test_supplied_hp_preserved_and_only_30_later_rows_are_inferred(self):
        waves = self.scoring['waves']
        self.assertEqual(len(waves), 75)
        for row, wave in zip(self.source['hpRows'], waves[:45]):
            self.assertEqual((wave['round'], wave['position']), (row['round'], row['position']))
            self.assertEqual(Decimal(str(wave['maxHp'])), Decimal(row['maxHp']))
            self.assertFalse(wave['inferred'])
            self.assertEqual(wave['hpStatus'], 'source')
        for wave in waves[45:]:
            self.assertTrue(wave['inferred'])
            self.assertEqual(wave['hpStatus'], 'inferred')
        self.assertEqual(Decimal(str(waves[45]['maxHp'])), Decimal('49441825.05'))
        self.assertEqual(Decimal(str(waves[-1]['maxHp'])), Decimal('77555804'))
        self.assertEqual(waves[-1]['fullPoints'], 89956)
        self.assertEqual(sum(wave['fullPoints'] for wave in waves), 3319829)

    def test_both_seasons_regenerate_identical_values_with_distinct_provenance(self):
        reference = json.loads((ROOT / 'data/scores.json').read_text(encoding='utf-8'))
        stamina = json.loads((ROOT / 'config/stamina.json').read_text(encoding='utf-8'))
        for tower_id, stage in ((16, 3), (18, 4)):
            season_id = f's2-phase{stage}'
            expected = build_scoring(self.source, season_id=season_id)
            canonical = json.loads((ROOT / f'config/seasons/s2-{stage}.json').read_text(encoding='utf-8'))
            self.assertEqual(expected, canonical['scoring'])
            self.assertEqual(make_season(tower_id, reference, stamina)['scoring'], expected)
            self.assertEqual(expected['waves'], self.scoring['waves'])
            self.assertEqual(expected['basedOnSeason'], 's2-phase4')
            self.assertEqual(expected['sourceLabel'], '用户提供' if stage == 4 else '同位次类比')
        self.assertNotEqual(reference['records'][0]['full_kill_points'], self.scoring['waves'][0]['fullPoints'])

    def test_inconsistent_source_scores_cumulative_order_or_growth_are_rejected_without_mutation(self):
        for change in ('score', 'cumulative', 'order', 'growth', 'rounding'):
            source = copy.deepcopy(self.source)
            if change == 'score':
                source['hpRows'][0]['fullPoints'] += 1
            elif change == 'cumulative':
                source['hpRows'][4]['cumulativePoints'] += 1
            elif change == 'order':
                source['hpRows'][20]['position'] = 2
            elif change == 'rounding':
                source['rounding'] = 'round-cumulative-only'
            else:
                source['hpRows'][20]['maxHp'] += Decimal('1')
            before = copy.deepcopy(source)
            with self.assertRaises(ValueError):
                build_scoring(source)
            self.assertEqual(source, before)

    def test_standard_json_floats_match_decimal_parsing_and_nonfinite_values_are_rejected(self):
        plain_source = json.loads((ROOT / 'data/s2_4_score_source.json').read_text(encoding='utf-8'))
        self.assertEqual(build_scoring(plain_source), self.scoring)
        for section, field in ((None, 'chestKillBonus'), ('projection', 'hpPerWave')):
            invalid = copy.deepcopy(self.source)
            (invalid if section is None else invalid[section])[field] = Decimal('NaN')
            with self.assertRaises(ValueError):
                build_scoring(invalid)


if __name__ == '__main__':
    unittest.main()
