import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RefreshJob,DailyRollover} from '../refresh-job.js';
test('one start continues bounded batches automatically and duplicate starts share the job',async()=>{
 const flags=[];const job=new RefreshJob({refresh:async options=>{flags.push(options.continueCatchup);return {status:flags.length===3?'complete':'partial',sources:[{canContinue:flags.length<3}]};}});
 const first=job.start();assert.equal(job.start(),first);await job.done;assert.equal(job.current.status,'complete');assert.deepEqual(flags,[false,true,true]);
});
test('stop waits for the current batch and does not begin another',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r);
 const job=new RefreshJob({refresh:async()=>{calls++;await gate;return {status:'partial',sources:[{canContinue:true}]};}});
 job.start();job.stop();release();await job.done;assert.equal(calls,1);assert.equal(job.current.status,'stopped');
});
test('quota or missing permissions pause instead of creating an endless retry loop',async()=>{
 let calls=0;const job=new RefreshJob({refresh:async()=>{calls++;return {status:'partial',sources:[{canContinue:false,status:'incomplete'}]};}});
 job.start();await job.done;assert.equal(job.current.status,'paused');assert.equal(calls,1);
});
test('background exceptions are captured and the user can start again',async()=>{
 const job=new RefreshJob({refresh:async()=>{throw Error('failure');}});job.start();await job.done;assert.equal(job.current.status,'failed');assert.ok(job.current.error);job.start();await job.done;assert.equal(job.current.status,'failed');
});
test('completed source reads do not conceal a failed Home update or unfinished reconciliation',async()=>{
 const job=new RefreshJob({refresh:async()=>({status:'complete',sources:[]}),applyAutomatic:async()=>({homeUpdated:false,exceptions:[{reason:'Home timed out'}]})});
 job.start();await job.done;assert.equal(job.current.status,'needs attention');assert.equal(job.current.automatic.homeUpdated,false);
});
test('task briefing is published before inbox work and remains reported after a later failure',async()=>{
 const order=[];const job=new RefreshJob({refreshDay:async()=>{order.push('home');return {homeUpdated:true,exceptions:[]};},refresh:async options=>{order.push('inbox');assert.equal(options.sameRun,true);assert.equal(options.continueCatchup,false);throw Error('Notion read timed out');}});
 job.start();await job.done;assert.deepEqual(order,['home','inbox']);assert.equal(job.current.status,'failed');assert.equal(job.current.day.homeUpdated,true);assert.match(job.current.error,/briefing was published.*Notion read timed out/);
});
test('automatic rollover uses New York midnight, survives a new scheduler, and skips completed days',async()=>{
 let now=new Date('2026-10-27T03:59:00Z'),starts=0;
 const state={configured:true,publication:{status:'verified',date:'2026-10-26'}};
 const job={assistant:{state:async()=>state},start(options){assert.equal(options.dayOnly,true);starts++;state.publication.date='2026-10-27';}};
 let rollover=new DailyRollover(job,{clock:()=>now});await rollover.tick();assert.equal(starts,0);
 now=new Date('2026-10-27T04:00:00Z');await rollover.tick();assert.equal(starts,1);
 rollover=new DailyRollover(job,{clock:()=>now});await rollover.tick();assert.equal(starts,1);
});
test('failed daily publications back off and active edits/updates take priority',async()=>{
 let now=new Date('2026-10-27T14:00:00Z'),starts=0,allowed=false;
 const job={assistant:{state:async()=>({configured:true,publication:{status:'partial',date:'2026-10-27'}})},start(){starts++;}};
 const rollover=new DailyRollover(job,{clock:()=>now,canRun:()=>allowed});await rollover.tick();assert.equal(starts,0);
 allowed=true;await rollover.tick();await rollover.tick();assert.equal(starts,1);
 now=new Date(+now+300000);job.assistant.busy=true;await rollover.tick();assert.equal(starts,1);
 job.assistant.busy=false;await rollover.tick();assert.equal(starts,2);
});
