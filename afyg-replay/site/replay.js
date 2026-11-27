import {showCalculationOverlay} from '/calculation-overlay.js';
import {inAxisRange,roundRange,refreshBundledProject,rosterKey,libraryEntry,isExecution,projectStages,repositionExecutions,inspectProjectAxis,axisLabels,confirmImportAxis,verifyEngineDamage} from './execution-position.js';
const $=id=>document.getElementById(id);
function elem(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
const fmt=n=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n);
const keys={MouseLeft:'左键',MouseLeftHold:'长按左键',MouseRight:'闪避',SpaceBar:'跳跃'};
let generation=0, frame=null, engineTimer, project, input, timeline, calc, result, selection='', lookup=new Map();
let originalEnvelope=null;
let exportRequest=null;
function teamLabel(p){return p.team.map((s,i)=>s.character+' · '+s.weapon+' '+(s.chain??p.conditionProfile?.chains?.[i]??0)+'链'+(s.refinement??p.conditionProfile?.refinements?.[i]??1)+'精').join('　 /　');}
let iconMap={};
function gearIcon(kind,name){
  const url=iconMap[kind]?.[name];
  const icon=elem('span');icon.className='gear-icon '+kind;
  const fallback=()=>icon.replaceChildren(document.createTextNode((name||'—').slice(0,1)));
  if(!url){fallback();return icon;}
  const image=elem('img');image.alt='';image.onerror=fallback;image.src=url;
  icon.append(image);return icon;
}
function chip(label,value){
  const box=elem('span');box.className='stat-chip';
  box.append(elem('span',label),elem('b',value));return box;
}
function echoTotals(slots){
  const sums=new Map();
  for(const slot of slots.slice(0,5)){
    for(const stat of [slot?.mainStat,slot?.secondMainStat,...(slot?.substats??[])]){
      if(!stat?.type||typeof stat.value!=='number'||!Number.isFinite(stat.value))continue;
      const unit=stat.unit||'',name=unit==='%'?stat.type.replace(/%$/,''):stat.type;
      const key=JSON.stringify([name,unit]);
      sums.set(key,(sums.get(key)||0)+stat.value);
    }
  }
  return [...sums].map(([key,v])=>{const [name,unit]=JSON.parse(key);return chip(name,fmt(v)+unit);});
}
function showEquipment(team, config, profile){
  const expanded=[...$('gear').querySelectorAll('details')].map(d=>d.open);
  $('gear').replaceChildren();
  team.forEach((slot,i)=>{
    const card=elem('article'),title=elem('div');title.className='role-heading';
    title.append(gearIcon('role',slot.character),elem('h2',slot.character),elem('small',(profile?.chains?.[i]??slot.chain??project.conditionProfile?.chains?.[i]??0)+' 链'));
    const weapon=elem('div');weapon.className='gear-line';
    weapon.append(gearIcon('weapon',slot.weapon),elem('span',slot.weapon||'未设置武器'),elem('small',(profile?.refinements?.[i]??slot.refinement??project.conditionProfile?.refinements?.[i]??1)+' 精'));
    card.append(title,weapon);
    const sets=new Map();
    for(const item of slot.triggerSets||[]){
      if(!sets.has(item.name))sets.set(item.name,new Set());
      sets.get(item.name).add(item.pieces);
    }
    for(const [name,pieces] of sets){
      const line=elem('div');line.className='gear-line';
      line.append(gearIcon('set',name),elem('span',name),elem('small',[...pieces].map(n=>n+'件').join(' / ')));card.append(line);
    }
    const details=elem('details');details.open=!!expanded[i];details.append(elem('summary','声骸与词条'));
    const first=slot.echoes?.[0]?.name;
    if(first){const line=elem('div');line.className='gear-line';line.append(gearIcon('echo',first),elem('b',first));details.append(line);}
    const stats=elem('div');stats.className='stat-list echo-stats';stats.append(...echoTotals(config?.characters?.[i]?.echoes||[]));
    if(!stats.childElementCount)stats.textContent='未填写词条';
    details.append(stats);card.append(details);$('gear').append(card);
  });
  const en=config?.enemy,enemy=$('enemy');enemy.replaceChildren();
  if(en)enemy.append(...[['等级',en.level],['类型',en.type],['防御',en.defense],['减伤',(en.dmgReduction??0)+'%'],...Object.entries(en.resistances||{}).map(([k,v])=>[k+'抗性',v+'%'])].map(([k,v])=>chip(k,v)));
  else enemy.textContent='未填写敌人配置';
}

const libraryKey='afyg-project-library-v1';
let library=[],activeId=null,lastDeletion=null;
function persistLibrary(){
  try{localStorage.setItem(libraryKey,JSON.stringify({items:library,activeId,lastDeletion}));$('library-status').textContent='';}
  catch{$('library-status').textContent='浏览器空间不足，队伍仅在本次打开期间保留。';}
}
function drawLibrary(){
  const nav=$('team-library');nav.replaceChildren();
  $('delete-project').disabled=!library.some(item=>item.id===activeId);
  $('undo-project').disabled=!lastDeletion;
  const groups=new Map();
  for(const item of library){
    const file=item.edited??item.raw,p=file.project??file;
    const key=rosterKey(p);
    let group=groups.get(key);
    if(!group){
      group=elem('section');group.className='roster-group';
      const names=p.team.map(slot=>slot.character).join(' · ');
      group.setAttribute('aria-label',names);
      const portraits=elem('span');portraits.className='team-portraits';
      for(const slot of p.team)portraits.append(gearIcon('role',slot.character));
      group.append(portraits,elem('h3',names));groups.set(key,group);nav.append(group);
    }
    const button=elem('button');button.type='button';button.className='team-entry';button.setAttribute('aria-pressed',String(item.id===activeId));
    const axis=inspectProjectAxis(p,projectStages(p).timeline.data);
    button.append(elem('strong',p.name||'未命名工程'),elem('span',axisLabels[axis.kind]));
    for(const [i,slot] of p.team.entries()){
      const chains=slot.chain??p.conditionProfile?.chains?.[i]??0;
      const refinement=slot.refinement??p.conditionProfile?.refinements?.[i]??1;
      button.append(elem('small',slot.character+' '+chains+'链 · '+(slot.weapon||'未设置武器')+' '+refinement+'精'));
    }
    button.onclick=()=>{if(activeId!==item.id)load(async()=>item.edited??item.raw,item.id);};group.append(button);
  }
}

function showProjectData(){
  $('overview').hidden=false;showEquipment(project.team,project.phases?.config?.data??project.encounter?.config?.data);
  const list=$('buff-directory');list.replaceChildren();
  for(const buff of calc.buffSets){
    const row=elem('details');row.className='buff-box';row.append(elem('summary',buff.name||buff.id));
    for(const zone of buff.zones||[])row.append(elem('p',zone.zoneId+'　'+(zone.value??'引用面板')));
    list.append(row);
  }
}
function editedFile(state){
    const snapshot=structuredClone(project);
    snapshot.conditionProfile={chains:state.chains,refinements:state.refinements};
    snapshot.team.forEach((slot,i)=>Object.assign(slot,{chain:state.chains[i],refinement:state.refinements[i]}));
    for(const stages of [snapshot.phases,snapshot.encounter])if(stages?.config)stages.config.data=state.config;
    snapshot.analysis={...snapshot.analysis,timings:state.timings.map(({refLineId,seconds})=>({refLineId,seconds}))};
    return originalEnvelope?{...originalEnvelope,project:snapshot}:snapshot;
}
function reset(){
  $('execution-editor').hidden=true;$('execution-status').textContent='';finishExecution();
  $('overview').hidden=true;document.querySelector('.native').hidden=true;
  generation++;exportRequest=null;clearTimeout(engineTimer);frame=null;result=null;selection='';lookup.clear();$('host').replaceChildren();$('export').disabled=true;
  for(const id of ['totals','axis','results','project-name','axis-audit','team','axis-info','detail-note'])$(id).replaceChildren();
  $('detail-title').textContent='逐段伤害';return generation;
}
let loadTicket=0;
function showEmptyLibrary(){
  ++loadTicket;
  reset();
  activeId=null;
  drawLibrary();
  $('status').textContent='工程库为空，可导入椰果 JSON 或载入样例。';
}
let pendingDeleteId=null;
$('delete-project').onclick=()=>{
  const item=library.find(entry=>entry.id===activeId);
  if(!item)return;
  pendingDeleteId=item.id;
  const name=(item.raw.project??item.raw).name||'未命名工程';
  $('delete-description').textContent='将从工程库删除「'+name+'」。只保留最近一次删除供撤回。'
    +(lastDeletion?'继续删除后，上一次删除将无法撤回。':'');
  $('delete-dialog').returnValue='';
  $('delete-dialog').showModal();
};
$('delete-dialog').addEventListener('close',()=>{
  const index=library.findIndex(item=>item.id===pendingDeleteId);
  pendingDeleteId=null;
  if($('delete-dialog').returnValue!=='delete'||index<0)return;
  const [item]=library.splice(index,1);
  lastDeletion={item,index};
  const next=library[index]??library[index-1];
  activeId=next?.id??null;
  persistLibrary();
  if(next)load(async()=>next.edited??next.raw,next.id);else showEmptyLibrary();
  $('project-notice').textContent='已删除「'+((item.raw.project??item.raw).name||'未命名工程')+'」。';
});
$('undo-project').onclick=()=>{
  if(!lastDeletion)return;
  const {item,index}=lastDeletion;
  lastDeletion=null;
  const existing=library.findIndex(entry=>entry.id===item.id);
  if(existing>=0)library.splice(existing,1);
  library.splice(index,0,item);
  activeId=item.id;
  persistLibrary();
  load(async()=>item.edited??item.raw,item.id);
  $('project-notice').textContent='已恢复「'+((item.raw.project??item.raw).name||'未命名工程')+'」。';
};
async function load(read,key=null){
  const ticket=++loadTicket; let seq=generation;$('status').textContent='正在读取工程…';
  try{
    const file=await read();if(ticket!==loadTicket||!file){if(ticket===loadTicket)$('status').textContent='';return;}
    let raw=file.engine==='wuwa-afyg-tool@441852a'&&file.result?file.project:file;
    let p=raw.project??raw;
    if(!Array.isArray(p.team)||p.team.length!==3)throw Error('请选择含三人队伍的椰果工程 JSON。');
    const stages=projectStages(p);
    if(!Array.isArray(stages?.timeline?.data?.opBlocks)||!Array.isArray(stages?.timeline?.data?.refLines)||!Array.isArray(stages?.timeline?.data?.damageBlocks)||!Array.isArray(stages?.calculation?.data?.buffSets))throw Error('工程缺少操作轴或拉表数据。');
    const item=libraryEntry(library,raw,key);
    raw=item.edited??item.raw;p=raw.project??raw;
    const {timeline:{data:t},calculation:{data:c}}=projectStages(p);
    seq=reset();activeId=item.id;drawLibrary();persistLibrary();
    const assets=p.team.flatMap(slot=>[['v3/info/character',slot.character],['v1/info/weapon',slot.weapon],...(slot.echoes??[]).filter(e=>e?.name).map(e=>['v1/info/echo',e.name])]).filter(([,name])=>name);
    project=p;input=raw;originalEnvelope=raw.project?raw:null;timeline=t;calc=c;lookup=new Map([...t.refLines,...t.opBlocks].map(a=>[a.id,a]));
    const audit=inspectProjectAxis(p,t);$('axis-audit').textContent=axisLabels[audit.kind]+' · '+audit.reason;
    $('project-name').textContent=p.name||'未命名工程';$('team').textContent=teamLabel(p);
    drawAxis();drawExecutionEditor();showProjectData();showRows();
    await Promise.all(assets.map(async ([route,name])=>{const res=await fetch('/api/'+route+'/'+encodeURIComponent(name));if(!res.ok)throw Error('本地资料包缺少 '+name);await res.json();}));
    if(seq!==generation||ticket!==loadTicket)return;
    document.querySelector('.native').hidden=false;$('status').textContent='正在计算期望伤害…';
    frame=elem('iframe');frame.title='椰果原版计算页';frame.src='/fast-calc?api_base='+encodeURIComponent(location.origin);$('host').append(frame);
    engineTimer=setTimeout(()=>{if(!result&&seq===generation){$('status').textContent='复算尚未返回，请检查本地基础资料并重新载入。';if(parent===window)finishExecution();}},18000);
  }catch(e){if(seq===generation&&ticket===loadTicket)$('status').textContent=e.message;}
}
let executionRequest=null;
function finishExecution(){
  if(!executionRequest)return;
  executionRequest.unlock();executionRequest=null;
  $('recalculate-execution').disabled=false;
}
function anchorLabel(a){
  if(a.key===undefined)return a.name||a.time||(a.id==='left'?'起点':a.id==='right'?'结束':'参考线');
  return [project.team[a.trackIndex]?.character,keys[a.key]||a.key,a.desc,a.intro?'变奏':''].filter(Boolean).join(' · ');
}
function drawExecutionEditor(){
  const item=library.find(i=>i.id===activeId);
  const original=item.raw.project??item.raw;
  const t=projectStages(original).timeline.data;
  const breaks=t.damageBlocks.filter(b=>b.nonDirectEntries?.some(isExecution));
  const list=$('execution-positions');list.replaceChildren();
  $('execution-editor').hidden=!breaks.length;
  $('recalculate-execution').disabled=false;
  $('recalculate-execution').textContent=parent===window?'重新计算':'重新计算并应用到血线';
  const anchors=[...t.opBlocks,...t.refLines].sort((a,b)=>a.pos-b.pos);
  const audit=inspectProjectAxis(project,t);
  const {range,kind,repeats}=audit,{cycles}=range;
  $('execution-hint').textContent=cycles>1?'每轮分别设置。选择「本轮不放」会跳过该次处决伤害和叠层。下方操作轴显示原工程的格子。':'放在计分区间外的处决不会计入血线。';
  breaks.sort((a,b)=>lookup.get(a.sourceId).pos-lookup.get(b.sourceId).pos);
  for(let round=0;round<cycles;round++){
   const group=elem('div');group.className='execution-round';
   if(cycles>1)group.append(elem('strong',repeats && round===0?(kind==='startup'?'第 1 轮 · 启动':'第 1 轮 · 首轮特化'):kind==='closing'&&round===4?'第 5 轮 · 尾轮特化':'第 '+(round+1)+' 轮'));
   list.append(group);
   breaks.forEach((block,i)=>{
    const inSegment=pos=>!repeats||inAxisRange(pos,roundRange(audit,round));
    if(!inSegment(lookup.get(block.sourceId).pos))return;
    const who=block.nonDirectEntries.find(isExecution).responders?.[0];
    const label=elem('label',[who,'处决'+(breaks.length>1?' '+(i+1):'')].filter(Boolean).join(' · '));
    const target=elem('select');target.dataset.block=block.id;target.dataset.round=round;
    target.add(new Option('原位置 · '+anchorLabel(lookup.get(block.sourceId)),''));
    if(cycles>1)target.add(new Option('本轮不放','@skip'));
    anchors.forEach((a,j)=>{if(inSegment(a.pos))target.add(new Option((j+1)+'. '+anchorLabel(a),a.id));});
    const move=(project.executionRounds?.[round]??item.executionMoves)?.[block.id];
    target.value=move?.skip?'@skip':move?.anchorId??'';
    const side=elem('select');side.setAttribute('aria-label','处决顺序');
    side.add(new Option('该格伤害之前','before'));side.add(new Option('该格伤害之后','after'));
    side.value=move?.side??'after';side.disabled=!target.value||target.value==='@skip';
    target.onchange=()=>{side.disabled=!target.value||target.value==='@skip';$('execution-status').textContent='已选新位置，重新计算后生效。';};
    side.onchange=()=>{$('execution-status').textContent='已选新顺序，重新计算后生效。';};
    const row=elem('div');row.className='execution-row';label.append(target);row.append(label,side);group.append(row);
   });
   if(repeats && !group.querySelector('select'))group.append(elem('small','该段没有绑定处决'));
  }
}
$('recalculate-execution').onclick=async()=>{
  const item=library.find(i=>i.id===activeId);
  if(!item||executionRequest)return;
  let unlock;
  try{
    unlock=showCalculationOverlay();
    const rounds=Array.from($('execution-positions').children,()=>({}));
    for(const row of $('execution-positions').querySelectorAll('.execution-row')){
      const [target,side]=row.querySelectorAll('select');
      if(target.value)rounds[Number(target.dataset.round)][target.dataset.block]=target.value==='@skip'?{skip:true}:{anchorId:target.value,side:side.value};
    }
    const original=item.raw.project??item.raw;
    const moves=rounds.length===1?rounds[0]:{};
    const revised=repositionExecutions(project,original,moves);
    if(rounds.length>1)revised.executionRounds=rounds;
    item.edited=originalEnvelope?{...originalEnvelope,project:revised}:revised;
    item.executionMoves=moves;
    await load(async()=>item.edited,item.id);
    if(activeId!==item.id||!frame)return;
    if(parent===window && result)return;
    executionRequest={id:crypto.randomUUID(),unlock};
    unlock=null;
    $('recalculate-execution').disabled=true;
    if(parent!==window){
      $('execution-status').textContent='正在按新位置推演血线…';
      parent.postMessage({type:'matrix:apply-execution',request:executionRequest.id,projectId:item.id,project:revised},location.origin);
    }
  }catch(error){finishExecution();$('execution-status').textContent=error.message;}
  finally{unlock?.();}
};
function drawAxis(){
  const board=elem('div');board.className='board';
  const executions=timeline.damageBlocks.filter(b=>b.nonDirectEntries?.some(isExecution));
  const labelsByAnchor=new Map();
  const spec=inspectProjectAxis(project,timeline);
  if(project.executionRounds && spec.range.cycles>1){
    project.executionRounds.forEach((moves,i)=>{
      for(const block of executions){
        const pos=lookup.get(block.sourceId)?.pos;
        if(spec.repeats && !inAxisRange(pos,roundRange(spec,i)))continue;
        const move=moves[block.id];if(move?.skip)continue;
        const id=move?.anchorId??block.sourceId;
        if(!labelsByAnchor.has(id))labelsByAnchor.set(id,new Set());
        labelsByAnchor.get(id).add(i+1);
      }
    });
  }
  const positions=[...new Set([...timeline.opBlocks,...timeline.refLines].map(x=>x.pos))].sort((a,b)=>a-b);
  const offset=pos=>78+(pos-positions[0]);
  board.style.width=(offset(positions.at(-1)??0)+130)+'px';
  const labels=elem('div');labels.className='lane-headers';board.append(labels);
  [...project.team.map(s=>s.character),'参考线'].forEach((name,i)=>{const label=elem('div',name);label.className='lane-name';label.style.gridArea=(i+1)+' / 1';labels.append(label);});
  for(const a of [...timeline.opBlocks,...timeline.refLines]){
    const ref=a.key===undefined;
    const name=ref?anchorLabel(a):(keys[a.key]||a.key);
    const cell=elem('button',ref?name:[name,a.desc,a.intro?'变奏':'',a.switchback?'切回':''].filter(Boolean).join(' · '));
    cell.className='block'+(ref?' ref':'');cell.dataset.id=a.id;cell.style.top=((ref?3:a.trackIndex)*74+4)+'px';cell.style.left=offset(a.pos)+'px';
    const rounds=labelsByAnchor.get(a.id);
    if(rounds || (!project.executionRounds && executions.some(b=>b.sourceId===a.id))){
      cell.classList.add('has-execution');cell.append(elem('strong',rounds?'第 '+[...rounds].join('、')+' 轮处决':'处决'));
    }
    const next=(ref?timeline.refLines:timeline.opBlocks.filter(x=>x.trackIndex===a.trackIndex)).filter(x=>x.pos>a.pos).sort((x,y)=>x.pos-y.pos)[0];cell.style.width=Math.max(24,Math.min(120,next?next.pos-a.pos-3:120))+'px';cell.title=cell.textContent;
    cell.onclick=()=>{selection=a.id;showRows();};board.append(cell);
  }
  $('axis').replaceChildren(board);$('axis-info').textContent=timeline.opBlocks.length+' 个操作 · '+timeline.refLines.length+' 条参考线 · '+timeline.damageBlocks.length+' 个伤害块 · '+calc.buffSets.length+' 个 Buff。横向位置沿用原工程，点操作或参考线可查看绑定伤害。';
}
function showRows(){
  if(!result){
    if(!timeline)return;
    const list=$('results');list.replaceChildren();
    $('detail-title').textContent='工程绑定的伤害段';
    for(const block of timeline.damageBlocks.filter(b=>!selection||b.sourceId===selection)){
      for(const hit of [...(block.skillHits||[]),...(block.nonDirectEntries||[])])
        list.append(elem('p',[hit.character,hit.hitName||hit.name,hit.ratio,hit.hits?'×'+hit.hits:''].filter(Boolean).join(' · ')));
    }
    if(!list.childElementCount)list.append(elem('p','此位置没有绑定伤害。'));
    return;
  }
  const entries=selection?result.entries.filter(e=>e.blockId===selection):result.entries;
  document.querySelectorAll('.block').forEach(b=>b.classList.toggle('active',b.dataset.id===selection));
  const anchor=lookup.get(selection);
  $('detail-title').textContent=anchor?(anchor.desc||anchor.name||keys[anchor.key]||anchor.key||'起点')+' · 绑定伤害':'全部伤害条目';
  $('detail-note').textContent=entries.length+' 条 · 合计 '+fmt(entries.reduce((s,e)=>s+e.damage,0));
  const table=elem('table'),head=elem('tr');for(const title of ['来源','伤害段','命中数','期望总伤','绑定 Buff'])head.append(elem('th',title));table.append(head);
  const names=new Map(calc.buffSets.map(b=>[b.id,b.name]));
  for(const e of entries){
    const row=elem('tr');for(const value of [e.character,e.name,e.hits,fmt(e.damage)])row.append(elem('td',value));
    const cell=elem('td'),list=elem('details'),ids=calc.damageEntryBuffSetIds?.[e.id]??[];list.append(elem('summary',ids.length+' 项'),elem('p',ids.map(id=>names.get(id)||id).join(' · ')));cell.append(list);row.append(cell);table.append(row);
  }
  $('results').replaceChildren(table);
}
window.addEventListener('message',e=>{
  if(e.source===parent && e.origin===location.origin && e.data?.type==='matrix:execution-result' && executionRequest && e.data.request===executionRequest.id){
    finishExecution();$('execution-status').textContent=e.data.message;return;
  }
  if(!frame||e.source!==frame.contentWindow||e.origin!==location.origin)return;
  if(e.data?.type==='fast-calc:state'&&e.data.requestId==='view-equipment'&&e.data.ok){
    showEquipment(project.team,e.data.config,e.data);
    const item=library.find(entry=>entry.id===activeId);
    if(item){item.edited=editedFile(e.data);drawLibrary();persistLibrary();}
    return;
  }
  if(e.data?.type==='fast-calc:ready'){frame.contentWindow.postMessage({type:'fast-calc:load',project:JSON.stringify(originalEnvelope?input:{version:project.version,project})},location.origin);return;}
  if(e.data?.type==='fast-calc:state'&&exportRequest&&e.data.requestId===exportRequest){
    exportRequest=null;$('export').disabled=false;
    if(!e.data.ok){$('status').textContent='获取当前配装失败，请重试。';return;}
    const file=editedFile(e.data);
    const blob=new Blob([JSON.stringify({engine:'wuwa-afyg-tool@441852a',dataVersion:'3.8',project:file,result},null,2)],{type:'application/json'});
    const link=elem('a');link.href=URL.createObjectURL(blob);link.download=(project.name||'椰果工程')+'-复算.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);return;
  }
  if(e.data?.type==='fast-calc:project-updated'){
    const updated=e.data.project;
    const rounds=project.executionRounds;
    const axisSettings=Object.fromEntries(['matrixAxisType','matrixLoopStart','matrixLoopEnd'].filter(k=>project[k]!==undefined).map(k=>[k,project[k]]));
    project=Object.assign(updated.project??updated,axisSettings);
    if(rounds)project.executionRounds=rounds;
    input=originalEnvelope?{...originalEnvelope,project}:project;
    $('team').textContent=teamLabel(project);
    frame.contentWindow.postMessage({type:'fast-calc:request-state',requestId:'view-equipment'},location.origin);
    return;
  }
  if(e.data?.type!=='fast-calc:result')return;
  if(parent===window)finishExecution();
  const r=e.data;
  if(!Array.isArray(r.entries)||!Array.isArray(r.segments)||!Number.isFinite(r.total)||r.entries.some(e=>!Number.isFinite(e.damage)||!lookup.has(e.blockId))){$('status').textContent='计算结果含未识别的轴绑定，无法完整还原。';return;}
  try{verifyEngineDamage(r);}catch(error){$('status').textContent=error.message;$('export').disabled=true;return;}
  const audit=inspectProjectAxis(project,timeline),range=audit.range;
  const closing=audit.kind==='closing';
  const first=roundRange(audit,0),tail=closing?roundRange(audit,4):null;
  let openingDamage=0,cycleDamage=0,tailDamage=0;
  for(const row of r.entries){
    const pos=lookup.get(row.blockId).pos;
    if(pos<range.start||pos>range.end||(!range.inclusiveEnd&&pos===range.end))continue;
    if(audit.repeats&&inAxisRange(pos,first))openingDamage+=row.damage;
    else if(tail&&inAxisRange(pos,tail))tailDamage+=row.damage;
    else cycleDamage+=row.damage;
  }
  const parts=[];
  if(audit.repeats)parts.push({label:audit.kind==='startup'?'启动':'首轮',damage:openingDamage,count:1});
  parts.push({label:audit.kind==='full'?'全轴':closing?'中间循环':'循环',damage:cycleDamage,count:audit.repeats||range.cycles});
  if(closing)parts.push({label:'尾轮',damage:tailDamage,count:1});
  const reference=parts.reduce((sum,p)=>sum+p.damage*p.count,0);
  const bounds=closing&&audit.split&&audit.loopEnd?'。首轮截至「'+anchorLabel(audit.split)+'」，中间循环截至「'+anchorLabel(audit.loopEnd)+'」，均含末格':audit.repeats&&audit.split?'。循环从「'+anchorLabel(audit.split)+'」开始，'+
    (audit.loopEnd?'到「'+anchorLabel(audit.loopEnd)+'」之前':'一直到工程末尾'):'';
  const seconds=closing||audit.kind==='startup'?audit.templateSeconds:audit.kind==='single'?100:120;
  $('axis-audit').textContent=axisLabels[audit.kind]+' · '+audit.reason+bounds+'。原工程敌人面板下，'+
    parts.map(p=>p.label+' '+fmt(p.damage)+(p.count>1?' × '+p.count:'')).join(' ＋ ')+
    '。模板参考总伤 '+fmt(reference)+(seconds?'，按 '+seconds+' 秒折算 '+fmt(reference/seconds)+' DPS。':'。所选分界缺少计时，仅显示总伤。');
  clearTimeout(engineTimer);result=r;$('status').textContent='';$('totals').replaceChildren();
  function metric(label,value,detail){const tile=elem('div');tile.append(elem('small',label),elem('strong',value));if(detail)tile.append(elem('small',detail));$('totals').append(tile);}
  metric('全工程期望伤害',fmt(reference));
  if(audit.kind==='full' && reference===r.total){
    for(const s of r.segments){metric(s.time+' · 伤害',fmt(s.total));if(s.seconds>0)metric(s.time+' · DPS',fmt(s.dps));}
  }else if(audit.kind!=='full'){
    for(const p of parts)metric(p.label+' × '+p.count,fmt(p.damage*p.count),p.count>1?'每轮 '+fmt(p.damage):'');
  }
  showRows();$('export').disabled=false;
});
$('sample').onclick=()=>load(async()=>{const res=await fetch('/sample.json');if(!res.ok)throw Error('未找到样例文件');return res.json();},'sample');
$('file').onchange=()=>{const file=$('file').files[0];if(file)load(async()=>{
  const input=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
  const raw=input.engine==='wuwa-afyg-tool@441852a'&&input.result?input.project:input;
  return await confirmImportAxis(raw.project??raw)?raw:null;
});$('file').value='';};
$('all').onclick=()=>{selection='';showRows();};
$('export').onclick=()=>{
  if(!result||!frame)return;
  exportRequest=crypto.randomUUID();$('export').disabled=true;
  frame.contentWindow.postMessage({type:'fast-calc:request-state',requestId:exportRequest},location.origin);
};
async function startTeamView(){
  let saved;
  try {
    saved = await refreshBundledProject();
  } catch (error) {
    $('library-status').textContent = '工程库读取失败，已保留原始数据。' + error.message;
    $('retry-library').hidden = false;
    $('retry-library').onclick = () => location.reload();
    return;
  }
  if (saved) {
    library = saved.items;
    activeId = saved.activeId;
    if (saved.lastDeletion?.item?.raw && saved.lastDeletion.item.id && Number.isInteger(saved.lastDeletion.index)) lastDeletion = saved.lastDeletion;
  }
  try{const response=await fetch('/icons/replay/index.json');if(response.ok)iconMap=await response.json();}catch{}
  const last=library.find(item=>item.id===activeId)??library[0];
  drawLibrary();
  $('file').disabled = $('sample').disabled = false;
  if(last)await load(async()=>last.edited??last.raw,last.id);
  else if(saved)showEmptyLibrary();
  else $('sample').click();
}
startTeamView();
