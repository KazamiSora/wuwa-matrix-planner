import {roundRange,inAxisRange,templateTimes,inspectProjectAxis,projectAxisRange,repositionExecutions,verifyEngineDamage} from './afyg-replay/site/execution-position.js';
import {specialEchoCast} from './cingulum.js';
import {enemyDefenseForLevel,damageProfileKey} from './season-config.js';
export {projectAxisRange};
const elements = ['冷凝','热熔','导电','气动','衍射','湮灭'];

async function resistanceTable(project, values,level) {
  const copy = structuredClone(project);
  const patches = Object.fromEntries(elements.map((name,i)=>[name,values[i]]));
  for(const stages of [copy.phases,copy.encounter]){
    if(!stages)continue;
    stages.config ??= {};
    stages.config.data ??= {};
    const cfg=stages.config.data;
    cfg.enemy={type:'BOSS',dmgReduction:0,...cfg.enemy,level,defense:enemyDefenseForLevel(level),defenseLocked:false,
      resistances:{...cfg.enemy?.resistances,...patches}};
  }
  const frame=document.createElement('iframe');
  frame.hidden=true;frame.title='椰果预设复算';
  return new Promise((resolve,reject)=>{
    let output=null,loaded=false,settle;
    const finish=()=>{clearTimeout(timeout);clearTimeout(settle);window.removeEventListener('message',handle);frame.remove();};
    const timeout=setTimeout(()=>{finish();reject(new Error('椰果复算超时，请重新应用'));},18000);
    function handle(event){
      if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
      const msg=event.data;
      if(msg?.type==='fast-calc:ready'){
        event.source.postMessage({type:'fast-calc:load',project:JSON.stringify({version:copy.version,project:copy})},location.origin);
      }else if(msg?.type==='fast-calc:result')output=msg;
      else if(msg?.type==='fast-calc:project-loaded')loaded=true;
      if(output&&loaded){
        clearTimeout(settle);settle=setTimeout(()=>{
          finish();
          try{verifyEngineDamage(output);resolve(output.entries);}catch(error){reject(error);}
        },400);
      }
    }
    window.addEventListener('message',handle);
    frame.src='/fast-calc?api_base='+encodeURIComponent(location.origin);document.body.append(frame);
  });
}
// Some full axes label rounds by duration ("30s启动, 25s循环, 25s循环").
// Keep increasing absolute labels on the existing clock.
export function fullAxisTimes(project,refs){
  const labels=refs.map(ref=>/^([+]?)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*(?:启动|首轮|起手|循环|尾轮|收尾)/i.exec((ref.name||ref.time||'').trim()));
  const stages=labels.filter(Boolean);
  if(stages.length<2 || !stages.some((m,i)=>m[1] || (i>0 && +m[2]<=+stages[i-1][2])))return null;
  const authored=new Map((project.analysis?.timings??[]).map(t=>[t.refLineId,t.seconds]));
  const times=new Map();
  const fullLength=project.matrixAxisType==='full' || /120\s*(?:s|秒)|全局轴/i.test(project.name??'');
  // A partial authored marker inside a round must not shift the next round end.
  let boundary=0;
  refs.forEach((ref,i)=>{
    const saved=authored.get(ref.id),duration=labels[i];
    if(ref.id==='left')times.set(ref.id,0);
    else if(duration){
      boundary=Number.isFinite(saved)&&saved>boundary?saved:boundary+Number(duration[2]);
      times.set(ref.id,boundary);
    }else if(Number.isFinite(saved)&&saved>=boundary && saved>0)times.set(ref.id,saved);
    else if(ref.id==='right' && fullLength && boundary<120)times.set(ref.id,120);
  });
  return times;
}

function axisClock(project,timeline,axis,repeats=false){
  const refs=[...timeline.refLines].sort((a,b)=>a.pos-b.pos);
  const timed=(axis.playback || repeats ? templateTimes(project,refs,{preferAuthored:!axis.playback}) :
    axis.cycles===1 ? fullAxisTimes(project,refs) : null) ?? new Map((project.analysis?.timings??[]).map(t=>[t.refLineId,t.seconds]));
  const points=[];
  for(const ref of timeline.refLines){
    const label=ref.name||ref.time||'';
    const seconds=timed.get(ref.id)??(/^\+?(\d+(?:\.\d+)?)\s*(?:s\b|秒)/i.exec(label)?.[1]);
    if(seconds!==undefined && Number.isFinite(+seconds))points.push({pos:ref.pos,t:+seconds});
  }
  if(!points.some(p=>p.t===0) && timeline.refLines.some(r=>r.id==='left'))
    points.push({pos:timeline.refLines.find(r=>r.id==='left').pos,t:0});
  points.sort((a,b)=>a.pos-b.pos);
  function secondsAt(x){
    const right=points.findIndex(p=>p.pos>=x);
    if(right<0)return null;
    if(points[right].pos===x)return points[right].t;
    if(!right)return null;
    const a=points[right-1],b=points[right];
    return b.t>a.t?a.t+(x-a.pos)/(b.pos-a.pos)*(b.t-a.t):null;
  }
  const begin=secondsAt(Number.isFinite(axis.start)?axis.start:points[0]?.pos);
  const finish=secondsAt(Number.isFinite(axis.end)?axis.end:points.at(-1)?.pos);
  return {secondsAt,begin,duration:begin!==null && finish>begin?finish-begin:0};
}
function appliesGlacio(character,name){
  if(character==='穗穗')return /^(?:醒春潮|普攻·濯雨时第四段|变奏技能|翾舞)伤害$/.test(name);
  if(character==='洛瑟菈')return /^(?:剪辑(?:·硬切)?|变奏技能)伤害$/.test(name);
  return character==='绯雪' && /^(?:普攻·常世身第三段|普攻·预求身第[三四五]段|空中攻击·预求身第[二三]段|重击·寒簇·常世身|重击·枯霜·预求身|预求我身·见心|变奏技能)伤害$/.test(name);
}
export function responseWindows(project,timeline,axis,pos,clock=axisClock(project,timeline,axis)){
  const {secondsAt,duration}=clock;
  const marks=new Map();
  for(const block of timeline.damageBlocks){
    for(const hit of block.skillHits??[]){
      if(!/变奏/.test(hit.skillType)||!/同奏/.test(hit.hitName))continue;
      const who=hit.character;
      if(!marks.has(who))marks.set(who,new Set());
      marks.get(who).add(pos.get(block.sourceId));
    }
  }
  if(axis.playback){
    let elapsed=0;
    const segments=axis.playback.map(range=>{
      const segmentClock=axisClock(project,timeline,{...range,playback:true});
      const start=elapsed;
      elapsed+=segmentClock.duration;
      return {range,start,begin:segmentClock.begin};
    });
    const absolute=(segment,x)=>{
      const t=secondsAt(x);
      return t===null || segment.begin===null ? null : segment.start+t-segment.begin;
    };
    const triggers=new Map();
    for(const [who,positions] of marks){
      triggers.set(who,segments.flatMap(s=>[...positions].filter(x=>inAxisRange(x,s.range)).map(x=>absolute(s,x))).filter(t=>t!==null));
    }
    return (who,x)=>segments.reduce((mask,s,i)=>{
      if(!inAxisRange(x,s.range))return mask;
      const time=absolute(s,x);
      return time!==null && triggers.get(who)?.some(t=>time>=t && time-t<30) ? mask|(1<<i) : mask;
    },0);
  }
  const warmStart=timeline.refLines.some(r=>r.pos===axis.start && /首轮.*不计/.test(r.name||r.time||''));
  return (who,x)=>{
    const now=secondsAt(x);
    let mask=0;
    for(const trigger of marks.get(who)??[]){
      if(x===trigger)return (1<<axis.cycles)-1;
      const t=secondsAt(trigger);
      if(t===null||now===null)continue;
      for(let round=0;round<axis.cycles;round++){
        let age=now-t;
        if(axis.loopAfterOpening && trigger<axis.start && round>1)age+=duration*(round-1);
        if(age<0 && duration>0 && axis.cycles>1 && (round>(axis.loopAfterOpening?1:0)||warmStart) && trigger>=axis.start && trigger<axis.end)age+=duration;
        if(age>=0 && age<30)mask|=1<<round;
      }
    }
    return mask;
  };
}

export async function compileProjectPreset(project, roles, seasons){
  const timeline=(project.phases??project.encounter)?.timeline?.data;
  if(!timeline?.refLines)throw Error('工程缺少轴参考线');
  const audit=inspectProjectAxis(project,timeline);
  const {kind,range,split,repeats,loopEnd}=audit;
  const rounds=range.cycles>1?project.executionRounds:undefined;
  if(!repeats && rounds===undefined)return compileRotation(project,roles,seasons);
  if(rounds!==undefined && (!Array.isArray(rounds)||rounds.length!==range.cycles))throw Error('处决设置的轮数与所选轴类型不一致');
  if(repeats && (!split||split.pos>range.end))throw Error('请在导入时确认首轮与循环段的分界');
  if(kind==='closing' && !(loopEnd?.pos>split?.pos))throw Error('请确认中间循环的末格与尾轮分界');
  const playback=Array.from({length:range.cycles},(_,i)=>roundRange(audit,i));
  const variants=new Map(),hits=[],pool=new Map(),roundOrders=[],roundSeconds=[];
  for(let i=0;i<range.cycles;i++){
    const moves=rounds?.[i]??{};
    if(!moves||typeof moves!=='object'||Array.isArray(moves))throw Error('分轮处决设置无效');
    const segment=playback[i];
    const key=JSON.stringify([segment.start,segment.end,moves]);
    if(!variants.has(key)){
      const rotation=repositionExecutions(project,project,moves);
      delete rotation.executionRounds;
      const variant=await compileRotation(rotation,roles,seasons,true,kind==='closing'?{...segment,playback}:segment);
      const order=variant.hits.map(hit=>{
        const signature=JSON.stringify(hit);
        if(!pool.has(signature)){pool.set(signature,hits.length);hits.push(hit);}
        return pool.get(signature);
      });
      variants.set(key,{order,duration:variant.roundSeconds?.[0]??0});
    }
    const {order,duration}=variants.get(key);
    roundOrders.push(order);
    roundSeconds.push(duration);
  }
  return {id:'afyg-project-v1',name:project.name||'椰果工程',roles,axisKind:kind,cycles:range.cycles,hits,roundOrders,roundSeconds,matrixBuffVersion:1,bossEventVersion:2,mistVersion:1,matrixLevelVersion:1};
}

async function compileRotation(project, roles, seasons, allowEmpty=false, segment){
  const phase=project.phases??project.encounter;
  const timeline=phase?.timeline?.data;
  const {range,kind,repeats}=inspectProjectAxis(project,timeline);
  const axis=segment??range;
  const clock=axisClock(project,timeline,axis,repeats);
  if(allowEmpty && timeline?.damageBlocks?.length===0)return {hits:[],roundSeconds:[clock.duration]};
  if(!timeline?.damageBlocks?.length)throw Error('工程中没有可推演的伤害块');
  const assets=project.team.flatMap(slot=>[['v3/character',slot.character],['v1/weapon',slot.weapon],...(slot.echoes??[]).filter(e=>e?.name).map(e=>['v1/echo',e.name])]);
  await Promise.all(assets.filter(([,name])=>name).map(async ([route,name])=>{
    const [version,type]=route.split('/');
    const response=await fetch('/api/'+version+'/info/'+type+'/'+encodeURIComponent(name),{method:'HEAD'});
    if(!response.ok)throw Error('本地资料包缺少 '+name);
  }));
  const keys=new Map();
  for(const season of seasons)for(const boss of season.bosses){
    const values=elements.map((_,i)=>boss.resistances.values[i+1]);
    for(const level of season.enemyLevels)keys.set(damageProfileKey(level,values.join(',')),{values,level});
  }
  const tables=new Map();
  const profiles=[...keys];
  for(let i=0;i<profiles.length;i+=3){
    const batch=await Promise.all(profiles.slice(i,i+3).map(async ([key,{values,level}])=>{
      const entries=await resistanceTable(project,values,level);
      return [key,new Map(entries.map(entry=>[entry.id,entry]))];
    }));
    for(const [key,table] of batch)tables.set(key,table);
  }
  const base=tables.values().next().value;
  const pos=new Map([...timeline.opBlocks,...timeline.refLines].map(anchor=>[anchor.id,anchor.pos]));
  const relativeSecond=pos=>{
    const t=clock.secondsAt(pos);
    return t!==null && clock.begin!==null && t>=clock.begin?t-clock.begin:null;
  };
  const responseAt=responseWindows(project,timeline,axis,pos,clock);
  const hits=[];
  const opById=new Map(timeline.opBlocks.map(op=>[op.id,op]));
  const ops=[...timeline.opBlocks].sort((a,b)=>a.pos-b.pos);
  const hasRoccia=project.team.some(slot=>slot.character==='洛可可');
  const castMarkers=new Map();
  for(const op of ops){
    const cast=specialEchoCast(project.team[op.trackIndex]?.character,op.desc,hasRoccia);
    if(cast && inAxisRange(op.pos,axis))castMarkers.set(op.id,{op,cast});
  }
  const positions=[];
  const blocks=[...timeline.damageBlocks].sort((a,b)=>pos.get(a.sourceId)-pos.get(b.sourceId));
  // Copied blocks can have IDs such as d123 and d123-25. Assign each row once.
  const byIdLength=[...blocks].sort((a,b)=>b.id.length-a.id.length);
  const rowsByBlock=new Map(blocks.map(block=>[block.id,[]]));
  for(const entry of base.values()){
    const owner=byIdLength.find(block=>block.sourceId===entry.blockId && entry.id.startsWith(block.id+'-'));
    if(!owner)throw Error('找不到伤害条目的所属轴块：'+entry.name);
    rowsByBlock.get(owner.id).push(entry);
  }
  for(const block of blocks){
    const anchor=pos.get(block.sourceId);
    if(!Number.isFinite(anchor))throw Error('找不到伤害块对应的操作或参考线');
    if(!inAxisRange(anchor,axis))continue;
    const rows=rowsByBlock.get(block.id);
    for(const entry of rows){
      const raw=block.skillHits.find(hit=>entry.id.includes(hit.skillType+'|'+hit.hitName+'#'));
      let factors=[1];
      if(raw){
        factors=String(raw.ratio).replace(/(?:生命|攻击|防御)$/,'').split(/(?<![eE])\+/).flatMap(term=>{
          const m=/^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(%?)(?:[*×](\d+))?$/.exec(term.trim());
          if(!m||!Number.isFinite(Number(m[1]))||Number(m[3]||1)>1000)throw Error('无法拆分 '+raw.hitName+' 的倍率 '+raw.ratio);
          return Array(Number(m[3]||1)).fill(Number(m[1]));
        });
      }else if(!block.nonDirectEntries?.length && !entry.fixed)throw Error('无法对应工程伤害条目 '+entry.name);
      const repeats=Number(entry.hits||1);
      if(!Number.isInteger(repeats)||repeats<1||repeats*factors.length>1000)throw Error('命中段数超出支持范围');
      if(entry.zones?.multAdd && new Set(factors).size>1)throw Error('该工程含复合倍率追加，暂不能准确拆分 '+entry.name);
      const weights=Array.from({length:repeats},()=>factors).flat(),sum=weights.reduce((a,b)=>a+b,0);
      if(sum<=0&&entry.damage>0)throw Error('无法拆分零倍率伤害');
      const coverage=responseAt(entry.character,anchor);
      const types=entry.damageTypes??[];
      const metadata={};
      const second=relativeSecond(anchor);
      if(Number.isFinite(second))metadata.roundSecond=second;
      const op=opById.get(block.sourceId)??ops.findLast(x=>x.pos<=anchor);
      const actor=project.team[op?.trackIndex]?.character;
      if(actor && actor!==entry.character)metadata.offField=true;
      const cast=specialEchoCast(entry.character,raw?.hitName??entry.name,hasRoccia);
      if(castMarkers.get(block.sourceId)?.cast===cast)castMarkers.delete(block.sourceId);
      if(cast==='遗忘'){
        const label=[raw?.hitName,op?.desc].join(' ');
        const assigned=phase.calculation?.data?.damageEntryDamageTypes?.[entry.id]??[];
        if(/霜渐/.test(label)||assigned.includes('普攻伤害'))metadata.forgetMode='frost';
        else if(/声骸/.test(label)||assigned.includes('声骸技能伤害'))metadata.forgetMode='echo';
      }
      const vulnerability=entry.zones?.vulnerability;
      if(!Number.isFinite(vulnerability)||vulnerability<0)throw Error('工程缺少易伤区数据，请刷新后重新应用');
      if(vulnerability!==1)metadata.vulnerabilityZone=vulnerability;
      const indirectName=entry.id.slice((block.id+'-nd|').length).split('#')[0];
      const indirect=!raw && block.nonDirectEntries?.find(nd=>entry.id.startsWith(block.id+'-nd|')&&nd.name===indirectName);
      if(indirect?.category==='效应' && indirect.name==='霜渐效应' && Number.isInteger(indirect.layers)){
        metadata.glacioLayers=indirect.layers;
      }
      if(indirect?.category==='处决' && indirect.name==='谐度破坏')metadata.tuneBreak=true;
      if(indirect?.category==='效应'||types.some(t=>t==='效应伤害'||t==='异常效应伤害'))metadata.abnormal=true;
      if(raw?.skillType==='声骸技能'){
        const echo=project.team.find(slot=>slot.character===raw.character)?.echoes?.[0]?.name;
        if(echo)metadata.echoName=echo;
      }
      if(raw && (types.includes('霜渐效应伤害')||types.includes('霜冻效应伤害')||/^(?:霜渐|霜冻)效应伤害$/.test(raw.hitName)))metadata.glacioDamage=true;
      if(coverage)metadata.unisonRounds=coverage;
      if(raw?.skillType==='声骸技能'||types.includes('声骸技能伤害'))metadata.echo=true;
      if(types.includes('普攻伤害'))metadata.basic=true;
      if(types.includes('共鸣解放伤害'))metadata.liberation=true;
      if(!Number.isFinite(entry.finalZone)||entry.finalZone<0)throw Error('伤害条目缺少终伤区数据，请刷新测试版后重新应用');
      if(entry.finalZone!==1)metadata.finalZone=entry.finalZone;
      const parts=weights.map((_,i)=>({name:entry.name,source:entry.character??indirect?.name??'',part:i+1,damage:{},...metadata}));
      // In Hiyuki's party the converted Glacio damage settles on application.
      if(indirect?.name==='霜渐效应' && project.team.some(slot=>slot.character==='绯雪')){
        for(const h of parts)h.statusApplication=true;
      }
      if(raw && appliesGlacio(raw.character,raw.hitName))parts.at(-1).statusApplication=true;
      if(cast)for(let i=0;i<parts.length;i+=(cast==='遗忘'?factors.length:parts.length))parts[i].specialEcho=cast;
      for(const [key,table] of tables){
        const full=table.get(entry.id)?.damage;if(!Number.isFinite(full)||full<0)throw Error('不同抗性下伤害条目无法匹配');
        let prior=0,cumulative=0;
        for(const [i,w] of weights.entries()){
          cumulative+=w;const next=Math.round(full*cumulative/(sum||1));
          parts[i].damage[key]=next-prior;prior=next;
        }
      }
      hits.push(...parts);
      for(let i=0;i<parts.length;i++)positions.push(anchor);
      if(hits.length>2000)throw Error('工程超过单轮 2000 次命中');
    }
  }
  // An explicitly named utility cast may have no damage bound to its grid cell.
  // Insert it after this cell's damage, without inventing a hit or any points.
  for(const {op,cast} of [...castMarkers.values()].reverse()){
    let index=positions.findIndex(x=>x>op.pos);
    if(index===-1)index=hits.length;
    positions.splice(index,0,op.pos);
    const mode=cast==='遗忘'?(/霜渐/.test(op.desc)?'frost':/声骸/.test(op.desc)?'echo':undefined):undefined;
    hits.splice(index,0,{name:cast,source:project.team[op.trackIndex]?.character??'',part:1,castOnly:true,specialEcho:cast,
      ...(mode?{forgetMode:mode}:{}),damage:{}});
  }
  // Damage ticks need not be applications. An explicit action/reference can
  // describe an application even when the project binds no damage to it.
  for(const a of [...ops,...timeline.refLines]){
    const label=(a.desc||a.name||a.time||'').trim();
    if(!/^(?:附加|施加)(?:(?:\d+层)?[【「]?(?:异常|霜渐|霜冻|电磁|光噪|虚湮|风蚀|聚爆)效应[】」]?)$/.test(label))continue;
    if(!inAxisRange(a.pos,axis))continue;
    let i=positions.findIndex(x=>x>a.pos);
    if(i<0)i=hits.length;
    const second=relativeSecond(a.pos);
    positions.splice(i,0,a.pos);
    hits.splice(i,0,{name:label,source:project.team[a.trackIndex]?.character??'',part:1,castOnly:true,statusApplication:true,
      ...(Number.isFinite(second)?{roundSecond:second}:{}),damage:{}});
  }
  for(const [key,table] of tables){
    let expected=0;
    for(const row of table.values()){
      const x=pos.get(row.blockId);
      if(!Number.isFinite(x))throw Error('导入核对失败：伤害条目缺少落点');
      if(inAxisRange(x,axis))expected+=Math.round(row.damage);
    }
    const actual=hits.reduce((sum,h)=>sum+(h.castOnly?0:h.damage[key]),0);
    if(actual!==expected)throw Error('导入核对失败：计分区间的逐击伤害与椰果条目不一致');
  }
  if(!allowEmpty && !hits.some(h=>Object.values(h.damage).some(n=>n>0)))throw Error('工程没有可计分的循环伤害');
  return {id:'afyg-project-v1',name:project.name||'椰果工程',roles,axisKind:kind,cycles:axis.cycles,hits,roundSeconds:Array(axis.cycles).fill(clock.duration),matrixBuffVersion:1,bossEventVersion:2,mistVersion:1,matrixLevelVersion:1};
}
