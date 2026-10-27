import {dayOf} from './briefing.js';
// Shared planning rules used by the server, browser and Notion projections.
export const closedStatus=s=>['done','complete','completed','canceled','cancelled','archived'].includes(String(s||'').toLowerCase());
export const activeTask=t=>!t.done&&!closedStatus(t.status);
const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export function reconcileTasks(tasks,decisions=[]){
  return tasks.map(t=>{
    const matching=decisions.filter(d=>d.verified!==false&&(d.taskId===t.id||!d.taskId&&normalized(d.title)===normalized(t.title)));
    const last=matching.at(-1);if(!last||!['done','cancel'].includes(last.action))return t;
    // Text-only corrections apply only to a unique exact title, never fuzzy matches.
    if(!last.taskId&&tasks.filter(other=>normalized(other.title)===normalized(t.title)).length!==1)return t;
    return {...t,status:last.action==='done'?'Done':'Canceled',done:last.action==='done',correction:last.origin||'remembered decision'};
  });
}
export function rankedActions(report,today){
  const held=new Set(report?.cleanup?.heldTaskIds||[]),blocked=new Set((report?.issues||[]).filter(i=>['Different schedule fields','Completion mismatch','Overlap','Invalid schedule'].includes(i.type)).flatMap(i=>[i.taskId,...(i.related||[])]));
  const day=dayOf,rank={ASAP:0,High:1,Normal:2,Low:3};
  const score=t=>t.due?.start&&day(t.due.start)<=today?0:day(t.doDate?.start)===today?1:2;
  return [...(report?.tasks||[]),...(report?.organizerTasks||[])].filter(t=>activeTask(t)&&!held.has(t.id)&&!blocked.has(t.id)&&t.kind!=='Fixed commitment'&&String(t.status).toLowerCase()!=='waiting'&&t.basis!=='Needs confirmation'&&(!t.doDate?.start||day(t.doDate.start)<=today)&&!(t.schedules||[]).some(s=>day(s.start)>today)).sort((a,b)=>score(a)-score(b)||(rank[a.priority]??2)-(rank[b.priority]??2)||(a.due?.start||'9999').localeCompare(b.due?.start||'9999')||String(a.id).localeCompare(String(b.id)));
}
export function localTasks(organizer){
  return (organizer?.items||[]).map(i=>({id:'local:'+i.id,localId:i.id,title:i.title,status:i.closed?'Done':i.kind==='followup'?'Waiting':'To do',done:!!i.closed,kind:i.kind==='appointment'?'Preparation':i.kind==='followup'?'Follow-up':'Task',basis:'Confirmed',category:'Personal',notes:i.notes||'',doDate:i.due?{start:i.due}:null,due:null,scheduled:null,schedules:[],origin:'local organizer',effort:30}));
}
export function homeDecisions(blocks){
  const text=b=>(b[b.type]?.rich_text||[]).map(p=>p.plain_text||p.text?.content||'').join('');const found=[];
  function walk(rows,inFacts=false){for(const b of rows){if(['child_page','child_database','synced_block'].includes(b.type)||/reference lists.*previous layouts|archived snapshots/i.test(text(b)))continue;const facts=inFacts||/^(your updates|remembered decisions)$/i.test(text(b).trim());if(inFacts){const m=text(b).match(/^(.+?)\s+[—–]\s+(completed|canceled|cancelled|no longer pursuing)\b/i);if(m)found.push({title:m[1],action:m[2].toLowerCase()==='completed'?'done':'cancel',verified:true,origin:'your Notion updates'});}if(b.children)walk(b.children,facts);}}walk(blocks);return found;
}
