import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
import {Assistant} from '../assistant-service.js';
import {normalizeCentral,auditCentral,buildPlan,changesSince} from '../assistant.js';
import {similar,localParts} from '../audit.js';
const sourceId='11111111-1111-1111-1111-111111111111';
const now=new Date('2026-10-22T13:00:00Z');
const date=d=>({type:'date',date:d});
function page(id='task1',extra={}){return {id,last_edited_time:'v1',properties:{'Task name':{type:'title',title:[{plain_text:'Review project'}]},Status:{type:'select',select:{name:'To do'}},Done:{type:'checkbox',checkbox:false},'On calendar':date(null),Start:date(null),'Finish by':date(null),'Do date':date(null),'Due date':date(null),'Commitment time':date(null),Area:{type:'select',select:{name:'School'}},Kind:{type:'select',select:{name:'Task'}},'Effort minutes':{type:'number',number:30},...extra}};}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'assistant-'));t.after(()=>rm(dir,{recursive:true,force:true}));return new Store(dir);}
const schema={id:sourceId,properties:{'Task name':{type:'title'},Status:{type:'select'},'On calendar':{type:'date'}}};
test('normalization checks fallback times and conflicting date columns',()=>{
 const p=page('1',{'Commitment time':date({start:'2026-10-23T07:00:00-04:00'}),Start:date({start:'2026-10-23T15:00:00-04:00'}),'Finish by':date({start:'2026-10-23T16:00:00-04:00'})});
 const task=normalizeCentral(p);assert.equal(task.schedules.length,2);
 const issues=auditCentral([task],now);assert.ok(issues.some(i=>i.type==='Blocked time'));assert.ok(issues.some(i=>i.type==='Different schedule fields'));assert.ok(!issues.some(i=>i.type==='Overlap'));
});
test('repeated templates with different numbers are not near duplicates',()=>{assert.equal(similar('Do chapter 2 exercises','Do chapter 3 exercises'),false);assert.equal(similar('Apply on Oct 15','Apply on Oct 16'),false);});
test('planner honors fixed commitments, protected time, capacity and deadlines',()=>{
 const fixed=normalizeCentral(page('fixed',{Kind:{type:'select',select:{name:'Fixed commitment'}},'Commitment time':date({start:'2026-10-22T09:30:00-04:00',end:'2026-10-22T11:00:00-04:00'})}));
 const flex=normalizeCentral(page('flex'));
 const impossible=normalizeCentral(page('impossible',{'Due date':date({start:'2026-10-22T09:15:00-04:00'})}));
 const plan=buildPlan([fixed,flex,impossible],now);
 assert.equal(plan.proposals.length,1);assert.equal(plan.proposals[0].taskId,'flex');assert.equal(plan.proposals[0].start,'2026-10-22T15:00:00.000Z');
 assert.ok(plan.unplaced.some(t=>t.taskId==='impossible'));assert.equal(localParts(plan.proposals[0].end,'America/New_York').minute,690);
});
test('future fixed date-only appointments block an entire day',()=>{
 const fixed=normalizeCentral(page('fixed',{Kind:{type:'select',select:{name:'Fixed commitment'}},'On calendar':date({start:'2026-10-22'})}));
 const plan=buildPlan([fixed,normalizeCentral(page('flex'))],now);assert.equal(plan.proposals[0].start.slice(0,10),'2026-10-23');
});
test('durable refresh repeats safely, preserves baseline on failure, and reports partial coverage',async t=>{
 const store=await fixture(t);let fail=false;
 const notion={source:async()=>schema,all:async()=>{if(fail)throw Error('unavailable');return [page()];}};
 const service=new Assistant({notion,store,sourceId,clock:()=>now});
 const first=await service.refresh();assert.equal(first.status,'partial');assert.equal(first.changes.firstRun,true);assert.equal(first.sources.filter(s=>s.status==='not connected').length,4);
 const second=await service.refresh();assert.deepEqual(second.changes,{firstRun:false,added:[],changed:[],missing:[]});
 fail=true;await assert.rejects(()=>service.refresh(),/unavailable/);
 const saved=await store.read();assert.equal(saved.latest.status,'failed');assert.equal(saved.baseline.tasks.length,1);
 const restarted=new Assistant({notion,store,sourceId,clock:()=>now});fail=false;assert.equal((await restarted.refresh()).changes.firstRun,false);
});
test('concurrent refreshes cannot both run',async t=>{
 const store=await fixture(t);let release;const gate=new Promise(r=>release=r);
 const service=new Assistant({store,sourceId,notion:{source:async()=>{await gate;return schema;},all:async()=>[page()]},clock:()=>now});
 const first=service.refresh();await assert.rejects(()=>service.refresh(),/already running/);release();await first;
});
test('approved change is stale guarded, mirrored across date columns, verified and single use',async t=>{
 const store=await fixture(t);let current=page(),writes=0,stale=false;
 const notion={source:async()=>schema,all:async()=>[current],call:async(path,method,body)=>{if(method==='PATCH'){writes++;for(const [k,v]of Object.entries(body.properties))current.properties[k]={type:'date',...v};current.last_edited_time='v2';return current;}return {...current,last_edited_time:stale?'new edit':current.last_edited_time};}};
 const service=new Assistant({notion,store,sourceId,clock:()=>now});const report=await service.refresh(),id=report.plan.proposals[0].id;
 await assert.rejects(()=>service.approve(id,false),/Confirm/);assert.equal(writes,0);
 stale=true;await assert.rejects(()=>service.approve(id,true),/changed/);assert.equal(writes,0);
 stale=false;assert.deepEqual(await service.approve(id,true),{updated:true,verified:true});assert.equal(writes,1);assert.equal(current.properties['Do date'].date.start,'2026-10-22');assert.ok(current.properties['On calendar'].date.end);
 await assert.rejects(()=>service.approve(id,true),/Refresh/);assert.equal(writes,1);assert.equal((await store.read()).operations[0].status,'verified');
});
test('an uncertain write is not retried automatically',async t=>{
 const store=await fixture(t);let writes=0;
 const service=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page()],call:async(path,method)=>{if(method==='PATCH'){writes++;throw Error('connection lost');}return page();}}});
 const report=await service.refresh(),id=report.plan.proposals[0].id;
 await assert.rejects(()=>service.approve(id,true),/uncertain/);await assert.rejects(()=>service.approve(id,true),/Refresh/);assert.equal(writes,1);assert.equal((await store.read()).operations[0].status,'needs verification');
});
test('corrupt local records are preserved instead of silently reset',async t=>{const store=await fixture(t);await writeFile(store.path,'broken');await assert.rejects(()=>store.read(),/kept untouched/);});
test('changes compare content instead of edit timestamps and never call missing tasks deleted',()=>{const a=normalizeCentral(page());assert.equal(changesSince([a],[{...a,lastEdited:'v9'}]).changed.length,0);assert.equal(changesSince([a],[]).missing.length,1);});
test('Gmail failure stays visible while independent Notion and inbox checks finish',async t=>{
 const store=await fixture(t);const service=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page()]},gmail:{readInbox:async slot=>{if(slot==='school')throw Error('denied');return {status:'checked',messages:[],count:0};}}});
 const report=await service.refresh();assert.equal(report.tasks.length,1);assert.equal(report.sources.find(s=>s.name==='School inbox').status,'failed');assert.equal(report.sources.find(s=>s.name==='Personal inbox').status,'checked');assert.equal(report.status,'partial');
});
test('approved email task creation uses a source key and cannot duplicate a prior creation',async t=>{
 const store=await fixture(t);const message={key:'gmail:school@example.com:m1',slot:'school',from:'teacher',subject:'Homework',snippet:'Read chapter'};
 const s=await store.read();s.sourceId=sourceId;s.latest={inboxReview:[message]};await store.write(s);let creates=0,existing=false,properties;
 const notion={all:async(path,body)=>{assert.equal(body.filter.rich_text.equals,message.key);return existing?[{id:'created'}]:[];},call:async(path,method,body)=>{
   if(path.startsWith('/data_sources'))return {properties:Object.fromEntries(Object.entries({'Source':'rich_text','Task name':'title','Status':'select','Area':'select','Next action':'rich_text','Due date':'date'}).map(([name,type])=>[name,{type}]))};
   if(method==='POST'){creates++;properties=body.properties;return {id:'created'};}
   return {properties:{Source:{rich_text:[{plain_text:message.key}]}}};
 }};
 const service=new Assistant({store,notion,clock:()=>now});await assert.rejects(()=>service.reviewMail({key:message.key,decision:'create',title:'Homework'}),/Confirm/);
 assert.deepEqual(await service.reviewMail({key:message.key,decision:'create',title:'Homework',confirmed:true,due:'2026-10-23'}),{created:true,verified:true});assert.equal(creates,1);assert.equal(properties.Area.select.name,'School');
 const next=await store.read();next.latest.inboxReview=[message];next.mailDecisions={};await store.write(next);existing=true;
 assert.deepEqual(await service.reviewMail({key:message.key,decision:'create',title:'Homework',confirmed:true}),{alreadyLinked:true});assert.equal(creates,1);
});
test('mail checkpoints persist even when a scan fails afterward',async t=>{
 const store=await fixture(t);let saved;
 const record={id:'m1',key:'gmail:me@example.com:m1',email:'me@example.com'};
 const service=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page()]},gmail:{readInbox:async(slot,previous,checkpoint)=>{
   if(slot==='personal'){saved=previous;await checkpoint([record]);throw Error('interrupted');}
   return {status:'not connected',messages:[]};
 }}});
 await service.refresh();assert.equal(saved.length,0);assert.deepEqual((await store.read()).mailRecords.personal,[record]);
 const restarted=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page()]},gmail:{readInbox:async(slot,previous)=>{
   if(slot==='personal'){assert.deepEqual(previous,[record]);return {status:'checked',messages:previous,count:1};}
   return {status:'not connected',messages:[]};
 }}});
 const next=await restarted.refresh();assert.equal(next.inboxReview.length,1);
});
test('live catch-up keeps a finished inbox checked and does not label waiting sources disconnected',async t=>{
 const store=await fixture(t),state=await store.read();
 const record={id:'m1',email:'work@example.com'};state.mailRecords={professional:[record]};state.mailScans={professional:{complete:true}};await store.write(state);
 let release,observed;const gate=new Promise(r=>release=r),ready=new Promise(r=>observed=r);
 const service=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page()]},gmail:{readInbox:async(slot,records,checkpoint)=>{
   if(slot==='personal'){await checkpoint([record],{complete:false,detail:'Old count: 0'});observed();await gate;}
   return {status:'checked',messages:records,count:records.length};
 }}});
 const run=service.refresh({continueCatchup:true});await ready;
 const live=(await store.read()).latest;
 assert.equal(live.sources.find(s=>s.name==='Professional inbox').status,'checked');
 assert.equal(live.sources.find(s=>s.name==='School inbox').status,'waiting');
 assert.ok(!live.sources.find(s=>s.name==='Personal inbox').detail.includes('Old count'));
 release();await run;
});
test('Notion-only reload does not scan Gmail or claim fresh email coverage',async t=>{
 const store=await fixture(t);
 const service=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page()]},gmail:{readInbox:async()=>{throw Error('must not scan');}}});
 const report=await service.refresh({taskOnly:true});assert.equal(report.tasks.length,1);assert.equal(report.sources.find(s=>s.name==='Personal inbox').status,'cached');assert.equal(report.status,'partial');
});
test('saved email window persists while every Notion task is still read',async t=>{
 const store=await fixture(t);const windows=[];
 const service=new Assistant({store,sourceId,clock:()=>now,notion:{source:async()=>schema,all:async()=>[page('old',{'Due date':{type:'date',date:{start:'2027-01-01'}}})]},gmail:{readInbox:async(slot,records,checkpoint,scan,options)=>{windows.push(options.lookbackDays);return {status:'checked',messages:[],count:0};}}});
 await service.setEmailWindow({days:7});const report=await service.refresh();assert.deepEqual(windows,[7,7,7]);assert.equal(report.tasks.length,1);assert.equal(report.tasks[0].due.start,'2027-01-01');assert.equal((await service.state()).settings.emailLookbackDays,7);
 await assert.rejects(()=>service.setEmailWindow({days:365}),/Choose/);
});
