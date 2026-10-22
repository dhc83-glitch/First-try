import {randomBytes,createHash} from 'node:crypto';
import {Store} from './store.js';

export const inboxSlots=['personal','school','professional'];
const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const decode=s=>Buffer.from(s||'','base64url').toString('utf8');
export function messageRecord(message,slot,email){
  const headers=Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
  function content(part){if(part.mimeType==='text/plain'&&part.body?.data)return decode(part.body.data);return (part.parts||[]).map(content).filter(Boolean).join('\n');}
  const text=content(message.payload||{});
  const newsletter=!!headers['list-unsubscribe'];
  return {id:message.id,key:`gmail:${email.toLowerCase()}:${message.id}`,slot,email,subject:headers.subject||'(No subject)',from:headers.from||'',receivedAt:new Date(Number(message.internalDate)||Date.now()).toISOString(),snippet:message.snippet||'',body:text.slice(0,10000),bodyTruncated:text.length>10000,bodyUnavailable:!text,category:newsletter?'Newsletter':slot==='school'?'School':slot==='professional'?'Career':'Personal',reviewNeeded:true,attachmentNotice:'Attachments are not read. Confirm dates and details against the original email.'};
}

// OAuth tokens are server-only, in an ignored, owner-readable local file.
export class Gmail {
  constructor({clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET,vault=new Store(new URL('./.local/google/',import.meta.url)),fetcher=fetch}={}){Object.assign(this,{clientId,clientSecret,vault,fetcher});this.pending=new Map();this.access=new Map();this.authBusy=false;}
  get configured(){return !!(this.clientId&&this.clientSecret);}
  async status(){const v=await this.vault.read();return {configured:this.configured,accounts:inboxSlots.map(slot=>({slot,connected:!!v.accounts?.[slot],email:v.accounts?.[slot]?.email||null}))};}
  begin(slot,origin){
    if(!this.configured)throw new Error('Google sign-in needs one-time app setup: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. See Gmail setup in README.');
    if(!inboxSlots.includes(slot))throw new Error('Unknown inbox.');
    if(this.authBusy)throw new Error('Another account is finishing sign-in. Try again shortly.');
    for(const [key,v]of this.pending)if(v.expires<Date.now())this.pending.delete(key);
    if(this.pending.size>20)throw new Error('Too many pending sign-ins. Wait ten minutes.');
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    const redirect=origin+'/oauth/gmail/callback';
    this.pending.set(state,{slot,verifier,redirect,expires:Date.now()+600000});
    const params=new URLSearchParams({client_id:this.clientId,redirect_uri:redirect,response_type:'code',scope,access_type:'offline',prompt:'consent select_account',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return GOOGLE_AUTH+'?'+params;
  }
  async token(body){const r=await this.fetcher(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:this.clientId,client_secret:this.clientSecret}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Google authorization failed. Reconnect this inbox; no email was changed.');return r.json();}
  async finish(state,code){
    const pending=this.pending.get(state);this.pending.delete(state);
    if(!pending||pending.expires<Date.now()||!code)throw new Error('Sign-in expired or was canceled. Start Connect Gmail again.');
    if(this.authBusy)throw new Error('Another sign-in is finishing. Start again in a moment.');
    this.authBusy=true;
    try{
      const tokens=await this.token({grant_type:'authorization_code',code,code_verifier:pending.verifier,redirect_uri:pending.redirect});
      if(!tokens.refresh_token)throw new Error('Google did not grant ongoing access. Reconnect and accept the read-only permission.');
      const profile=await this.get('/profile',tokens.access_token);
      const v=await this.vault.read();v.accounts||={};
      if(Object.entries(v.accounts).some(([slot,a])=>slot!==pending.slot&&a.email.toLowerCase()===profile.emailAddress.toLowerCase()))throw new Error('This Gmail account is already connected in another slot. Choose the intended account.');
      v.accounts[pending.slot]={email:profile.emailAddress,refreshToken:tokens.refresh_token};await this.vault.write(v);
      this.access.set(pending.slot,{token:tokens.access_token,expires:Date.now()+(tokens.expires_in||3600)*1000});return pending.slot;
    }finally{this.authBusy=false;}
  }
  async get(path,token){
    for(let attempt=0;attempt<3;attempt++){
      const r=await this.fetcher(GMAIL+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
      if((r.status===429||r.status>=500)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1000));continue;}
      if(!r.ok)throw new Error(`Gmail read failed (HTTP ${r.status}). Check this account's connection. Nothing was changed.`);
      return r.json();
    }
  }
  async readInbox(slot,previous=[]){
    const v=await this.vault.read(),account=v.accounts?.[slot];
    if(!account)return {slot,status:'not connected',messages:[]};
    let access=this.access.get(slot);
    if(!access||access.expires<Date.now()+60000){const t=await this.token({grant_type:'refresh_token',refresh_token:account.refreshToken});access={token:t.access_token,expires:Date.now()+(t.expires_in||3600)*1000};this.access.set(slot,access);}
    const existing=new Map(previous.filter(m=>m.email===account.email).map(m=>[m.id,m]));
    const ids=[];let next;
    do{
      const params=new URLSearchParams({labelIds:'INBOX',maxResults:'100',...(next?{pageToken:next}:{})});
      const page=await this.get('/messages?'+params,access.token);ids.push(...(page.messages||[]).map(m=>m.id));next=page.nextPageToken;
    }while(next&&ids.length<2000);
    const unique=[...new Set(ids)],messages=[];
    for(let i=0;i<unique.length;i+=5){
      const batch=await Promise.all(unique.slice(i,i+5).map(async id=>existing.get(id)||messageRecord(await this.get('/messages/'+encodeURIComponent(id)+'?format=full',access.token),slot,account.email)));
      messages.push(...batch);
    }
    return {slot,email:account.email,status:next?'incomplete':'checked',messages,count:messages.length,detail:next?'More than 2,000 inbox messages: scan limit reached. This is not a complete inbox check.':'Read current inbox messages, including read messages. Archived mail, spam, trash, attachments, and other folders are outside this check.'};
  }
}
