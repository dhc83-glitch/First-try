import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Assistant} from '../assistant-service.js';
import {Store} from '../store.js';
import {interpretUpdate,automaticCleanup,taskTitleCorrections,hasReportedScore} from '../automatic.js';
import {RefreshJob} from '../refresh-job.js';
const now=new Date('2026-10-22T18:00:00Z');
const task=(id,title,extra={})=>({id,title,status:'To do',done:false,notes:'',schedules:[],...extra});
test('explicit updates match uniquely; quoted titles disambiguate and questions/future/negation never close tasks',()=>{
 const tasks=[task('one','Check finance exam grade'),task('two','Check history exam grade')];
 assert.equal(interpretUpdate('Completed "Check finance exam grade": grade received 82',tasks).taskId,'one');
 assert.equal(interpretUpdate('My finance exam grade was 82',tasks).action,'done');
 assert.ok(interpretUpdate('Completed exam grade',tasks).exception);
 for(const text of ['Should I cancel "Check finance exam grade"?','I have not completed "Check finance exam grade"','I will complete "Check finance exam grade"','I haven’t finished "Check finance exam grade"','Do not cancel "Check finance exam grade"'])assert.ok(interpretUpdate(text,tasks).exception,text);
 assert.equal(interpretUpdate('Cancel "Check finance exam grade": no longer needed',tasks).action,'cancel');
 assert.deepEqual(interpretUpdate('Add: Call the library',tasks),{action:'create',title:'Call the library'});
});
test('only past event reminders close by date; quizzes, followups, future alternative times and assignments remain',()=>{
 const past={doDate:{start:'2026-10-21'}};
 const tasks=[task('class','Accounting class',past),task('soccer','Soccer pickup',past),task('quiz','Liabilities quiz',past),task('homework','Accounting class homework',past),task('followup','Confirm class attendance',past),task('future','Micro class',{...past,schedules:[{start:'2026-10-25T18:00:00Z'}]})];
 assert.deepEqual(automaticCleanup(tasks,{},now).actions.map(a=>a.taskId),['class','soccer']);
 assert.equal(automaticCleanup([task('a','Canceled application')],{a:{action:'cancel',verified:true,note:'Not pursuing'}},now).actions[0].action,'cancel');
 assert.equal(automaticCleanup([task('a','Uncertain write')],{a:{action:'cancel',verified:false}},now).exceptions.length,1);
});
async function fixture(t,tasks){
 const directory=await mkdtemp(join(tmpdir(),'automatic-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new Store(directory);
 let time=now,version=0,creates=0;const writes=[];
 const date=value=>({type:'date',date:value||null}),rich=content=>({type:'rich_text',rich_text:content?[{text:{content}}]:[]});
 const schema={id:'source',properties:{'Task name':{type:'title'},Status:{type:'select',select:{options:['To do','Inbox','Done','Canceled'].map(name=>({name}))}},Done:{type:'checkbox'},'Due date':{type:'date'},Start:{type:'date'},'Finish by':{type:'date'},'Commitment time':{type:'date'},'Do date':{type:'date'},'On calendar':{type:'date'},Area:{type:'select'},Priority:{type:'select'},Kind:{type:'select'},'Record basis':{type:'select'},'Next action':{type:'rich_text'},'Effort minutes':{type:'number'},Source:{type:'rich_text'}}};
 const pages=new Map(tasks.map(t=>[t.id,{id:t.id,last_edited_time:'v0',properties:{'Task name':{type:'title',title:[{text:{content:t.title}}]},Status:{type:'select',select:{name:t.status}},Done:{type:'checkbox',checkbox:t.done},'Next action':rich(t.notes),Source:rich(''),Start:date(t.start),'Finish by':date(null),'Commitment time':date(null),'Do date':date(t.doDate),'On calendar':date(null),'Due date':date(t.due),Area:{type:'select',select:null},Priority:{type:'select',select:null},Kind:{type:'select',select:{name:t.kind||'Task'}},'Record basis':{type:'select',select:null},'Effort minutes':{type:'number',number:60}}}]));
 const blocks=new Map([['heading',{id:'heading',type:'callout',last_edited_time:'v0',callout:{rich_text:[{text:{content:'Wednesday · task review'}}]}}],['summary',{id:'summary',type:'paragraph',last_edited_time:'v0',paragraph:{rich_text:[{text:{content:'Old summary'}}]}}]]);
 const children=new Map([['home',['heading']],['heading',['summary']]]);
 const addBlock=(input)=>{const b=structuredClone(input),id='block'+(++version);const nested=b[b.type].children;delete b[b.type].children;b.id=id;b.last_edited_time='v'+version;b.has_children=!!nested?.length;blocks.set(id,b);if(nested)children.set(id,nested.map(addBlock));return id;};
 const notion={source:async()=>schema,discover:async()=>[{id:'source',title:'Central Tasks'}],all:async(path,body)=>{
  if(path==='/search')return [{id:'home',properties:{Name:{type:'title',title:[{text:{content:'Home'}}]}}}];
  return structuredClone([...pages.values()].filter(p=>!body?.filter||(body.filter.property==='Source'?p.properties.Source.rich_text.map(x=>x.text.content).join('')===body.filter.rich_text.equals:p.properties['Task name'].title[0].text.content===body.filter.title.equals)));
 },call:async(path,method,body)=>{
  if(path.startsWith('/data_sources/'))return structuredClone(schema);
  if(path.includes('/children')){
    const parent=path.split('/')[2];
    if(method==='PATCH'){writes.push(path);const ids=body.children.map(addBlock);children.set(parent,[...(children.get(parent)||[]),...ids]);blocks.get(parent).has_children=true;return {results:ids.map(id=>structuredClone(blocks.get(id)))};}
    return {results:(children.get(parent)||[]).map(id=>structuredClone(blocks.get(id))),has_more:false};
  }
  if(path==='/pages'&&method==='POST'){creates++;const p={id:'new'+creates,last_edited_time:'v'+(++version),properties:structuredClone(body.properties)};pages.set(p.id,p);writes.push(path);return structuredClone(p);}
  const record=(path.startsWith('/pages/')?pages:blocks).get(path.split('/').at(-1));
  if(!record)throw Error('Unexpected path '+path);
  if(method==='PATCH'){writes.push(path);if(body.properties)for(const [key,value]of Object.entries(body.properties))record.properties[key]={...record.properties[key],...value};else record[record.type]=body[record.type];record.last_edited_time='v'+(++version);}
  return structuredClone(record);
 }};
 const gmail={readInbox:async slot=>({slot,status:'checked',count:0,messages:[]})};
 const service=new Assistant({store,notion,gmail,clock:()=>time});
 return {store,pages,blocks,writes,service,notion,creates:()=>creates,setTime:value=>time=value};
}
test('Tuesday Home and daily goal publish while the inbox is still blocked; one run keeps the original comparison',async t=>{
 const f=await fixture(t,[task('daily','Apply to at least 2 internships',{done:true,status:'Done',doDate:{start:'2026-10-26'}})]);
 f.setTime(new Date('2026-10-27T14:00:00Z'));
 let release,entered;const inbox=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 f.service.gmail.readInbox=async slot=>{entered();await inbox;return {slot,status:'checked',messages:[],count:0};};
 const job=new RefreshJob(f.service);job.start();await started;
 assert.match(f.blocks.get('heading').callout.rich_text[0].text.content,/Tuesday, October 27/);
 assert.equal(f.pages.get('daily').properties.Status.select.name,'To do');
 assert.equal(f.pages.get('daily').properties['Do date'].date.start,'2026-10-27');
 const early=await f.store.read();assert.equal(early.homePublication.date,'2026-10-27');assert.equal(early.homePublication.status,'verified');
 release();await job.done;const final=await f.store.read();
 assert.equal(final.latest.id,early.latest.id);assert.equal(final.history.length,1);assert.equal(final.homePublication.date,'2026-10-27');
});
test('task-only automatic rollover never starts Gmail or schedules work',async t=>{
 const f=await fixture(t,[task('outline','Prepare outline')]);
 f.service.gmail.readInbox=async()=>{throw Error('Gmail must not run');};
 const job=new RefreshJob(f.service);job.start({dayOnly:true});await job.done;
 assert.equal(job.current.status,'complete');assert.equal(job.current.day.homeUpdated,true);
 assert.equal(f.writes.some(path=>path.startsWith('/pages/')),false);
 const state=await f.store.read();assert.equal(state.latest.automatic.homeUpdated,true);assert.equal(state.homePublication.status,'verified');
 assert.ok(state.latest.sources.some(s=>s.status==='cached'));
});
test('one Refresh job applies supplied facts, closes past reminders, reuses daily master, dates Home and is repeatable',async t=>{
 const f=await fixture(t,[task('class','Accounting class',{doDate:{start:'2026-10-21'}}),task('quiz','Liabilities quiz',{due:{start:'2026-10-21'}}),task('grade','Check finance grade'),task('trial','Example trial'),task('daily','Apply to 2 internships',{doDate:{start:'2026-10-22'}}),task('duplicate','Apply to 2 internships',{doDate:{start:'2026-10-21'}})]);
 await f.service.saveUpdate({text:'Completed "Check finance grade": grade received 82'});
 await f.service.saveUpdate({text:'Cancel "Example trial": canceled'});
 const job=new RefreshJob(f.service);job.start();await job.done;assert.equal(job.current.status,'complete');
 const status=id=>f.pages.get(id).properties.Status.select.name;
 assert.equal(status('class'),'Canceled');assert.equal(status('quiz'),'To do');assert.equal(status('grade'),'Done');assert.equal(status('trial'),'Canceled');assert.equal(status('duplicate'),'Canceled');assert.equal(f.creates(),0);
 assert.match(f.blocks.get('heading').callout.rich_text[0].text.content,/Thursday, October 22/);
 assert.equal((await f.store.read()).updates.every(u=>u.status==='applied'),true);
 const firstWrites=f.writes.filter(p=>p.startsWith('/pages/')).length;
 job.start();await job.done;assert.equal(f.writes.filter(p=>p.startsWith('/pages/')).length,firstWrites);
 await f.service.saveUpdate({text:'Completed "Apply to 2 internships": sent both'});job.start();await job.done;assert.equal(status('daily'),'Done');
 job.start();await job.done;assert.equal(status('daily'),'Done');
 f.setTime(new Date('2026-10-23T18:00:00Z'));job.start();await job.done;assert.equal(status('daily'),'To do');assert.equal(f.pages.get('daily').properties['Do date'].date.start,'2026-10-23');assert.equal(f.creates(),0);
});
test('saved additions create once and ambiguous notes persist without changing the named tasks',async t=>{
 const f=await fixture(t,[task('a','Check history grade'),task('b','Check finance grade')]);
 await f.service.saveUpdate({text:'Completed check grade'});await f.service.saveUpdate({text:'Add: Call the library'});
 await f.service.refresh();const result=await f.service.applyAutomatic();assert.equal(result.appliedUpdates,1);assert.ok(result.exceptions.length);assert.equal(f.creates(),1);
 assert.equal(f.pages.get('a').properties.Status.select.name,'To do');assert.equal(f.pages.get('b').properties.Status.select.name,'To do');
 await f.service.refresh();await f.service.applyAutomatic();assert.equal(f.creates(),1);assert.equal((await f.store.read()).updates[0].status,'needs information');
});
test('uncertain automatic writes remain blocked on later Refresh, with no silent retry',async t=>{
 const f=await fixture(t,[task('class','Accounting class',{doDate:{start:'2026-10-21'}}),task('daily','Apply to 2 internships')]);
 const original=f.notion.call;let attempts=0;
 f.notion.call=async(path,method,body)=>{if(path.startsWith('/pages/')&&method==='PATCH'){attempts++;throw Error('lost response');}return original(path,method,body);};
 await f.service.refresh();await f.service.applyAutomatic();assert.equal(attempts,2);
 await f.service.refresh();const result=await f.service.applyAutomatic();assert.equal(attempts,2);assert.ok(result.exceptions.some(e=>/verification/.test(e.reason)));
});
test('raw collected email keeps scheduling in draft until reconciliation exists',async t=>{
 const f=await fixture(t,[task('work','Prepare project outline')]);f.service.gmail.readInbox=async slot=>({slot,status:'checked',messages:[{key:slot+':1',slot,subject:'Meeting tomorrow',receivedAt:now.toISOString()}],count:1});
 await f.service.refresh();const result=await f.service.applyAutomatic();assert.equal(result.scheduled,0);assert.ok(result.exceptions.some(e=>/reconciliation/.test(e.reason)));assert.equal(f.writes.filter(p=>p.startsWith('/pages/')).length,0);
});
test('stopping a batch skips automatic writes; a complete catch-up applies them once',async()=>{
 let release,applied=0;const gate=new Promise(r=>release=r);const job=new RefreshJob({refresh:async()=>{await gate;return {status:'complete',sources:[]};},applyAutomatic:async()=>{applied++;}});
 job.start();job.stop();release();await job.done;assert.equal(applied,0);
 job.start();await job.done;assert.equal(applied,1);
});
test('uncertain Home writes are not silently overwritten on the following refresh',async t=>{
 const f=await fixture(t,[]),original=f.notion.call;let attempts=0;
 f.notion.call=async(path,method,body)=>{if(path.startsWith('/blocks/')&&method==='PATCH'){attempts++;throw Error('lost response');}return original(path,method,body);};
 await f.service.refresh();await f.service.applyAutomatic();assert.equal(attempts,1);
 await f.service.refresh();const result=await f.service.applyAutomatic();assert.equal(attempts,1);assert.equal(result.homeUpdated,false);assert.ok(result.exceptions.some(e=>/earlier Home update/.test(e.reason)));
});
test('an explicit cancellation stops daily-goal reopening on later days',async t=>{
 const f=await fixture(t,[task('daily','Apply to at least 2 internships')]);
 await f.service.saveUpdate({text:'Cancel "Apply to at least 2 internships": stopping this routine'});
 await f.service.refresh();await f.service.applyAutomatic();assert.equal(f.pages.get('daily').properties.Status.select.name,'Canceled');
 f.setTime(new Date('2026-10-23T18:00:00Z'));await f.service.refresh();await f.service.applyAutomatic();assert.equal(f.pages.get('daily').properties.Status.select.name,'Canceled');
});
test('a verified email conversation completes its confirmation before rebuilding Home, while its future event remains active',async t=>{
 const f=await fixture(t,[task('confirm','Confirm Exampleco campus attendance',{status:'Waiting'}),task('event','Attend Exampleco campus event',{kind:'Fixed commitment',start:{start:'2026-10-28T18:00:00Z'}})]);
 f.service.gmail.readCorrespondence=async()=>({coverage:[{slot:'professional',status:'checked'}],conversations:[{id:'thread',slot:'professional',email:'me@example.com',complete:true,messages:[{id:'sent',messageId:'<sent>',from:'me@example.com',to:'host@exampleco.com',subject:'Exampleco campus event',labels:['SENT'],body:'I confirm my attendance.',receivedAt:'2026-10-21T12:00:00Z'},{id:'ack',inReplyTo:'<sent>',from:'host@exampleco.com',to:'me@example.com',subject:'Exampleco campus event',body:'Thank you for confirming. See you there!',receivedAt:'2026-10-21T13:00:00Z'}]}]});
 await f.service.refresh();const result=await f.service.applyAutomatic();assert.equal(result.emailCompletions,1);assert.equal(f.pages.get('confirm').properties.Status.select.name,'Done');assert.equal(f.pages.get('event').properties.Status.select.name,'To do');assert.equal((await f.store.read()).correspondenceEvidence.confirm.replyId,'ack');
 await f.service.refresh();const repeat=await f.service.applyAutomatic();assert.equal(repeat.emailCompletions,0);
});
test('checked completion and stale planning-only titles are reconciled against their source fields',async t=>{
 const f=await fixture(t,[task('checked','Reply to example contact',{done:true}),task('room','Room reset — Wednesday',{doDate:{start:'2026-10-23'}}),task('result','Example exam — graded; score awaiting capture',{status:'Done',done:true,notes:'Exam score is 73.'})]);
 await f.service.refresh();const result=await f.service.applyAutomatic();assert.equal(f.pages.get('checked').properties.Status.select.name,'Done');assert.equal(f.pages.get('room').properties['Task name'].title[0].text.content,'Room reset');assert.match(f.pages.get('result').properties['Task name'].title[0].text.content,/score recorded/);assert.equal(result.renamedTasks,2);
});

test('dates and missing-score notices never count as reported grades',()=>{
 assert.equal(hasReportedScore('Grade/comments released Oct 14. Score is not included in the email.'),false);
 assert.ok(hasReportedScore('Exam 1 score confirmed by the student: 73.'));
 assert.ok(hasReportedScore('Exam score is 82.'));
 assert.equal(taskTitleCorrections([task('unknown','Quiz — score to capture',{done:true,status:'Done',notes:'Grade/comments released Oct 14. Score is not included in the email.'})]).length,0);
});


test('daily planner installs once, keeps details in toggles and updates the same blocks on tomorrow’s refresh',async t=>{
 const f=await fixture(t,[task('a','Prepare outline')]);
 await f.service.refresh();const first=await f.service.applyAutomatic();assert.equal(first.homeUpdated,true);assert.ok(first.homeSections.includes('Daily planner'));
 const installs=()=>f.writes.filter(p=>p==='/blocks/heading/children').length;
 assert.equal(installs(),1);
 const heading=[...f.blocks.values()].find(b=>b.type==='heading_3'&&b.heading_3.rich_text[0].text.content==='Your next 3');assert.ok(heading);
 await f.service.refresh();await f.service.applyAutomatic();assert.equal(installs(),1);
 f.setTime(new Date('2026-10-23T18:00:00Z'));await f.service.refresh();const next=await f.service.applyAutomatic();assert.equal(next.homeUpdated,true);assert.equal(installs(),1);
 assert.match(f.blocks.get('heading').callout.rich_text[0].text.content,/Friday/);
});
test('a lost layout-install response blocks later automatic appends rather than creating duplicate planners',async t=>{
 const f=await fixture(t,[]),original=f.notion.call;let installs=0;
 f.notion.call=async(path,method,body)=>{const response=await original(path,method,body);if(path==='/blocks/heading/children'&&method==='PATCH'){installs++;throw Error('response lost after successful creation');}return response;};
 await f.service.refresh();const first=await f.service.applyAutomatic();assert.equal(first.homeUpdated,false);assert.equal(installs,1);
 const pending=(await f.store.read()).operations.find(o=>o.title==='Update Home dated task summary');assert.equal(pending.status,'needs verification');assert.equal(pending.pendingAppend,'heading');
 await f.service.refresh();const next=await f.service.applyAutomatic();assert.equal(installs,1);assert.equal(next.homeUpdated,false);assert.ok(next.exceptions.some(e=>/earlier Home update/.test(e.reason)));
});
