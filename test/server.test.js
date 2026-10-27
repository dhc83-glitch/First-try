import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {Store} from '../store.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('local dashboard and mocked live read; writes require confirmation and stale guard',async(t)=>{
  const id='11111111-1111-1111-1111-111111111111';let writes=0,stale=false;
  const page={id,url:'https://www.notion.so/'+id,last_edited_time:'v1',properties:{Name:{type:'title',title:[{plain_text:'Live task'}]},Status:{type:'status',status:{name:'Active'}},Schedule:{type:'date',date:{start:'2026-10-23T07:00:00-04:00'}}}};
  const notion={call:async(path,method,body)=>{if(method==='PATCH'){writes++;assert.deepEqual(body.properties.Schedule,{date:null});return {};}if(path.startsWith('/pages/'))return {...page,last_edited_time:stale?'v2':'v1'};return {id,properties:{Name:{type:'title'},Status:{type:'status'},Schedule:{type:'date'}}};},all:async()=>[page]};
  const server=createApp({notion});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  const config=await (await fetch(base+'/api/config')).json();assert.equal(config.connected,true);assert.equal(config.token,undefined);
  assert.match(await (await fetch(base)).text(),/Personal Assistant/);
  const moduleResponse=await fetch(base+'/briefing.js');assert.equal(moduleResponse.status,200);assert.match(moduleResponse.headers.get('content-type'),/javascript/);
  const post=(path,body,csrf=config.csrf)=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Auditor-Token':csrf},body:JSON.stringify(body)});
  assert.equal((await post('audit',{},'wrong')).status,403);
  const gmailStatus=await (await post('gmail/status',{})).json();assert.equal(gmailStatus.accounts.length,3);assert.ok(gmailStatus.accounts.every(a=>a.connected===false));
  const callback=await fetch(base+'/oauth/gmail/callback?state=invalid&code=private-code');assert.equal(callback.status,400);assert.ok(!(await callback.text()).includes('private-code'));
  const read=()=>post('audit',{sourceId:id,map:{title:'Name',status:'Status',scheduled:'Schedule'}});
  let response=await read();assert.equal(response.status,200);const data=await response.json();assert.equal(data.tasks[0].title,'Live task');assert.ok(data.issues.some(i=>i.type==='Blocked time'));assert.equal(writes,0);
  assert.equal((await post('update',{taskId:id,action:'clearSchedule'})).status,400);assert.equal(writes,0);
  stale=true;assert.equal((await post('update',{taskId:id,action:'clearSchedule',confirmed:true})).status,409);assert.equal(writes,0);
  stale=false;assert.equal((await post('update',{taskId:id,action:'clearSchedule',confirmed:true})).status,200);assert.equal(writes,1);
  assert.equal((await post('update',{taskId:id,action:'clearSchedule',confirmed:true})).status,400);
});
test('HTTP start catches up in background, exposes status, and performs no Notion writes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'refresh-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const types={'Task name':'title',Status:'select','On calendar':'date',Done:'checkbox','Due date':'date',Start:'date','Finish by':'date','Commitment time':'date','Do date':'date',Area:'select',Priority:'select',Kind:'select','Next action':'rich_text','Effort minutes':'number','Record basis':'select'};
 const schema={id:'11111111-1111-1111-1111-111111111111',properties:Object.fromEntries(Object.entries(types).map(([name,type])=>[name,{type}]))};
 let writes=0;const notion={discover:async()=>[{id:schema.id,title:'Central Tasks'}],call:async(path,method)=>{if(method&&method!=='GET')writes++;return schema;},source:async()=>schema,all:async()=>[]};
 const gmail={readInbox:async(slot,records,checkpoint,scan)=>{const count=(scan?.count||0)+1,next={count};const messages=[{id:slot,slot,email:slot+'@example.com',key:'gmail:'+slot}];await checkpoint(messages,next);return {status:count>=2?'checked':'incomplete',messages,count:1,canContinue:count<2};}};
 const app=createApp({notion,gmail,store:new Store(dir)});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.address().port}`;
 const config=await(await fetch(base+'/api/config')).json();
 const post=async route=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Auditor-Token':config.csrf},body:'{}'});
 assert.equal((await post('assistant/start')).status,202);
 for(const route of ['assistant/organizer','assistant/capture','assistant/recovery-preview','assistant/restore','updates/install'])assert.equal((await post(route)).status,400);
 let state;for(let i=0;i<50;i++){state=await(await post('assistant/state')).json();if(state.job?.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(state.job.status,'needs attention');assert.equal(state.job.rounds,2);assert.equal(state.latest.status,'complete');assert.equal(state.latest.inboxReview.length,3);assert.equal(writes,0);
});

test('organizer and capture HTTP routes persist data without Notion writes and require the local token',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'organizer-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new Store(dir);let calls=0;const app=createApp({notion:{call:async()=>{calls++;throw Error('Unexpected Notion call');}},store,gmail:{status:async()=>({configured:false,accounts:[]})}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.address().port}`;
 const config=await(await fetch(base+'/api/config')).json();
 const post=(route,data,csrf=config.csrf)=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Auditor-Token':csrf},body:JSON.stringify(data)});
 assert.equal((await post('assistant/organizer',{action:'save',revision:0,item:{title:'Buy milk',kind:'errand',location:'Grocery'}})).status,200);
 assert.equal((await post('assistant/organizer',{action:'save',revision:0,item:{title:'Stale'}})).status,400);
 assert.equal((await post('assistant/capture',{requestId:'http-capture-request-123',title:'Review rent',due:'2026-11-01',nextAction:'Check invoice'})).status,200);
 assert.equal((await post('assistant/organizer',{},'wrong-token')).status,403);
 const result=await(await post('assistant/state',{})).json();assert.equal(result.organizer.items[0].location,'Grocery');assert.equal(result.updates[0].capture.due,'2026-11-01');assert.equal(calls,0);
 for(const path of ['/planning.js','/organizer-ui.js']){const res=await fetch(base+path);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/javascript/);}
});

test('the personal organizer remains available without a Notion connection',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'offline-organizer-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const app=createApp({notion:null,store:new Store(dir),gmail:{status:async()=>({configured:false,accounts:[]})}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address().port}`,config=await(await fetch(base+'/api/config')).json();assert.equal(config.connected,false);
 const post=(path,data)=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Auditor-Token':config.csrf},body:JSON.stringify(data)});
 assert.equal((await post('assistant/organizer',{action:'save',revision:0,item:{title:'Bring documents',kind:'appointment'}})).status,200);
 assert.equal((await(await post('assistant/state',{})).json()).organizer.items.length,1);
 assert.equal((await post('assistant/start',{})).status,503);
});
