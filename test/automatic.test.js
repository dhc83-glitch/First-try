import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Assistant} from '../assistant-service.js';
import {Store} from '../store.js';
import {interpretUpdate,automaticCleanup} from '../automatic.js';
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
 const notion={source:async()=>schema,discover:async()=>[{id:'source',title:'Central Tasks'}],all:async(path,body)=>{
  if(path==='/search')return [{id:'home',properties:{Name:{type:'title',title:[{text:{content:'Home'}}]}}}];
  return structuredClone([...pages.values()].filter(p=>!body?.filter||(body.filter.property==='Source'?p.properties.Source.rich_text.map(x=>x.text.content).join('')===body.filter.rich_text.equals:p.properties['Task name'].title[0].text.content===body.filter.title.equals)));
 },call:async(path,method,body)=>{
  if(path.startsWith('/data_sources/'))return structuredClone(schema);
  if(path.includes('/children'))return {results:[structuredClone(blocks.get(path.includes('/home/')?'heading':'summary'))],has_more:false};
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
test('one Refresh job applies supplied facts, closes past reminders, reuses daily master, dates Home and is repeatable',async t=>{
 const f=await fixture(t,[task('class','Accounting class',{doDate:{start:'2026-10-21'}}),task('quiz','Liabilities quiz',{due:{start:'2026-10-21'}}),task('grade','Check finance grade'),task('trial','Example trial'),task('daily','Apply to 2 internships',{doDate:{start:'2026-10-22'}}),task('duplicate','Apply to 2 internships',{doDate:{start:'2026-10-21'}})]);
 await f.service.saveUpdate({text:'Completed "Check finance grade": grade received 82'});
 await f.service.saveUpdate({text:'Cancel "Example trial": canceled'});
 const job=new RefreshJob(f.service);job.start();await job.done;assert.equal(job.current.status,'complete');
 const status=id=>f.pages.get(id).properties.Status.select.name;
 assert.equal(status('class'),'Done');assert.equal(status('quiz'),'To do');assert.equal(status('grade'),'Done');assert.equal(status('trial'),'Canceled');assert.equal(status('duplicate'),'Canceled');assert.equal(f.creates(),0);
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
