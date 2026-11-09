import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seasonDefinitions, getSeason, seasonStaminaRules, buildSeasonScores } from '../season-config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = relative => JSON.parse(readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'));
const tableHpRows = [
  ['5612519', '5612519', '5612519', '5612519', '6173771'],
  ['9541514', '9541514', '9541514', '9541514', '12756094'],
  ['19388951', '19388951', '19388951', '19388951', '19388951'],
  ['20358398.55', '21327846.1', '22297293.65', '23266741.2', '24236188.75'],
  ['25205636.3', '26175083.85', '27144531.4', '28113978.95', '29083426.5'],
  ['30052874.05', '31022321.6', '31991769.15', '32961216.7', '33930664.25'],
  ['34900111.8', '35869559.35', '36839006.9', '37808454.45', '38777902'],
  ['39747349.55', '40716797.1', '41686244.65', '42655692.2', '43625139.75'],
  ['44594587.3', '45564034.85', '46533482.4', '47502929.95', '48472377.5'],
].flat().map(value => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
});
function expectedLatest(index) {
  const hpCents = index < 45 ? tableHpRows[index] : tableHpRows.at(-1) + 96944755n * BigInt(index - 44);
  const round = Math.floor(index / 5) + 1, chest = index % 5 === 4;
  const coefficient = [[834, 918], [960, 1055], [1043, 1147]][Math.min(round, 3) - 1][Number(chest)];
  const damageUnits = hpCents * BigInt(coefficient), bonus = chest ? 1000 : 0;
  const damage = Number(damageUnits / 100000000n);
  return { hp: Number(hpCents) / 100, coefficient: coefficient / 1e6, damage, bonus, total: damage + bonus };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);

test('registry supplies concrete identities and legacy tower-ID lookup without period mismatch', () => {
  assert.equal(seasonDefinitions.length, 2);
  assert.equal(getSeason().id, 's2-phase3');
  for (const [id, towerId, stage] of [['s2-phase3', 16, 3], ['s2-phase4', 18, 4]]) {
    const season = getSeason(id);
    assert.equal(season.stage, stage);
    assert.equal(season.towerId, towerId);
    assert.equal(season.modeName, '奇点扩张');
    assert.equal(season.maxRound, 15);
    assert.equal(getSeason({ towerId }).id, id);
    assert.equal(getSeason({ matrixSeason: id, towerId }).id, id);
  }
  assert.throws(() => getSeason('unknown'), /找不到/);
  assert.throws(() => getSeason({}), /不匹配/);
  assert.throws(() => getSeason({ matrixSeason: 's2-phase3', towerId: 18 }), /不匹配/);
});

const providedScores = [
  [4680, 4680, 4680, 4680, 6667], [9159, 9159, 9159, 9159, 14457],
  [20222, 20222, 20222, 20222, 23239], [21233, 22244, 23256, 24267, 28798],
  [26289, 27300, 28311, 29322, 34358], [31345, 32356, 33367, 34378, 39918],
  [36400, 37411, 38423, 39434, 45478], [41456, 42467, 43478, 44489, 51038],
  [46512, 47523, 48534, 49545, 56597],
].flat();
const providedCumulative = [
  [4680, 9360, 14040, 18720, 25387], [34546, 43705, 52864, 62023, 76480],
  [96702, 116924, 137146, 157368, 180607], [201840, 224084, 247340, 271607, 300405],
  [326694, 353994, 382305, 411627, 445985], [477330, 509686, 543053, 577431, 617349],
  [653749, 691160, 729583, 769017, 814495], [855951, 898418, 941896, 986385, 1037423],
  [1083935, 1131458, 1179992, 1229537, 1286134],
].flat();

test('both seasons use every integer score and cumulative total from the latest image table', () => {
  const original = buildSeasonScores('s2-phase3');
  const updated = buildSeasonScores('s2-phase4');
  for (const [table, label] of [[original, '同位次类比'], [updated, '用户提供']]) {
    assert.equal(table.records.length, 75);
    let cumulative = 0;
    for (let index = 0; index < 75; index++) {
      const wave = table.records[index], expected = expectedLatest(index);
      assert.equal(wave.full_kill_points, expected.total);
      assert.equal(wave.damage_points_at_full_hp, expected.damage);
      assert.equal(wave.kill_bonus, expected.bonus);
      assert.equal(wave.points_per_damage, expected.coefficient);
      assert.equal(wave.cumulative_points_before, cumulative);
      cumulative += expected.total;
      assert.equal(wave.cumulative_points_after, cumulative);
      if (index < 45) {
        assert.equal(wave.full_kill_points, providedScores[index]);
        assert.equal(wave.cumulative_points_after, providedCumulative[index]);
      }
      assert.equal(wave.provisional, false);
      assert.equal(wave.estimated, index >= 45);
      assert.equal(wave.score_reference_season, 's2-phase4');
      assert.equal(wave.source_label, label);
      assert.equal(wave.source_cell, null);
    }
    assert.equal(table.records.filter(wave => wave.estimated).length, 30);
    assert.equal(table.scoring_status, 'source-and-inferred');
  }
  assert.equal(getSeason('s2-phase3').scoring.rounding, 'floor-per-boss');
  assert.equal(getSeason('s2-phase4').scoring.rounding, 'floor-per-boss');
  assert.equal(original.records[44].cumulative_points_after, 1286134);
  assert.equal(updated.records[44].cumulative_points_after, 1286134);
  assert.equal(original.records[0].name, '燎照之骑');
  assert.equal(updated.records[0].name, '飞廉之猩');
  assert.match(original.basis, /类比/);
  assert.match(updated.basis, /用户/);
});

test('S2-4 repeats the exact published boss order and all configured assets exist locally', () => {
  const names = ['飞廉之猩', '达妮娅', '无冠者', '辛吉勒姆', '矩阵奇藏'];
  const ids = ['607750002', '665700003', '650000041', '676750008', '401800000'];
  const season = getSeason('s2-phase4');
  assert.deepEqual(season.bosses.map(boss => boss.name), names);
  assert.deepEqual(season.bosses.map(boss => boss.id), ids);
  assert.equal(season.source, 'https://ww.nanoka.cc/newtower/18');
  const built = buildSeasonScores(season);
  for (let index = 0; index < 75; index++) assert.equal(built.records[index].name, names[index % 5]);
  for (const definition of seasonDefinitions) {
    for (const resource of [...definition.bosses, ...definition.circuits, ...definition.characters]) {
      assert.ok(existsSync(path.join(root, resource.icon_file)), resource.icon_file);
    }
  }
});

test('each JSON controls its own stamina bonus and matrix enhancements', () => {
  const phase3 = getSeason('s2-phase3'), phase4 = getSeason('s2-phase4');
  const rules = seasonStaminaRules();
  assert.deepEqual(rules.seasons[0].bonusCharacterIds, ['1509']);
  assert.deepEqual(rules.seasons[1].bonusCharacterIds, ['1109']);
  assert.equal(Object.keys(phase3.stamina.baseStamina).length, 6);
  assert.equal(phase3.stamina.baseStamina['1110'], 2);
  assert.deepEqual(phase3.stamina.baseStamina, phase4.stamina.baseStamina);
  assert.equal(phase3.circuits.length, 4); assert.equal(phase4.circuits.length, 4);
  assert.equal(phase3.characters.length, 13); assert.equal(phase4.characters.length, 13);
  assert.notDeepEqual(phase3.circuits.map(circuit => circuit.description), phase4.circuits.map(circuit => circuit.description));
  for (const [definition, id, name] of [[phase3, '1509', '琳奈'], [phase4, '1109', '洛瑟菈']]) {
    const staminaCharacters = definition.characters.filter(character => character.enhancements.some(effect => effect.kind === 'stamina-bonus'));
    assert.deepEqual(staminaCharacters.map(character => character.id), [id]);
    assert.equal(staminaCharacters[0].name, name);
    const effect = staminaCharacters[0].enhancements.find(effect => effect.kind === 'stamina-bonus');
    assert.match(effect.description, /额外1点体力/);
    assert.ok(effect.description.includes(definition.name));
  }
  assert.ok(!phase3.characters.some(character => character.id === '1109'));
  rules.seasons[0].baseStamina['1110'] = 99;
  assert.equal(getSeason('s2-phase3').stamina.baseStamina['1110'], 2);
});

test('definitions are deeply frozen and generated records are independent mutable copies', () => {
  assert.ok(Object.isFrozen(seasonDefinitions));
  const definition = getSeason('s2-phase3');
  assert.ok(Object.isFrozen(definition.scoring.waves[0]));
  assert.throws(() => { definition.scoring.waves[0].fullPoints = 7; }, TypeError);
  const built = buildSeasonScores('s2-phase3');
  built.records[0].full_kill_points = 7;
  built.records[0].name = '修改副本';
  assert.equal(buildSeasonScores('s2-phase3').records[0].full_kill_points, expectedLatest(0).total);
  assert.equal(getSeason('s2-phase3').bosses[0].name, '燎照之骑');
});

test('both seasons preserve 45 supplied same-position HP rows and mark only R10-R15 as inferred', () => {
  for (const id of ['s2-phase3', 's2-phase4']) {
    const rows = buildSeasonScores(id).records;
    for (let index = 0; index < rows.length; index++) {
      const wave = rows[index], expected = expectedLatest(index);
      assert.equal(wave.round, Math.floor(index / 5) + 1);
      assert.equal(wave.boss_position, index % 5 + 1);
      near(wave.max_hp, expected.hp);
      assert.equal(wave.hp_status, index < 45 ? 'source' : 'inferred');
    }
  }
  assert.match(getSeason('s2-phase3').scoring.hpBasis, /类比/);
  assert.match(getSeason('s2-phase4').scoring.hpBasis, /用户/);
});

test('matrix resistances use the confirmed 20% base and 40% tagged attribute, with uniform chest resistance', () => {
  const expected = { '燎照之骑': 2, '封庭械囿': 1, '无冠者': 6, '天傀劫煞': 4, '飞廉之猩': 4, '达妮娅': 2, '辛吉勒姆': 5, '矩阵奇藏': null };
  for (const season of seasonDefinitions) {
    for (const boss of season.bosses) {
      assert.equal(boss.resistances.status, 'confirmed');
      assert.equal(boss.resistances.highElement, expected[boss.name]);
      for (let id = 1; id <= 6; id++) assert.equal(boss.resistances.values[id], id === expected[boss.name] ? 40 : 20);
    }
  }
});

test('boss special properties preserve all supplied triggers, percentages, limits and durations', () => {
  const expected = {
    '天傀劫煞': ['被施加异常效应时，受到的伤害最终提升20%，持续6秒。', '天傀劫煞受到的电磁效应伤害最终提升100%。'],
    '封庭械囿': ['附近敌方目标获得护盾时，封庭械囿受到的最终伤害提升10%，持续6秒，每0.5秒可触发一次，最多可叠加4层。'],
    '无冠者': ['共鸣者响应同奏时，该共鸣者在30秒内对无冠者造成的伤害最终提升40%。'],
    '飞廉之猩': ['受到伤害降低20%。', '被谐度破坏时，飞廉之猩受到伤害提升12.5%，持续至本场战斗结束，可叠加4层。'],
    '达妮娅': ['受到的异常效应伤害最终提升25%。', '受到【霜结】后，受到的最终伤害提升30%，持续15秒。'],
    '辛吉勒姆': ['声骸技能命中辛吉勒姆时，将为其附加一层【迷航】，最多叠加5层，同名声骸仅可触发一次。', '每层【迷航】使辛吉勒姆受到的最终伤害提升10%。', '【迷航】达到5层时，辛吉勒姆受到的最终伤害额外提升30%。'],
  };
  const seen = new Map();
  for (const season of seasonDefinitions) {
    for (const boss of season.bosses) {
      assert.deepEqual(boss.specialProperties, expected[boss.name] || []);
      if (seen.has(boss.name)) assert.deepEqual(boss.specialProperties, seen.get(boss.name));
      seen.set(boss.name, boss.specialProperties);
    }
  }
  assert.equal(seen.size, 8);
  assert.equal([...seen.values()].filter(properties => properties.length).length, 6);
});

test('older season definitions may omit special properties without losing score data', () => {
  const result = runChangedConfig(({ phase3, phase4 }) => {
    for (const season of [phase3, phase4]) for (const boss of season.bosses) delete boss.specialProperties;
  });
  assert.equal(result.status, 0, result.stderr);
  near(JSON.parse(result.stdout)[0].full_kill_points, expectedLatest(0).total);
});

function runChangedConfig(change) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'matrix-season-config-'));
  try {
    mkdirSync(path.join(temporaryRoot, 'config', 'seasons'), { recursive: true });
    copyFileSync(path.join(root, 'season-config.js'), path.join(temporaryRoot, 'season-config.js'));
    writeFileSync(path.join(temporaryRoot, 'package.json'), '{"type":"module"}');
    const registry = readJson('config/seasons.json');
    const phase3 = readJson('config/seasons/s2-3.json'), phase4 = readJson('config/seasons/s2-4.json');
    change({ registry, phase3, phase4 });
    for (const [filename, value] of [['config/seasons.json', registry], ['config/seasons/s2-3.json', phase3], ['config/seasons/s2-4.json', phase4]]) writeFileSync(path.join(temporaryRoot, filename), JSON.stringify(value));
    const moduleUrl = pathToFileURL(path.join(temporaryRoot, 'season-config.js')).href;
    return spawnSync(process.execPath, ['--input-type=module', '-e', `const {buildSeasonScores}=await import(${JSON.stringify(moduleUrl)});console.log(JSON.stringify(buildSeasonScores('s2-phase4').records.slice(0,2)))`], { encoding: 'utf8' });
  } finally {
    const resolvedRoot = path.resolve(temporaryRoot), intendedRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolvedRoot.startsWith(intendedRoot) && path.basename(resolvedRoot).startsWith('matrix-season-config-'));
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
}

test('editing JSON points changes scores and prefixes without relying on obsolete cumulative fields', () => {
  const result = runChangedConfig(({ phase4 }) => {
    phase4.scoring.waves[0].fullPoints += 123.5;
    phase4.scoring.waves[0].cumulative_points_after = 999999999;
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  near(rows[0].full_kill_points, expectedLatest(0).total + 123.5);
  assert.equal(rows[0].cumulative_points_before, 0);
  assert.equal(rows[1].cumulative_points_before, rows[0].full_kill_points);
});

test('unsafe registry paths and invalid boss/wave values fail before use', () => {
  for (const change of [
    ({ registry }) => { registry.seasons[0].file = '../private.json'; },
    ({ phase4 }) => { phase4.bosses[0].order = 2; },
    ({ phase4 }) => { phase4.bosses[0].icon_file = '../private.webp'; },
    ({ phase4 }) => { phase4.scoring.waves.pop(); },
    ({ phase4 }) => { phase4.scoring.waves[0].fullPoints = phase4.scoring.waves[0].killBonus; },
    ({ phase4 }) => { phase4.scoring.waves[0].maxHp = null; },
    ({ phase4 }) => { phase4.scoring.waves[0].maxHp = 0; },
    ({ phase4 }) => { phase4.scoring.waves[0].hpStatus = 'unconfirmed'; },
    ({ phase4 }) => { phase4.bosses[0].resistances.status = 'confirmed'; phase4.bosses[0].resistances.values['1'] = null; },
    ({ phase4 }) => { phase4.bosses[0].resistances.values['2'] = '40'; },
    ({ phase4 }) => { phase4.bosses[0].specialProperties = '不是数组'; },
    ({ phase4 }) => { phase4.bosses[0].specialProperties = null; },
    ({ phase4 }) => { phase4.bosses[0].specialProperties = ['   ']; },
    ({ phase4 }) => { phase4.bosses[0].specialProperties = [40]; },
  ]) {
    const result = runChangedConfig(change);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /赛季配置无效/);
  }
});
