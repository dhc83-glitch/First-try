import {randomUUID} from 'node:crypto';
import {readCentral,auditCentral,changesSince,buildPlan} from './assistant.js';
import {localParts} from './audit.js';
import {gmailFailureDetail} from './gmail.js';

const pendingSources=()=>['Personal inbox','School inbox','Professional inbox','External calendar'].map(name=>({name,status:'not connected',detail:'Not checked. A separate app connection is required; ChatGPT connections are not inherited.'}));
export class Assistant {
  constructor({notion,store,sourceId,gmail,clock=()=>new Date()}){Object.assign(this,{notion,store,sourceId,gmail,clock});this.busy=false;}
  async state(){const s=await this.store.read();return {latest:s.latest,history:s.history,operations:s.operations||[],configured:!!this.notion};}
  async refresh({continueCatchup=false}={}){
    if(this.busy)throw new Error('A refresh or update is already running. Wait for it to finish.');
    this.busy=true;
    let state,run;
    try {
      state=await this.store.read();const now=this.clock();
      run={id:randomUUID(),startedAt:now.toISOString(),status:'running',sources:[{name:'Central Tasks',status:'checking'},...pendingSources()]};
      state.latest=run;await this.store.write(state);
      if(!this.notion)throw new Error('Notion is not connected to this app.');
      const slots=['personal','school','professional'];
      state.mailRecords||={};state.mailScans||={};let checkpoint=Promise.resolve();
      const saveProgress=(slot,messages,scan)=>{
        state.mailRecords[slot]=structuredClone(messages);if(scan)state.mailScans[slot]=structuredClone(scan);
        run.sources[slots.indexOf(slot)+1]={name:slot[0].toUpperCase()+slot.slice(1)+' inbox',status:scan?.complete?'checked':'reading',count:messages.length,detail:scan?.detail||'Progress saved; catch-up is continuing.'};
        const snapshot=structuredClone(state);
        checkpoint=checkpoint.then(()=>this.store.write(snapshot));return checkpoint;
      };
      const reads=await Promise.allSettled([readCentral(this.notion,state.sourceId||this.sourceId),...slots.map(slot=>this.gmail?this.gmail.readInbox(slot,state.mailRecords[slot]||[],(messages,scan)=>saveProgress(slot,messages,scan),state.mailScans[slot],{reuseComplete:continueCatchup}):Promise.resolve({slot,status:'not connected',messages:[]}))]);
      await checkpoint;
      state.mailRecords||={};const mailSources=[];
      for(let i=0;i<slots.length;i++){
        const read=reads[i+1],slot=slots[i],name=slot[0].toUpperCase()+slot.slice(1)+' inbox';
        if(read.status==='rejected'){mailSources.push({name,status:'failed',detail:gmailFailureDetail(read.reason)});continue;}
        const inbox=read.value;
        mailSources.push({name,status:inbox.status,count:inbox.count,canContinue:inbox.canContinue===true,detail:inbox.detail||'Not checked. Connect this Gmail account in the app.'});
        if(['checked','incomplete'].includes(inbox.status))state.mailRecords[slot]=inbox.messages;
      }
      run.sources=[{name:'Central Tasks',status:reads[0].status==='fulfilled'?'checked':'failed'},...mailSources,{name:'External calendar (optional)',status:'not connected',optional:true,detail:'Only commitments stored in Central Tasks are checked.'}];
      if(reads[0].status==='rejected')throw reads[0].reason;
      const result=reads[0].value;
      const issues=auditCentral(result.tasks,now),plan=buildPlan(result.tasks,now);
      plan.assumptions[2]='External calendar is not connected. Only commitments recorded in Central Tasks reserve time. Email-derived tasks require your review before creation.';
      const successfulSlots=new Set(slots.filter((slot,i)=>reads[i+1].status==='fulfilled'&&['checked','incomplete'].includes(reads[i+1].value.status)));
      const inboxReview=Object.entries(state.mailRecords).filter(([slot])=>successfulSlots.has(slot)).flatMap(([,records])=>records).filter(m=>!state.mailDecisions?.[m.key]);
      const report={...run,status:result.warnings.length===0&&mailSources.every(s=>s.status==='checked')?'complete':'partial',finishedAt:this.clock().toISOString(),sources:[{name:'Central Tasks',status:'checked',count:result.tasks.length},...mailSources,run.sources.at(-1)],warnings:result.warnings,tasks:result.tasks,issues,plan,inboxReview,changes:changesSince(state.baseline?.tasks,result.tasks),notionChecked:true};
      const next={...state,sourceId:result.sourceId,baseline:{checkedAt:report.finishedAt,tasks:result.tasks},latest:report,history:[{id:report.id,status:report.status,startedAt:report.startedAt,finishedAt:report.finishedAt,taskCount:result.tasks.length,issueCount:issues.length},...state.history].slice(0,30)};
      await this.store.write(next);return report;
    }catch(e){
      if(state&&run){
        const failed={...run,status:'failed',finishedAt:this.clock().toISOString(),error:'Refresh did not finish. No Notion changes were made. The previous successful comparison record was kept.'};
        await this.store.write({...state,latest:failed,history:[{id:run.id,status:'failed',startedAt:run.startedAt,finishedAt:failed.finishedAt},...state.history].slice(0,30)});
      }
      throw e;
    }finally{this.busy=false;}
  }
  async reviewMail({key,decision,title,due,confirmed}){
    if(this.busy)throw new Error('A refresh or update is running.');
    if(!['ignore','create'].includes(decision))throw new Error('Choose a review action.');
    if(decision==='create'&&confirmed!==true)throw new Error('Confirm this new Notion task first.');
    this.busy=true;
    try{
      const state=await this.store.read();
      const message=state.latest?.inboxReview?.find(m=>m.key===key);
      if(!message)throw new Error('Refresh and review this email again.');
      if(state.mailDecisions?.[key])return {alreadyReviewed:true};
      state.mailDecisions||={};
      if(decision==='ignore'){
        state.mailDecisions[key]={decision,at:this.clock().toISOString()};state.latest.inboxReview=state.latest.inboxReview.filter(m=>m.key!==key);await this.store.write(state);return {reviewed:true};
      }
      if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('Enter a task title of 1–200 characters.');
      if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due))throw new Error('Enter a valid due date or leave it empty.');
      const source=await this.notion.call(`/data_sources/${state.sourceId}`);
      const required={'Source':'rich_text','Task name':'title','Status':'select','Area':'select','Next action':'rich_text','Due date':'date'};
      for(const [name,type]of Object.entries(required))if(source.properties[name]?.type!==type)throw new Error(`The ${name} column is unavailable. Nothing was created.`);
      // A persistent Gmail source key prevents duplicate creation after retries or restarts.
      const existing=await this.notion.all(`/data_sources/${state.sourceId}/query`,{filter:{property:'Source',rich_text:{equals:key}}});
      if(existing.length){state.mailDecisions[key]={decision:'already linked',taskId:existing[0].id};state.latest.inboxReview=state.latest.inboxReview.filter(m=>m.key!==key);await this.store.write(state);return {alreadyLinked:true};}
      if((state.operations||[]).some(o=>o.mailKey===key&&o.status!=='verified'))throw new Error('A previous create attempt needs verification. Check Notion before trying again.');
      const text=content=>[{text:{content}}];
      const area=message.slot==='school'?'School':message.slot==='professional'?'Career':'Personal';
      const properties={'Task name':{title:text(title.trim())},Status:{select:{name:'To do'}},Area:{select:{name:area}},Source:{rich_text:text(key)},'Next action':{rich_text:text(('From: '+message.from+'\nEmail: '+message.subject+'\n'+message.snippet).slice(0,1900))},...(due?{'Due date':{date:{start:due}}}:{})};
      const operation={id:randomUUID(),mailKey:key,title:title.trim(),at:this.clock().toISOString(),status:'pending verification'};
      state.operations=[operation,...(state.operations||[])].slice(0,50);await this.store.write(state);
      try{
        const created=await this.notion.call('/pages','POST',{parent:{type:'data_source_id',data_source_id:state.sourceId},properties});
        const verified=await this.notion.call('/pages/'+created.id);
        if(!verified.properties.Source?.rich_text?.some(t=>(t.plain_text||t.text?.content||'').includes(key)))throw new Error('Source key verification failed');
        operation.status='verified';operation.taskId=created.id;state.mailDecisions[key]={decision:'created',taskId:created.id};state.latest.inboxReview=state.latest.inboxReview.filter(m=>m.key!==key);state.latest.needsRefresh=true;await this.store.write(state);return {created:true,verified:true};
      }catch{operation.status='needs verification';await this.store.write(state);throw new Error('Task creation needs verification. Refresh and inspect Notion; this will not be retried automatically.');}
    }finally{this.busy=false;}
  }
  async approve(proposalId,confirmed){
    if(confirmed!==true)throw new Error('Confirm this individual Notion change first.');
    if(this.busy)throw new Error('A refresh or update is already running.');
    this.busy=true;
    try{
      const state=await this.store.read(),report=state.latest;
      const proposal=report?.plan?.proposals.find(p=>p.id===proposalId);
      if(!proposal||report.needsRefresh)throw new Error('Refresh and review a current suggestion first.');
      const current=await this.notion.call(`/pages/${proposal.taskId}`);
      if(current.last_edited_time!==proposal.lastEdited||current.archived||current.in_trash)throw new Error('This task changed in Notion. Refresh before approving it.');
      for(const field of ['Start','Finish by','Do date','On calendar'])if(current.properties[field]?.type!=='date')throw new Error(`The ${field} column is unavailable. Nothing was changed.`);
      const properties={'Start':{date:{start:proposal.start}},'Finish by':{date:{start:proposal.end}},'Do date':{date:{start:localParts(proposal.start,'America/New_York').day}},'On calendar':{date:{start:proposal.start,end:proposal.end}}};
      const operation={id:randomUUID(),taskId:proposal.taskId,title:proposal.title,at:this.clock().toISOString(),status:'pending verification',properties};
      // Persist intent before writing. Never automatically retry a possibly successful write.
      report.needsRefresh=true;report.plan.proposals=[];
      state.operations=[operation,...(state.operations||[])].slice(0,50);await this.store.write(state);
      try{
        await this.notion.call(`/pages/${proposal.taskId}`,'PATCH',{properties});
        const verified=await this.notion.call(`/pages/${proposal.taskId}`);
        for(const [field,expected]of Object.entries(properties)){
          const actual=verified.properties[field]?.date;
          const equal=(a,b)=>a?.length===10||b?.length===10?a===b:Date.parse(a)===Date.parse(b);
          if(!actual||!equal(actual.start,expected.date.start)||(expected.date.end&&!equal(actual.end,expected.date.end)))throw new Error('Notion update could not be verified. Refresh and inspect the task before trying again.');
        }
        operation.status='verified';await this.store.write(state);
        return {updated:true,verified:true};
      }catch(e){
        operation.status='needs verification';await this.store.write(state);
        throw new Error('The update outcome is uncertain. Refresh and inspect this task in Notion before trying again. It will not be retried automatically.');
      }
    }finally{this.busy=false;}
  }
}
