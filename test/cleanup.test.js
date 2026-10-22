import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../store.js';
import {Assistant} from '../assistant-service.js';
import {cleanupReview,matchingDecisions} from '../cleanup.js';
import {previewHome} from '../home-summary.js';
const now=new Date('2026-10-22T18:00:00Z');
const task=(id,title,extra={})=>({id,title,lastEdited:'v1',status:'To do',done:false,notes:'',schedules:[],...extra});
const date=value=>({type:'date',date:value});
const page=t=>({id:t.id,last_edited_time:t.lastEdited,properties:{Status:{type:'select',select:{name:t.status}},Done:{type:'checkbox',checkbox:false},Start:date({start:'2026-10-01'}),'Finish by':date(null),'Do date':date(null),'On calendar':date(null),'Due date':date({start:'2026-10-01'}),'Commitment time':date({start:'2026-10-01'}),'Next action':{type:'rich_text',rich_text:[{type:'text',text:{content:'Existing notes'}}]}}});
const schema={properties:{Status:{type:'select',select:{options:[{name:'Done'},{name:'Canceled'}]}}}};
async function fixture(t,tasks){
 const dir=await mkdtemp(join(tmpdir(),'cleanup-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new Store(dir),state=await store.read();state.sourceId='source';state.latest={id:'run1',tasks,cleanup:cleanupReview(tasks,{},now)};await store.write(state);
 const pages=new Map(tasks.map(t=>[t.id,page(t)]));let writes=0;
 const notion={call:async(path,method,body)=>{
   if(path.startsWith('/data_sources/'))return schema;
   const p=pages.get(path.split('/').at(-1));
   if(method==='PATCH'){writes++;for(const [k,v]of Object.entries(body.properties))p.properties[k]={...p.properties[k],...v};p.last_edited_time='v2';}
   return structuredClone(p);
 }};
 return {store,pages,notion,writes:()=>writes,service:new Assistant({store,notion,clock:()=>now})};
}
test('past game/exam are review candidates, while a past assignment remains unresolved',()=>{
 const past={due:{start:'2026-10-10'}};
 const tasks=[task('game','Confirm umpiring game',past),task('exam','Macro exam 1',past),task('homework','Submit accounting assignment',{...past,kind:'Assignment'}),task('prep','Macro exam preparation',past)];
 const review=cleanupReview(tasks,{},now);assert.deepEqual(review.items.map(i=>i.taskId),['game','exam']);assert.ok(review.items.every(i=>i.evidence.some(e=>/review|grade|prove/i.test(e))));assert.equal(tasks[0].status,'To do');assert.equal(review.heldTaskIds.includes('homework'),false);
});
test('New York date handles midnight and does not reuse a stale weekday',()=>{
 const review=cleanupReview([],{},new Date('2026-10-23T02:00:00Z'));assert.equal(review.today,'2026-10-22');assert.match(review.displayDate,/Thursday/);
});
test('recurring goals collapse in the draft without hiding separate catch-up work',()=>{
 const tasks=[task('yesterday','Apply to 2 internships',{doDate:{start:'2026-10-21'}}),task('today','Apply to 2 internships',{doDate:{start:'2026-10-22'}}),task('backlog','Apply to 2 missed internships')];
 const review=cleanupReview(tasks,{},now);assert.equal(review.routines[0].keeperId,'today');assert.deepEqual(review.heldTaskIds,['yesterday']);assert.equal(tasks.length,3);
});
test('remembered cancellations are pinned by task identity and exact normalized title',()=>{
 const t=task('a','Example application');const decisions={a:{title:t.title,action:'cancel',note:'No longer pursuing'}};
 const review=cleanupReview([t],decisions,now);assert.ok(review.heldTaskIds.includes('a'));assert.equal(matchingDecisions('EXAMPLE application!',decisions).length,1);assert.equal(matchingDecisions('Different application',decisions).length,0);
});
test('approved resolution saves the result, clears planning dates, preserves deadline and event history',async t=>{
 const f=await fixture(t,[task('grade','Check exam grade')]);
 await assert.rejects(()=>f.service.resolveTask({taskId:'grade',action:'done'}),/Confirm/);assert.equal(f.writes(),0);
 assert.deepEqual(await f.service.resolveTask({taskId:'grade',action:'done',note:'Grade received: 82',confirmed:true}),{updated:true,verified:true});
 const p=f.pages.get('grade');assert.equal(p.properties.Status.select.name,'Done');assert.equal(p.properties.Done.checkbox,true);assert.equal(p.properties.Start.date,null);assert.ok(p.properties['Due date'].date);assert.ok(p.properties['Commitment time'].date);assert.ok(p.properties['Next action'].rich_text.some(x=>x.text?.content.includes('Grade received: 82')));
 const state=await f.store.read();assert.equal(state.taskDecisions.grade.note,'Grade received: 82');assert.equal(state.taskDecisions.grade.verified,true);assert.equal(state.operations[0].status,'verified');
});
test('canceled tasks keep Done false and stale versions cannot be resolved',async t=>{
 const f=await fixture(t,[task('a','Trial reminder')]);f.pages.get('a').last_edited_time='changed';await assert.rejects(()=>f.service.resolveTask({taskId:'a',action:'cancel',confirmed:true}),/changed/);assert.equal(f.writes(),0);
 f.pages.get('a').last_edited_time='v1';await f.service.resolveTask({taskId:'a',action:'cancel',note:'Canceled',confirmed:true});assert.equal(f.pages.get('a').properties.Status.select.name,'Canceled');assert.equal(f.pages.get('a').properties.Done.checkbox,false);
});
test('uncertain cleanup writes stay remembered and are not silently retried',async t=>{
 const f=await fixture(t,[task('a','Old task')]);f.notion.call=async(path,method)=>{if(path.startsWith('/data_sources/'))return schema;if(method==='PATCH')throw Error('lost response');return page(task('a','Old task'));};
 await assert.rejects(()=>f.service.resolveTask({taskId:'a',action:'cancel',confirmed:true}),/needs verification/);const state=await f.store.read();assert.equal(state.taskDecisions.a.verified,false);assert.equal(state.latest.needsRefresh,true);await assert.rejects(()=>f.service.resolveTask({taskId:'a',action:'cancel',confirmed:true}),/Refresh/);
});
test('group cleanup keeps the reviewed master and cancels only displayed repeats',async t=>{
 const tasks=[task('keep','Apply to 2 internships'),task('close1','Apply to 2 internships'),task('close2','Apply to 2 internships')];
 const f=await fixture(t,tasks);assert.deepEqual(await f.service.resolveRoutine({key:'daily-internship-applications',keeperId:'keep',confirmed:true}),{updated:2,verified:true});assert.equal(f.pages.get('keep').properties.Status.select.name,'To do');assert.equal(f.pages.get('close1').properties.Status.select.name,'Canceled');assert.equal(f.pages.get('close2').properties.Status.select.name,'Canceled');assert.equal(f.writes(),2);
});
test('Home preview is read-only and replaces only the supported dated callout and paragraph',async()=>{
 let writes=0;const notion={all:async()=>[{id:'home',properties:{Name:{type:'title',title:[{plain_text:'Home'}]}}}],call:async(path,method)=>{if(method)writes++;if(path.includes('/home/'))return {results:[{id:'heading',type:'callout',last_edited_time:'v1',callout:{rich_text:[{plain_text:'Wednesday · October 21 · refreshed'}]}}]};return {results:[{id:'summary',type:'paragraph',last_edited_time:'v1',paragraph:{rich_text:[{plain_text:'Old summary'}]}}]};}};
 const report={id:'run',cleanup:{today:'2026-10-22',displayDate:'Thursday, October 22, 2026',items:[]},tasks:[],plan:{upcoming:[]},sources:[]};
 const preview=await previewHome(notion,report);assert.equal(writes,0);assert.equal(preview.changes.length,2);assert.match(preview.changes[0].after[0].text.content,/Thursday/);assert.equal(preview.runId,'run');
});
test('Home apply verifies both blocks and rejects edits made after the preview',async t=>{
 const f=await fixture(t,[]),state=await f.store.read();
 state.homePreview={id:'preview',runId:'run1',date:'2026-10-22',changes:[{id:'heading',type:'callout',lastEdited:'v1',before:[{plain_text:'Wednesday'}],after:[{text:{content:'Thursday'}}]},{id:'summary',type:'paragraph',lastEdited:'v1',before:[{plain_text:'Old'}],after:[{text:{content:'New'}}]}]};await f.store.write(state);
 const blocks=new Map(state.homePreview.changes.map(c=>[c.id,{type:c.type,last_edited_time:c.lastEdited,[c.type]:{rich_text:c.before}}]));let writes=0;
 f.notion.call=async(path,method,body)=>{const block=blocks.get(path.split('/').at(-1));if(method==='PATCH'){writes++;block[block.type]=body[block.type];}return structuredClone(block);};
 blocks.get('heading').last_edited_time='v2';await assert.rejects(()=>f.service.approveHome({previewId:'preview',confirmed:true}),/edited/);assert.equal(writes,0);
 blocks.get('heading').last_edited_time='v1';assert.deepEqual(await f.service.approveHome({previewId:'preview',confirmed:true}),{updated:true,verified:true});assert.equal(writes,2);
});
test('a saved cancellation prevents an old email from recreating the same task',async t=>{
 const f=await fixture(t,[task('a','Example application')]),state=await f.store.read();
 state.taskDecisions={a:{title:'Example application',action:'cancel',verified:true}};state.latest.inboxReview=[{key:'gmail:person@example.com:m1',subject:'Example application'}];await f.store.write(state);
 await assert.rejects(()=>f.service.reviewMail({key:'gmail:person@example.com:m1',decision:'create',title:'Example application',confirmed:true}),/remembered/);assert.equal(f.writes(),0);
 await f.service.forgetDecision({taskId:'a',confirmed:true});assert.deepEqual((await f.store.read()).taskDecisions,{});assert.equal(f.writes(),0);
});
test('a partial routine batch stops on uncertainty and retains verified earlier decisions',async t=>{
 const f=await fixture(t,[task('keep','Apply to 2 internships'),task('first','Apply to 2 internships'),task('second','Apply to 2 internships')]);const original=f.notion.call;let uncertain=0;
 f.notion.call=async(path,method,body)=>{if(path==='/pages/second'&&method==='PATCH'){uncertain++;throw Error('lost response');}return original(path,method,body);};
 await assert.rejects(()=>f.service.resolveRoutine({key:'daily-internship-applications',keeperId:'keep',confirmed:true}),/1 routine records verified/);
 const state=await f.store.read();assert.equal(state.taskDecisions.first.verified,true);assert.equal(state.taskDecisions.second.verified,false);assert.equal(uncertain,1);assert.equal(f.pages.get('keep').properties.Status.select.name,'To do');
});
