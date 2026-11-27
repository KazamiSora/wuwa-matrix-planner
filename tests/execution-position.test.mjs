import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRosterChoices} from '../afyg-batch.js';
import {compileProjectPreset} from '../afyg-preset.js';
import {repositionExecutions,inspectProjectAxis,verifyEngineDamage,rosterKey,libraryEntry,roundRange,inAxisRange} from '../afyg-replay/site/execution-position.js';

test('1+3+1 uses the ending reference hits once per corresponding segment and keeps the tail once',()=>{
  const timeline={refLines:[
    {id:'left',pos:0},{id:'a',pos:10,time:'+28s 首轮 14胶卷'},
    {id:'b',pos:20,time:'+26s 中间三轮循环 10胶卷'},{id:'c',pos:30,time:'+14s 尾轮'},
    {id:'right',pos:32,time:'结束'}
  ]};
  const audit=inspectProjectAxis({},timeline);
  assert.equal(audit.kind,'closing');assert.equal(audit.range.cycles,5);assert.equal(audit.templateSeconds,120);
  const rounds=Array.from({length:5},(_,i)=>[0,10,11,20,21,30].filter(x=>inAxisRange(x,roundRange(audit,i))));
  assert.deepEqual(rounds,[[0,10],[11,20],[11,20],[11,20],[21,30]]);
  assert.equal(inspectProjectAxis({matrixAxisType:'full'},timeline).kind,'full');
  assert.equal(inspectProjectAxis({analysis:{timings:[{refLineId:'right',seconds:120}]}},timeline).kind,'full');
});

test('library groups reordered rosters, keeps gear and axis variants, and distinguishes Rover elements',()=>{
  const p={name:'循环',team:['漂泊者·气动','心','莉莉'].map(character=>({character,chain:0,refinement:1})),phases:{timeline:{data:{opBlocks:[],refLines:[],damageBlocks:[]}}}};
  const items=[],first=libraryEntry(items,{project:p,exportedAt:1});
  assert.equal(libraryEntry(items,{project:{...p,matrixAxisType:'single'},exportedAt:2}).id,first.id);
  const reversed={...p,team:[...p.team].reverse()};
  assert.equal(rosterKey(p),rosterKey(reversed));
  for(const change of [{chain:4},{refinement:5},{weapon:'另一把武器'}]){
    const variant=structuredClone(p);Object.assign(variant.team[0],change);
    assert.equal(rosterKey(variant),rosterKey(p));
    assert.notEqual(libraryEntry(items,variant).id,first.id);
  }
  assert.notEqual(libraryEntry(items,{...p,matrixAxisType:'full'}).id,first.id);
  const rover=structuredClone(p);rover.team[0].character='漂泊者·湮灭';
  assert.notEqual(rosterKey(p),rosterKey(rover));
  assert.equal(items.length,5);
});

test('a written 120s opening and loop timeline plays once; a selected template plays 1 + 4',()=>{
  const t={refLines:[{id:'a',time:'+26s 首轮',pos:10},{id:'b',time:'+25s 循环轴',pos:20},{id:'z',time:'结束',pos:50}]};
  assert.equal(inspectProjectAxis({},t).kind,'opening');
  const full={analysis:{timings:[{refLineId:'z',seconds:120}]}};
  assert.equal(inspectProjectAxis(full,t).range.cycles,1);
  const chosen=inspectProjectAxis({...full,matrixAxisType:'opening',matrixLoopStart:'a',matrixLoopEnd:'b'},t);
  assert.equal(chosen.range.cycles,5);assert.equal(chosen.split.pos,10);assert.equal(chosen.range.end,20);
  assert.equal(chosen.range.inclusiveEnd,false);
});
test('an inconsistent native damage result or duplicated entry cannot pass import verification',()=>{
  verifyEngineDamage({total:12,entries:[{id:'A',damage:2},{id:'B',damage:10}]});
  assert.throws(()=>verifyEngineDamage({total:20,entries:[{id:'A',damage:2}]}));
  assert.throws(()=>verifyEngineDamage({total:4,entries:[{id:'A',damage:2},{id:'A',damage:2}]}));
});
test('startup ends at 30s and its 28s loop plays three times, preserving other choices',()=>{
  const t={refLines:[{id:'a',time:'启动轴',pos:2812},{id:'b',time:'循环轴',pos:5333},{id:'right',time:'结束',pos:10848}]};
  const project={analysis:{timings:[{refLineId:'b',seconds:58},{refLineId:'a',seconds:30}]}};
  const audit=inspectProjectAxis(project,t);
  assert.equal(audit.kind,'startup');assert.equal(audit.repeats,3);assert.equal(audit.range.cycles,4);
  assert.equal(audit.split.id,'a');assert.equal(audit.range.end,5333);
  assert.equal(audit.range.inclusiveEnd,false);assert.equal(audit.templateSeconds,114);
  assert.equal(inspectProjectAxis({...project,matrixAxisType:'opening'},t).range.cycles,5);
  assert.equal(inspectProjectAxis({...project,matrixAxisType:'single'},t).repeats,0);
  project.analysis.timings.push({refLineId:'right',seconds:120});
  assert.equal(inspectProjectAxis(project,t).kind,'full');
});

test('relative reference times drive both the template audit and each compiled round', async () => {
  const timeline = {opBlocks: [], damageBlocks: [], refLines: [
    {id: 'left', pos: 0}, {id: 'a', pos: 10, time: '+30s 启动轴'},
    {id: 'b', pos: 20, time: '+28s 循环轴'}, {id: 'right', pos: 30}
  ]};
  for (const [kind, rounds] of [['startup', [30, 28, 28, 28]], ['opening', [30, 28, 28, 28, 28]]]) {
    const project = {matrixAxisType: kind, phases: {timeline: {data: timeline}}};
    const preset = await compileProjectPreset(project, [], []);
    assert.deepEqual(preset.roundSeconds, rounds);
    assert.equal(inspectProjectAxis(project, timeline).templateSeconds, rounds.reduce((a, b) => a + b));
  }
  assert.equal(inspectProjectAxis({}, timeline).kind, 'startup');
  const authored = {matrixAxisType: 'startup', analysis: {timings: [{refLineId: 'a', seconds: 31}]}};
  assert.equal(inspectProjectAxis(authored, timeline).templateSeconds, 115);
});

test('move separate executions without moving co-bound skills, effects or losing row bindings',()=>{
  const execution={name:'谐度破坏',category:'处决',responders:['心']};
  const effect={name:'电磁效应',category:'效应'};
  const original={phases:{
    timeline:{data:{opBlocks:[{id:'A',pos:10},{id:'B',pos:20}],refLines:[],damageBlocks:[
      {id:'d1',sourceId:'A',sourceType:'op',skillHits:[{hitName:'普攻'}],nonDirectEntries:[execution,effect]},
      {id:'d2',sourceId:'B',sourceType:'op',skillHits:[],nonDirectEntries:[execution]}
    ]}},
    calculation:{data:{damageEntryBuffSetIds:{'d1-nd|谐度破坏':['a'],'d1-nd|电磁效应':['b']}}}
  }};
  const moves={d1:{anchorId:'B',side:'after'},d2:{anchorId:'A',side:'before'}};
  const revised=repositionExecutions(original,original,moves);
  const [first,mixed,last]=revised.phases.timeline.data.damageBlocks;
  assert.deepEqual([first.sourceId,mixed.sourceId,last.sourceId],['A','A','B']);
  assert.deepEqual(mixed.nonDirectEntries,[effect]);
  assert.deepEqual(last.nonDirectEntries,[execution]);
  assert.deepEqual(revised.phases.calculation.data.damageEntryBuffSetIds[last.id+'-nd|谐度破坏'],['a']);
  assert.deepEqual(repositionExecutions(revised,original,moves),revised);
  assert.deepEqual(repositionExecutions(revised,original,{}),original);
  const skipped=repositionExecutions(original,original,{d1:{skip:true},d2:{skip:true}});
  const blocks=skipped.phases.timeline.data.damageBlocks;
  assert.equal(blocks.length,1);
  assert.deepEqual(blocks[0].skillHits,[{hitName:'普攻'}]);
  assert.deepEqual(blocks[0].nonDirectEntries,[effect]);
});
test('batch preferences select a single axis automatically and keep plan-specific roster choices',()=>{
  const project={team:['绯雪','洛瑟菈','穗穗'].map(character=>({character}))};
  const items=[{id:'one',raw:{project}},{id:'two',raw:{...project,team:[...project.team].reverse()}}];
  const key=rosterKey(project), available=()=>'';
  const choices=previous=>makeRosterChoices(items,previous,available)[0];
  assert.equal(choices(undefined).choice,null);
  assert.equal(choices([{key,selected:true,projectId:'two'}]).choice,'two');
  assert.equal(choices([{key,selected:false,projectId:'one'}]).selected,false);
  assert.equal(choices([{key,selected:true,projectId:'deleted'}]).choice,null);
  const [single]=makeRosterChoices(items.slice(0,1),[{key,selected:true,projectId:'two'}],available);
  assert.equal(single.choice,'one');
});
