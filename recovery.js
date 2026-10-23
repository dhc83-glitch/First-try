import {randomUUID} from 'node:crypto';

function writable(p){
  if(!p||!['date','checkbox','select','rich_text','title'].includes(p.type))throw Error('This property cannot be safely restored.');
  if(p.type==='date')return {date:p.date?{start:p.date.start,...(p.date.end?{end:p.date.end}:{}),...(p.date.time_zone?{time_zone:p.date.time_zone}:{})}:null};
  if(p.type==='checkbox')return {checkbox:p.checkbox};
  if(p.type==='select')return {select:p.select?{name:p.select.name}:null};
  const parts=(p[p.type]||[]).map(part=>{
    const type=part.type||'text';
    if(!['text','mention','equation'].includes(type))throw Error('A note contains unsupported content.');
    return {type,[type]:part[type]||{content:part.plain_text||''},...(part.annotations?{annotations:part.annotations}:{})};
  });
  return {[p.type]:parts};
}
function comparable(p){
  const type=p.type||Object.keys(p)[0],value=p[type];
  if(type==='date')return value?[value.start?.includes('T')?Date.parse(value.start):value.start,value.end?.includes('T')?Date.parse(value.end):value.end||null]:null;
  if(type==='select')return value?.name||null;
  if(type==='title'||type==='rich_text')return (value||[]).map(part=>({type:part.type||'text',value:part.text?.content??part.plain_text??part.mention??part.equation,link:part.text?.link||null,annotations:Object.fromEntries(Object.entries(part.annotations||{}).filter(([key,v])=>key==='color'?v!=='default':v===true))}));
  return value;
}
const equal=(a,b)=>JSON.stringify(comparable(a))===JSON.stringify(comparable(b));
async function prepare(assistant,id){
  const state=await assistant.store.read(),ops=state.operations||[],index=ops.findIndex(o=>o.id===id),op=ops[index];
  if(!op||op.status!=='verified'||!op.taskId||!op.before||!op.properties||op.restoredBy||op.action==='restore')throw Error('This change has no supported verified restore point.');
  if(ops.slice(0,index).some(o=>o.taskId===op.taskId))throw Error('A later change exists for this task. Restore is blocked.');
  const current=await assistant.notion.call('/pages/'+op.taskId);
  if(current.archived||current.in_trash)throw Error('This task is archived. Restore it in Notion first.');
  const properties={};
  for(const [field,expected]of Object.entries(op.properties)){
    if(!current.properties[field]||current.properties[field].type!==op.before[field]?.type||!equal(current.properties[field],expected))throw Error('The task changed after this operation. Nothing was restored.');
    properties[field]=writable(op.before[field]);
  }
  if(!Object.keys(properties).length)throw Error('No supported properties to restore.');
  return {state,op,current,properties};
}
export async function previewRecovery(assistant,id){
  const {op,current,properties}=await prepare(assistant,id);
  return {id:op.id,title:op.title,taskId:op.taskId,lastEdited:current.last_edited_time,fields:Object.keys(properties).map(field=>({field,current:comparable(current.properties[field]),restore:comparable(properties[field])}))};
}
export async function restoreOperation(assistant,{id,lastEdited,confirmed}){
  if(confirmed!==true)throw Error('Review and confirm the restore first.');
  const {state,op,current,properties}=await prepare(assistant,id);
  if(current.last_edited_time!==lastEdited)throw Error('The task changed since the restore preview. Review it again.');
  const recovery={id:randomUUID(),taskId:op.taskId,title:op.title,action:'restore',restores:id,at:assistant.clock().toISOString(),status:'pending verification',before:current.properties,properties};
  state.operations=[recovery,...state.operations];if(state.latest)state.latest.needsRefresh=true;await assistant.store.write(state);
  try{
    await assistant.notion.call('/pages/'+op.taskId,'PATCH',{properties});
    const verified=await assistant.notion.call('/pages/'+op.taskId);
    if(!Object.entries(properties).every(([field,value])=>verified.properties[field]&&equal(verified.properties[field],value)))throw Error('Restore verification failed');
    recovery.status='verified';op.restoredBy=recovery.id;
    if(['done','cancel'].includes(op.action)){delete state.taskDecisions?.[op.taskId];if(state.dailyGoal?.masterId===op.taskId)state.dailyGoal.completedToday=properties.Done?.checkbox===true;}
    await assistant.store.write(state);return {restored:true,verified:true};
  }catch{recovery.status='needs verification';await assistant.store.write(state);throw Error('Restore outcome needs verification. Inspect Notion; it will not be retried automatically.');}
}
