export function parseScoreInput(input) {
  const text = String(input ?? '').trim();
  if (!text || text.length > 100) return NaN;
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?\s*([kwm]?)$/i.exec(text);
  if (!match) return NaN;
  const [whole, fraction = ''] = match[2].split('.');
  const digits = (whole || '0') + fraction;
  const shift = Number(match[3] || 0) + ({ k: 3, w: 4, m: 6 }[match[4].toLowerCase()] || 0) - fraction.length;
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 1000) return NaN;
  const value = Number(`${match[1]}${digits}e${shift}`);
  return Number.isFinite(value) && !(value === 0 && /[1-9]/.test(digits)) ? value : NaN;
}

export function visibleWaves(records, maxRound) {
  return records.filter(wave => wave.round <= maxRound);
}

export function bossScoreAtRemainingHp(wave, remainingPercent) {
  if (!Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100) throw new RangeError('剩余血量百分比须为 0—100');
  if (!Number.isFinite(wave?.damage_points_at_full_hp) || !Number.isFinite(wave.full_kill_points) || !Number.isFinite(wave.kill_bonus) || wave.damage_points_at_full_hp <= 0 || wave.kill_bonus < 0 || wave.full_kill_points < wave.damage_points_at_full_hp) throw new TypeError('Boss 分数数据无效');
  const damagePointsEarned = wave.damage_points_at_full_hp * (1 - remainingPercent / 100);
  const killBonusEarned = remainingPercent === 0 ? wave.kill_bonus : 0;
  const earnedPoints = remainingPercent === 0 ? wave.full_kill_points : damagePointsEarned;
  return { earnedPoints, remainingPoints: wave.full_kill_points - earnedPoints, damagePointsEarned, killBonusEarned };
}

export function locateScore(score, waves) {
  if (!Number.isFinite(score) || !waves.length || score < 0 || score > waves.at(-1).cumulative_points_after + 1e-7) throw new RangeError('积分超出当前血线轴');
  const wave = waves.find(item => score < item.cumulative_points_after - 1e-7) || waves.at(-1);
  const within = Math.max(0, score - wave.cumulative_points_before);
  const damage = Math.min(within, wave.damage_points_at_full_hp);
  const inBonus = wave.kill_bonus > 0 && within >= wave.damage_points_at_full_hp - 1e-7 && within < wave.full_kill_points - 1e-7;
  const completed = score >= waves.at(-1).cumulative_points_after - 1e-7;
  const remainingHp = inBonus || completed ? 0 : Math.max(0, 1 - damage / wave.damage_points_at_full_hp);
  const remainingPoints = completed ? 0 : Math.max(0, wave.cumulative_points_after - score);
  return { wave, remainingHp, remainingPoints, inBonus, completed };
}

export function packTeams(teams) {
  let cursor = 0;
  return teams.map(team => {
    const packed = { ...team, startScore: cursor };
    cursor += team.score;
    return packed;
  });
}

export const PENDING_TEAM_SCORE = 5000;

export function layoutTeamPreviews(teams) {
  let cursor = 0;
  let pendingBefore = false;
  return teams.map(team => {
    const pending = team.needsScore === true;
    const axisScore = pending ? PENDING_TEAM_SCORE : team.score;
    const preview = {
      ...structuredClone(team),
      axisScore,
      axisStartScore: cursor,
      positionIsPreview: pendingBefore || pending,
    };
    cursor += axisScore;
    pendingBefore ||= pending;
    return preview;
  });
}

const TEAM_DELETION_HISTORY_LIMIT = 2;

export function createTeamDeletionHistory() {
  return { undo: [], redo: [] };
}

function copyTeamDeletionInputs(teams, history) {
  if (!Array.isArray(teams) || !history || !Array.isArray(history.undo) || !Array.isArray(history.redo)) throw new Error('队伍删除记录无效');
  const ids = new Set();
  for (const team of teams) {
    if (!team || typeof team.id !== 'string' || !team.id || ids.has(team.id)) throw new Error('队伍 ID 无效或重复');
    ids.add(team.id);
  }
  for (const stack of [history.undo, history.redo]) {
    if (stack.length > TEAM_DELETION_HISTORY_LIMIT) throw new Error('队伍删除记录超出两次上限');
    for (const record of stack) {
      if (!record?.team || typeof record.team.id !== 'string' || !record.team.id || !Number.isInteger(record.index) || record.index < 0
          || ![record.beforeId, record.afterId].every(id => id === null || (typeof id === 'string' && id.length > 0 && id !== record.team.id))) throw new Error('队伍删除记录无效');
    }
  }
  return { teams: structuredClone(teams), history: structuredClone(history) };
}

function teamDeletionRecord(teams, index) {
  return {
    team: structuredClone(teams[index]), index,
    beforeId: teams[index - 1]?.id ?? null,
    afterId: teams[index + 1]?.id ?? null,
  };
}

function appendTeamDeletionRecord(stack, record) {
  return [...stack, record].slice(-TEAM_DELETION_HISTORY_LIMIT);
}

export function deleteTeamWithHistory(teams, id, history = createTeamDeletionHistory()) {
  const next = copyTeamDeletionInputs(teams, history);
  const index = next.teams.findIndex(team => team.id === id);
  if (index < 0) throw new Error('找不到要删除的队伍');
  const record = teamDeletionRecord(next.teams, index);
  next.teams.splice(index, 1);
  return { teams: packTeams(next.teams), history: { undo: appendTeamDeletionRecord(next.history.undo, record), redo: [] } };
}

export function undoTeamDeletion(teams, history) {
  const next = copyTeamDeletionInputs(teams, history);
  const record = next.history.undo.pop();
  if (!record) throw new Error('没有可以撤回的队伍删除');
  if (next.teams.some(team => team.id === record.team.id)) throw new Error('无法撤回删除：该队伍 ID 已存在');
  const before = next.teams.findIndex(team => team.id === record.beforeId);
  const after = next.teams.findIndex(team => team.id === record.afterId);
  const anchorsReversed = before >= 0 && after >= 0 && before >= after;
  const index = anchorsReversed ? Math.min(record.index, next.teams.length) : after >= 0 ? after : before >= 0 ? before + 1 : Math.min(record.index, next.teams.length);
  next.teams.splice(index, 0, structuredClone(record.team));
  return { teams: packTeams(next.teams), history: { undo: next.history.undo, redo: appendTeamDeletionRecord(next.history.redo, record) } };
}

export function redoTeamDeletion(teams, history) {
  const next = copyTeamDeletionInputs(teams, history);
  const record = next.history.redo.pop();
  if (!record) throw new Error('没有可以恢复的队伍删除');
  const index = next.teams.findIndex(team => team.id === record.team.id);
  if (index < 0) throw new Error('无法恢复删除：对应队伍已不存在');
  const current = teamDeletionRecord(next.teams, index);
  next.teams.splice(index, 1);
  return { teams: packTeams(next.teams), history: { undo: appendTeamDeletionRecord(next.history.undo, current), redo: next.history.redo } };
}

export function reorderTeams(teams, id, targetIndex) {
  const ordered = [...teams];
  const index = ordered.findIndex(team => team.id === id);
  if (index < 0) return packTeams(ordered);
  const [team] = ordered.splice(index, 1);
  ordered.splice(Math.max(0, Math.min(ordered.length, targetIndex)), 0, team);
  return packTeams(ordered);
}

export function nearestTeamSlot(teams, id, desiredStart) {
  const others = teams.filter(team => team.id !== id);
  const starts = [0];
  for (const team of others) starts.push(starts.at(-1) + team.score);
  let best = 0;
  for (let index = 1; index < starts.length; index++) {
    if (Math.abs(starts[index] - desiredStart) < Math.abs(starts[best] - desiredStart)) best = index;
  }
  return best;
}

export function characterIdentity(character) {
  return character.name.startsWith('漂泊者') ? '漂泊者' : character.id;
}

export function defaultTeamName(characterIds, characterMap) {
  return characterIds.map(id => [...(characterMap.get(id)?.name || '')][0] || '').join('');
}

export function splitQuickTeams(sequence) {
  const groups = [];
  for (let index = 0; index < sequence.length; index += 3) groups.push(sequence.slice(index, index + 3));
  return groups;
}

export function axisTickStep(pixelsPerPoint) {
  const desired = 80 / pixelsPerPoint;
  const magnitude = 10 ** Math.floor(Math.log10(desired));
  return [1, 2, 5, 10].find(step => step * magnitude >= desired) * magnitude;
}

export function staminaLimits(rules, seasonId, identityById = new Map()) {
  const limits = new Map();
  if (!rules) return limits;
  const season = rules.seasons.find(item => item.id === (seasonId || rules.defaultSeason));
  if (!season) throw new Error('体力期数无效');
  const baseStamina = season.baseStamina || rules.baseStamina;
  const defaultStamina = season.defaultStamina || rules.defaultStamina;
  for (const identity of identityById.values()) limits.set(identity, defaultStamina);
  for (const [id, count] of Object.entries(baseStamina)) {
    const identity = identityById.get(id) || id;
    limits.set(identity, count);
  }
  for (const id of season.bonusCharacterIds) {
    const identity = identityById.get(id) || id;
    limits.set(identity, (limits.get(identity) || defaultStamina) + season.extraStamina);
  }
  return limits;
}

export function staminaConflicts(teams, rules, seasonId, identityById = new Map()) {
  const limits = staminaLimits(rules, seasonId, identityById);
  const usage = new Map();
  teams.forEach((team, index) => {
    const seen = new Set();
    for (const id of team.characterIds) {
      const identity = identityById.get(id) || id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!usage.has(identity)) usage.set(identity, { identity, characterId: id, teams: [] });
      usage.get(identity).teams.push({ id: team.id, name: team.name, number: index + 1 });
    }
  });
  return [...usage.values()].map(item => {
    const limit = limits.get(item.identity) || rules?.defaultStamina || 1;
    return { ...item, used: item.teams.length, limit, excess: item.teams.length - limit };
  }).filter(item => item.excess > 0);
}

export function matrixInfo(config) {
  const season = getSeason(config);
  return { id: season.id, towerId: season.towerId, name: season.name, scoreReady: season.scoring.waves.length > 0, provisional: season.scoring.status === 'provisional', maxRound: season.maxRound };
}

export function validateConfig(value, characterIds, records, identityById = new Map(), staminaRules, options = {}) {
  if (!value || value.version !== 1) throw new Error('请导入 version: 1 JSON 配置');
  const matrix = matrixInfo(value);
  const maxRound = Math.max(...records.map(wave => wave.round));
  if (!Number.isInteger(value.maxRound) || value.maxRound < 1) throw new Error(`显示轮次须为 1—${maxRound}`);
  if (!Number.isFinite(value.pixelsPerPoint) || value.pixelsPerPoint <= 0 || value.pixelsPerPoint > MAX_ZOOM) throw new Error('缩放范围无效');
  if (!Array.isArray(value.teams) || value.teams.length > 40) throw new Error('队伍数量须为 0—40');
  if (value.disabledCharacterIds !== undefined && (!Array.isArray(value.disabledCharacterIds) || value.disabledCharacterIds.some(id => typeof id !== 'string' || !characterIds.has(id)) || new Set(value.disabledCharacterIds).size !== value.disabledCharacterIds.length)) throw new Error('禁用角色配置无效');
  if (value.scoreMarker != null && (!Number.isFinite(value.scoreMarker) || value.scoreMarker < 0 || value.scoreMarker > (matrix.scoreReady ? records.at(-1).cumulative_points_after : Number.MAX_SAFE_INTEGER))) throw new Error('目标总分标记超出已导入的分数范围');
  const total = matrix.scoreReady ? visibleWaves(records, Math.min(value.maxRound, maxRound)).at(-1).cumulative_points_after : Number.MAX_SAFE_INTEGER;
  const ids = new Set();
  const usedCharacters = new Map();
  const staminaSeason = value.staminaSeason || matrix.id;
  const limits = staminaLimits(staminaRules, staminaSeason, identityById);
  let combinedScore = 0;
  for (const team of value.teams) {
    if (typeof team.id !== 'string' || !team.id || ids.has(team.id)) throw new Error('队伍 ID 须唯一');
    ids.add(team.id);
    if (typeof team.name !== 'string' || !team.name.trim() || team.name.length > 30) throw new Error('队名须为 1—30 个字符');
    if (team.nameMode !== undefined && !['auto', 'custom'].includes(team.nameMode)) throw new Error('队名模式无效');
    const roster = team.characterIds;
    if (!Array.isArray(roster) || (roster.length !== 3 && !(team.needsCharacters === true && roster.length < 3)) || new Set(roster).size !== roster.length || roster.some(id => !characterIds.has(id))) throw new Error('每队需选择 3 个不同的有效角色');
    const teamIdentities = new Set();
    for (const id of roster) {
      const identity = identityById.get(id) || id;
      if (teamIdentities.has(identity)) throw new Error('同一队内不能重复选择同一角色');
      teamIdentities.add(identity);
      const count = (usedCharacters.get(identity) || 0) + 1;
      if (!options.allowStaminaConflicts && count > (limits.get(identity) || staminaRules?.defaultStamina || 1)) throw new Error('角色体力不足，不能重复上阵到更多队伍');
      usedCharacters.set(identity, count);
    }
    if (Object.hasOwn(team, 'needsScore') && typeof team.needsScore !== 'boolean') throw new Error('待填分数标记须为布尔值');
    if (team.needsScore === true && team.score !== 0) throw new Error('待填分数的队伍分数须为 0');
    const awaitingScore = team.needsScore === true && team.score === 0;
    if (!Number.isFinite(team.score) || team.score < 0 || (!awaitingScore && team.score === 0) || team.score > total || !Number.isFinite(team.startScore) || team.startScore < 0 || team.startScore + team.score > total + 1e-7) throw new Error('队伍分数或起点超出当前血线轴');
    if (!/^#[\da-f]{6}$/i.test(team.color)) throw new Error('队伍颜色格式无效');
    combinedScore += team.score;
  }
  if (combinedScore > total + 1e-7) throw new Error('所有队伍的总分超出当前血线轴，请增加显示轮次');
  const normalized = structuredClone(value);
  normalized.maxRound = Math.min(normalized.maxRound, maxRound);
  normalized.matrixSeason = matrix.id;
  normalized.matrixVersion = matrix.name;
  normalized.pixelsPerPoint = Math.max(MIN_ZOOM, normalized.pixelsPerPoint);
  if (staminaRules) normalized.staminaSeason = staminaSeason;
  normalized.teams = packTeams(normalized.teams);
  if (matrix.scoreReady && normalized.scoreMarker != null) normalized.maxRound = Math.max(normalized.maxRound, records.find(wave => wave.cumulative_points_after >= normalized.scoreMarker).round);
  return normalized;
}
export const MIN_ZOOM = 0.000001;
export const MAX_ZOOM = 0.24;

import { getSeason } from './season-config.js';

