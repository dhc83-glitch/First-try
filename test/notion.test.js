import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Notion,task} from '../notion.js';
test('discovery recovers omitted sources from accessible page parents and deduplicates',async()=>{
 const client=new Notion('private',async(url,opts)=>{
   const body=opts.body?JSON.parse(opts.body):{};
   if(url.endsWith('/search'))return Response.json({results:body.filter.value==='data_source'?[{id:'known',title:[{plain_text:'Known'}]}]:[{parent:{type:'data_source_id',data_source_id:'known'}},{parent:{type:'data_source_id',data_source_id:'hidden'}},{parent:{type:'data_source_id',data_source_id:'hidden'}}],has_more:false});
   assert.ok(url.endsWith('/data_sources/hidden'));
   return Response.json({id:'hidden',title:[{plain_text:'Recovered'}]});
 });
 assert.deepEqual((await client.discover()).map(x=>x.title),['Known','Recovered']);
});
test('linked views explain how to find the original database',async()=>{
 const client=new Notion('private',async()=>Response.json({object:'database',data_sources:[]}));
 await assert.rejects(()=>client.source('view-id'),/linked view/);
});
test('Notion query paginates and sends pinned API version',async()=>{let calls=[];const client=new Notion('private',async(url,opts)=>{calls.push({url,...opts});return new Response(JSON.stringify(calls.length===1?{results:[{id:'a'}],has_more:true,next_cursor:'next'}:{results:[{id:'b'}],has_more:false}));});assert.deepEqual(await client.all('/data_sources/id/query',{}),[{id:'a'},{id:'b'}]);assert.equal(JSON.parse(calls[1].body).start_cursor,'next');assert.equal(calls[0].headers['Notion-Version'],'2025-09-03');});
test('properties normalize without reading unsupported content',()=>{const p={id:'x',properties:{Name:{type:'title',title:[{plain_text:'Task'}]},Status:{type:'status',status:{name:'Done'}},Notes:{type:'rich_text',rich_text:[{plain_text:'A note'}]}}};const result=task(p,{title:'Name',status:'Status',notes:'Notes'});assert.equal(result.title,'Task');assert.equal(result.status,'Done');assert.equal(result.notes,'A note');assert.equal(result.scheduled,null);});
