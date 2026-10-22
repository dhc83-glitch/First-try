// Email text is evidence, never an instruction to this program.
import {isActive} from './assistant.js';
const stop=new Set('confirm confirmation attendance attend reply respond response email message send sent please thank thanks follow followup check about your their with that this from early careers campus connect invitation event details register registration rsvp request'.split(' '));
export const followupTokens=task=>[...new Set(task.title.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[])].filter(w=>w.length>=4&&!stop.has(w));
export const isCorrespondenceTask=t=>isActive(t)&&/^(?:confirm\b|reply\b|respond\b|rsvp\b|send\b.*\breply\b)/i.test(t.title)&&t.kind!=='Fixed commitment';
export function unquotedText(message){
 if(message.bodyUnavailable||!message.body)return '';
 return message.body.split(/\n(?:On [\s\S]{0,500}?wrote:|[- ]*Original Message[- ]*|From:|Begin forwarded message:)/i)[0].split('\n').filter(line=>!/^\s*>/.test(line)).join('\n').trim();
}
const addresses=text=>(text?.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[]);
const own=(m,email)=>addresses(m.from).includes(email.toLowerCase());
const negative=/\b(?:not|never|cannot|can['’]?t|won['’]?t|unable|decline|declining|cancel|cancelled|canceled|reschedul\w*|withdraw\w*|reconfirm|confirm again)\b/i;
const affirmation=/\b(?:I confirm|I['’]m confirming|I am confirming|confirm my attendance|I will attend|I['’]ll attend|I will be attending|I can attend|happy to attend|count me in|RSVP yes|look(?:ing)? forward to attending)\b/i;
const acknowledgement=/\b(?:thanks? (?:you )?(?:for )?(?:confirming|your confirmation|your response|replying|getting back)|thank you for (?:confirming|your confirmation|your response|replying|getting back)|confirmation (?:received|confirmed)|attendance (?:is )?confirmed|see you (?:there|on|at)|look(?:ing)? forward to (?:seeing|meeting) you|you['’]re (?:confirmed|registered)|you are (?:confirmed|registered))\b/i;
export function completionEvidence(task,conversations,now=new Date()){
 if(!isCorrespondenceTask(task)||/^confirm/i.test(task.title)&&!/\b(attendance|attend|rsvp|invitation|event|campus|meeting|interview)\b/i.test(task.title))return null;
 const tokens=followupTokens(task);if(!tokens.length)return null;
 const proofs=[];
 for(const thread of conversations){
  if(thread.complete!==true)continue;
  const messages=[...thread.messages].sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
  // Match subject/current authored text, not quoted invitations from other events.
  const topic=messages.map(m=>m.subject+' '+unquotedText(m)).join(' ').toLowerCase();
  const matches=tokens.filter(w=>new RegExp('\\b'+w+'\\b','iu').test(topic));
  if(matches.length<Math.min(2,tokens.length)||tokens.length===1&&tokens[0].length<5)continue;
  for(const sent of messages){
   const text=unquotedText(sent),sentAt=Date.parse(sent.receivedAt);
   if(!sent.labels?.includes('SENT')||!own(sent,thread.email)||!sent.messageId||sent.bodyTruncated||!text||negative.test(text)||!Number.isFinite(sentAt)||sentAt>+now)continue;
   if(/^confirm|^rsvp/i.test(task.title)&&!affirmation.test(text))continue;
   if(/^reply|^respond|^send/i.test(task.title)&&text.length<15)continue;
   for(const received of messages){
    const reply=unquotedText(received),receivedAt=Date.parse(received.receivedAt);
    const directlyReplies=received.inReplyTo?.trim()===sent.messageId.trim();
    if(!addresses(received.from).some(a=>addresses(sent.to).includes(a))||own(received,thread.email)||received.labels?.includes('SENT')||received.bodyTruncated||!directlyReplies||!reply||negative.test(reply)||!acknowledgement.test(reply)||!Number.isFinite(receivedAt)||receivedAt<=sentAt||receivedAt>+now)continue;
    // A later correction/request in the same conversation defeats the simple rule.
    if(messages.some(m=>Date.parse(m.receivedAt)>receivedAt&&(m.bodyUnavailable||m.bodyTruncated||negative.test(unquotedText(m)))))continue;
    proofs.push({taskId:task.id,slot:thread.slot,threadId:thread.id,email:thread.email,subject:sent.subject,sentId:sent.id,replyId:received.id,sentAt:sent.receivedAt,replyAt:received.receivedAt,sentExcerpt:text.slice(0,300),replyExcerpt:reply.slice(0,300)});
   }
  }
 }
 return proofs.length===1?proofs[0]:null;
}
export function completionCandidates(tasks,conversations,now=new Date()){
 const proposals=tasks.map(t=>({task:t,evidence:completionEvidence(t,conversations,now)})).filter(p=>p.evidence);
 // If the same proof could close different tasks, its target is ambiguous.
 return proposals.filter(p=>proposals.filter(other=>other.evidence.sentId===p.evidence.sentId&&other.evidence.replyId===p.evidence.replyId&&other.evidence.email===p.evidence.email).length===1);
}
