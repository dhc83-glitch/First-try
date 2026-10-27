import {rankedActions} from './task-state.js';
import {dayOf,findTasks} from './briefing.js';
export function shiftDay(day,amount){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
function remainingCapacity(tasks,now){
  const today=dayOf(now),name=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(new Date(today+'T16:00:00Z')).find(p=>p.type==='timeZoneName').value;
  const offset=name.includes('-4')?'-04:00':'-05:00',start=Math.max(+now,Date.parse(today+'T09:30:00'+offset)),end=Date.parse(today+'T22:00:00'+offset);
  if(start>=end)return 0;
  const intervals=[];
  for(const t of findTasks(tasks))for(const s of t.schedules?.length?t.schedules:t.scheduled?[t.scheduled]:[]){
    if(s.start?.length===10){if(t.kind==='Fixed commitment'&&s.start<=today&&(s.end||s.start)>=today)return 0;continue;}
    const a=Math.max(start,Date.parse(s.start)),b=Math.min(end,s.end?Date.parse(s.end):Date.parse(s.start)+(t.effort||60)*60000);
    if(a<b)intervals.push([a,b]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);let occupied=0,last=start;
  for(const [a,b]of intervals){occupied+=Math.max(0,b-Math.max(last,a));last=Math.max(last,b);}
  return Math.max(0,Math.min(120,Math.floor((end-start-occupied)/60000)));
}
export function dailyPriorities(report,now=new Date()){
  const today=dayOf(now),rank={ASAP:0,High:1,Normal:2,Low:3},capacity=remainingCapacity(report?.tasks||[],now);
  const active=rankedActions(report,today);
  const score=t=>dayOf(t.due?.start)&&dayOf(t.due.start)<=today?0:dayOf(t.doDate?.start)===today?1:2;
  let minutes=0;const chosen=[];
  for(const task of active){const effort=task.effort||60;if(!Number.isFinite(effort)||effort<1||effort>120||minutes+effort>capacity)continue;chosen.push({task,minutes:effort,reason:score(task)===0?'Deadline today or overdue':score(task)===1?'Planned for today':(task.priority||'Normal')+' priority'});minutes+=effort;if(chosen.length===3)break;}
  return {items:chosen,minutes,capacity};
}
export function weeklyReview(report,operations=[],organizer={items:[],history:[]},now=new Date()){
  const today=dayOf(now),since=shiftDay(today,-6),through=shiftDay(today,7),active=findTasks(report?.tasks||[]);
  const completions=new Map();
  for(const op of operations)if(op.status==='verified'&&op.action==='done'&&dayOf(op.at)>=since&&dayOf(op.at)<=today&&!op.restoredBy)completions.set(op.taskId,{title:op.title,at:op.at,source:'Notion completion recorded by this app'});
  const localCompletions=organizer.completions||(organizer.history||[]).filter(h=>h.action==='complete'&&!organizer.history.some(r=>r.action==='restore'&&r.undoneId===h.id));
  for(const h of localCompletions)if(dayOf(h.at)>=since&&dayOf(h.at)<=today)completions.set(h.id,{title:h.title,at:h.at,source:'Local reminder completed'});
  return {since,through,completed:[...completions.values()],overdue:active.filter(t=>t.due?.start&&(t.due.start.length===10?t.due.start<today:Date.parse(t.due.start)<+now)),upcoming:active.filter(t=>dayOf(t.due?.start)>today&&dayOf(t.due.start)<=through).sort((a,b)=>a.due.start.localeCompare(b.due.start)),waiting:active.filter(t=>t.status==='Waiting'),decisions:report?.plan?.unplaced||[]};
}
export function refreshSummary(state){
  const report=state.latest,a=report?.automatic;
  const verified=a?['closedReminders','appliedUpdates','scheduled','dailyGoalUpdates','emailCompletions','renamedTasks'].reduce((sum,k)=>sum+(a[k]||0),0):0;
  return {verified,checked:(report?.sources||[]).filter(s=>!s.optional&&s.status==='checked').length,missing:(report?.sources||[]).filter(s=>!s.optional&&s.status!=='checked'),exceptions:a?.exceptions||[],changed:report?.changes?.changed?.length||0,added:report?.changes?.added?.length||0,unverified:(state.operations||[]).filter(o=>o.status!=='verified').length};
}
