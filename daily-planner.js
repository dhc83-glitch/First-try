import {rich} from './notion.js';
import {isActive} from './assistant.js';
import {localParts} from './audit.js';

const zone='America/New_York';
const rt=text=>String(text).match(/[\s\S]{1,1800}/g)?.map(content=>({type:'text',text:{content}}))||[];
const paragraph=text=>({object:'block',type:'paragraph',paragraph:{rich_text:rt(text)}});
const heading=text=>({object:'block',type:'heading_3',heading_3:{rich_text:rt(text)}});
const toggle=(title,text)=>({object:'block',type:'toggle',toggle:{rich_text:rt(title),children:[paragraph(text)]}});
const text=b=>rich(b[b.type]?.rich_text);
const day=value=>value?.length===10?value:value?localParts(value,zone).day:null;
const date=value=>value?.length===10?new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric'}).format(new Date(value+'T12:00:00Z')):new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const short=s=>s.length>160?s.slice(0,159)+'…':s;

// A small, owned area inside the dated callout. Existing sections stay intact.
// Previewing is read-only; installation happens in the guarded Home write.
export function planDailyPlanner(dated,report){
  const today=report.cleanup.today,now=new Date(report.finishedAt||report.startedAt||today+'T16:00:00Z');
  const held=new Set(report.cleanup.heldTaskIds||[]);
  const active=report.tasks.filter(t=>isActive(t)&&!held.has(t.id));
  const rank={ASAP:0,High:1,Normal:2,Low:3};
  const ordered=[...active].sort((a,b)=>(rank[a.priority]??2)-(rank[b.priority]??2)||(a.due?.start||'9999').localeCompare(b.due?.start||'9999')||a.title.localeCompare(b.title));
  const next=ordered.filter(t=>t.kind!=='Fixed commitment'&&t.status!=='Waiting'&&t.basis!=='Needs confirmation'&&(!t.doDate?.start||day(t.doDate.start)<=today)).slice(0,3);
  const reason=t=>t.due?.start?'Deadline '+date(t.due.start):t.priority==='ASAP'||t.priority==='High'?'High priority in your task records':'Open work · no deadline recorded';
  const nextText=next.length?next.map((t,i)=>`${i+1}. ${short(t.title)}\n${reason(t)}`).join('\n\n'):'No next action is confirmed in your current task records.';
  const commitments=active.flatMap(t=>(t.schedules||[]).filter(s=>s.start?.includes('T')&&day(s.start)===today&&Date.parse(s.end||s.start)>+now).map(s=>({t,s}))).sort((a,b)=>Date.parse(a.s.start)-Date.parse(b.s.start));
  const untimed=active.filter(t=>t.kind==='Fixed commitment'&&!(t.schedules||[]).length&&[t.scheduled?.start,t.doDate?.start].some(value=>value?.length===10&&value===today));
  const dueToday=ordered.filter(t=>day(t.due?.start)===today);
  const commitmentsText=[...commitments.map(({t,s})=>`${date(s.start)} · ${short(t.title)}`),...untimed.map(t=>`Today · time not recorded · ${short(t.title)}`),...dueToday.map(t=>`Due today${t.due.start.includes('T')?' at '+date(t.due.start):''} · ${short(t.title)}`)].join('\n')||'No remaining timed commitments or deadlines are recorded for today.';
  const weekEnd=day(new Date(+now+7*86400000).toISOString());
  const deadlines=ordered.filter(t=>t.due?.start&&day(t.due.start)<=weekEnd).sort((a,b)=>a.due.start.localeCompare(b.due.start));
  const week=deadlines.slice(0,10).map(t=>`${day(t.due.start)<today?'Overdue · ':''}${date(t.due.start)} · ${short(t.title)}`).join('\n')||'No actual deadlines are recorded in the next seven days.';
  const waiting=ordered.filter(t=>t.status==='Waiting');
  const waitingText=waiting.slice(0,8).map(t=>short(t.title)+(t.due?.start?' · deadline '+date(t.due.start):'')).join('\n')||'No tasks are currently marked Waiting.';
  const exceptions=[...(report.automatic?.exceptions||[]).filter(e=>!/^Recent email was collected\./.test(e.reason||'')),...(report.cleanup.items||[]).map(i=>({title:i.title,reason:i.type}))];
  const decisions=[...new Set(exceptions.map(e=>(e.title?e.title+' — ':'')+(e.reason||e.detail||'Needs clarification')))];
  const decisionText=decisions.slice(0,8).join('\n\n')||'No specific decisions were reported. Email interpretation is still incomplete, so this is not a complete inbox review.';
  const sources=(report.sources||[]).map(s=>`${s.name}: ${s.status}${s.count!==undefined?' · '+s.count+' items':''}`).join('\n');
  const details=`Checked ${date(now.toISOString())} · New York time\n${sources}\n\nRecent email is collected, but general email-to-task interpretation is still being built. Work times remain suggestions. External Google Calendar events are not included.\n\nThe sections below this briefing retain your detailed plans and reference material.`;
  const blocks=[heading('Your next 3'),paragraph(nextText),heading('Today’s commitments'),paragraph(commitmentsText),toggle('This week · actual deadlines',week+(deadlines.length>10?'\nMore deadlines are in Central Tasks.':'')),toggle('Waiting on others',waitingText+(waiting.length>8?'\nMore waiting tasks are in Central Tasks.':'')),toggle('Needs your input',decisionText),toggle('Refresh details',details)];
  const existing=dated.children||[],marker=existing.findIndex(b=>b.type==='heading_3'&&text(b)==='Your next 3');
  if(marker<0){
    if(existing.some(b=>b.type==='toggle'&&blocks.some(expected=>expected.type==='toggle'&&text(expected)===text(b))))throw new Error('Part of the daily planner layout was edited. Inspect it before creating another.');
    return {changes:[],append:{parentId:dated.id,lastEdited:dated.last_edited_time,children:blocks},coverage:['Daily planner']};
  }
  const managed=existing.slice(marker,marker+blocks.length),changes=[];
  for(let i=0;i<blocks.length;i++){
    const expected=blocks[i],current=managed[i];
    if(!current||current.type!==expected.type||(expected.type!=='paragraph'&&text(current)!==text(expected)))throw new Error('The daily planner layout was edited. Its structure needs inspection before updating.');
    if(expected.type==='paragraph'&&text(current)!==text(expected))changes.push({id:current.id,type:current.type,field:'rich_text',lastEdited:current.last_edited_time,before:current.paragraph.rich_text,after:expected.paragraph.rich_text,section:'Daily planner'});
    if(expected.type==='toggle'){
      const child=current.children?.[0];
      if(!child||child.type!=='paragraph'||current.children.length!==1)throw new Error('A daily planner detail section was edited. Inspect it before updating.');
      if(text(child)!==text(expected.toggle.children[0]))changes.push({id:child.id,type:'paragraph',field:'rich_text',lastEdited:child.last_edited_time,before:child.paragraph.rich_text,after:expected.toggle.children[0].paragraph.rich_text,section:'Daily planner'});
    }
  }
  return {changes,coverage:['Daily planner']};
}

export function samePlannerBlocks(actual,expected){
  return actual.length===expected.length&&actual.every((b,i)=>b.type===expected[i].type&&text(b)===text(expected[i])&&(!expected[i][b.type]?.children||samePlannerBlocks(b.children||[],expected[i][b.type].children)));
}
