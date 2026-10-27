import {Updater} from './updater.js';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Notion,task,rich} from './notion.js';
import {audit,defaults} from './audit.js';
import {Store} from './store.js';
import {Assistant} from './assistant-service.js';
import {Gmail} from './gmail.js';
import {RefreshJob} from './refresh-job.js';

export function createApp({token=process.env.NOTION_TOKEN, databaseId=process.env.NOTION_DATABASE_ID, notion=token?new Notion(token):null,store=new Store(),gmail=new Gmail(),updater=new Updater({restart:process.env.ASSISTANT_MANAGED==='1'?()=>process.send?.({type:'restart'}):null})}={}){
  const csrf=randomBytes(32).toString('hex'); let snapshot=null; let busy=false;
  const assistant=new Assistant({notion,store,sourceId:databaseId,gmail});
  const job=new RefreshJob(assistant);
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const body=async req=>{let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw new Error('Request too large');}return JSON.parse(text||'{}');};
  const id=v=>{if(typeof v!=='string'||!/^[a-f0-9-]{32,36}$/i.test(v))throw new Error('Enter a valid Notion database or data source ID.');return v;};
  return http.createServer(async(req,res)=>{
    try {
      const host=req.headers.host||'';
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return json(res,403,{error:'Local access only'});
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='GET'&&path==='/oauth/gmail/callback'){
        const params=new URL(req.url,'http://localhost').searchParams;
        await gmail.finish(params.get('state'),params.get('code'));
        res.writeHead(303,{Location:'/','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
      }
      if(req.method==='GET'&&path==='/api/config')return json(res,200,{connected:!!notion,databaseId:databaseId||'',csrf,defaults});
      if(path.startsWith('/api/')){
        if(req.method!=='POST')return json(res,405,{error:'Use POST'});
        if(req.headers['x-auditor-token']!==csrf)return json(res,403,{error:'Reload the app before continuing.'});
        if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(res,403,{error:'Origin rejected'});
        const data=await body(req);
        if(path==='/api/updates/status')return json(res,200,await updater.status());
        if(updater.busy||updater.restarting)throw Error('The assistant is installing an update. Wait for it to restart.');
        if(path.startsWith('/api/updates/')){
          if(busy||job.running||assistant.busy)throw Error('Let the current refresh or edit finish before updating.');
          if(path==='/api/updates/check')return json(res,200,await updater.check());
          if(path==='/api/updates/install')return json(res,200,await updater.install(data));
          if(path==='/api/updates/rollback')return json(res,200,await updater.rollback());
        }
        if(path==='/api/gmail/status')return json(res,200,await gmail.status());
        if(path==='/api/gmail/connect')return json(res,200,{url:gmail.begin(data.slot,`http://${host}`)});
        if(path==='/api/assistant/state'){
          const currentJob=job.current?{...job.current}:null;
          return json(res,200,{...await assistant.state(),busy:busy||assistant.busy,job:currentJob});
        }
        if(path==='/api/assistant/organizer'){
          if(busy||job.running)throw Error('Wait until the refresh or update finishes.');
          return json(res,200,await assistant.organizerEdit(data));
        }
        if(!notion)return json(res,503,{error:'Set NOTION_TOKEN in the server environment, then restart. Never enter a token in chat.'});
        if(path==='/api/assistant/start'){if(busy)throw new Error('A Notion update is running.');return json(res,202,{job:job.start()});}
        if(path==='/api/assistant/stop')return json(res,200,job.stop());
        if(['/api/assistant/home-recovery-preview','/api/assistant/recover-home'].includes(path)){
          if(busy||job.running)throw Error('Let Refresh finish before inspecting publication.');
          if(path.endsWith('/home-recovery-preview'))return json(res,200,await assistant.inspectHomeOperation(data.id,{dryRun:true}));
          if(data.confirmed!==true)throw Error('Review and confirm the publication inspection first.');
          await assistant.inspectHomeOperation(data.id,{allowPartial:true});return json(res,200,{inspected:true});
        }
        if(['/api/assistant/capture','/api/assistant/recovery-preview','/api/assistant/restore'].includes(path)){
          if(busy||job.running)throw Error('Wait until the refresh or update finishes.');
          if(path.endsWith('/capture'))return json(res,200,await assistant.capture(data));
          if(path.endsWith('/recovery-preview'))return json(res,200,await assistant.recoveryPreview(data));
          return json(res,200,await assistant.restore(data));
        }
        if(path==='/api/assistant/update'){if(busy||job.running)throw new Error('Wait until this refresh finishes before saving an update.');return json(res,200,await assistant.saveUpdate(data));}
        if(path==='/api/assistant/email-window'){if(busy||job.running)throw new Error('Stop the running refresh and wait for the current batch first.');return json(res,200,await assistant.setEmailWindow(data));}
        if(job.running&&['/api/assistant/refresh','/api/assistant/approve','/api/assistant/mail-review','/api/assistant/resolve-task','/api/assistant/resolve-routine','/api/assistant/forget-decision','/api/assistant/home-preview','/api/assistant/home-approve','/api/audit','/api/update'].includes(path))throw new Error('Catch-up is running. Stop it and wait for the current batch before reviewing changes.');
        if(path==='/api/assistant/refresh'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.refresh());}
        if(path==='/api/assistant/approve'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.approve(data.proposalId,data.confirmed));}
        if(path==='/api/assistant/mail-review'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.reviewMail(data));}
        if(path==='/api/assistant/resolve-task'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.resolveTask(data));}
        if(path==='/api/assistant/resolve-routine'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.resolveRoutine(data));}
        if(path==='/api/assistant/forget-decision'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.forgetDecision(data));}
        if(path==='/api/assistant/home-preview'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.homePreview());}
        if(path==='/api/assistant/home-approve'){if(busy)throw new Error('A Notion update is running.');return json(res,200,await assistant.approveHome(data));}
        if(path==='/api/assistant/tasks-refresh'){if(busy||job.running)throw new Error('Finish or stop the running catch-up first.');return json(res,200,await assistant.refresh({taskOnly:true}));}
        if(path==='/api/databases')return json(res,200,{databases:await notion.discover()});
        if(path==='/api/schema'){
          const source=await notion.source(id(data.id));
          return json(res,200,{id:source.id,title:rich(source.title),properties:Object.entries(source.properties).map(([name,p])=>({name,type:p.type,options:(p.status?.options||p.select?.options||[]).map(o=>o.name)}))});
        }
        if(path==='/api/audit'){
          if(busy||assistant.busy)throw new Error('A refresh or update is already running.');
          const source=await notion.call(`/data_sources/${id(data.sourceId)}`);
          const map=data.map||{};
          const types={title:['title'],status:['status','select'],due:['date'],scheduled:['date'],category:['select','rich_text','multi_select'],priority:['select','status','rich_text'],notes:['rich_text']};
          for(const [key,allowed] of Object.entries(types)){
            if(!map[key]&& !['title','status','scheduled'].includes(key))continue;
            if(!allowed.includes(source.properties[map[key]]?.type))throw new Error(`Choose a compatible ${key} property.`);
          }
          const options={...defaults,...data.options};new Intl.DateTimeFormat('en',{timeZone:options.timezone});
          if(!Number.isFinite(+options.duration)||+options.duration<1||+options.duration>1440)throw new Error('Default duration must be 1–1440 minutes.');
          for(const key of ['completed','inactive','discretionary'])if(!Array.isArray(options[key])||options[key].some(x=>typeof x!=='string'))throw new Error(`Invalid ${key} labels.`);
          const pages=await notion.all(`/data_sources/${source.id}/query`,{});
          const tasks=pages.filter(p=>!p.archived&&!p.in_trash).map(p=>task(p,map));
          snapshot={sourceId:source.id,map,options,tasks};
          return json(res,200,{tasks,issues:audit(tasks,options),checkedAt:new Date().toISOString()});
        }
        if(path==='/api/update'){
          if(busy||assistant.busy)return json(res,409,{error:'Another refresh or update is in progress.'});
          if(data.confirmed!==true)throw new Error('Explicit confirmation is required.');
          const reviewed=snapshot;
          const old=reviewed?.tasks.find(t=>t.id===data.taskId);if(!old)throw new Error('Refresh tasks before editing.');
          if(!['clearSchedule','setSchedule'].includes(data.action))throw new Error('Unsupported update.');
          let date=null;
          if(data.action==='setSchedule'){
            if(typeof data.start!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(data.start)||!Number.isFinite(Date.parse(data.start)))throw new Error('A valid start time with timezone is required.');
            date={start:data.start};
            if(data.end){if(!/(Z|[+-]\d\d:\d\d)$/.test(data.end)||!Number.isFinite(Date.parse(data.end))||Date.parse(data.end)<=Date.parse(data.start))throw new Error('End must follow start.');date.end=data.end;}
          }
          busy=true;
          try {
            const current=await notion.call(`/pages/${id(old.id)}`);
            if(current.last_edited_time!==old.lastEdited)return json(res,409,{error:'Task changed in Notion. Refresh and review it again.'});
            if(current.archived||current.in_trash)throw new Error('Task is archived. Refresh tasks.');
            await notion.call(`/pages/${old.id}`,'PATCH',{properties:{[reviewed.map.scheduled]:{date}}});
            snapshot=null;
            return json(res,200,{updated:true});
          }finally{busy=false;}
        }
        return json(res,404,{error:'Unknown API route'});
      }
      const files={'/':'index.html','/app.js':'app.js','/briefing.js':'briefing.js','/planning.js':'planning.js','/task-state.js':'task-state.js','/organizer-ui.js':'organizer-ui.js','/style.css':'style.css'};
      if(req.method!=='GET'||!files[path])return json(res,404,{error:'Not found'});
      const content=await readFile(new URL(`./public/${files[path]}`,import.meta.url));
      res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(content);
    }catch(e){json(res,400,{error:e.message});}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const server=createApp();server.listen(Number(process.env.PORT)||3000,'127.0.0.1',async()=>{
   try{await new Store().read();await new Gmail().status();console.log('Personal Assistant running on local port '+(process.env.PORT||3000));process.send?.({type:'ready'});}catch{console.error('Saved records could not be opened. Startup stopped without changing them.');server.close(()=>process.exit(1));}
 });
 process.on('message',m=>{if(m?.type==='shutdown'){server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),4000).unref();}});
}
