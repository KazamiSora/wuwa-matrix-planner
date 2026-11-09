import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleWaves, bossScoreAtRemainingHp, locateScore, packTeams, layoutTeamPreviews, PENDING_TEAM_SCORE, createTeamDeletionHistory, deleteTeamWithHistory, undoTeamDeletion, redoTeamDeletion, reorderTeams, nearestTeamSlot, characterIdentity, validateConfig, staminaLimits, MIN_ZOOM, defaultTeamName, splitQuickTeams, axisTickStep } from '../score-axis.js';
const scores = JSON.parse(readFileSync(new URL('../data/scores.json', import.meta.url))).records;
const example = JSON.parse(readFileSync(new URL('../config/demo.json', import.meta.url)));
const characters = new Set(JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url))).entries.filter(item => !item.download_failed).map(item => item.id));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const stamina = JSON.parse(readFileSync(new URL('../config/stamina.json', import.meta.url)));

test('unscored teams receive contiguous 5000-point previews without changing saved scores or offsets', () => {
  const teams = packTeams([
    { id: 'a', score: 8000, characterIds: ['one'] },
    { id: 'b', score: 0, needsScore: true, characterIds: ['two'] },
    { id: 'c', score: 2500, characterIds: ['three'] },
    { id: 'd', score: 0, needsScore: true, characterIds: ['four'] },
  ]);
  const saved = JSON.stringify(teams);
  const preview = layoutTeamPreviews(teams);
  assert.equal(PENDING_TEAM_SCORE, 5000);
  assert.deepEqual(preview.map(team => team.axisScore), [8000, 5000, 2500, 5000]);
  assert.deepEqual(preview.map(team => team.axisStartScore), [0, 8000, 13000, 15500]);
  assert.deepEqual(preview.map(team => team.positionIsPreview), [false, true, true, true]);
  assert.deepEqual(preview.map(team => team.score), [8000, 0, 2500, 0]);
  assert.deepEqual(preview.map(team => team.startScore), [0, 8000, 8000, 10500]);
  preview[1].characterIds.push('edited-only-in-view');
  preview[1].score = 9000;
  assert.equal(JSON.stringify(teams), saved);
  assert.ok(teams.every(team => !('axisScore' in team) && !('axisStartScore' in team) && !('positionIsPreview' in team)));
});

test('filling a preview uses the real width and clears uncertainty before the next unscored team', () => {
  const teams = packTeams([
    { id: 'a', score: 8000 }, { id: 'b', score: 0, needsScore: true },
    { id: 'c', score: 2500 }, { id: 'd', score: 0, needsScore: true },
  ]);
  const updated = teams.map(team => team.id === 'b' ? { ...team, score: 6500, needsScore: false } : team);
  const preview = layoutTeamPreviews(packTeams(updated));
  assert.deepEqual(preview.map(team => team.axisScore), [8000, 6500, 2500, 5000]);
  assert.deepEqual(preview.map(team => team.axisStartScore), [0, 8000, 14500, 17000]);
  assert.deepEqual(preview.map(team => team.positionIsPreview), [false, false, false, true]);
  assert.equal(teams[1].score, 0);
  assert.equal(teams[1].needsScore, true);
});

test('preview order follows reordered teams while empty and fully scored layouts remain exact', () => {
  assert.deepEqual(layoutTeamPreviews([]), []);
  const teams = packTeams([{ id: 'a', score: 8000 }, { id: 'b', score: 0, needsScore: true }, { id: 'c', score: 2500 }]);
  const ordered = reorderTeams(teams, 'b', 0);
  const preview = layoutTeamPreviews(ordered);
  assert.deepEqual(preview.map(team => team.id), ['b', 'a', 'c']);
  assert.deepEqual(preview.map(team => team.axisStartScore), [0, 5000, 13000]);
  assert.ok(preview.every(team => team.positionIsPreview));
  assert.equal(ordered.reduce((sum, team) => sum + team.score, 0), 10500);
  const exact = layoutTeamPreviews(packTeams([{ id: 'a', score: 1234.5 }, { id: 'b', score: 9876.25 }]));
  assert.deepEqual(exact.map(team => team.axisStartScore), [0, 1234.5]);
  assert.ok(exact.every(team => !team.positionIsPreview && team.axisScore === team.score && team.axisStartScore === team.startScore));
});

test('two team deletions can be undone and redone in sequence without changing pending flags or team data', () => {
  const original = packTeams([
    { id: 'a', name: 'A', score: 100, characterIds: ['one'] },
    { id: 'b', name: 'B', score: 0, needsScore: true, characterIds: ['two'] },
    { id: 'c', name: 'C', score: 300, characterIds: ['three'] },
    { id: 'd', name: 'D', score: 400, characterIds: ['four'] },
  ]);
  let state = { teams: original, history: createTeamDeletionHistory() };
  state = deleteTeamWithHistory(state.teams, 'b', state.history);
  state = deleteTeamWithHistory(state.teams, 'c', state.history);
  assert.deepEqual(state.teams.map(team => team.id), ['a', 'd']);
  assert.equal(state.history.undo.length, 2);
  assert.deepEqual(Object.keys(state.history.undo[0]).sort(), ['afterId', 'beforeId', 'index', 'team']);
  state = undoTeamDeletion(state.teams, state.history);
  assert.deepEqual(state.teams.map(team => team.id), ['a', 'c', 'd']);
  state = undoTeamDeletion(state.teams, state.history);
  assert.deepEqual(state.teams, original);
  assert.equal(state.history.redo.length, 2);
  state = redoTeamDeletion(state.teams, state.history);
  state = redoTeamDeletion(state.teams, state.history);
  assert.deepEqual(state.teams.map(team => team.id), ['a', 'd']);
  assert.deepEqual(state.teams.map(team => team.startScore), [0, 100]);
  assert.equal(state.history.undo.length, 2);
  assert.equal(state.history.redo.length, 0);
});

test('undo restores only the deleted team and preserves edits or additions to surviving teams', () => {
  const initial = packTeams([{ id: 'a', score: 100 }, { id: 'b', score: 200 }, { id: 'c', score: 300 }]);
  const removed = deleteTeamWithHistory(initial, 'b');
  const edited = packTeams([{ ...removed.teams[0], score: 125, name: 'edited A' }, { ...removed.teams[1], name: 'edited C' }, { id: 'd', score: 500 }]);
  const undone = undoTeamDeletion(edited, removed.history);
  assert.deepEqual(undone.teams.map(team => team.id), ['a', 'b', 'c', 'd']);
  assert.equal(undone.teams[0].score, 125);
  assert.equal(undone.teams[0].name, 'edited A');
  assert.equal(undone.teams[2].name, 'edited C');
  assert.equal(undone.teams[3].score, 500);
  assert.deepEqual(undone.teams.map(team => team.startScore), [0, 125, 325, 625]);
});

test('redo captures the restored team latest edits and position for the next undo', () => {
  let state = deleteTeamWithHistory(packTeams([{ id: 'a', score: 100 }, { id: 'b', score: 0, needsScore: true, characterIds: ['old'] }, { id: 'c', score: 300 }]), 'b');
  state = undoTeamDeletion(state.teams, state.history);
  const edited = state.teams.map(team => team.id === 'b' ? { ...team, score: 6500, needsScore: false, name: 'edited B', characterIds: ['new'] } : team);
  const moved = reorderTeams(edited, 'b', 2);
  state = redoTeamDeletion(moved, state.history);
  assert.deepEqual(state.teams.map(team => team.id), ['a', 'c']);
  state = undoTeamDeletion(state.teams, state.history);
  assert.deepEqual(state.teams.map(team => team.id), ['a', 'c', 'b']);
  assert.equal(state.teams[2].score, 6500);
  assert.equal(state.teams[2].needsScore, false);
  assert.equal(state.teams[2].name, 'edited B');
  assert.deepEqual(state.teams[2].characterIds, ['new']);
});

test('undo after reversing the original neighbors uses the saved index and preserves their new order', () => {
  const initial = packTeams([{ id: 'a', score: 100 }, { id: 'b', score: 200 }, { id: 'c', score: 300 }]);
  const removed = deleteTeamWithHistory(initial, 'b');
  const reordered = reorderTeams(removed.teams, 'c', 0).map(team => team.id === 'c' ? { ...team, score: 350, name: 'edited C' } : team);
  const restored = undoTeamDeletion(reordered, removed.history);
  assert.deepEqual(restored.teams.map(team => team.id), ['c', 'b', 'a']);
  assert.deepEqual(restored.teams.map(team => team.startScore), [0, 350, 550]);
  assert.equal(restored.teams[0].name, 'edited C');
  assert.equal(restored.history.undo.length, 0);
  assert.equal(restored.history.redo.length, 1);
  assert.deepEqual(reordered.map(team => team.id), ['c', 'a']);
});

test('deletion history retains only two actions and a new deletion clears the redo branch', () => {
  const initial = packTeams(['a', 'b', 'c', 'd'].map(id => ({ id, score: 100 })));
  let state = { teams: initial, history: createTeamDeletionHistory() };
  for (const id of ['a', 'b', 'c']) state = deleteTeamWithHistory(state.teams, id, state.history);
  assert.deepEqual(state.history.undo.map(record => record.team.id), ['b', 'c']);
  state = undoTeamDeletion(state.teams, state.history);
  state = undoTeamDeletion(state.teams, state.history);
  assert.deepEqual(state.teams.map(team => team.id), ['b', 'c', 'd']);
  assert.throws(() => undoTeamDeletion(state.teams, state.history), /没有可以撤回/);
  state = redoTeamDeletion(state.teams, state.history);
  state = deleteTeamWithHistory(state.teams, 'd', state.history);
  assert.deepEqual(state.history.redo, []);
  assert.deepEqual(state.history.undo.map(record => record.team.id), ['b', 'd']);
});

test('team deletion actions return independent results and leave source teams and histories unchanged', () => {
  const teams = packTeams([{ id: 'a', score: 100, characterIds: ['one'] }, { id: 'b', score: 200, characterIds: ['two'] }]);
  const history = createTeamDeletionHistory();
  const snapshot = JSON.stringify({ teams, history });
  const deleted = deleteTeamWithHistory(teams, 'b', history);
  assert.equal(JSON.stringify({ teams, history }), snapshot);
  const deletedSnapshot = JSON.stringify(deleted);
  const undone = undoTeamDeletion(deleted.teams, deleted.history);
  assert.equal(JSON.stringify(deleted), deletedSnapshot);
  const undoneSnapshot = JSON.stringify(undone);
  const redone = redoTeamDeletion(undone.teams, undone.history);
  assert.equal(JSON.stringify(undone), undoneSnapshot);
  redone.teams[0].characterIds.push('different');
  redone.history.undo[0].team.characterIds.push('different');
  assert.equal(JSON.stringify(undone), undoneSnapshot);
  assert.equal(JSON.stringify({ teams, history }), snapshot);
});

test('deletion history conflicts reject without modifying input or consuming the recoverable action', () => {
  const teams = packTeams([{ id: 'a', score: 100 }, { id: 'b', score: 200 }, { id: 'c', score: 300 }]);
  const deleted = deleteTeamWithHistory(teams, 'b');
  const withDuplicate = packTeams([...deleted.teams, { id: 'b', score: 123 }]);
  for (const invalidTeams of [withDuplicate]) {
    const snapshot = JSON.stringify({ teams: invalidTeams, history: deleted.history });
    assert.throws(() => undoTeamDeletion(invalidTeams, deleted.history), /无法撤回/);
    assert.equal(JSON.stringify({ teams: invalidTeams, history: deleted.history }), snapshot);
  }
  const undone = undoTeamDeletion(deleted.teams, deleted.history);
  const missing = undone.teams.filter(team => team.id !== 'b');
  const snapshot = JSON.stringify({ teams: missing, history: undone.history });
  assert.throws(() => redoTeamDeletion(missing, undone.history), /对应队伍已不存在/);
  assert.equal(JSON.stringify({ teams: missing, history: undone.history }), snapshot);
  assert.throws(() => deleteTeamWithHistory(teams, 'missing'), /找不到/);
  assert.throws(() => deleteTeamWithHistory([...teams, teams[0]], 'a'), /重复/);
  assert.throws(() => redoTeamDeletion(teams, createTeamDeletionHistory()), /没有可以恢复/);
});

test('remaining HP calculator keeps earned and remaining scores complementary at endpoints and fractional HP', () => {
  for (const wave of scores) {
    assert.deepEqual(bossScoreAtRemainingHp(wave, 100), {
      earnedPoints: 0, remainingPoints: wave.full_kill_points, damagePointsEarned: 0, killBonusEarned: 0,
    });
    assert.deepEqual(bossScoreAtRemainingHp(wave, 0), {
      earnedPoints: wave.full_kill_points, remainingPoints: 0, damagePointsEarned: wave.damage_points_at_full_hp, killBonusEarned: wave.kill_bonus,
    });
    const fractional = bossScoreAtRemainingHp(wave, 37.25);
    near(fractional.earnedPoints, wave.damage_points_at_full_hp * .6275);
    near(fractional.remainingPoints, wave.damage_points_at_full_hp * .3725 + wave.kill_bonus);
    near(fractional.earnedPoints + fractional.remainingPoints, wave.full_kill_points);
    assert.equal(fractional.killBonusEarned, 0);
  }
});
test('remaining HP calculator awards the chest bonus only on reaching zero HP', () => {
  for (const wave of scores.filter(item => item.kill_bonus)) {
    const alive = bossScoreAtRemainingHp(wave, .001);
    assert.equal(alive.killBonusEarned, 0);
    assert.ok(alive.remainingPoints > wave.kill_bonus);
    const defeated = bossScoreAtRemainingHp(wave, 0);
    assert.equal(defeated.killBonusEarned, wave.kill_bonus);
    near(defeated.earnedPoints - defeated.damagePointsEarned, wave.kill_bonus);
  }
});
test('remaining HP calculator rejects missing, nonnumeric and out-of-range input', () => {
  for (const invalid of ['', '50', 'bad', null, undefined, true, NaN, Infinity, -Infinity, -.01, 100.01]) {
    assert.throws(() => bossScoreAtRemainingHp(scores[0], invalid), /百分比/);
  }
  assert.throws(() => bossScoreAtRemainingHp(null, 50), /分数数据/);
  assert.throws(() => bossScoreAtRemainingHp({ ...scores[0], damage_points_at_full_hp: NaN }, 50), /分数数据/);
});

test('all 75 boss midpoints map to 50% HP', () => {
  for (const wave of scores) {
    const found = locateScore(wave.cumulative_points_before + wave.damage_points_at_full_hp / 2, scores);
    assert.equal(found.wave.wave_index, wave.wave_index);
    near(found.remainingHp, .5);
    assert.equal(found.inBonus, false);
  }
});
test('exact boss boundaries select the next full-HP boss', () => {
  for (let i = 0; i < scores.length - 1; i++) {
    const found = locateScore(scores[i].cumulative_points_after, scores);
    assert.equal(found.wave.wave_index, scores[i + 1].wave_index);
    near(found.remainingHp, 1);
  }
  assert.equal(locateScore(scores.at(-1).cumulative_points_after, scores).completed, true);
});
test('chest bonus is a discrete reward region, never fractional HP', () => {
  for (const wave of scores.filter(item => item.kill_bonus)) {
    for (const extra of [0, 100, 999]) {
      const point = locateScore(wave.cumulative_points_before + wave.damage_points_at_full_hp + extra, scores);
      assert.equal(point.inBonus, true);
      assert.equal(point.remainingHp, 0);
    }
  }
});
test('packing pins the first team to zero and joins endpoints after edits and deletes', () => {
  const changed = structuredClone(example.teams);
  changed[0].score = 1234.56;
  changed[0].startScore = 10000;
  const packed = packTeams(changed);
  assert.equal(packed[0].startScore, 0);
  near(packed[1].startScore, 1234.56);
  near(packed[2].startScore, 1234.56 + packed[1].score);
  const deleted = packTeams(packed.filter(team => team.id !== 'team-2'));
  near(deleted[1].startScore, 1234.56);
});
test('dragging snaps to slots and reorders without gaps or score changes', () => {
  assert.equal(nearestTeamSlot(example.teams, 'team-1', 100), 0);
  assert.equal(nearestTeamSlot(example.teams, 'team-1', 7000), 1);
  const reordered = reorderTeams(example.teams, 'team-1', 1);
  assert.deepEqual(reordered.map(team => team.id), ['team-2', 'team-1', 'team-3']);
  assert.equal(reordered[0].startScore, 0);
  assert.equal(reordered[1].startScore, reordered[0].score);
  assert.equal(reordered[2].startScore, reordered[0].score + reordered[1].score);
  assert.equal(reordered[1].score, 8000);
});
test('source rows are preserved and R9-R15 extensions are explicitly marked', () => {
  const source = JSON.parse(readFileSync(new URL('../data/scores_source.json', import.meta.url))).records;
  assert.deepEqual(scores.slice(0, 42), source);
  const round9 = visibleWaves(scores, 9).filter(item => item.round === 9);
  assert.equal(round9.length, 5);
  assert.equal(round9.filter(item => item.estimated).length, 3);
  assert.equal(scores.length, 75);
  assert.throws(() => locateScore(-1, scores), RangeError);
  assert.throws(() => locateScore(Infinity, scores), RangeError);
});
test('JSON round trip preserves teams, avatars, scores and positions', () => {
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(example)), characters, scores), example);
  const bad = structuredClone(example);
  bad.teams[0].characterIds[1] = bad.teams[0].characterIds[0];
  assert.throws(() => validateConfig(bad, characters, scores), /3 个不同/);
  const overflow = structuredClone(example);
  overflow.teams[0].startScore = 1e9;
  assert.throws(() => validateConfig(overflow, characters, scores), /超出/);
  const other = structuredClone(example); other.towerId = 18;
  assert.throws(() => validateConfig(other, characters, scores), /不匹配/);
});
test('JSON prevents cross-team reuse, including other Rover variants', () => {
  const duplicate = structuredClone(example);
  duplicate.teams[1].characterIds[0] = duplicate.teams[0].characterIds[0];
  assert.throws(() => validateConfig(duplicate, characters, scores), /重复上阵/);
  const data = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url))).entries;
  const identities = new Map(data.map(character => [character.id, characterIdentity(character)]));
  const rovers = data.filter(character => character.name.startsWith('漂泊者'));
  duplicate.teams[0].characterIds[0] = rovers[0].id;
  duplicate.teams[1].characterIds[0] = rovers[1].id;
  assert.throws(() => validateConfig(duplicate, characters, scores, identities), /重复上阵/);
  const legacy = structuredClone(example); legacy.teams[0].startScore = 2000;
  assert.equal(validateConfig(legacy, characters, scores).teams[0].startScore, 0);
});
test('all seven configured two-stamina characters may enter two teams, but not three', () => {
  assert.equal(Object.keys(stamina.baseStamina).length, 7);
  assert.equal(stamina.baseStamina['1110'], 2);
  for (const id of Object.keys(stamina.baseStamina)) {
    const plan = structuredClone(example);
    plan.teams[0].characterIds[2] = id;
    plan.teams[1].characterIds[2] = id;
    plan.teams[2].characterIds[2] = '1507';
    assert.doesNotThrow(() => validateConfig(plan, characters, scores, new Map(), stamina));
    plan.teams[2].characterIds[2] = id;
    assert.throws(() => validateConfig(plan, characters, scores, new Map(), stamina), /体力不足/);
    plan.teams = packTeams(plan.teams.slice(1));
    assert.doesNotThrow(() => validateConfig(plan, characters, scores, new Map(), stamina));
  }
});
test('Lynae bonus is current-period only; Lucilla bonus is next-period only', () => {
  for (const [id, allowed, denied] of [['1509', 's2-phase3', 's2-phase4'], ['1109', 's2-phase4', 's2-phase3']]) {
    const plan = structuredClone(example);
    plan.teams[0].characterIds[2] = id;
    plan.teams[1].characterIds[2] = id;
    plan.staminaSeason = allowed;
    assert.doesNotThrow(() => validateConfig(plan, characters, scores, new Map(), stamina));
    plan.staminaSeason = denied;
    assert.throws(() => validateConfig(plan, characters, scores, new Map(), stamina), /体力不足/);
  }
  const stacked = structuredClone(stamina);
  stacked.seasons[0].bonusCharacterIds = ['1505'];
  assert.equal(staminaLimits(stacked, 's2-phase3').get('1505'), 3);
});
test('old zoom values migrate to the new minimum without losing a plan', () => {
  const plan = structuredClone(example); plan.pixelsPerPoint = MIN_ZOOM / 2;
  const updated = validateConfig(plan, characters, scores, new Map(), stamina);
  assert.equal(updated.pixelsPerPoint, MIN_ZOOM);
  assert.deepEqual(updated.teams, plan.teams);
});
test('remaining points follow each Boss score span, including unclaimed bonus', () => {
  for (const wave of scores) {
    const mid = locateScore(wave.cumulative_points_before + wave.damage_points_at_full_hp / 2, scores);
    near(mid.remainingPoints, wave.damage_points_at_full_hp / 2 + wave.kill_bonus);
  }
  const chest = scores[4];
  near(locateScore(chest.cumulative_points_after - 100, scores).remainingPoints, 100);
  assert.equal(locateScore(scores.at(-1).cumulative_points_after, scores).remainingPoints, 0);
});
test('score markers validate the full data range and expand displayed rounds', () => {
  const plan = structuredClone(example); plan.scoreMarker = 150000;
  assert.equal(validateConfig(plan, characters, scores).maxRound, 3);
  plan.scoreMarker = 0;
  assert.equal(validateConfig(plan, characters, scores).scoreMarker, 0);
  plan.scoreMarker = scores.at(-1).cumulative_points_after;
  assert.equal(validateConfig(plan, characters, scores).maxRound, 15);
  for (const value of [-1, Infinity, NaN, scores.at(-1).cumulative_points_after + 1]) {
    plan.scoreMarker = value;
    assert.throws(() => validateConfig(plan, characters, scores), /目标总分/);
  }
  plan.scoreMarker = null; plan.maxRound = 99;
  const limited = validateConfig(plan, characters, scores);
  assert.equal(limited.maxRound, 15);
  assert.deepEqual(limited.teams, plan.teams);
});
test('automatic names take each character first codepoint in selection order', () => {
  const map = new Map(JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url))).entries.map(entry => [entry.id, entry]));
  assert.equal(defaultTeamName(['1305', '1302', '1409'], map), '相吟卡');
  assert.equal(defaultTeamName(['1302', '1305'], map), '吟相');
  assert.equal(defaultTeamName([], map), '');
  for (const scale of [.0001, .001, .01, .04, .24]) assert.ok(axisTickStep(scale) * scale >= 80);
});
test('matrix identity is explicit and legacy stamina choices do not change the score-data period', () => {
  const legacy = structuredClone(example); delete legacy.matrixSeason; delete legacy.matrixVersion; legacy.staminaSeason = 's2-phase4';
  const migrated = validateConfig(legacy, characters, scores, new Map(), stamina);
  assert.equal(migrated.matrixSeason, 's2-phase3'); assert.equal(migrated.staminaSeason, 's2-phase4');
  const phase4 = { ...structuredClone(example), towerId: 18, matrixSeason: 's2-phase4', matrixVersion: 'wrong', staminaSeason: 's2-phase4', scoreMarker: 2000000 };
  const result = validateConfig(phase4, characters, scores, new Map(), stamina);
  assert.equal(result.matrixVersion, '终焉矩阵S2-4（S2第四阶段）'); assert.equal(result.scoreMarker, 2000000);
});
test('quick selections split strictly in threes and preserve partial last group', () => {
  assert.deepEqual(splitQuickTeams(['a', 'b', 'c', 'd', 'e', 'f', 'g']), [['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]);
  assert.deepEqual(splitQuickTeams([]), []);
});
test('unscored quick teams preserve order without inventing points', () => {
  const plan = structuredClone(example);
  plan.teams.push({ id: 'quick-1', name: '忌鉴莫', nameMode: 'auto', characterIds: ['1404', '1405', '1204'], score: 0, needsScore: true, startScore: 24000, color: '#aabbcc' });
  const result = validateConfig(plan, characters, scores, new Map(), stamina);
  assert.deepEqual(result.teams.slice(0, 3), example.teams);
  assert.equal(result.teams[3].startScore, 24000);
  assert.equal(result.teams.reduce((sum, team) => sum + team.score, 0), 24000);
  delete plan.teams[3].needsScore;
  assert.throws(() => validateConfig(plan, characters, scores), /超出/);
});
