import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completionEvidence,completionCandidates,unquotedText} from '../correspondence.js';
import {Gmail} from '../gmail.js';
const now=new Date('2026-10-22T20:00:00Z');
const task={id:'confirm',title:'Confirm Exampleco campus attendance',status:'Waiting',done:false,kind:'Follow-up'};
const sent={id:'sent',messageId:'<sent@example.com>',labels:['SENT'],from:'Me <me@example.com>',to:'Host <host@exampleco.com>',subject:'Exampleco campus event',body:'I confirm my attendance. I look forward to attending.',receivedAt:'2026-10-21T12:00:00Z'};
const reply={id:'reply',inReplyTo:'<sent@example.com>',labels:['INBOX'],from:'Host <host@exampleco.com>',to:'me@example.com',subject:'Re: Exampleco campus event',body:'Thank you for confirming. See you there!',receivedAt:'2026-10-21T13:00:00Z'};
const thread=(messages=[sent,reply],extra={})=>({id:'thread',slot:'professional',email:'me@example.com',complete:true,messages,...extra});
test('a sent attendance confirmation and direct positive acknowledgement provide a traceable completion',()=>{
 const proof=completionEvidence(task,[thread()],now);assert.equal(proof.taskId,'confirm');assert.equal(proof.sentId,'sent');assert.equal(proof.replyId,'reply');assert.match(proof.replyExcerpt,/Thank you/);
 assert.equal(completionEvidence({...task,title:'Attend Exampleco event',kind:'Fixed commitment'},[thread()],now),null);
});
test('an invitation, draft, unrelated acknowledgement, or quoted affirmation cannot close a task',()=>{
 for(const messages of [[reply],[{...sent,labels:['DRAFT']},reply],[sent,{...reply,inReplyTo:'<other>'}],[{...sent,body:'Not sure yet.\nOn Wednesday someone wrote:\nI confirm my attendance.'},reply],[{...sent,body:'> I confirm my attendance.'},reply],[sent,{...reply,from:'stranger@other.com'}]])assert.equal(completionEvidence(task,[thread(messages)],now),null);
 assert.equal(unquotedText({...sent,body:'My answer\nOn Wed,\nsomeone wrote:\nold reply'}),'My answer');
});
test('cancellations, later reconfirmations, incomplete bodies and different companies defeat automatic closure',()=>{
 for(const messages of [[{...sent,body:'I cannot attend.'},reply],[sent,{...reply,body:'Please confirm again.'}],[sent,reply,{...reply,id:'later',body:'We need to reschedule. Please confirm again.',receivedAt:'2026-10-22T13:00:00Z'}],[{...sent,bodyTruncated:true},reply],[sent,reply,{...reply,id:'later',bodyUnavailable:true,receivedAt:'2026-10-22T13:00:00Z'}]])assert.equal(completionEvidence(task,[thread(messages)],now),null);
 assert.equal(completionEvidence({...task,title:'Confirm Anotherco campus attendance'},[thread()],now),null);
 assert.equal(completionEvidence(task,[thread([sent,reply],{complete:false})],now),null);
});
test('one ambiguous thread cannot close two different tasks and completion is scoped to replies/confirmations',()=>{
 assert.equal(completionCandidates([task,{...task,id:'different'}],[thread()],now).length,0);
 assert.equal(completionEvidence({...task,title:'Review Exampleco application'},[thread()],now),null);
 assert.ok(completionEvidence({...task,title:'Reply to Exampleco campus invitation'},[thread()],now));
});
test('targeted conversation reading searches all mail, reads sent context, deduplicates threads, and never changes Gmail',async()=>{
 const paths=[];let threadReads=0;
 const vault={read:async()=>({accounts:{professional:{email:'me@example.com',refreshToken:'private'}}})};
 const gmail=new Gmail({vault,now:()=>+now,requestIntervalMs:0,fetcher:async(url,opts)=>{
  paths.push(url);assert.equal(opts.method,undefined);
  if(url.includes('/messages?')){const params=new URL(url).searchParams;assert.equal(params.has('labelIds'),false);assert.match(params.get('q'),/after:/);return Response.json({messages:[{id:'m1',threadId:'conversation'},{id:'m2',threadId:'conversation'}]});}
  threadReads++;return Response.json({id:'conversation',messages:[{id:'m1',threadId:'conversation',internalDate:String(+now-1000),labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'me@example.com'},{name:'To',value:'host@exampleco.com'},{name:'Message-ID',value:'<m1>'}],body:{data:Buffer.from('I confirm my attendance.').toString('base64url')}}}]});
 }});
 gmail.access.set('professional',{token:'private',expires:Date.now()+3600000});
 const result=await gmail.readCorrespondence([task]);assert.equal(threadReads,1);assert.equal(result.conversations[0].messages[0].labels[0],'SENT');assert.equal(result.conversations[0].messages[0].messageId,'<m1>');assert.equal(result.coverage.find(c=>c.slot==='professional').status,'checked');assert.equal(paths.length,2);
});
