import {randomBytes,createHash} from 'node:crypto';
import {Store} from './store.js';

export const inboxSlots=['personal','school','professional'];
const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const knownReasons=new Set(['invalid_grant','invalid_client','insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT','accessNotConfigured','SERVICE_DISABLED','rateLimitExceeded','userRateLimitExceeded','RESOURCE_EXHAUSTED','domainPolicy','authError','notFound','invalidArgument','backendError','PERMISSION_DENIED','UNAUTHENTICATED']);
export function gmailFailureDetail(error){
  if(error?.gmailDiagnostic)return error.gmailDiagnostic;
  if(['TimeoutError','AbortError'].includes(error?.name))return 'Gmail request timed out. Try Refresh again. Saved inbox records were kept.';
  return 'The Gmail reader encountered an unexpected error. A local diagnostic is needed; saved inbox records were kept.';
}
async function googleFailure(response,stage){
  const data=await response.json().catch(()=>({}));
  const codes=[typeof data.error==='string'?data.error:null,data.error?.status,...(data.error?.errors||[]).map(e=>e.reason),...(data.error?.details||[]).map(e=>e.reason)].filter(c=>knownReasons.has(c));
  let advice='Try Refresh again. If this persists, report this error code.';
  if(codes.some(c=>['invalid_grant','UNAUTHENTICATED','authError'].includes(c))||response.status===401)advice='The Google permission expired or was revoked. Reconnect this inbox.';
  if(codes.includes('invalid_client'))advice='Check the Google Client ID and Client Secret in the private .env file, then restart the app.';
  if(codes.some(c=>['insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(c)))advice='Reconnect this inbox and grant the read-only Gmail permission.';
  if(codes.some(c=>['SERVICE_DISABLED','accessNotConfigured'].includes(c)))advice='Enable Gmail API in the Google Cloud project that owns this Client ID.';
  if(response.status===429||codes.some(c=>['rateLimitExceeded','userRateLimitExceeded','RESOURCE_EXHAUSTED'].includes(c)))advice='Google limited the request rate. Wait a minute, then Refresh again.';
  if(codes.includes('domainPolicy'))advice='Your school or work administrator must allow this app.';
  const diagnostic=`${stage}: Google HTTP ${response.status}${codes.length?' ('+[...new Set(codes)].join(', ')+')':''}. ${advice} Saved records were kept.`;
  const error=new Error(diagnostic);error.gmailDiagnostic=diagnostic;error.httpStatus=response.status;
  error.rateLimited=response.status===429||codes.some(c=>['rateLimitExceeded','userRateLimitExceeded','RESOURCE_EXHAUSTED'].includes(c));
  const retry=response.headers.get('retry-after');
  error.retryAfterMs=retry?Math.max(0,/^\d+(\.\d+)?$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now()):0;
  return error;
}
const decode=s=>Buffer.from(s||'','base64url').toString('utf8');
export function messageRecord(message,slot,email){
  const headers=Object.fromEntries((message.payload?.headers||[]).filter(h=>typeof h.name==='string').map(h=>[h.name.toLowerCase(),h.value]));
  function content(part){if(part.mimeType==='text/plain'&&part.body?.data)return decode(part.body.data);return (part.parts||[]).map(content).filter(Boolean).join('\n');}
  const text=content(message.payload||{});
  const newsletter=!!headers['list-unsubscribe'];
  return {id:message.id,key:`gmail:${email.toLowerCase()}:${message.id}`,slot,email,subject:headers.subject||'(No subject)',from:headers.from||'',receivedAt:new Date(Number(message.internalDate)||Date.now()).toISOString(),snippet:message.snippet||'',body:text.slice(0,10000),bodyTruncated:text.length>10000,bodyUnavailable:!text,category:newsletter?'Newsletter':slot==='school'?'School':slot==='professional'?'Career':'Personal',reviewNeeded:true,attachmentNotice:'Attachments are not read. Confirm dates and details against the original email.'};
}

// OAuth tokens are server-only, in an ignored, owner-readable local file.
export class Gmail {
  constructor({clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET,vault=new Store(new URL('./.local/google/',import.meta.url)),fetcher=fetch,requestIntervalMs=300,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now(),maxNewMessages=40}={}){Object.assign(this,{clientId,clientSecret,vault,fetcher,requestIntervalMs,sleep,now,maxNewMessages});this.pending=new Map();this.access=new Map();this.authBusy=false;this.queue=Promise.resolve();this.nextRequestAt=0;this.cooldownUntil=0;this.lastRateError=null;}
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
  async token(body){const r=await this.fetcher(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:this.clientId,client_secret:this.clientSecret}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw await googleFailure(r,'Google sign-in');return r.json();}
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
    for(let attempt=0;attempt<4;attempt++){
      const read=this.queue.then(async()=>{
        const wait=Math.max(this.nextRequestAt,this.cooldownUntil)-this.now();
        if(wait>30000&&this.lastRateError)throw this.lastRateError;
        if(wait>0)await this.sleep(wait);
        this.nextRequestAt=this.now()+this.requestIntervalMs;
        const response=await this.fetcher(GMAIL+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
        if(response.ok)return {data:await response.json()};
        const error=await googleFailure(response,path.startsWith('/messages?')?'Listing inbox':path.startsWith('/messages/')?'Reading email':'Checking account');
        if(error.rateLimited||response.status>=500){
          const delay=Math.max(error.retryAfterMs||0,1000*2**attempt);
          this.cooldownUntil=Math.max(this.cooldownUntil,this.now()+delay);
          this.lastRateError=error;
        }
        return {error};
      });
      this.queue=read.then(()=>{},()=>{});
      const {data,error}=await read;
      if(!error)return data;
      if((error.rateLimited||error.httpStatus>=500)&&attempt<3)continue;
      throw error;
    }
  }
  async readInbox(slot,previous=[],onProgress=async()=>{},savedScan=null,{reuseComplete=false}={}){
    const v=await this.vault.read(),account=v.accounts?.[slot];
    if(!account)return {slot,status:'not connected',messages:[],canContinue:false};
    const existing=new Map(previous.filter(m=>m.email===account.email).map(m=>[m.id,m]));
    let scan=savedScan?.email===account.email?structuredClone(savedScan):null;
    if(reuseComplete&&scan&&(scan.complete||scan.paused))return {slot,email:account.email,status:scan.complete?'checked':'incomplete',messages:[...existing.values()],count:existing.size,canContinue:false,detail:scan.detail||'Current inbox scan finished.'};
    if(!scan||scan.complete)scan={email:account.email,startedAt:new Date().toISOString(),pageToken:null,listed:false,pendingIds:[],seenIds:[],complete:false,paused:false};
    scan.paused=false;
    let access=this.access.get(slot);
    if(!access||access.expires<Date.now()+60000){const t=await this.token({grant_type:'refresh_token',refresh_token:account.refreshToken});access={token:t.access_token,expires:Date.now()+(t.expires_in||3600)*1000};this.access.set(slot,access);}
    let fetched=0,pages=0,errorDetail='';
    const checkpoint=()=>onProgress([...existing.values()],scan);
    const seen=new Set(scan.seenIds);
    while(fetched<this.maxNewMessages&&pages<4){
      if(scan.pendingIds.length){
        const id=scan.pendingIds[0];
        if(existing.has(id)){scan.pendingIds.shift();continue;}
        try{
          const record=messageRecord(await this.get('/messages/'+encodeURIComponent(id)+'?format=full',access.token),slot,account.email);
          existing.set(id,record);scan.pendingIds.shift();fetched++;
        }catch(error){
          if(error.httpStatus===404){scan.pendingIds.shift();continue;}
          scan.paused=true;errorDetail=gmailFailureDetail(error);break;
        }
        if(fetched%10===0)await checkpoint();
        continue;
      }
      if(scan.listed&&!scan.pageToken)break;
      try{
        const params=new URLSearchParams({labelIds:'INBOX',maxResults:'100',...(scan.pageToken?{pageToken:scan.pageToken}:{})});
        const page=await this.get('/messages?'+params,access.token);pages++;
        if(page.nextPageToken&&page.nextPageToken===scan.pageToken)throw new Error('Gmail pagination did not advance.');
        for(const message of page.messages||[]){if(!seen.has(message.id)){seen.add(message.id);scan.pendingIds.push(message.id);}}
        scan.seenIds=[...seen];scan.pageToken=page.nextPageToken||null;scan.listed=true;
        await checkpoint();
      }catch(error){
        // Expired pagination cursors restart inventory while preserving cached bodies.
        if(error.httpStatus===400&&scan.pageToken&&(scan.restarts||0)<1){scan.restarts=(scan.restarts||0)+1;scan.pageToken=null;scan.listed=false;scan.pendingIds=[];scan.seenIds=[];scan.detail='Inventory cursor expired; restarting the listing with saved emails retained.';await checkpoint();return {slot,email:account.email,status:'incomplete',messages:[...existing.values()],count:existing.size,canContinue:true,detail:scan.detail};}
        scan.paused=true;errorDetail=gmailFailureDetail(error);break;
      }
    }
    scan.complete=scan.listed&&!scan.pageToken&&scan.pendingIds.length===0;
    if(scan.complete){for(const id of existing.keys())if(!seen.has(id))existing.delete(id);}
    const remaining=scan.pendingIds.filter(id=>!existing.has(id)).length;
    scan.detail=[errorDetail,`${existing.size} emails saved.`,scan.complete?'All pages of this inbox scan have been read.':`${remaining} pending emails on listed pages${scan.pageToken?'; additional inbox pages remain':''}.`,scan.paused?'Catch-up paused. Progress was kept; click Refresh to retry.':!scan.complete?'Automatic catch-up can continue from this point.':'','Current INBOX only; archived mail, spam, trash, and attachments are outside this check.'].filter(Boolean).join(' ');
    await checkpoint();
    return {slot,email:account.email,status:scan.complete?'checked':'incomplete',messages:[...existing.values()],count:existing.size,canContinue:!scan.complete&&!scan.paused,detail:scan.detail};
  }
}
