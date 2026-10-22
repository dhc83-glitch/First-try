import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planHomeContent,homeRich,homeValueEqual,readHomeTree} from '../home-content.js';
const block=(id,type,text,children)=>({id,type,last_edited_time:'v1',[type]:{rich_text:homeRich(text)},...(children?{has_children:true,children}:{})});
const row=(id,values)=>({id,type:'table_row',last_edited_time:'v1',table_row:{cells:values.map(homeRich)}});
const report={id:'run',finishedAt:'2026-10-22T18:00:00Z',cleanup:{today:'2026-10-22',displayDate:'Thursday, October 22, 2026',heldTaskIds:[]},sources:[],tasks:[{id:'a',title:'Submit example survey',status:'Done',done:true,notes:'Submitted',schedules:[]},{id:'b',title:'Prepare next exam',status:'To do',done:false,priority:'High',category:'School',notes:'Known score: 73',schedules:[]},{id:'c',title:'Attend evening meeting',status:'To do',done:false,kind:'Fixed commitment',doDate:{start:'2026-10-22'},schedules:[{start:'2026-10-22T23:00:00Z',end:'2026-10-23T00:00:00Z'}]}]};
function fixture(){return [block('date','callout','Wednesday · old',[block('summary','paragraph','Old summary')]),block('next-heading','heading_2','Do this next'),block('next','paragraph','Wednesday priority: submit example survey'),block('focus','callout','This week’s priority',[block('focus-body','paragraph','Wednesday: submit example survey')]),block('exec','callout','Wednesday execution order',[block('exec-body','paragraph','Wednesday old classes')]),block('week','toggle','Open all tasks & the full weekly schedule',[{id:'table',type:'table',has_children:true,table:{table_width:3},children:[row('header',['Day','Confirmed schedule','Preparation & reminders']),...Array.from({length:7},(_,i)=>row('day'+i,['old','old','old']))]}]),block('archive','toggle','Reference lists & previous layouts',[block('old','paragraph','Wednesday historical notes')])];}
test('Home is rebuilt across priority, execution and weekly rows; completed work disappears from current instructions',()=>{
 const tree=fixture(),plan=planHomeContent(tree,report),text=id=>plan.changes.find(c=>c.id===id)?.after.map(x=>x.text?.content||'').join('');
 for(const id of ['next','focus-body','exec','exec-body']){assert.ok(text(id));assert.doesNotMatch(text(id),/Wednesday|submit example survey/i);}
 assert.match(text('next'),/Thursday.*Prepare next exam/);assert.ok(plan.changes.some(c=>c.id==='day3'&&c.field==='cells'));assert.ok(plan.changes.find(c=>c.id==='day3').after[0][0].text.content.includes('TODAY'));assert.equal(plan.changes.some(c=>c.id==='old'),false);
 assert.ok(plan.coverage.includes('Execution plan'));assert.ok(plan.coverage.includes('Weekly schedule'));
 for(const c of plan.changes){const apply=rows=>{for(const b of rows){if(b.id===c.id)b[b.type][c.field]=structuredClone(c.after);if(b.children)apply(b.children);}};apply(tree);}
 const again=planHomeContent(tree,report);assert.equal(again.changes.length,0,JSON.stringify(again.changes.map(c=>({id:c.id,before:c.before,after:c.after}))));
});
test('explicit user decisions reconcile separate narrative references and preserve unrelated service questions',()=>{
 const tree=fixture();tree.push(block('facts','callout','Your updates',[block('fact','bulleted_list_item','Example service — canceled. You reported cancellation.')]),block('billing','callout','Needs confirmation: Example service may still bill weekly; Another service may duplicate its direct plan. Verify both in account settings.'));
 const change=planHomeContent(tree,report).changes.find(c=>c.id==='billing');const text=change.after.map(x=>x.text.content).join('');assert.match(text,/Example service — canceled/);assert.match(text,/Another service may duplicate/);assert.doesNotMatch(text,/may still bill weekly/);
});
test('tree traversal follows nested dashboard containers but never child pages, databases, synced content or old layouts',async()=>{
 const calls=[];const nodes={home:[{...block('container','column_list',''),has_children:true},{...block('old','toggle','Reference lists & previous layouts'),has_children:true},{id:'db',type:'child_database',has_children:true},{id:'page',type:'child_page',has_children:true},{id:'synced',type:'synced_block',has_children:true}],container:[block('text','paragraph','Nested dashboard')]};
 const tree=await readHomeTree({call:async path=>{const id=path.split('/')[2];calls.push(id);return {results:nodes[id],has_more:false};}},'home');assert.deepEqual(calls,['home','container']);assert.equal(tree[0].children[0].id,'text');
});
test('table verification compares every cell and rich-text segmentation safely',()=>{
 assert.ok(homeValueEqual([homeRich('one'),homeRich('two')],[homeRich('one'),homeRich('two')],'cells'));assert.equal(homeValueEqual([homeRich('one')],[homeRich('different')],'cells'),false);
});
test('saved decisions remain stable across repeated renders and preserve semicolons in unrelated notes',()=>{
 const tree=fixture();tree.push(block('facts','callout','Your updates',[block('fact','bulleted_list_item','Example service — canceled. Trial ended; another service remains separate.')]),block('billing','callout','Needs confirmation: Example service may bill; Another service has a separate plan.'));
 const first=planHomeContent(tree,report);
 for(const c of first.changes){const apply=rows=>{for(const b of rows){if(b.id===c.id)b[b.type][c.field]=structuredClone(c.after);if(b.children)apply(b.children);}};apply(tree);}
 assert.equal(planHomeContent(tree,report).changes.length,0);
});
