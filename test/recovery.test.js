import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Assistant} from '../assistant-service.js';
import {Store} from '../store.js';
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let writes=0,fail=false;
  const page={id:'task',last_edited_time:'v2',properties:{Status:{type:'select',select:{name:'Done'}},Done:{type:'checkbox',checkbox:true},Start:{type:'date',date:null}}};
  const a=new Assistant({store:new Store(dir),clock:()=>new Date('2026-10-23T16:00:00Z'),notion:{call:async(path,method,body)=>{if(method==='PATCH'){writes++;if(fail)throw Error('timeout');for(const [k,v]of Object.entries(body.properties))page.properties[k]={type:page.properties[k].type,...v};page.last_edited_time='v3';}return structuredClone(page);}}});
  const state=await a.store.read();state.latest={tasks:[]};state.taskDecisions={task:{action:'done',verified:true}};
  state.operations=[{id:'op1',taskId:'task',title:'Task',action:'done',status:'verified',before:{Status:{type:'select',select:{name:'To do'}},Done:{type:'checkbox',checkbox:false},Start:{type:'date',date:{start:'2026-10-24T14:00:00Z'}}},properties:{Status:{select:{name:'Done'}},Done:{checkbox:true},Start:{date:null}}}];await a.store.write(state);
  return {a,page,writes:()=>writes,setFail:()=>{fail=true;}};
}
test('restore previews changed fields, confirms, verifies, and retires the remembered decision',async t=>{
  const {a,page,writes}=await fixture(t),preview=await a.recoveryPreview({id:'op1'});
  assert.equal(preview.fields.length,3);assert.equal(writes(),0);
  await assert.rejects(()=>a.restore({id:'op1',lastEdited:'v2'}),/confirm/);
  await a.restore({id:'op1',lastEdited:preview.lastEdited,confirmed:true});assert.equal(writes(),1);assert.equal(page.properties.Status.select.name,'To do');
  const state=await a.store.read();assert.equal(state.operations[0].status,'verified');assert.equal(state.taskDecisions.task,undefined);assert.equal(state.latest.needsRefresh,true);
  await assert.rejects(()=>a.restore({id:'op1',lastEdited:'v3',confirmed:true}),/restore point/);
});
test('external changes and later task operations prevent restore',async t=>{
  const {a,page,writes}=await fixture(t);page.properties.Done.checkbox=false;
  await assert.rejects(()=>a.recoveryPreview({id:'op1'}),/changed/);assert.equal(writes(),0);
  page.properties.Done.checkbox=true;const state=await a.store.read();state.operations.unshift({id:'newer',taskId:'task',status:'needs verification'});await a.store.write(state);
  await assert.rejects(()=>a.recoveryPreview({id:'op1'}),/later change/);
});
test('uncertain restore persists its intent and cannot be retried automatically',async t=>{
  const {a,setFail,writes}=await fixture(t);setFail();
  await assert.rejects(()=>a.restore({id:'op1',lastEdited:'v2',confirmed:true}),/needs verification/);
  assert.equal((await a.state()).operations[0].status,'needs verification');assert.equal(writes(),1);
  await assert.rejects(()=>a.restore({id:'op1',lastEdited:'v2',confirmed:true}),/later change/);assert.equal(writes(),1);
});
