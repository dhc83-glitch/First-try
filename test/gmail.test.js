import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Gmail,messageRecord,gmailFailureDetail} from '../gmail.js';
const testGmail=options=>new Gmail({requestIntervalMs:0,sleep:async()=>{},now:()=>0,...options});
const vault=accounts=>{let data={version:1,history:[],accounts};return {read:async()=>structuredClone(data),write:async v=>{data=structuredClone(v);}};};
const raw=(id='m1')=>({id,internalDate:'1792670400000',snippet:'Review the assignment',payload:{mimeType:'multipart/alternative',headers:[{name:'Subject',value:'Assignment update'},{name:'From',value:'teacher@example.com'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Read the updated instructions.').toString('base64url')}}]}});
test('Gmail uses state and PKCE, readonly permission, and never returns tokens to the UI',async()=>{
 const v=vault({});let exchanged;
 const gmail=testGmail({clientId:'id',clientSecret:'secret',vault:v,fetcher:async(url,options)=>{
   if(url.includes('/token')){exchanged=Object.fromEntries(options.body);return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});}
   return Response.json({emailAddress:'school@example.com'});
 }});
 const url=new URL(gmail.begin('school','http://127.0.0.1:3000'));
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(await gmail.finish(url.searchParams.get('state'),'code'),'school');assert.ok(exchanged.code_verifier);assert.equal(exchanged.redirect_uri,'http://127.0.0.1:3000/oauth/gmail/callback');
 const status=await gmail.status();assert.equal(status.accounts[1].email,'school@example.com');assert.ok(!JSON.stringify(status).includes('refresh'));assert.ok(!JSON.stringify(status).includes('access'));
 await assert.rejects(()=>gmail.finish(url.searchParams.get('state'),'code'),/expired/);
});
test('invalid state does not exchange codes',async()=>{const gmail=testGmail({vault:vault({}),fetcher:()=>{throw Error('must not call');}});await assert.rejects(()=>gmail.finish('bad','code'),/expired/);});
test('Gmail inbox read paginates, caches immutable messages, and leaves emails untouched',async()=>{
 const calls=[];const gmail=testGmail({clientId:'id',clientSecret:'secret',vault:vault({school:{email:'school@example.com',refreshToken:'private'}}),fetcher:async(url,opts)=>{
   calls.push({url,method:opts.method||'GET'});
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?'))return Response.json(url.includes('pageToken=next')?{messages:[{id:'m2'}]}:{messages:[{id:'m1'}],nextPageToken:'next'});
   return Response.json(raw(url.includes('/m2')?'m2':'m1'));
 }});
 const result=await gmail.readInbox('school');assert.equal(result.status,'checked');assert.equal(result.messages.length,2);assert.ok(result.messages[0].body.includes('updated instructions'));
 const details=calls.filter(c=>c.url.includes('?format=full')).length;await gmail.readInbox('school',result.messages);assert.equal(calls.filter(c=>c.url.includes('?format=full')).length,details);assert.ok(calls.filter(c=>c.url.includes('gmail.googleapis.com')).every(c=>c.method==='GET'));
});
test('saved pagination cursors reach beyond 2,000 messages without duplicate body reads',async()=>{
 let scan,records=[],listCalls=0;const reads=new Map();
 const gmail=testGmail({maxNewMessages:500,vault:vault({personal:{email:'me@example.com',refreshToken:'private'}}),fetcher:async url=>{
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?')){
     listCalls++;const index=Number(new URL(url).searchParams.get('pageToken')||0);
     return Response.json({messages:Array.from({length:Math.min(100,2101-index)},(_,i)=>({id:'m'+(index+i)})),...(index+100<2101?{nextPageToken:String(index+100)}:{})});
   }
   const id=url.match(/\/messages\/(m\d+)/)[1];reads.set(id,(reads.get(id)||0)+1);return Response.json(raw(id));
 }});
 let result;for(let round=0;round<10;round++){
   result=await gmail.readInbox('personal',records,async(r,s)=>{records=structuredClone(r);scan=structuredClone(s);},scan,{reuseComplete:round>0});
   if(result.status==='checked')break;
 }
 assert.equal(result.status,'checked');assert.equal(result.count,2101);assert.equal(listCalls,22);assert.ok([...reads.values()].every(n=>n===1));
 const before=listCalls;await gmail.readInbox('personal',records,async()=>{},scan,{reuseComplete:true});assert.equal(listCalls,before);
});
test('email text is data; newsletter and missing body are explicit',()=>{
 const m=raw();m.payload.headers.push({name:'List-Unsubscribe',value:'https://example.com'});m.payload.parts=[];
 const r=messageRecord(m,'personal','me@example.com');assert.equal(r.category,'Newsletter');assert.equal(r.bodyUnavailable,true);assert.equal(r.key,'gmail:me@example.com:m1');
});
test('Gmail failures show phase and safe Google codes without leaking response content',async()=>{
 const gmail=testGmail({vault:vault({}),fetcher:async()=>Response.json({error:{status:'PERMISSION_DENIED',message:'private-response-content',details:[{reason:'SERVICE_DISABLED',metadata:{private:'do not show'}}]}},{status:403})});
 await assert.rejects(()=>gmail.get('/messages?maxResults=1','private-access-token'),e=>{
  const text=gmailFailureDetail(e);assert.match(text,/Listing inbox.*403.*SERVICE_DISABLED/);assert.match(text,/Enable Gmail API/);assert.ok(!text.includes('private'));return true;
 });
});
test('expired refresh permissions identify sign-in without exposing tokens',async()=>{
 const gmail=testGmail({vault:vault({}),fetcher:async()=>Response.json({error:'invalid_grant',error_description:'private details'},{status:400})});
 await assert.rejects(()=>gmail.token({refresh_token:'private-token'}),e=>{assert.match(gmailFailureDetail(e),/Google sign-in.*invalid_grant/);assert.ok(!e.message.includes('private'));return true;});
});
test('Google 403 rate limits back off and retry, honoring Retry-After',async()=>{
 let calls=0,time=0;const delays=[];
 const gmail=testGmail({now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms;},fetcher:async()=>++calls===1?Response.json({error:{errors:[{reason:'rateLimitExceeded'}]}},{status:403,headers:{'Retry-After':'2'}}):Response.json({ok:true})});
 assert.deepEqual(await gmail.get('/messages/test?format=full','private'),{ok:true});assert.equal(calls,2);assert.deepEqual(delays,[2000]);
});
test('permission errors are not retried as rate limits',async()=>{
 let calls=0;const gmail=testGmail({fetcher:async()=>{calls++;return Response.json({error:{errors:[{reason:'insufficientPermissions'}]}},{status:403});}});
 await assert.rejects(()=>gmail.get('/messages?maxResults=1','private'),/insufficientPermissions/);assert.equal(calls,1);
});
test('one shared queue paces reads across concurrent accounts',async()=>{
 let time=0,active=0,maximum=0;const starts=[];
 const gmail=testGmail({requestIntervalMs:300,now:()=>time,sleep:async ms=>{time+=ms;},fetcher:async()=>{active++;maximum=Math.max(active,maximum);starts.push(time);await Promise.resolve();active--;return Response.json({ok:true});}});
 await Promise.all(['a','b','c'].map(t=>gmail.get('/profile',t)));assert.equal(maximum,1);assert.deepEqual(starts,[0,300,600]);
});
test('rate-limited scan retains successful reads and resumes without rereading them',async()=>{
 let limited=true,firstReads=0,checkpoints=[];
 const gmail=testGmail({vault:vault({personal:{email:'me@example.com',refreshToken:'private'}}),fetcher:async url=>{
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?'))return Response.json({messages:[{id:'m1'},{id:'m2'}]});
   if(url.includes('/m1?')){firstReads++;return Response.json(raw('m1'));}
   return limited?Response.json({error:{errors:[{reason:'rateLimitExceeded'}]}},{status:403}):Response.json(raw('m2'));
 }});
 const first=await gmail.readInbox('personal',[],async records=>checkpoints.push(structuredClone(records)));
 assert.equal(first.status,'incomplete');assert.equal(first.count,1);assert.match(first.detail,/1 pending emails/);assert.equal(checkpoints.at(-1).length,1);
 limited=false;const resumed=await gmail.readInbox('personal',first.messages);assert.equal(resumed.status,'checked');assert.equal(resumed.count,2);assert.equal(firstReads,1);
});
test('small refresh batches make progress without duplicate messages',async()=>{
 const gmail=testGmail({maxNewMessages:2,vault:vault({personal:{email:'me@example.com',refreshToken:'private'}}),fetcher:async url=>{
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?'))return Response.json({messages:[{id:'m1'},{id:'m2'},{id:'m3'}]});
   return Response.json(raw(url.match(/\/messages\/(m\d)/)[1]));
 }});
 const first=await gmail.readInbox('personal');assert.equal(first.count,2);assert.equal(first.status,'incomplete');
 const second=await gmail.readInbox('personal',first.messages);assert.equal(second.count,3);assert.equal(second.status,'checked');assert.equal(new Set(second.messages.map(m=>m.id)).size,3);
});
test('recent-email scope replaces legacy full-history cursors and excludes old cache entries',async()=>{
 const time=Date.parse('2026-10-22T18:00:00Z'),queries=[];let checkpoint;
 const gmail=testGmail({now:()=>time,vault:vault({personal:{email:'me@example.com',refreshToken:'private'}}),fetcher:async url=>{
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?')){queries.push(new URL(url).searchParams);return Response.json({messages:[{id:'recent'}]});}
   return Response.json(raw('recent'));
 }});
 const old={id:'old',email:'me@example.com',receivedAt:'2020-01-01T00:00:00Z'};
 const legacy={email:'me@example.com',pageToken:'old-history-page',pendingIds:['old'],seenIds:['old'],listed:true,complete:false};
 const result=await gmail.readInbox('personal',[old],async(records,scan)=>checkpoint=structuredClone(scan),legacy);
 assert.equal(result.status,'checked');assert.deepEqual(result.messages.map(m=>m.id),['recent']);assert.equal(queries[0].get('pageToken'),null);assert.equal(queries[0].get('q'),'after:'+Math.floor((time-14*86400000)/1000));assert.equal(checkpoint.lookbackDays,14);assert.match(result.detail,/Older email/);
});
test('scope stays fixed across catch-up batches and resets when the user chooses fewer days',async()=>{
 let time=Date.parse('2026-10-22T18:00:00Z'),scan,records=[];const queries=[];
 const gmail=testGmail({now:()=>time,maxNewMessages:1,vault:vault({personal:{email:'me@example.com',refreshToken:'private'}}),fetcher:async url=>{
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?')){queries.push(new URL(url).searchParams.get('q'));return Response.json({messages:[{id:'m1'},{id:'m2'}]});}
   return Response.json(raw(url.includes('/m1?')?'m1':'m2'));
 }});
 const save=async(r,s)=>{records=structuredClone(r);scan=structuredClone(s);};
 await gmail.readInbox('personal',records,save,scan,{lookbackDays:14});const cutoff=scan.cutoffMs;time+=60000;
 await gmail.readInbox('personal',records,save,scan,{lookbackDays:14,reuseComplete:true});assert.equal(scan.cutoffMs,cutoff);assert.equal(queries.length,1);
 await gmail.readInbox('personal',records,save,scan,{lookbackDays:7});assert.equal(scan.lookbackDays,7);assert.notEqual(queries[0],queries[1]);
});
