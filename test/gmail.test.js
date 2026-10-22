import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Gmail,messageRecord,gmailFailureDetail} from '../gmail.js';
const vault=accounts=>{let data={version:1,history:[],accounts};return {read:async()=>structuredClone(data),write:async v=>{data=structuredClone(v);}};};
const raw=(id='m1')=>({id,internalDate:'1792670400000',snippet:'Review the assignment',payload:{mimeType:'multipart/alternative',headers:[{name:'Subject',value:'Assignment update'},{name:'From',value:'teacher@example.com'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Read the updated instructions.').toString('base64url')}}]}});
test('Gmail uses state and PKCE, readonly permission, and never returns tokens to the UI',async()=>{
 const v=vault({});let exchanged;
 const gmail=new Gmail({clientId:'id',clientSecret:'secret',vault:v,fetcher:async(url,options)=>{
   if(url.includes('/token')){exchanged=Object.fromEntries(options.body);return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});}
   return Response.json({emailAddress:'school@example.com'});
 }});
 const url=new URL(gmail.begin('school','http://127.0.0.1:3000'));
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(await gmail.finish(url.searchParams.get('state'),'code'),'school');assert.ok(exchanged.code_verifier);assert.equal(exchanged.redirect_uri,'http://127.0.0.1:3000/oauth/gmail/callback');
 const status=await gmail.status();assert.equal(status.accounts[1].email,'school@example.com');assert.ok(!JSON.stringify(status).includes('refresh'));assert.ok(!JSON.stringify(status).includes('access'));
 await assert.rejects(()=>gmail.finish(url.searchParams.get('state'),'code'),/expired/);
});
test('invalid state does not exchange codes',async()=>{const gmail=new Gmail({vault:vault({}),fetcher:()=>{throw Error('must not call');}});await assert.rejects(()=>gmail.finish('bad','code'),/expired/);});
test('Gmail inbox read paginates, caches immutable messages, and leaves emails untouched',async()=>{
 const calls=[];const gmail=new Gmail({clientId:'id',clientSecret:'secret',vault:vault({school:{email:'school@example.com',refreshToken:'private'}}),fetcher:async(url,opts)=>{
   calls.push({url,method:opts.method||'GET'});
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   if(url.includes('/messages?'))return Response.json(url.includes('pageToken=next')?{messages:[{id:'m2'}]}:{messages:[{id:'m1'}],nextPageToken:'next'});
   return Response.json(raw(url.includes('/m2')?'m2':'m1'));
 }});
 const result=await gmail.readInbox('school');assert.equal(result.status,'checked');assert.equal(result.messages.length,2);assert.ok(result.messages[0].body.includes('updated instructions'));
 const details=calls.filter(c=>c.url.includes('?format=full')).length;await gmail.readInbox('school',result.messages);assert.equal(calls.filter(c=>c.url.includes('?format=full')).length,details);assert.ok(calls.filter(c=>c.url.includes('gmail.googleapis.com')).every(c=>c.method==='GET'));
});
test('pagination cap reports incomplete instead of claiming every email was checked',async()=>{
 let page=0;const previous=[];
 const gmail=new Gmail({clientId:'id',clientSecret:'secret',vault:vault({personal:{email:'me@example.com',refreshToken:'private'}}),fetcher:async url=>{
   if(url.includes('/token'))return Response.json({access_token:'access',expires_in:3600});
   const messages=Array.from({length:100},(_,i)=>({id:'m'+(page*100+i)}));page++;return Response.json({messages,nextPageToken:'next'+page});
 }});
 for(let i=0;i<2000;i++)previous.push({id:'m'+i,email:'me@example.com'});
 const result=await gmail.readInbox('personal',previous);assert.equal(result.status,'incomplete');assert.equal(result.count,2000);
});
test('email text is data; newsletter and missing body are explicit',()=>{
 const m=raw();m.payload.headers.push({name:'List-Unsubscribe',value:'https://example.com'});m.payload.parts=[];
 const r=messageRecord(m,'personal','me@example.com');assert.equal(r.category,'Newsletter');assert.equal(r.bodyUnavailable,true);assert.equal(r.key,'gmail:me@example.com:m1');
});
test('Gmail failures show phase and safe Google codes without leaking response content',async()=>{
 const gmail=new Gmail({vault:vault({}),fetcher:async()=>Response.json({error:{status:'PERMISSION_DENIED',message:'private-response-content',details:[{reason:'SERVICE_DISABLED',metadata:{private:'do not show'}}]}},{status:403})});
 await assert.rejects(()=>gmail.get('/messages?maxResults=1','private-access-token'),e=>{
  const text=gmailFailureDetail(e);assert.match(text,/Listing inbox.*403.*SERVICE_DISABLED/);assert.match(text,/Enable Gmail API/);assert.ok(!text.includes('private'));return true;
 });
});
test('expired refresh permissions identify sign-in without exposing tokens',async()=>{
 const gmail=new Gmail({vault:vault({}),fetcher:async()=>Response.json({error:'invalid_grant',error_description:'private details'},{status:400})});
 await assert.rejects(()=>gmail.token({refresh_token:'private-token'}),e=>{assert.match(gmailFailureDetail(e),/Google sign-in.*invalid_grant/);assert.ok(!e.message.includes('private'));return true;});
});
