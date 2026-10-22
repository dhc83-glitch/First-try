import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audit,similar,localParts} from '../audit.js';
const now=new Date('2026-10-22T16:00:00Z');
const t=(id,extra={})=>({id,title:'Task '+id,status:'Active',category:'Work',...extra});
const types=(tasks,options)=>audit(tasks,options,now).map(i=>i.type);
test('overdue dates use New York day; done and inactive tasks excluded',()=>{
  assert.deepEqual(types([t('1',{due:{start:'2026-10-21'}}),t('2',{due:{start:'2026-10-22'}}),t('3',{status:'Done',due:{start:'2020-01-01'}}),t('4',{status:'Cancelled',due:{start:'2020-01-01'}})]),['Overdue']);
  assert.equal(localParts('2026-10-22T02:00:00Z','America/New_York').day,'2026-10-21');
});
test('completed future schedule is flagged, without active conflicts',()=>assert.deepEqual(types([t('1',{status:'Done',scheduled:{start:'2026-10-23T07:00:00-04:00'}})]),['Completed but scheduled']));
test('blocked interval has exclusive end and covers cross-midnight tasks',()=>{
  assert.deepEqual(types([t('1',{scheduled:{start:'2026-10-23T05:30:00-04:00',end:'2026-10-23T06:00:00-04:00'}})]),[]);
  assert.deepEqual(types([t('1',{scheduled:{start:'2026-10-23T09:30:00-04:00'}})]),[]);
  assert.deepEqual(types([t('1',{scheduled:{start:'2026-10-22T23:30:00-04:00',end:'2026-10-23T06:01:00-04:00'}})]),['Blocked time']);
  assert.deepEqual(types([t('1',{scheduled:{start:'2026-10-24T07:00:00-04:00'}})]),[]);
});
test('late discretionary categories and overlaps honor interval ends',()=>{
  assert.ok(types([t('1',{category:'Work, Optional',scheduled:{start:'2026-10-23T21:30:00-04:00'}})]).includes('Late discretionary work'));
  assert.deepEqual(types([t('1',{scheduled:{start:'2026-10-23T12:00:00-04:00'}}),t('2',{scheduled:{start:'2026-10-23T13:00:00-04:00'}})]),[]);
  assert.ok(types([t('1',{scheduled:{start:'2026-10-23T12:00:00-04:00'}}),t('2',{scheduled:{start:'2026-10-23T12:30:00-04:00'}})]).includes('Overlap'));
});
test('date-only and invalid schedule are reported explicitly',()=>assert.deepEqual(types([t('1',{scheduled:{start:'2026-10-23'}}),t('2',{scheduled:{start:'2026-10-23T12:00:00Z',end:'2026-10-23T11:00:00Z'}})]),['Missing time','Invalid schedule']));
test('duplicate heuristic handles punctuation and near matches',()=>{assert.ok(similar('Buy the weekly groceries!','Buy the weekly groceries'));assert.ok(similar('Prepare quarterly financial report','Prepare the quarterly financial report'));assert.ok(!similar('Call mom','Call dentist'));assert.ok(types([t('1',{title:'Buy milk'}),t('2',{title:'Buy milk'})]).includes('Possible duplicate'));});
test('New York DST is applied for winter blocked time',()=>assert.deepEqual(types([t('1',{scheduled:{start:'2026-12-01T11:00:00Z'}})]),['Blocked time']));
