import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBriefing,dayOf,findTasks,buildMoneyReview} from '../public/briefing.js';
const task=(id,extra={})=>({id,title:id,status:'To do',...extra});
test('brief uses New York days and does not turn a planned date into a deadline',()=>{
  const now=new Date('2026-10-24T02:00:00Z');
  const b=buildBriefing([task('work',{scheduled:{start:'2026-10-23'}}),task('due',{due:{start:'2026-10-23'}}),task('old',{due:{start:'2026-10-22'}}),task('tomorrow',{due:{start:'2026-10-24'}})],now);
  assert.equal(b.today,'2026-10-23');assert.deepEqual(b.urgent.map(t=>t.id),['old','due']);assert.equal(b.isOverdue(b.urgent[1]),false);assert.equal(b.agenda[0].task.id,'work');
});
test('closed tasks stay out of briefing and waiting does not mean completed',()=>{
  const tasks=[task('done',{done:true}),task('canceled',{status:'Canceled'}),task('waiting',{status:'Waiting',due:{start:'2026-10-20'}})];
  const b=buildBriefing(tasks,new Date('2026-10-23T16:00:00Z'));assert.deepEqual(b.active.map(t=>t.id),['waiting']);assert.equal(b.waiting.length,1);assert.equal(b.urgent.length,1);
});
test('all recorded conflicting times and overnight commitments remain visible',()=>{
  const t=task('event',{schedules:[{start:'2026-10-22T23:00:00-04:00',end:'2026-10-23T01:00:00-04:00'},{start:'2026-10-23T14:00:00-04:00'}]});
  assert.equal(buildBriefing([t],new Date('2026-10-23T16:00:00Z')).agenda.length,2);
  assert.equal(dayOf('2026-11-01T05:30:00Z'),'2026-11-01');assert.equal(dayOf('2026-11-01T06:30:00Z'),'2026-11-01');assert.equal(dayOf('bad'),'');
});
test('search matches words across fields and lets users retrieve closed tasks',()=>{
  const tasks=[task('Call Alex',{notes:'Ask about renewal',category:'Personal'}),task('Paid bill',{status:'Done'}),task('reply',{status:'Waiting'})];
  assert.equal(findTasks(tasks,'alex RENEWAL').length,1);assert.equal(findTasks(tasks,'bill').length,0);assert.equal(findTasks(tasks,'bill','closed').length,1);assert.equal(findTasks(tasks,'','waiting')[0].id,'reply');assert.equal(findTasks(tasks,'','all').length,3);
});

test('money review uses actual deadlines, excludes closed tasks, and sorts the next 30 local dates',()=>{
  const b=buildMoneyReview([
    task('rent',{due:{start:'2026-10-23'}}),
    task('insurance',{due:{start:'2026-10-22'}}),
    task('subscription',{due:{start:'2026-11-22'}}),
    task('renew membership',{due:{start:'2026-11-23'}}),
    task('utility bill',{scheduled:{start:'2026-10-23'}}),
    task('invoice',{status:'Done',due:{start:'2026-10-20'}}),
    task('Call provider',{category:'Finance',due:{start:'2026-10-25'}}),
    task('rent a movie someday',{status:'Canceled'}),
    task('rentable equipment'),task('Read book',{notes:'invoice mentioned in an unrelated quote'})
  ],new Date('2026-10-24T02:00:00Z'));
  assert.equal(b.total,6);assert.equal(b.through,'2026-11-22');
  assert.deepEqual(b.attention.map(i=>i.task.id),['insurance','rent']);
  assert.deepEqual(b.upcoming.map(i=>i.task.id),['Call provider','subscription']);
  assert.equal(b.later[0].task.id,'renew membership');assert.equal(b.undated[0].task.id,'utility bill');
});
test('money review treats invalid dates as missing and handles month/year boundaries',()=>{
  const b=buildMoneyReview([task('bill',{due:{start:'invalid'}}),task('renewal',{due:{start:'2027-01-02T01:00:00Z'}})],new Date('2026-12-31T17:00:00Z'));
  assert.equal(b.through,'2027-01-30');assert.equal(b.undated.length,1);assert.equal(b.upcoming[0].date,'2027-01-01');
});
