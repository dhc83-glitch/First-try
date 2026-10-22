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
test('temporary read timeouts and server errors recover, including POST search/query',async()=>{
 for(const [path,method]of [['/blocks/home','GET'],['/search','POST'],['/data_sources/source/query','POST']]){
  let calls=0;const delays=[];
  const client=new Notion('private',async()=>{calls++;if(calls===1)throw new DOMException('Timed out','TimeoutError');if(calls===2)return Response.json({message:'Temporary error'},{status:503});return Response.json({results:[],ok:true});},{sleep:async ms=>delays.push(ms)});
  assert.equal((await client.call(path,method,{})).ok,true);assert.equal(calls,3);assert.deepEqual(delays,[500,1000]);
 }
});
test('ambiguous writes are never replayed after timeouts or server errors',async()=>{
 for(const failure of ['timeout','server'])for(const [path,method]of [['/pages','POST'],['/blocks/heading','PATCH']]){
  let calls=0;const client=new Notion('private',async()=>{calls++;if(failure==='timeout')throw new DOMException('Timed out','TimeoutError');return Response.json({message:'Temporary error'},{status:503});},{sleep:async()=>assert.fail('A write must not be retried')});
  await assert.rejects(()=>client.call(path,method,{}),failure==='timeout'?/outcome must be verified/:/Notion 503/);assert.equal(calls,1);
 }
});
test('permanent permission failures are not retried and read timeouts stop after three attempts',async()=>{
 let calls=0;const denied=new Notion('private',async()=>{calls++;return Response.json({message:'Access denied'},{status:403});},{sleep:async()=>{}});
 await assert.rejects(()=>denied.call('/blocks/home'),/Notion 403/);assert.equal(calls,1);
 calls=0;const timeout=new Notion('private',async()=>{calls++;throw new DOMException('Timed out','TimeoutError');},{sleep:async()=>{}});
 await assert.rejects(()=>timeout.call('/blocks/home'),/bounded read retries/);assert.equal(calls,3);
});
test('parallel Notion calls share one queue rather than issuing overlapping requests',async()=>{
 let active=0,maxActive=0,release;const gate=new Promise(r=>release=r);let calls=0;
 const client=new Notion('private',async()=>{calls++;active++;maxActive=Math.max(maxActive,active);if(calls===1)await gate;active--;return Response.json({ok:true});});
 const first=client.call('/blocks/one'),second=client.call('/blocks/two');await Promise.resolve();release();await Promise.all([first,second]);assert.equal(maxActive,1);assert.equal(calls,2);
});
