import {rich} from './notion.js';
import {isActive} from './assistant.js';
import {localParts} from './audit.js';
import {hasReportedScore} from './automatic.js';

const zone='America/New_York';
const key=s=>String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export const homeText=b=>rich(b[b.type]?.rich_text);
export const homeValue=(b,field='rich_text')=>b[b.type]?.[field];
export const homeValueEqual=(a,b,field='rich_text')=>field==='cells'?a?.length===b?.length&&a.every((c,i)=>rich(c)===rich(b[i])):rich(a)===rich(b);
export const homeRich=text=>String(text).match(/[\s\S]{1,1800}/g)?.map(content=>({type:'text',text:{content}}))||[];
const shortened=(text,n=300)=>text.length>n?text.slice(0,n-1)+'…':text;
const stamp=value=>!value?'':value.length===10?value:new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const dayOf=value=>value?.length===10?value: value?localParts(value,zone).day:null;
const textTasks=(tasks,limit=5)=>tasks.slice(0,limit).map(t=>t.title+(t.status==='Waiting'?' [waiting]':'')).join(' → ')+(tasks.length>limit?` (+${tasks.length-limit} more in task list)`:'');
const isArchive=b=>/reference lists.*previous layouts|previous layouts|archived snapshots/i.test(homeText(b));

// Stay on this dashboard. Child pages/databases and preserved reference layouts
// are independent sources, not recursively editable portions of Home.
export async function readHomeTree(notion,pageId){
  let count=0;const visited=new Set();
  async function load(id,depth){
    if(depth>10||visited.has(id))throw new Error('Home structure is too deep or cyclic; no changes were prepared.');
    visited.add(id);let cursor,rows=[];
    do{const result=await notion.call('/blocks/'+id+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));rows.push(...result.results);cursor=result.has_more?result.next_cursor:null;}while(cursor);
    count+=rows.length;if(count>800)throw new Error('Home exceeds the supported dashboard size; no changes were prepared.');
    for(const b of rows)if(b.has_children&&!['child_page','child_database','synced_block'].includes(b.type)&&!isArchive(b))b.children=await load(b.id,depth+1);
    return rows;
  }
  return load(pageId,0);
}

export function planHomeContent(blocks,report){
  const now=new Date(report.finishedAt||report.startedAt||report.cleanup.today+'T16:00:00Z');
  const today=report.cleanup.today,weekday=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long'}).format(now);
  const held=new Set(report.cleanup.heldTaskIds||[]);
  const active=report.tasks.filter(t=>isActive(t)&&!held.has(t.id));
  const priority={ASAP:0,High:1,Normal:2,Low:3};
  const rank=(a,b)=>(priority[a.priority]??2)-(priority[b.priority]??2)||(a.due?.start||'9999').localeCompare(b.due?.start||'9999')||a.title.localeCompare(b.title);
  const eligible=active.filter(t=>t.kind!=='Fixed commitment'&&t.status!=='Waiting'&&t.basis!=='Needs confirmation'&&(!t.doDate?.start||dayOf(t.doDate.start)<=today)).sort(rank);
  const timed=active.flatMap(t=>(t.schedules||[]).map(s=>({task:t,start:s.start,end:s.end||s.start}))).filter(s=>s.start?.includes('T')&&dayOf(s.start)===today&&Date.parse(s.end)>+now).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  const upcoming=active.filter(t=>[t.due?.start,t.doDate?.start,...(t.schedules||[]).map(s=>s.start)].some(d=>d&&dayOf(d)>=today&&dayOf(d)<=dayOf(new Date(+now+7*86400000).toISOString()))).sort(rank);
  const followups=active.filter(t=>/^(reply|confirm|review|check|follow[ -]?up|wait|await)\b/i.test(t.title)||t.status==='Waiting').sort(rank);
  const done=report.tasks.filter(t=>!isActive(t));
  const sources=(report.sources||[]).filter(s=>!s.optional).map(s=>`${s.name}: ${s.status}`).join('; ');
  const next=`${weekday} priority order · ${report.cleanup.displayDate} · New York time. ${eligible.length?textTasks(eligible):'No immediately actionable unscheduled work is confirmed in the current task records.'} ${timed.length?'Remaining recorded times: '+timed.map(s=>stamp(s.start)+' '+s.task.title).join('; ')+'.':'No remaining timed commitments are recorded for today.'} Actual deadlines remain separate from planned work times. Collected email has not yet been fully reconciled.`;
  const focus=`Current open priorities: ${eligible.length?textTasks(eligible):'none confirmed for today'}. Coming up: ${upcoming.length?textTasks(upcoming):'no dated active items recorded in the next seven days'}. Completed and canceled tasks are excluded. Undated work is not automatically due today.`;
  const execution=`${weekday} · remaining recorded schedule: ${timed.length?timed.map(s=>stamp(s.start)+(s.end!==s.start?'–'+new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(s.end)):'')+' '+s.task.title).join(' → '):'no remaining timed blocks recorded'}. Open work without a current time: ${eligible.length?textTasks(eligible):'none confirmed'}. Weekdays 6:00–9:30 AM remain protected; discretionary work ends by 10 PM. Past work windows do not prove completion or reserve time today.`;
  // User-maintained decisions live in Home, not in code or an email prompt.
  const facts=[];
  function collectFacts(rows){for(const b of rows){if(isArchive(b)||['child_page','child_database'].includes(b.type))continue;if(['your updates','remembered decisions'].includes(key(homeText(b))))for(const c of b.children||[]){const match=homeText(c).match(/^(.+?)\s+[—–]\s+(canceled|cancelled|no longer pursuing|completed|known result)\b[.:]?\s*(.*)$/i);if(match)facts.push({topic:match[1],state:match[2],detail:match[3],statement:homeText(c)});}if(b.children)collectFacts(b.children);}}
  collectFacts(blocks);
  const changes=[],coverage=[],warnings=[];let summaryFound=false;
  const change=(b,text,section)=>{
    if(!b[b.type]?.rich_text)return;
    const after=homeRich(text);if(homeValueEqual(homeValue(b),after))return;
    changes.push({id:b.id,type:b.type,field:'rich_text',lastEdited:b.last_edited_time,before:homeValue(b),after,section});coverage.push(section);
  };
  const cells=(b,texts,section)=>{const after=texts.map(homeRich);if(homeValueEqual(b.table_row.cells,after,'cells'))return;changes.push({id:b.id,type:b.type,field:'cells',lastEdited:b.last_edited_time,before:b.table_row.cells,after,section});coverage.push(section);};
  const monday=new Date(today+'T12:00:00Z');monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(+monday+i*86400000);return d.toISOString().slice(0,10);});
  const dayLabel=d=>new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'short',day:'numeric'}).format(new Date(d+'T12:00:00Z'));
  const forDay=(tasks,d)=>tasks.filter(t=>[t.doDate?.start,t.due?.start,...(t.schedules||[]).map(s=>s.start)].some(value=>dayOf(value)===d));
  function walk(rows,context={}){
    let section=context.section||'';
    for(const b of rows){
      const text=homeText(b),name=key(text);if(isArchive(b)||['child_page','child_database','synced_block'].includes(b.type))continue;
      if(b.type.startsWith('heading_'))section=name;
      const ctx={...context,section};
      if(b.type==='callout'&&/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text)&&!context.section&&!summaryFound&&!/execution order/i.test(text)){
        change(b,report.cleanup.displayDate+' · task review','Home date');
        const summary=b.children?.find(c=>c.type==='paragraph');
        if(summary){summaryFound=true;change(summary,`${report.cleanup.displayDate}. ${active.length} active tasks; ${done.length} completed/canceled records retained. ${eligible.length} tasks can be considered today; ${followups.filter(t=>t.status==='Waiting').length} follow-ups are waiting. Source checks: ${sources}. The sections below reflect saved Notion tasks. Email interpretation and fresh sports/news verification are still incomplete.`,'Home summary');}
      }
      if(b.type==='paragraph'&&section==='do this next')change(b,next,'Do this next');
      if(b.type==='callout'&&name==='this week s priority'){for(const c of b.children||[])if(c.type==='paragraph')change(c,focus,'This week’s priority');}
      if(b.type==='callout'&&/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today).*execution order$/.test(name)){
        change(b,weekday+' execution order','Execution heading');for(const c of b.children||[])if(c.type==='paragraph')change(c,execution,'Execution plan');
      }
      if(b.type==='table'&&b.children?.[0]?.type==='table_row'){
        const header=b.children[0].table_row.cells.map(rich).join(' | ');
        if(/^Day \| (Confirmed schedule \| Preparation & reminders|Recorded commitments \/ history \| Open work \/ actual deadlines)$/.test(header)&&b.children.length===8){
          cells(b.children[0],['Day','Recorded commitments / history','Open work / actual deadlines'],'Weekly schedule');
          for(let i=0;i<7;i++){
            const d=weekDays[i],past=d<today,dated=forDay(past?report.tasks:active,d);
            const fixed=dated.filter(t=>t.kind==='Fixed commitment');
            const open=dated.filter(t=>t.kind!=='Fixed commitment');
            cells(b.children[i+1],[dayLabel(d)+(d===today?' · TODAY':past?' · history':''),fixed.length?fixed.map(t=>t.title+' ['+(isActive(t)?past?'past event; completion not assumed':t.status:t.status)+']').join('; '):'No fixed commitment recorded',open.length?open.map(t=>t.title+' ['+t.status+']'+(t.due?.start?' · deadline '+stamp(t.due.start):'')).join('; '):'No dated work recorded'],'Weekly schedule');
          }
        }
        if(/^Priority \| (Email → what to do|Open follow-up in Notion) \| Timing$/.test(header)){
          cells(b.children[0],['Priority','Open follow-up in Notion','Timing'],'Open follow-ups');
          b.children.slice(1).forEach((row,i)=>{const t=followups[i];cells(row,t?[String(i+1)+' · '+(t.category||'Task'),t.title+' ['+t.status+']'+(t.notes?' — '+shortened(t.notes,350):''),t.due?.start?'Actual deadline: '+stamp(t.due.start):t.doDate?.start?'Planned day: '+stamp(t.doDate.start):'No actual deadline recorded']:['—','No additional confirmed follow-up in this slot','—'],'Open follow-ups');});
        }
      }
      if(context.toggle?.includes('full weekly schedule')&&b.type.startsWith('heading_')&&/schedule.*reminders/.test(name))change(b,dayLabel(weekDays[0])+'–'+dayLabel(weekDays[6])+' · schedule & reminders','Weekly date range');
      if(b.type==='paragraph'&&/^Coverage:/.test(text))change(b,`Coverage as of ${report.cleanup.displayDate}: ${sources}. These follow-ups come from current Notion task records. Newly collected email is not yet automatically reconciled; do not treat this table as a completed inbox review.`,'Inbox coverage');
      if(b.type==='paragraph'&&section==='school'){
        const topic=key(text.split(':')[0]).split(' ').filter(w=>w.length>2||/^\d+$/.test(w));
        const matches=done.filter(t=>topic.length>=2&&topic.filter(w=>key(t.title).split(' ').includes(w)).length>=Math.min(3,topic.length));
        const known=matches.find(t=>hasReportedScore(t.notes));
        if(known)change(b,known.title.replace(/score (?:awaiting capture|to capture)/i,'score recorded')+' — '+known.notes,'School results');
        else if(/^(Next |Upcoming school work:)/i.test(text))change(b,'Upcoming school work: '+(textTasks(upcoming.filter(t=>t.category==='School'),8)||'no dated active school work recorded')+'. Past quizzes are not next-up work; unresolved grade follow-ups remain separate.','School deadlines');
        else if(/Review its errors before|Current grade follow-ups:/i.test(text))change(b,text.split(/\. Quiz |\. Current grade follow-ups:/)[0]+'. Current grade follow-ups: '+(textTasks(active.filter(t=>t.category==='School'&&t.status==='Waiting'&&/\b(grade|quiz|result)\b/i.test(t.title)))||'none recorded')+'.','School results');
      }
      if(b.type==='paragraph'&&section==='reading downtime'&&/so (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) is not overloaded|Open reading work:/i.test(text))change(b,text.split(/Monday’s|Tuesday’s|Wednesday’s|Thursday’s|Friday’s|Saturday’s|Sunday’s|Open reading work:/)[0].trim()+' Open reading work: '+(textTasks(active.filter(t=>/\b(read|reading|pages|chapter.*exercises)\b/i.test(t.title)),6)||'none recorded')+'. Catch-up stays separate from the daily goal.','Reading plan');
      if(b.type==='callout'&&(/weekend\?/.test(text)&&/\bOct\s+\d/.test(text)||name==='upcoming weekend decision status')){
        change(b,'Upcoming weekend · decision status','Weekend decision');for(const c of b.children||[])if(c.type==='paragraph')change(c,'Current assignment information: '+(active.filter(t=>/\b(arbiter|umpir|weekend)\b/i.test(t.title)).map(t=>t.title+' ['+t.status+']: '+t.notes).join('; ')||'No current assignment information is recorded')+'. A past game does not confirm a new game.','Weekend assignments');
      }
      if(b.type==='paragraph'&&/^Recommendation rule:/.test(text))change(b,'Choose the weekend base using newly confirmed games and current commitments. The previous weekend’s game and its old morning work window are not carried forward. Protected weekday mornings remain 6:00–9:30 AM.','Weekend recommendation');
      if(b.type==='paragraph'&&context.toggle==='how morning updates work'){
        if(/^The morning routine|^The local refresh/.test(text))change(b,'The local refresh reads connected recent inboxes, applies supported saved decisions and reminder cleanup, and rebuilds these Home planning sections from current Notion tasks. Automatic contextual email-to-task reconciliation is still being built.','Refresh description');
        if(/^Subscription reviews|^Known renewal/.test(text))change(b,'Known renewal dates remain in the task records; your explicit cancellation updates take priority over older review reminders. Automatic provider verification and general 7-day/1-day reminder generation are not implemented.','Refresh description');
        if(/^Date filters|^This app runs/.test(text))change(b,'This app runs when you click Refresh while its local server is running. It does not configure or verify a separate 6:45 AM ChatGPT routine. Sports, weather, newsletters, and subscription provider records require their own current sources; this app has not freshly verified them.','Refresh description');
      }
      if(b.type==='toggle'&&/sports this week|sports saved listings/.test(name)){
        change(b,'🏟️ Sports · saved listings','Sports coverage');warnings.push('Sports listings are preserved as an older snapshot; fresh fixtures are not connected.');
      }
      if(context.toggle?.includes('sports')&&b.type.startsWith('heading_')&&/important sports matchups|saved sports listings/.test(name))change(b,'🏟️ Saved sports listings · not freshly verified','Sports coverage');
      if(context.toggle?.includes('sports')&&b.type==='paragraph'&&/^Checked Friday|^Verification status:/.test(text))change(b,'Verification status: these are saved listings from an earlier refresh. Past matchups remain historical. Current times, results, and new fixtures have not been checked.','Sports coverage');
      if(context.newsletters&&b.type==='paragraph'&&/ · (?:Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)\b|^Saved newsletter snapshot:/i.test(text)){
        const original=text.replace(/^Saved newsletter snapshot: /,'');
        const label=key(original.split(' · ')[0]);
        const recent=(report.inboxReview||[]).filter(m=>m.category==='Newsletter'&&key(m.from+' '+m.subject).includes(label)).sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt))[0];
        change(b,recent?`${recent.subject} · received ${stamp(recent.receivedAt)}. ${shortened(recent.snippet||'',400)}`:'Saved newsletter snapshot: '+original,'Newsletter coverage');
      }
      const nextContext={...ctx,...(b.type==='paragraph'&&name==='newsletters'?{newsletters:true}:{}),...(b.type==='callout'?{section:name}:{}),...(b.type==='toggle'?{toggle:context.toggle?.includes('sports')?context.toggle+' '+name:name}:{})};
      if(b.children)walk(b.children,nextContext);
    }
  }
  walk(blocks);
  // Reconcile separate narrative references to explicit saved user updates.
  // Restrict replacement to factual paragraph/callout clauses, never task titles
  // or arbitrary instructions, and leave other services in mixed notes intact.
  function applyFacts(rows,inFacts=false){
    for(const b of rows){
      if(isArchive(b)||['child_page','child_database'].includes(b.type))continue;
      const isFacts=inFacts||['your updates','remembered decisions'].includes(key(homeText(b)));
      if(!isFacts&&['paragraph','callout','bulleted_list_item'].includes(b.type)){
        const previous=changes.find(c=>c.id===b.id),current=previous?rich(previous.after):homeText(b);
        const relevant=facts.filter(f=>key(current).includes(key(f.topic)));
        let replacement=current;
        for(const f of relevant){
          if(f.state==='known result'&&key(replacement).startsWith(key(f.topic))){replacement=f.statement.replace(/[.\s]+$/,'')+'.';continue;}
          const clauses=replacement.split(/(?<=\.)\s+|;\s*/);let edited=false;
          const updated=clauses.map(clause=>{if(key(clause).includes(key(f.topic))&&!key(clause).includes(key(f.state))){edited=true;return f.statement.replace(/[.\s]+$/,'')+'.';}return clause;});
          if(edited)replacement=updated.join(' ');
        }
        if(replacement!==current){
          replacement=replacement.replace(/Verify both in /g,'Verify only the remaining unresolved items in ');
          if(previous){previous.after=homeRich(replacement);previous.section+='; saved decisions';}
          else change(b,replacement,'Saved decisions');
        }
      }
      if(b.children)applyFacts(b.children,isFacts);
    }
  }
  applyFacts(blocks);
  if(!summaryFound)warnings.push('The supported dated Home summary was not found.');
  warnings.push('Linked database views and their filters are preserved; the Notion API does not expose view-filter editing.');
  return {changes:changes.filter(c=>!homeValueEqual(c.before,c.after,c.field)),coverage:[...new Set(coverage)],warnings};
}
