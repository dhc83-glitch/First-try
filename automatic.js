import {isActive} from './assistant.js';
import {localParts} from './audit.js';
import {titleKey} from './cleanup.js';

const ignored=new Set('a an the i my me it is was were to on for of and this that already please no longer matters matter need needed does doesn t not cancel canceled cancelled complete completed finished got received grade score result add task remind'.split(' '));
export function interpretUpdate(text,tasks){
  const quoted=text.match(/["“]([^"”]+)["”]/)?.[1];
  const instruction=quoted?text.replace(/["“][^"”]+["”]/,''):text;
  let action;
  if(/[?]/.test(instruction)||/\b(should|could|might|maybe|if|do not|don['’]?t|not yet|haven['’]?t|didn['’]?t|never|will|plan to|hope to)\b/i.test(instruction))return {exception:'Saved for clarification: use a definite completed/canceled decision or Add: task title.'};
  if(/^\s*(add|create|remind me)\s*[:：]/i.test(text)){
    const title=text.replace(/^\s*(add|create|remind me)\s*[:：]\s*/i,'').trim();
    return title&&title.length<=200?{action:'create',title}:{exception:'Use Add: followed by a task title of 1–200 characters.'};
  }else if(/\b(not|never|haven['’]?t|didn['’]?t|isn['’]?t)\s+(?:been\s+)?(?:completed|finished|cancelled|canceled)\b/i.test(instruction))return {exception:'This is a negated decision. State the current action explicitly so the assistant does not reverse its meaning.'};
  else if(/\b(cancel|cancelled|canceled|no longer|not pursuing|doesn['’]?t matter)\b/i.test(instruction))action='cancel';
  else if(!/\b(will|expect|hope|plan)\b/i.test(instruction)&&(/\b(completed|finished|already did|already checked)\b/i.test(instruction)||/\b(grade|score|result)\b.*\b(is|was|received|got)\b.*\d/i.test(instruction)||/\b(got|received|scored)\b.*\d/i.test(instruction)))action='done';
  else return {exception:'This update was saved, but its action is unclear. Say cancel, completed, or give a grade/result and a task name; use Add: for a new task.'};
  let matches;
  if(quoted)matches=tasks.filter(t=>titleKey(t.title)===titleKey(quoted));
  else{
    const words=[...new Set(titleKey(text).split(' ').filter(w=>!ignored.has(w)))];
    const scored=tasks.map(t=>{const title=new Set(titleKey(t.title).split(' '));return {task:t,score:words.filter(w=>title.has(w)).length};});
    const best=Math.max(0,...scored.map(s=>s.score));
    matches=best>=2?scored.filter(s=>s.score===best).map(s=>s.task):[];
  }
  if(matches.length>1){const active=matches.filter(isActive);if(active.length===1)matches=active;}
  if(matches.length!==1)return {exception:matches.length?'More than one task matches. Put the exact task title in quotation marks.':'No unique task matched. Include its exact title in quotation marks.'};
  return {action,taskId:matches[0].id,title:matches[0].title,note:text};
}
export const isDailyGoal=t=>/^\s*apply\s+(?:to\s+)?(?:at\s+least\s+)?(?:2|two)\s+internships?(?:\s+(?:today|daily|every day|per day))?\s*[.!]?\s*$/i.test(t.title);

export function automaticCleanup(tasks,decisions={},now=new Date()){
  const today=localParts(now,'America/New_York').day,actions=[],exceptions=[];
  for(const t of tasks)if(t.done&&['To do','In progress','Waiting','Inbox'].includes(t.status))actions.push({taskId:t.id,action:'done',note:'The Done checkbox was already checked. Aligned the status and removed obsolete planned dates.'});
  for(const t of tasks.filter(isActive)){
    const remembered=decisions[t.id];
    if(remembered){
      if(isDailyGoal(t)&&remembered.action==='done'&&remembered.at&&localParts(remembered.at,'America/New_York').day<today)continue;
      if(remembered.verified)actions.push({taskId:t.id,action:remembered.action,note:'Reapplied your remembered decision: '+remembered.note});
      else exceptions.push({taskId:t.id,title:t.title,reason:'An earlier write needs verification. Inspect it before retrying.'});
      continue;
    }
    const dates=[t.due?.start,t.doDate?.start,t.scheduled?.end||t.scheduled?.start,...(t.schedules||[]).map(s=>s.end||s.start)].filter(Boolean);
    const past=dates.length&&dates.every(d=>d.length===10?d<today:Date.parse(d)<+now);
    // Only narrow event reminders qualify. Never infer an assignment, grade,
    // application, payment, or exam completion from a date.
    const reminder=/\b(class|lecture|soccer pickup|umpiring game|game reminder)\b/i.test(t.title);
    const followup=/\b(assignment|homework|quiz|exam|grade|score|result|payment|invoice|application|follow[ -]?up|confirm|reply|waiting)\b/i.test(t.title);
    const pastQuizEvent=t.kind==='Fixed commitment'&&/\b(quiz|exam|midterm|final)\b/i.test(t.title)&&!/\b(prep|study|review|practice|assignment|homework)\b/i.test(t.title);
    if(past&&(reminder&&!followup||pastQuizEvent))actions.push({taskId:t.id,action:'cancel',note:'Past dated event reminder expired and was removed from active work. Attendance, a grade, and completion of related work are not assumed. Separate study and result follow-ups remain unresolved.'});
  }
  return {actions,exceptions};
}

export const hasReportedScore=text=>/\b(?:score|grade|result)\s*(?:(?:is|was|of|known|confirmed|received|recorded)\s*){0,3}(?:by\s+[^:.\n\d]{1,60}:\s*|[:=]\s*)?\d{1,3}(?:\.\d+)?\s*(?:%|\/\s*\d{1,3})?(?=[.\s,;]|$)/i.test(text||'');

export function taskTitleCorrections(tasks){
  const corrections=[];
  for(const task of tasks){
    let title=task.title;
    if(task.done&&hasReportedScore(task.notes))title=title.replace(/score (?:awaiting capture|to capture)/i,'score recorded');
    const match=title.match(/\s+[—–-]\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i);
    if(match&&task.kind!=='Fixed commitment'&&task.doDate?.start){
      const date=task.doDate.start.length===10?task.doDate.start+'T12:00:00Z':task.doDate.start;
      const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long'}).format(new Date(date));
      if(match[1].toLowerCase()!==weekday.toLowerCase())title=title.slice(0,match.index);
    }
    if(title!==task.title)corrections.push({taskId:task.id,title});
  }
  return corrections;
}
