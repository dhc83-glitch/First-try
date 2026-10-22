import {createHash} from 'node:crypto';
import {rich,value} from './notion.js';
import {audit,localParts,defaults} from './audit.js';

const labels = ['Done','Complete','Completed','Canceled','Cancelled','Archived'];
export const isActive = t => !t.done && !labels.some(s=>s.toLowerCase()===t.status.toLowerCase());
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateValue = (p,name) => p[name]?.type==='date'?p[name].date:null;
export function normalizeCentral(page){
  const p=page.properties, start=dateValue(p,'Start'),finish=dateValue(p,'Finish by');
  const planned=start?{...start,end:start.end||finish?.start||null}:null;
  const raw=[['Commitment time',dateValue(p,'Commitment time')],['Start / Finish by',planned],['On calendar',dateValue(p,'On calendar')]];
  const timed=raw.filter(([,d])=>d?.start?.includes('T'));
  const unique=new Map();
  for(const [field,date] of timed){const key=JSON.stringify([Date.parse(date.start),date.end?Date.parse(date.end):null]);if(!unique.has(key))unique.set(key,{field,...date});}
  const schedules=[...unique.values()];
  const get=name=>value(p[name]);
  return {id:page.id,url:page.url,lastEdited:page.last_edited_time,title:get('Task name')||'Untitled task',status:get('Status'),done:p.Done?.checkbox===true,category:get('Area'),priority:get('Priority'),notes:get('Next action'),kind:get('Kind'),basis:get('Record basis'),effort:p['Effort minutes']?.number||null,due:dateValue(p,'Due date'),doDate:dateValue(p,'Do date'),scheduled:schedules[0]||raw.find(([,d])=>d)?.[1]||dateValue(p,'Do date'),schedules};
}
export function auditCentral(tasks,now=new Date()){
  const options={...defaults,discretionary:['Personal','Leisure']};
  const canonical=tasks.map(t=>({...t,status:t.done?'Done':t.status}));
  // The regular audit covers deadlines, completion, duplicates and primary dates.
  const issues=audit(canonical,options,now).filter(i=>!['Overlap','Blocked time','Late discretionary work','Completed but scheduled'].includes(i.type));
  const expanded=canonical.flatMap(t=>(t.schedules.length?t.schedules:[t.scheduled]).filter(Boolean).map((s,i)=>({...t,id:`${t.id}:${i}`,scheduled:s})));
  const lookup=new Map(expanded.map(t=>[t.id,t]));
  const seen=new Set();
  for(const issue of audit(expanded,options,now).filter(i=>['Overlap','Blocked time','Late discretionary work','Completed but scheduled'].includes(i.type))){
    const t=lookup.get(issue.taskId),taskId=t.id.split(':')[0];
    const related=issue.related.map(id=>id.split(':')[0]);
    if(related.includes(taskId))continue;
    const key=issue.type+':'+[taskId,...related].sort().join(':');if(seen.has(key))continue;seen.add(key);
    issues.push({...issue,taskId,related,detail:issue.detail+(t.kind==='Fixed commitment'?' This is a fixed commitment; review an exception rather than moving it automatically.':'')});
  }
  const today=localParts(now,'America/New_York').day;
  for(const t of tasks){
    const add=(type,detail)=>issues.push({type,taskId:t.id,title:t.title,detail,related:[]});
    if(t.done!==['Done','Complete','Completed'].some(x=>x.toLowerCase()===t.status.toLowerCase()))add('Completion mismatch','The Done checkbox and Status disagree. Confirm whether this task is finished.');
    if(t.schedules.length>1)add('Different schedule fields','This task has different times in its schedule columns. All of those times were checked; review which is current.');
    if(isActive(t)&&t.kind!=='Fixed commitment'&&t.scheduled?.start&&(t.scheduled.start.length===10?t.scheduled.start<today:new Date(t.scheduled.end||t.scheduled.start)<now))add('Past planned time','The planned work time has passed, but this task is still active. This does not mean its actual deadline has passed.');
  }
  return issues;
}

export function changesSince(previous,tasks){
  if(!previous)return {firstRun:true,added:[],changed:[],missing:[]};
  const before=new Map(previous.map(t=>[t.id,t])),after=new Map(tasks.map(t=>[t.id,t]));
  const content=t=>({...t,lastEdited:undefined});
  return {firstRun:false,added:tasks.filter(t=>!before.has(t.id)).map(t=>({id:t.id,title:t.title})),changed:tasks.filter(t=>before.has(t.id)&&fingerprint(content(before.get(t.id)))!==fingerprint(content(t))).map(t=>({id:t.id,title:t.title})),missing:previous.filter(t=>!after.has(t.id)).map(t=>({id:t.id,title:t.title}))};
}

export function buildPlan(tasks,now=new Date()){
  const zone='America/New_York', horizon=+now+7*86400000;
  const today=localParts(now,zone).day;
  const occupied=[];
  for(const t of tasks.filter(isActive))for(const s of t.schedules){
    if(!s.start?.includes('T'))continue;
    const start=Date.parse(s.start),end=s.end?Date.parse(s.end):start+(t.effort||60)*60000;
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)occupied.push({start,end});
  }
  const dueMs=t=>t.due?.start?(t.due.start.length===10?Date.parse(t.due.start+'T23:59:59'+offsetForDay(t.due.start)):Date.parse(t.due.start)):Infinity;
  const priorities={ASAP:0,High:1,Normal:2,Low:3};
  const active=tasks.filter(isActive);
  const upcoming=active.filter(t=>t.due?.start&&dueMs(t)<=horizon).sort((a,b)=>dueMs(a)-dueMs(b)).map(t=>({taskId:t.id,title:t.title,due:t.due.start,overdue:dueMs(t)<+now}));
  const fixed=active.filter(t=>t.kind==='Fixed commitment');
  const proposals=[],unplaced=[];
  const candidates=active.filter(t=>t.kind!=='Fixed commitment').sort((a,b)=>(priorities[a.priority]??2)-(priorities[b.priority]??2)||dueMs(a)-dueMs(b)||a.id.localeCompare(b.id));
  for(const t of candidates){
    if(t.status==='Waiting'){unplaced.push({taskId:t.id,title:t.title,reason:'Waiting for someone or something; no automatic time suggestion.'});continue;}
    if(t.basis==='Needs confirmation'){unplaced.push({taskId:t.id,title:t.title,reason:'Confirm this task before planning it.'});continue;}
    if(t.schedules.length>1){unplaced.push({taskId:t.id,title:t.title,reason:'Resolve the differing schedule columns first.'});continue;}
    if(t.schedules.some(s=>Date.parse(s.end||s.start)>+now))continue;
    if(t.doDate?.start?.slice(0,10)>localParts(horizon,zone).day)continue;
    const duration=t.effort||60;
    if(!Number.isFinite(duration)||duration<=0||duration>240){unplaced.push({taskId:t.id,title:t.title,reason:'Break this task into blocks of four hours or less.'});continue;}
    let found;
    for(let start=Math.ceil(+now/900000)*900000;start+duration*60000<=horizon;start+=900000){
      const end=start+duration*60000,p=localParts(start,zone),q=localParts(end-1,zone);
      const earliest=t.doDate?.start?.slice(0,10)||today;
      if(p.day<earliest||p.day!==q.day||p.minute<570||q.minute>=1320)continue;
      if(end>dueMs(t))continue;
      // An all-day commitment prevents a safe time suggestion on that day.
      if(fixed.some(f=>f.scheduled?.start?.length===10&&f.scheduled.start===p.day))continue;
      if(occupied.some(s=>start<s.end&&end>s.start))continue;
      found={start:new Date(start).toISOString(),end:new Date(end).toISOString()};occupied.push({start,end});break;
    }
    if(found)proposals.push({id:fingerprint([t.id,t.lastEdited,found]),taskId:t.id,title:t.title,lastEdited:t.lastEdited,...found,duration,assumedDuration:!t.effort,reason:`${t.priority||'Normal'} priority; ${t.effort?'uses your effort estimate':'assumes 60 minutes'}. Keeps fixed commitments and your protected hours free.`});
    else unplaced.push({taskId:t.id,title:t.title,reason:'No safe slot before the deadline in the next seven days. Review the deadline, duration, or capacity.'});
  }
  return {upcoming,proposals,unplaced,horizon:new Date(horizon).toISOString(),assumptions:['Refresh can apply supported work-time suggestions when source checks and decisions are complete. Unreconciled email leaves times as suggestions.','Planning hours are 9:30 AM–10 PM New York time on all days.','Only Central Tasks commitments are checked; external calendars and inboxes are not connected.','Existing future times are retained, even when the audit flags a conflict. Review those issues separately.','Tasks without effort estimates use 60 minutes. Date-only fixed commitments reserve the whole day.']};
}
function offsetForDay(day){
  const instant=new Date(day+'T12:00:00Z');
  const name=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(instant).find(p=>p.type==='timeZoneName').value;
  return name.includes('-4')?'-04:00':'-05:00';
}

export async function readCentral(notion,sourceId){
  let source;
  if(sourceId)source=await notion.source(sourceId);
  else {
    const found=(await notion.discover()).filter(s=>s.title.toLowerCase()==='central tasks');
    if(found.length!==1)throw new Error('Choose the original Central Tasks database first; no unique match was found.');
    source=await notion.call(`/data_sources/${found[0].id}`);
  }
  const required={'Task name':'title','Status':'select','On calendar':'date'};
  for(const [name,type]of Object.entries(required))if(source.properties[name]?.type!==type)throw new Error(`Central Tasks column changed: expected ${name} (${type}). Refresh stopped instead of guessing.`);
  const optional={'Done':'checkbox','Due date':'date','Start':'date','Finish by':'date','Commitment time':'date','Do date':'date','Area':'select','Priority':'select','Kind':'select','Next action':'rich_text','Effort minutes':'number','Record basis':'select'};
  const missing=Object.entries(optional).filter(([name,type])=>source.properties[name]?.type!==type).map(([name])=>name);
  const pages=await notion.all(`/data_sources/${source.id}/query`,{});
  return {sourceId:source.id,tasks:pages.filter(p=>!p.archived&&!p.in_trash).map(normalizeCentral),warnings:missing.map(name=>`Column unavailable or incompatible: ${name}. Related checks may be incomplete.`)};
}
