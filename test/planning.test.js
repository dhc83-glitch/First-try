import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyPriorities,weeklyReview,refreshSummary} from '../public/planning.js';
const task=(id,extra={})=>({id,title:id,status:'To do',effort:30,schedules:[],...extra});
const now=new Date('2026-10-23T16:00:00Z');
test('daily short list excludes blocked, waiting, future and oversized work and prioritizes real deadlines',()=>{
  const report={tasks:[task('waiting',{status:'Waiting'}),task('future',{doDate:{start:'2026-10-24'}}),task('oversized',{effort:300}),task('confirm',{basis:'Needs confirmation'}),task('conflict'),task('urgent',{due:{start:'2026-10-23'}}),task('asap',{priority:'ASAP'}),task('normal')],issues:[{taskId:'conflict',type:'Overlap',related:[]}]};
  const p=dailyPriorities(report,now);assert.deepEqual(p.items.map(i=>i.task.id),['urgent','asap','normal']);assert.equal(p.minutes,90);assert.equal(p.capacity,120);
});
test('priorities respect remaining New York hours and merge overlapping occupied intervals',()=>{
  const busy=[task('fixed',{kind:'Fixed commitment',schedules:[{start:'2026-10-23T20:00:00-04:00',end:'2026-10-23T21:30:00-04:00'}]}),task('duplicate',{kind:'Fixed commitment',schedules:[{start:'2026-10-23T21:00:00-04:00',end:'2026-10-23T21:30:00-04:00'}]})];
  const p=dailyPriorities({tasks:[...busy,task('short'),task('later')]},new Date('2026-10-24T00:00:00Z'));assert.equal(p.capacity,30);assert.equal(p.items.length,1);
  assert.equal(dailyPriorities({tasks:[task('x')]},new Date('2026-10-24T03:00:00Z')).capacity,0);
  assert.equal(dailyPriorities({tasks:[task('all day',{kind:'Fixed commitment',scheduled:{start:'2026-10-23'}}),task('x')]},now).items.length,0);
});
test('weekly completion review needs actual app evidence and excludes restored, uncertain and old changes',()=>{
  const report={tasks:[task('old due',{due:{start:'2026-10-22'}}),task('next',{due:{start:'2026-10-30'}}),task('later',{due:{start:'2026-10-31'}}),task('closed',{status:'Done'})],plan:{unplaced:[{title:'Clarify',reason:'Needs confirmation'}]}};
  const ops=[{taskId:'done',title:'Done',status:'verified',action:'done',at:'2026-10-20T16:00:00Z'},{taskId:'restored',title:'Restored',status:'verified',action:'done',at:'2026-10-20T16:00:00Z',restoredBy:'restore1'},{taskId:'unknown',status:'needs verification',action:'done',at:'2026-10-20T16:00:00Z'}];
  const local={history:[{id:'local1',title:'Shopping',action:'complete',at:'2026-10-23T16:00:00Z'},{action:'restore',undoneId:'local1',at:'2026-10-23T16:01:00Z'}]};
  const w=weeklyReview(report,ops,local,now);assert.equal(w.completed.length,1);assert.equal(w.overdue.length,1);assert.equal(w.upcoming.length,1);assert.equal(w.decisions.length,1);
});
test('refresh digest keeps missing sources and uncertain operations visible',()=>{
  const d=refreshSummary({latest:{sources:[{name:'Tasks',status:'checked'},{name:'Mail',status:'failed'}],automatic:{appliedUpdates:2,exceptions:[{reason:'Uncertain'}]},changes:{added:[{}],changed:[]}},operations:[{status:'needs verification'}]});
  assert.equal(d.verified,2);assert.equal(d.checked,1);assert.equal(d.missing[0].name,'Mail');assert.equal(d.unverified,1);assert.equal(d.exceptions.length,1);
});
