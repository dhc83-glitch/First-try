import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RefreshJob} from '../refresh-job.js';
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
