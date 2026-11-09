import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { characterIdentity, packTeams, staminaConflicts, validateConfig } from '../score-axis.js';

const readJson = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const example = readJson('../config/demo.json');
const rules = readJson('../config/stamina.json');
const records = readJson('../data/scores.json').records;
const characters = readJson('../data/characters.json').entries.filter(character => !character.download_failed);
const characterIds = new Set(characters.map(character => character.id));
const identities = new Map(characters.map(character => [character.id, characterIdentity(character)]));

function repeatedCharacter(id, season) {
  const plan = structuredClone(example);
  plan.staminaSeason = season;
  plan.teams[0].name = '第一队';
  plan.teams[1].name = '第二队';
  plan.teams[0].characterIds[2] = id;
  plan.teams[1].characterIds[2] = id;
  return plan;
}

function validate(plan, options) {
  return validateConfig(plan, characterIds, records, identities, rules, options);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('switching two Lynae teams to S2-4 reports both affected team identities and positions', () => {
  const plan = repeatedCharacter('1509', 's2-phase3');
  assert.deepEqual(staminaConflicts(plan.teams, rules, 's2-phase3', identities), []);
  assert.deepEqual(staminaConflicts(plan.teams, rules, 's2-phase4', identities), [{
    identity: '1509', characterId: '1509', used: 2, limit: 1, excess: 1,
    teams: [{ id: 'team-1', name: '第一队', number: 1 }, { id: 'team-2', name: '第二队', number: 2 }],
  }]);
});

test('the reverse switch reports two Lucilla teams, while the correct version remains valid', () => {
  const plan = repeatedCharacter('1109', 's2-phase4');
  assert.deepEqual(staminaConflicts(plan.teams, rules, 's2-phase4', identities), []);
  const conflicts = staminaConflicts(plan.teams, rules, 's2-phase3', identities);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].characterId, '1109');
  assert.equal(conflicts[0].used, 2);
  assert.equal(conflicts[0].limit, 1);
  assert.equal(conflicts[0].excess, 1);
  assert.deepEqual(conflicts[0].teams.map(team => team.id), ['team-1', 'team-2']);
});

test('an S2-4 plan without a stamina period accepts its own two-stamina character', () => {
  const plan = repeatedCharacter('1109', 's2-phase4');
  plan.towerId = 18;
  plan.matrixSeason = 's2-phase4';
  delete plan.staminaSeason;
  const before = structuredClone(plan);
  const normalized = validate(plan);
  assert.equal(normalized.staminaSeason, 's2-phase4');
  assert.deepEqual(staminaConflicts(normalized.teams, rules, normalized.staminaSeason, identities), []);
  assert.deepEqual(plan, before);
});

test('an S2-4 plan without a stamina period rejects the S2-3-only bonus', () => {
  const plan = repeatedCharacter('1509', 's2-phase3');
  plan.towerId = 18;
  plan.matrixSeason = 's2-phase4';
  delete plan.staminaSeason;
  assert.throws(() => validate(plan), /体力不足/);
  const recovered = validate(plan, { allowStaminaConflicts: true });
  assert.equal(recovered.staminaSeason, 's2-phase4');
  assert.equal(staminaConflicts(recovered.teams, rules, recovered.staminaSeason, identities).length, 1);
});

test('an explicit stamina period can still differ from the matrix period', () => {
  const plan = repeatedCharacter('1509', 's2-phase3');
  plan.towerId = 18;
  plan.matrixSeason = 's2-phase4';
  const normalized = validate(plan);
  assert.equal(normalized.matrixSeason, 's2-phase4');
  assert.equal(normalized.staminaSeason, 's2-phase3');
  assert.deepEqual(staminaConflicts(normalized.teams, rules, normalized.staminaSeason, identities), []);
});

test('all conflicts are returned when more than one character loses available stamina', () => {
  const plan = repeatedCharacter('1509', 's2-phase3');
  plan.teams[0].characterIds[1] = '1505';
  plan.teams[1].characterIds[1] = '1505';
  const changedRules = structuredClone(rules);
  changedRules.baseStamina['1505'] = 1;
  const conflicts = new Map(staminaConflicts(plan.teams, changedRules, 's2-phase4', identities).map(conflict => [conflict.identity, conflict]));
  assert.equal(conflicts.size, 2);
  for (const id of ['1505', '1509']) {
    assert.equal(conflicts.get(id).used, 2);
    assert.equal(conflicts.get(id).limit, 1);
    assert.equal(conflicts.get(id).excess, 1);
    assert.deepEqual(conflicts.get(id).teams.map(team => team.number), [1, 2]);
  }
});

test('unscored quick teams consume stamina and remain in the conflict team list', () => {
  const plan = repeatedCharacter('1509', 's2-phase4');
  plan.teams[1].score = 0;
  plan.teams[1].needsScore = true;
  plan.teams = packTeams(plan.teams);
  const conflicts = staminaConflicts(plan.teams, rules, 's2-phase4', identities);
  assert.equal(conflicts[0].used, 2);
  assert.deepEqual(conflicts[0].teams.map(team => team.id), ['team-1', 'team-2']);
  const recovered = validate(plan, { allowStaminaConflicts: true });
  assert.equal(recovered.teams[1].needsScore, true);
  assert.equal(recovered.teams[1].score, 0);
});

test('a team awaiting a score cannot retain positive points during import or recovery', () => {
  const plan = structuredClone(example);
  plan.teams[0].needsScore = true;
  for (const options of [{}, { allowStaminaConflicts: true }]) {
    assert.throws(() => validate(plan, options), /待填分数/);
  }
  plan.teams[0].needsScore = false;
  assert.equal(validate(plan).teams[0].score, 8000);
});

test('the pending-score flag rejects non-boolean values during import and recovery', () => {
  for (const value of ['false', 'true', 1, 0, null, {}, [], undefined]) {
    const plan = structuredClone(example);
    plan.teams[0].needsScore = value;
    for (const options of [{}, { allowStaminaConflicts: true }]) {
      assert.throws(() => validate(plan, options), /待填分数标记须为布尔值/);
    }
  }
});

test('the pending-score flag permits absent or false with points, and true with zero', () => {
  const plan = structuredClone(example);
  assert.equal(validate(plan).teams[0].score, 8000);
  plan.teams[0].needsScore = false;
  assert.equal(validate(plan).teams[0].score, 8000);
  plan.teams[0].needsScore = true;
  plan.teams[0].score = 0;
  plan.teams = packTeams(plan.teams);
  const normalized = validate(plan);
  assert.equal(normalized.teams[0].needsScore, true);
  assert.equal(normalized.teams[0].score, 0);
  assert.equal(normalized.teams[1].startScore, 0);
});

test('editing an affected roster or deleting its team resolves the conflict', () => {
  const plan = repeatedCharacter('1509', 's2-phase4');
  assert.equal(staminaConflicts(plan.teams, rules, 's2-phase4', identities).length, 1);
  const edited = structuredClone(plan);
  edited.teams[1].characterIds[2] = '1503';
  assert.deepEqual(staminaConflicts(edited.teams, rules, 's2-phase4', identities), []);
  const deleted = plan.teams.filter(team => team.id !== 'team-2');
  assert.deepEqual(staminaConflicts(deleted, rules, 's2-phase4', identities), []);
  assert.equal(staminaConflicts(plan.teams, rules, 's2-phase4', identities).length, 1, 'Editing a clone must not change the original plan');
});

test('conflict analysis does not modify teams, rules, or the supplied identity map', () => {
  const plan = repeatedCharacter('1509', 's2-phase3');
  const before = structuredClone(plan.teams);
  const frozenRules = deepFreeze(structuredClone(rules));
  const identityEntries = [...identities];
  staminaConflicts(deepFreeze(plan.teams), frozenRules, 's2-phase4', identities);
  assert.deepEqual(plan.teams, before);
  assert.deepEqual(frozenRules, rules);
  assert.deepEqual([...identities], identityEntries);
});

test('JSON import remains strict; recovery alone can retain over-budget cross-team rosters', () => {
  const plan = repeatedCharacter('1509', 's2-phase4');
  assert.throws(() => validate(plan), /体力/);
  assert.throws(() => validate(plan, { allowStaminaConflicts: false }), /体力/);
  const before = structuredClone(plan);
  const recovered = validate(plan, { allowStaminaConflicts: true });
  assert.deepEqual(recovered.teams, plan.teams, 'Recovery must retain every roster, name, score and position');
  assert.deepEqual(plan, before, 'Validation must not rewrite its input');
  assert.equal(recovered.staminaSeason, 's2-phase4');
  assert.equal(staminaConflicts(recovered.teams, rules, recovered.staminaSeason, identities).length, 1);
  const importedFlag = { ...plan, allowStaminaConflicts: true };
  assert.throws(() => validate(importedFlag), /体力/, 'A property inside the JSON must not activate recovery mode');
});

test('recovery mode still rejects duplicate identities within one team', () => {
  const duplicate = repeatedCharacter('1509', 's2-phase4');
  duplicate.teams[0].characterIds = ['1304', '1304', '1509'];
  assert.throws(() => validate(duplicate, { allowStaminaConflicts: true }), /角色|重复/);
  const roverVariants = characters.filter(character => character.name.startsWith('漂泊者')).slice(0, 2);
  assert.equal(roverVariants.length, 2);
  const sameIdentity = repeatedCharacter('1509', 's2-phase4');
  sameIdentity.teams[0].characterIds = [roverVariants[0].id, roverVariants[1].id, '1509'];
  assert.throws(() => validate(sameIdentity, { allowStaminaConflicts: true }), /同一队|重复/);
});

test('recovery mode does not relax scores or other structural validation', () => {
  for (const invalidScore of [-1, NaN, 0]) {
    const plan = repeatedCharacter('1509', 's2-phase4');
    plan.teams[0].score = invalidScore;
    assert.throws(() => validate(plan, { allowStaminaConflicts: true }), /分数|超出/);
  }
  const unknownCharacter = repeatedCharacter('1509', 's2-phase4');
  unknownCharacter.teams[0].characterIds[0] = 'not-a-character';
  assert.throws(() => validate(unknownCharacter, { allowStaminaConflicts: true }), /有效角色/);
  const duplicateTeam = repeatedCharacter('1509', 's2-phase4');
  duplicateTeam.teams[1].id = duplicateTeam.teams[0].id;
  assert.throws(() => validate(duplicateTeam, { allowStaminaConflicts: true }), /唯一/);
});
