"""Apply the latest integer score table to S2-4 and corresponding S2-3 boss slots."""
import copy
import json
import sys
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 's2_4_score_source.json'
TARGETS = {
    's2-phase3': ROOT / 'config' / 'seasons' / 's2-3.json',
    's2-phase4': ROOT / 'config' / 'seasons' / 's2-4.json',
}


def read_source():
    return json.loads(SOURCE.read_text(encoding='utf-8'), parse_float=Decimal)


def as_decimal(value):
    return Decimal(str(value))


def decimal_text(value):
    return format(as_decimal(value).normalize(), 'f')


def json_number(value):
    value = as_decimal(value)
    return int(value) if value == value.to_integral_value() else float(value)


def build_scoring(source, max_round=15, season_id='s2-phase4'):
    if season_id not in TARGETS:
        raise ValueError('The target season must be S2-3 or S2-4.')
    if source.get('seasonId') != 's2-phase4' or source.get('providedRounds') != 9:
        raise ValueError('The supplied scoring data must cover S2-4 R1—R9.')
    if source.get('rounding') != 'floor-per-boss':
        raise ValueError('The latest table requires per-boss downward rounding before accumulation.')
    if not isinstance(max_round, int) or not 9 <= max_round <= 15:
        raise ValueError('S2-4 scoring output must cover R9—R15.')
    rows = source['hpRows']
    if len(rows) != 45:
        raise ValueError('Expected exactly 45 supplied HP rows.')
    for index, row in enumerate(rows):
        if (row['round'], row['position']) != (index // 5 + 1, index % 5 + 1):
            raise ValueError('Supplied HP rows must be continuous and ordered by round and boss position.')
        if not as_decimal(row['maxHp']).is_finite() or as_decimal(row['maxHp']) <= 0:
            raise ValueError('Boss HP must be a positive finite number.')
    rules = source['damageRules']
    if [rule['fromRound'] for rule in rules] != [1, 2, 3]:
        raise ValueError('Expected coefficient rules starting at R1, R2 and R3.')
    for rule in rules:
        for key in ('normal', 'chest'):
            if not as_decimal(rule[key]).is_finite() or as_decimal(rule[key]) <= 0:
                raise ValueError('Damage coefficients must be positive finite decimals.')
    bonus = as_decimal(source['chestKillBonus'])
    step = as_decimal(source['projection']['hpPerWave'])
    if not bonus.is_finite() or bonus < 0 or bonus != bonus.to_integral_value() or not step.is_finite() or step <= 0:
        raise ValueError('Kill bonus and HP projection step are invalid.')
    # The R4 first boss also advances exactly one step from the R3 chest.
    for index in range(15, len(rows)):
        if as_decimal(rows[index]['maxHp']) - as_decimal(rows[index - 1]['maxHp']) != step:
            raise ValueError('The supplied R4—R9 HP does not follow the configured per-wave step.')
    waves = []
    cumulative = 0
    last_hp = as_decimal(rows[-1]['maxHp'])
    for index in range(max_round * 5):
        round_number, position = index // 5 + 1, index % 5 + 1
        inferred = index >= len(rows)
        hp = last_hp + step * (index - len(rows) + 1) if inferred else as_decimal(rows[index]['maxHp'])
        rule = next(rule for rule in reversed(rules) if round_number >= rule['fromRound'])
        coefficient = as_decimal(rule['chest' if position == 5 else 'normal'])
        kill_bonus = bonus if position == 5 else Decimal(0)
        points = (hp * coefficient).to_integral_value(rounding=ROUND_FLOOR) + kill_bonus
        cumulative += int(points)
        if not inferred:
            row = rows[index]
            if row.get('fullPoints') != int(points) or row.get('cumulativePoints') != cumulative:
                raise ValueError(f'Supplied score or cumulative points disagree with the latest table at R{round_number} position {position}.')
        formula = f'=FLOOR({decimal_text(hp)}*{decimal_text(coefficient)},1)'
        if kill_bonus:
            formula += f'+{decimal_text(kill_bonus)}'
        waves.append({
            'round': round_number, 'position': position,
            'fullPoints': json_number(points), 'killBonus': json_number(kill_bonus),
            'inferred': inferred, 'sourceCell': None, 'formula': formula,
            'maxHp': json_number(hp), 'hpStatus': 'inferred' if inferred else 'source',
            'pointsPerDamage': json_number(coefficient),
        })
    return {
        'status': 'source-and-inferred',
        'basis': ('S2-4 R1—R9 的45段血量、整数分数与累计分数采用用户最新表；每只 Boss 伤害积分向下取整后，宝箱击杀另加1000分，再逐只累加。R10—R15 的30段按现有血量增幅推算。' if season_id == 's2-phase4' else 'S2-3 按 S2-4 最新表的相同轮次、相同出场位次类比同步血量与整数分数；每只 Boss 向下取整后逐只累加，宝箱击杀另加1000分。R10—R15 的30段为推算。'),
        'basedOnSeason': 's2-phase4',
        'sourceLabel': '用户提供' if season_id == 's2-phase4' else '同位次类比',
        'sourceData': 'data/s2_4_score_source.json',
        'rounding': 'floor-per-boss',
        'damageRules': [{key: json_number(value) if key in ('normal', 'chest') else value for key, value in rule.items()} for rule in rules],
        'chestKillBonus': json_number(bonus),
        'hpBasis': ('S2-4 R1—R9 总血量采用用户最新表；R10—R15 按 R4 起每只 Boss 增加969447.55血量的规律推算。' if season_id == 's2-phase4' else 'S2-3 总血量按 S2-4 最新表的相同轮次、相同出场位次类比；R10—R15 按每只 Boss 增加969447.55血量的规律推算。'),
        'waves': waves,
    }


def rebuild():
    source = read_source()
    updated = {}
    for season_id, target in TARGETS.items():
        season = json.loads(target.read_text(encoding='utf-8'))
        expected_tower = 16 if season_id == 's2-phase3' else 18
        if season.get('id') != season_id or season.get('towerId') != expected_tower:
            raise ValueError('The target identity must match its S2-3 or S2-4 configuration.')
        value = copy.deepcopy(season)
        value['scoring'] = build_scoring(source, value['maxRound'], season_id=season_id)
        updated[season_id] = value
    # Validate both before writing; only the scoring section is replaced.
    for season_id, value in updated.items():
        TARGETS[season_id].write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return updated


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    result = rebuild()
    print(json.dumps({'seasons': [{'id': season_id, 'waves': len(season['scoring']['waves']), 'provided': 45,
                                  'inferred': len(season['scoring']['waves']) - 45, 'written': str(TARGETS[season_id])}
                                 for season_id, season in result.items()]}, ensure_ascii=False))
