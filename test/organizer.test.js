import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Assistant} from '../assistant-service.js';
import {Store} from '../store.js';
import {nextOccurrence,validDay} from '../organizer.js';
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'organizer-'));t.after(()=>rm(directory,{recursive:true,force:true}));return new Assistant({store:new Store(directory),clock:()=>new Date('2026-10-23T16:00:00Z')});}
test('recurrences retain month/year anchors and skip missed dates without extra records',()=>{
  assert.equal(nextOccurrence('2026-01-31','monthly','2026-01-31',31,1),'2026-02-28');
  assert.equal(nextOccurrence('2026-02-28','monthly','2026-02-28',31,1),'2026-03-31');
  assert.equal(nextOccurrence('2024-02-29','yearly','2027-03-01',29,2),'2028-02-29');
  assert.equal(nextOccurrence('2026-10-01','weekly','2026-10-23'),'2026-10-29');
  assert.equal(nextOccurrence('2026-10-31','daily','2026-11-01'),'2026-11-02');
  assert.equal(validDay('2026-02-29'),false);assert.equal(validDay('2028-02-29'),true);
});
test('organizer persists completion once, blocks stale saves, and restores the last revision',async t=>{
  const a=await fixture(t);
  await a.organizerEdit({action:'save',revision:0,item:{title:'Pay rent',due:'2026-10-01',repeat:'monthly',checklist:[{label:'Confirm amount'}]}});
  const first=(await a.state()).organizer,id=first.items[0].id;
  await a.organizerEdit({action:'complete',revision:1,id});
  let org=(await a.state()).organizer;assert.equal(org.items.length,1);assert.equal(org.items[0].due,'2026-11-01');assert.equal(org.items[0].closed,false);assert.equal(org.completions.length,1);
  await assert.rejects(()=>a.organizerEdit({action:'complete',revision:1,id}),/changed/);
  await assert.rejects(()=>a.organizerEdit({action:'complete',revision:2,id}),/on or after/);
  await a.organizerEdit({action:'restore',revision:2,historyId:org.history[0].id});
  org=(await a.state()).organizer;assert.equal(org.items[0].due,'2026-10-01');assert.equal(org.history[0].undoneId,org.history[1].id);assert.equal(org.completions.length,0);
  await assert.rejects(()=>a.organizerEdit({action:'restore',revision:3,historyId:org.history[1].id}),/most recent/);
  assert.equal((await a.store.read()).organizer.revision,3);
});
test('follow-ups record contact and next check; checklists and archive preserve data',async t=>{
  const a=await fixture(t);
  await a.organizerEdit({action:'save',revision:0,item:{title:'Check application',kind:'followup',contact:'Recruiter',due:'2026-10-23'}});
  let org=(await a.state()).organizer,id=org.items[0].id;
  await assert.rejects(()=>a.organizerEdit({action:'contacted',revision:1,id,nextCheck:'2026-10-23'}),/after today/);
  await a.organizerEdit({action:'contacted',revision:1,id,nextCheck:'2026-10-30'});
  org=(await a.state()).organizer;assert.equal(org.items[0].lastContact,'2026-10-23');assert.equal(org.items[0].due,'2026-10-30');
  await a.organizerEdit({action:'save',revision:2,item:{title:'Visit doctor',kind:'appointment',checklist:[{label:'Bring ID'}]}});
  id=(await a.state()).organizer.items[1].id;
  await a.organizerEdit({action:'check',revision:3,id,index:0,done:true});
  await a.organizerEdit({action:'archive',revision:4,id});
  org=(await a.state()).organizer;assert.equal(org.items[1].checklist[0].done,true);assert.equal(org.items[1].closedReason,'archive');
  await assert.rejects(()=>a.organizerEdit({action:'check',revision:5,id,index:0,done:false}),/not found/);
});
test('capture is durable, validates dates, and deduplicates request retries',async t=>{
  const a=await fixture(t),input={title:'Renew membership',due:'2026-11-01',area:'Personal',nextAction:'Check price',requestId:'capture-test-request-123'};
  await a.capture(input);assert.equal((await a.capture(input)).alreadyQueued,true);
  await assert.rejects(()=>a.capture({...input,title:'Different task'}),/different fields/);
  assert.equal((await a.state()).updates.length,1);assert.deepEqual((await a.state()).updates[0].capture,{title:input.title,due:input.due,area:input.area,nextAction:input.nextAction});
  await assert.rejects(()=>a.capture({...input,due:'2026-02-30'}),/deadline/);
  a.busy=true;await assert.rejects(()=>a.organizerEdit({action:'save',revision:0,item:{title:'X'}}),/Wait/);a.busy=false;
});
test('structured capture writes and verifies all supplied Notion fields',async t=>{
  const a=await fixture(t);let page,writes=0;
  a.notion={all:async()=>[],call:async(path,method,body)=>{
    if(path.startsWith('/data_sources/'))return {properties:{Source:{type:'rich_text'},'Task name':{type:'title'},Status:{type:'select',select:{options:[{name:'To do'}]}},Area:{type:'select',select:{options:[{name:'Personal'}]}},'Due date':{type:'date'},'Next action':{type:'rich_text'}}};
    if(method==='POST'){writes++;page={id:'new-task',properties:body.properties};return page;}return page;
  }};
  const state=await a.store.read();state.sourceId='source';state.latest={tasks:[]};await a.store.write(state);
  await a.capture({title:'Renew',due:'2026-11-01',area:'Personal',nextAction:'Check price',requestId:'capture-new-request-123'});
  const update=(await a.state()).updates[0];await a.createFromUpdate(update,'Renew');
  assert.equal(writes,1);assert.equal(page.properties['Due date'].date.start,'2026-11-01');assert.equal(page.properties.Area.select.name,'Personal');assert.equal(page.properties['Next action'].rich_text[0].text.content,'Check price');assert.equal((await a.state()).operations[0].status,'verified');
});

test('capture refuses schema mismatches and existing titles before creating anything',async t=>{
 const a=await fixture(t);let writes=0;
 a.notion={all:async()=>[],call:async(path,method)=>{if(method==='POST'){writes++;throw Error('Unexpected creation');}return {properties:{Source:{type:'rich_text'},'Task name':{type:'title'},Status:{type:'select',select:{options:[{name:'To do'}]}}}};}};
 const state=await a.store.read();state.sourceId='source';state.latest={tasks:[]};await a.store.write(state);
 const update={id:'capture1',capture:{title:'Pay invoice',due:'2026-11-01',area:'',nextAction:''}};
 await assert.rejects(()=>a.createFromUpdate(update,'Pay invoice'),/Due date column/);assert.equal(writes,0);
 const current=await a.store.read();current.latest.tasks=[{title:'Pay invoice',status:'To do'}];await a.store.write(current);
 await assert.rejects(()=>a.createFromUpdate(update,'Pay invoice'),/already exists/);assert.equal(writes,0);
});
