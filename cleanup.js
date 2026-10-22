import {createHash} from 'node:crypto';
import {isActive} from './assistant.js';
import {localParts} from './audit.js';

export const titleKey=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const routineKey=t=>!/\b(catch[ -]?up|missed)\b/i.test(t.title)&&/\bapply\b.*\b(?:2|two)\b.*\binternships?\b/i.test(t.title)?'daily-internship-applications':null;
export function cleanupReview(tasks,decisions={},now=new Date()){
  const today=localParts(now,'America/New_York').day;
  const displayDate=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(now);
  const groups=new Map(),items=[],held=new Set();
  for(const t of tasks.filter(isActive)){
    const key=routineKey(t);if(key){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
    const decision=decisions[t.id];
    if(decision){held.add(t.id);items.push({id:hash([t.id,t.lastEdited,'remembered']),taskId:t.id,title:t.title,lastEdited:t.lastEdited,type:'Remembered decision conflicts with active task',evidence:[`You previously chose ${decision.action} for this exact task.`,decision.note||'No extra note.'],suggestedAction:decision.action});continue;}
    const evidence=[];let type,suggestedAction='done';
    const dated=[t.due?.start,t.doDate?.start,t.scheduled?.end||t.scheduled?.start].filter(Boolean);
    const past=dated.length&&dated.every(d=>d.length===10?d<today:Date.parse(d)<+now);
    if(/\b(cancelled|canceled|no longer needed|no longer relevant|not pursuing)\b/i.test(t.notes)){
      type='Cancellation mentioned in task notes';suggestedAction='cancel';evidence.push('The existing task notes mention cancellation. Verify what was canceled before applying this.');
    }else if(past&&(/\b(umpir\w*|game reminder|confirm.*game)\b/i.test(t.title)||t.kind==='Fixed commitment')){
      type='Past event still active';evidence.push('All recorded dates for this task are in the past.','A past date does not prove attendance or completion; review any remaining follow-up.');
    }else if(past&&/\b(exam|midterm|quiz|final)\b/i.test(t.title)&&!/\b(prep|prepare|preparation|preparing|study|studying|review|practice)\b/i.test(t.title)){
      type='Past exam or grade follow-up';evidence.push('This exam-related item has only past dates.','Retain the result in history. If a grade is still missing, keep that specific follow-up open.');
    }else if(/\b(check|confirm|find|view)\b.*\b(grade|result|score)\b/i.test(t.title)){
      type='Check whether the result is already known';evidence.push('Confirm whether you already received this result. The app cannot infer a grade from an old date.');
    }
    if(type)items.push({id:hash([t.id,t.lastEdited,type]),taskId:t.id,title:t.title,lastEdited:t.lastEdited,type,evidence,suggestedAction});
  }
  const routines=[];
  for(const [key,members]of groups){
    members.sort((a,b)=>(b.doDate?.start||'').localeCompare(a.doDate?.start||'')||a.id.localeCompare(b.id));
    const keeper=members.find(t=>t.doDate?.start?.slice(0,10)===today)||members[0];
    routines.push({key,label:'Daily internship application goal',keeperId:keeper.id,members:members.map(t=>({id:t.id,title:t.title,doDate:t.doDate?.start||null})),detail:'One candidate is kept in the draft work plan. Other copies are held for review, not deleted. A routine is not evidence that today’s applications are finished.'});
    for(const t of members)if(t.id!==keeper.id){held.add(t.id);if(!items.some(i=>i.taskId===t.id))items.push({id:hash([t.id,t.lastEdited,key]),taskId:t.id,title:t.title,lastEdited:t.lastEdited,type:'Repeated daily routine',evidence:['This task repeats the daily internship goal.',`Draft keeper: ${keeper.title}. Confirm this is not separate catch-up work before canceling it.`],suggestedAction:'cancel'});}
  }
  return {today,displayDate,items,routines,heldTaskIds:[...held],remembered:Object.entries(decisions).map(([taskId,d])=>({taskId,...d})),notice:'Refresh closes narrow past event reminders and applies saved decisions automatically. Past assignments and grade outcomes remain unresolved without evidence. Expiring a past fixed event only retires its calendar reminder; it does not assert attendance or a result. Remaining items may need clarification.'};
}
export function matchingDecisions(subject,decisions={}){
  const key=titleKey(subject);return Object.entries(decisions).filter(([,d])=>titleKey(d.title)===key).map(([taskId,d])=>({taskId,title:d.title,action:d.action,note:d.note}));
}
