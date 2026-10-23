const zone='America/New_York';
const closed=new Set(['done','complete','completed','canceled','cancelled','archived']);
export function dayOf(value){
  if(!value)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const date=new Date(value);if(!Number.isFinite(+date))return '';
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function buildBriefing(tasks,now=new Date()){
  const today=dayOf(now),active=tasks.filter(t=>!t.done&&!closed.has((t.status||'').toLowerCase()));
  const due=t=>t.due?.start;
  const overdue=t=>due(t)&&(due(t).length===10?due(t)<today:Date.parse(due(t))<+now);
  const urgent=active.filter(t=>overdue(t)||dayOf(due(t))===today).sort((a,b)=>String(due(a)).localeCompare(String(due(b))));
  const agenda=active.flatMap(t=>{
    const dates=t.schedules?.length?t.schedules:t.scheduled?[t.scheduled]:t.doDate?[t.doDate]:[];
    return dates.filter(s=>dayOf(s.start)===today||(s.end&&dayOf(s.start)<today&&dayOf(s.end)>=today)).map(s=>({task:t,start:s.start,end:s.end}));
  }).sort((a,b)=>a.start.localeCompare(b.start));
  const waiting=active.filter(t=>(t.status||'').toLowerCase()==='waiting');
  return {today,active,urgent,agenda,waiting,isOverdue:overdue};
}
export function findTasks(tasks,query='',filter='active'){
  const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return tasks.filter(t=>{
    const inactive=t.done||closed.has((t.status||'').toLowerCase());
    if(filter==='active'&&inactive||filter==='closed'&&!inactive||filter==='waiting'&&(inactive||(t.status||'').toLowerCase()!=='waiting'))return false;
    const text=[t.title,t.status,t.category,t.priority,t.notes].join(' ').toLowerCase();
    return words.every(word=>text.includes(word));
  });
}

// A discovery view of recorded tasks, never evidence that money is owed or paid.
export function buildMoneyReview(tasks,now=new Date()){
  const today=dayOf(now);
  const limit=new Date(today+'T12:00:00Z');limit.setUTCDate(limit.getUTCDate()+30);
  const through=limit.toISOString().slice(0,10);
  const matches=findTasks(tasks).filter(t=>/\b(bills?|payments?|subscriptions?|renewals?|renew|rent|mortgage|utilities|tuition|invoices?|insurance|membership|autopay)\b/i.test(t.title||'')||/^(finance|finances|financial|bills|subscriptions)$/i.test(t.category||''));
  const groups={attention:[],upcoming:[],undated:[],later:[]};
  for(const task of matches){
    const date=dayOf(task.due?.start);
    const item={task,date};
    if(!date)groups.undated.push(item);
    else if(date<=today)groups.attention.push(item);
    else if(date<=through)groups.upcoming.push(item);
    else groups.later.push(item);
  }
  for(const list of Object.values(groups))list.sort((a,b)=>a.date.localeCompare(b.date)||(a.task.title||'').localeCompare(b.task.title||''));
  return {...groups,today,through,total:matches.length};
}
