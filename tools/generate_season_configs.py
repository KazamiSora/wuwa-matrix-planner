"""Bootstrap self-contained season JSON files without replacing user edits by default."""
import argparse
import copy
import json
import sys
from pathlib import Path

try:
    from .update_s2_4_scores import build_scoring as build_s2_4_scoring, read_source as read_s2_4_source
except ImportError:
    from update_s2_4_scores import build_scoring as build_s2_4_scoring, read_source as read_s2_4_source

ROOT = Path(__file__).resolve().parents[1]


def read_json(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))


def make_season(tower_id, reference, stamina):
    phase = 3 if tower_id == 16 else 4
    season_id = f's2-phase{phase}'
    content = read_json(f'data/matrix_content_{tower_id}.json')
    boss_data = read_json(f'data/bosses_{tower_id}.json')
    stamina_data = next(item for item in stamina['seasons'] if item['id'] == season_id)
    character_index = {item['id']: item for item in read_json('data/characters.json')['entries']}
    version_name = f'终焉矩阵S2-{phase}（S2第{"三" if phase == 3 else "四"}阶段）'
    enhanced_characters = []
    for source in content['characters']:
        character = copy.deepcopy(source)
        character['enhancements'] = [effect for effect in character['enhancements'] if effect.get('kind') != 'stamina-bonus' and not effect['description'].startswith('角色拥有额外疲劳值')]
        if character['enhancements']:
            enhanced_characters.append(character)
    for character_id in stamina_data['bonusCharacterIds']:
        character = next((item for item in enhanced_characters if item['id'] == character_id), None)
        if character is None:
            actor = character_index[character_id]
            character = {'id': actor['id'], 'name': actor['name'], 'icon_file': actor['icon_file'], 'enhancements': []}
            enhanced_characters.append(character)
        character['enhancements'].append({'sourceKey': 'season-stamina', 'kind': 'stamina-bonus', 'description': f"角色拥有额外{stamina_data['extraStamina']}点体力（{version_name}限定）。"})
    season = {
        'schemaVersion': 1,
        'id': season_id,
        'name': f'终焉矩阵S2-{phase}（S2第{"三" if phase == 3 else "四"}阶段）',
        'season': 'S2',
        'stage': phase,
        'towerId': tower_id,
        'modeName': '奇点扩张',
        'maxRound': 15,
        'source': f'https://ww.nanoka.cc/newtower/{tower_id}',
        'bosses': [
            {key: item[key] for key in ('order', 'id', 'name', 'alias', 'icon_file')}
            for item in sorted(boss_data['entries'], key=lambda item: item['order'])
        ],
        'stamina': {
            'defaultStamina': stamina_data.get('defaultStamina', stamina['defaultStamina']),
            'baseStamina': copy.deepcopy(stamina_data.get('baseStamina', stamina['baseStamina'])),
            'bonusCharacterIds': copy.deepcopy(stamina_data['bonusCharacterIds']),
            'extraStamina': stamina_data['extraStamina'],
        },
        'circuits': copy.deepcopy(content['circuits']),
        'characters': enhanced_characters,
        'scoring': build_s2_4_scoring(read_s2_4_source(), 15, season_id=season_id),
    }
    return season


def write_new_file(path, data, force):
    if path.exists() and not force:
        print(f'保留已有配置：{path.relative_to(ROOT)}')
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已生成：{path.relative_to(ROOT)}')
    return True


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true', help='Explicitly overwrite existing season configuration files')
    args = parser.parse_args()
    reference = read_json('data/scores.json')
    if len(reference['records']) != 75:
        raise ValueError('Expected 75 S2-3 reference waves through R15')
    stamina = read_json('config/stamina.json')
    for tower_id, filename in ((16, 's2-3.json'), (18, 's2-4.json')):
        write_new_file(ROOT / 'config' / 'seasons' / filename, make_season(tower_id, reference, stamina), args.force)
    registry = {
        'version': 1,
        'defaultSeason': 's2-phase3',
        'seasons': [
            {'id': 's2-phase3', 'file': 'config/seasons/s2-3.json'},
            {'id': 's2-phase4', 'file': 'config/seasons/s2-4.json'},
        ],
    }
    write_new_file(ROOT / 'config' / 'seasons.json', registry, args.force)


if __name__ == '__main__':
    main()
