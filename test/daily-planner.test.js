import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planDailyPlanner,samePlannerBlocks} from '../daily-planner.js';
import {rich} from '../notion.js';

const task=(id,extra={})=>({id,title:'Task '+id,status:'To do',done:false,schedules:[],...extra});
const report={finishedAt:'2026-10-23T18:00:00Z',cleanup:{today:'2026-10-23',items:[],heldTaskIds:[]},tasks:[task('done',{status:'Done',done:true}),task('later',{doDate:{start:'2026-10-25'}}),task('waiting',{status:'Waiting'}),task('a',{priority:'High',due:{start:'2026-10-23'}}),task('b'),task('c'),task('d'),task('meeting',{kind:'Fixed commitment',schedules:[{start:'2026-10-23T23:00:00Z',end:'2026-10-24T00:00:00Z'}]})],sources:[{name:'School inbox',status:'failed'}]};
const text=b=>rich(b[b.type].rich_text);
let serial=0;
const hydrate=blocks=>blocks.map(input=>{const b=structuredClone(input),nested=b[b.type].children;delete b[b.type].children;return {...b,id:'id'+(++serial),last_edited_time:'v1',...(nested?{has_children:true,children:hydrate(nested)}:{})};});

test('briefing shows three actionable tasks, separate commitments, actual deadlines and honest source limits',()=>{
 const plan=planDailyPlanner({id:'dated',last_edited_time:'v1',children:[]},report),rows=plan.append.children;
 assert.match(text(rows[1]),/1\. Task a/);assert.match(text(rows[1]),/2\. Task b/);assert.match(text(rows[1]),/3\. Task c/);
 assert.doesNotMatch(text(rows[1]),/Task (done|later|waiting|meeting|d)\b/);
 assert.match(text(rows[3]),/7:00 PM · Task meeting/);assert.match(text(rows[3]),/Due today · Task a/);
 assert.match(text(rows[4].toggle.children[0]),/Oct 23 · Task a/);
 assert.equal(text(rows[5].toggle.children[0]),'Task waiting');
 assert.match(text(rows[7].toggle.children[0]),/School inbox: failed/);
 assert.match(text(rows[7].toggle.children[0]),/Work times remain suggestions/);
});

test('repeat refresh edits owned content without appending again; next day removes yesterday’s commitments',()=>{
 const first=planDailyPlanner({id:'dated',children:[]},report),rows=hydrate(first.append.children),dated={id:'dated',children:rows};
 assert.ok(samePlannerBlocks(rows,first.append.children));
 assert.equal(planDailyPlanner(dated,report).changes.length,0);assert.equal(planDailyPlanner(dated,report).append,undefined);
 const friday=structuredClone(report);friday.cleanup.today='2026-10-24';friday.finishedAt='2026-10-24T18:00:00Z';
 const changed=planDailyPlanner(dated,friday);const commitment=changed.changes.find(c=>c.id===rows[3].id);
 assert.ok(commitment);assert.doesNotMatch(rich(commitment.after),/Task meeting|Due today/);
});

test('layout edits become visible exceptions rather than duplicate sections or overwritten user notes',()=>{
 const rows=hydrate(planDailyPlanner({id:'dated',children:[]},report).append.children);
 rows[5].children.push(...hydrate([{type:'paragraph',paragraph:{rich_text:[{text:{content:'My personal note'}}]}}]));
 assert.throws(()=>planDailyPlanner({id:'dated',children:rows},report),/edited/);
});

test('decisions show unresolved cleanup and update exceptions without inventing completion',()=>{
 const pending=structuredClone(report);pending.cleanup.items=[{title:'Confirm past game',type:'Past event still active'}];pending.automatic={exceptions:[{title:'Example reply',reason:'Conflicting evidence'}]};
 const rows=planDailyPlanner({id:'dated',children:[]},pending).append.children;
 const decision=text(rows[6].toggle.children[0]);assert.match(decision,/Confirm past game — Past event still active/);assert.match(decision,/Example reply — Conflicting evidence/);
});
