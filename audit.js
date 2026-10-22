export const defaults = { timezone: 'America/New_York', completed: ['Done', 'Complete', 'Completed'], inactive: ['Cancelled', 'Canceled', 'Archived'], discretionary: ['Discretionary', 'Personal', 'Optional'], duration: 60 };
const formatters=new Map();
export function localParts(date, timezone) {
  if(!formatters.has(timezone))formatters.set(timezone,new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  const p = Object.fromEntries(formatters.get(timezone).formatToParts(new Date(date)).map(p=>[p.type,p.value]));
  return {day:`${p.year}-${p.month}-${p.day}`, weekday:p.weekday, minute:+p.hour*60 + +p.minute};
}
const norm = s => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export function similar(a,b) {
  a=norm(a); b=norm(b); if (!a || !b) return false; if(a===b) return true;
  // Chapter, exam-part, and dated recurring tasks can share most words legitimately.
  if(JSON.stringify(a.match(/\d+/g)||[])!==JSON.stringify(b.match(/\d+/g)||[]))return false;
  const x=new Set(a.split(' ')), y=new Set(b.split(' '));
  return x.size>=3 && y.size>=3 && [...x].filter(v=>y.has(v)).length / new Set([...x,...y]).size >= .75;
}
export function audit(tasks, options={}, now=new Date()) {
  const c={...defaults,...options}; const today=localParts(now,c.timezone).day; const issues=[];
  const matches=(arr,s)=>arr.some(v=>v.toLowerCase()===String(s).toLowerCase());
  const done=t=>matches(c.completed,t.status); const active=t=>!done(t)&&!matches(c.inactive,t.status);
  const add=(type,t,detail,related=[])=>issues.push({type,taskId:t.id,title:t.title,detail,related});
  const spans=new Map();
  for(const t of tasks){
    if(t.due?.start && active(t) && (t.due.start.length===10?t.due.start<today:new Date(t.due.start)<now)) add('Overdue',t,'Due date has passed and the task is still active.');
    const s=t.scheduled?.start;
    if(!s) continue;
    if(done(t) && (s.length===10?s>today:new Date(s)>now)) add('Completed but scheduled',t,'Completed task is still scheduled in the future.');
    if(!active(t)) continue;
    if(s.length===10){add('Missing time',t,'Schedule has a date but no time; conflict checks need a time.');continue;}
    const start=new Date(s), end=t.scheduled.end?new Date(t.scheduled.end):new Date(+start+(t.effort||c.duration)*60000);
    if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start){add('Invalid schedule',t,'Schedule end must be after its start.');continue;}
    spans.set(t.id,{start,end}); const discretionary=String(t.category).split(',').some(v=>matches(c.discretionary,v.trim()));
    let blocked=+end-+start>=8*86400000,late=blocked&&discretionary;
    // Inspect the entire interval, including cross-midnight and DST transitions.
    for(let ms=+start;ms<+end&&ms<+start+8*86400000;ms=Math.floor(ms/60000)*60000+60000){
      const p=localParts(ms,c.timezone);
      if(!['Sat','Sun'].includes(p.weekday)&&p.minute>=360&&p.minute<570) blocked=true;
      if(p.minute>=1320 && discretionary) late=true;
      if(blocked&&late) break;
    }
    if(blocked) add('Blocked time',t,'Overlaps your Monday–Friday 6:00–9:30 AM blocked time.');
    if(late) add('Late discretionary work',t,'Discretionary work overlaps time after 10:00 PM.');
  }
  for(let i=0;i<tasks.length;i++) for(let j=i+1;j<tasks.length;j++){
    const a=tasks[i],b=tasks[j];
    if(active(a)&&active(b)&&similar(a.title,b.title)) add('Possible duplicate',a,`Similar title: ${b.title}`,[b.id]);
    const x=spans.get(a.id),y=spans.get(b.id);
    if(x&&y&&x.start<y.end&&y.start<x.end) add('Overlap',a,`Overlaps: ${b.title}`,[b.id]);
  }
  return issues;
}
