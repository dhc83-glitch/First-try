import {randomUUID} from 'node:crypto';
import {readCentral,auditCentral,changesSince,buildPlan} from './assistant.js';
import {localParts} from './audit.js';
import {gmailFailureDetail} from './gmail.js';
import {cleanupReview,matchingDecisions} from './cleanup.js';
import {previewHome} from './home-summary.js';
import {rich} from './notion.js';
import {interpretUpdate,automaticCleanup,isDailyGoal} from './automatic.js';
const batchApproval=Symbol('authorized routine update');
const retainOperations=operations=>operations.filter((op,index)=>index<50||op.status!=='verified');

const pendingSources=(state,continuing)=>[
  ...['personal','school','professional'].map(slot=>{
    const scan=state.mailScans?.[slot],complete=continuing&&scan?.complete;
    return {name:slot[0].toUpperCase()+slot.slice(1)+' inbox',status:complete?'checked':'waiting',count:state.mailRecords?.[slot]?.length,detail:complete?'This inbox finished earlier in this catch-up.':'Waiting for the current batch result; this does not mean the connection is missing.'};
  }),
  {name:'External calendar (optional)',status:'not connected',optional:true,detail:'Only commitments stored in Central Tasks are checked.'}
];
export class Assistant {
  constructor({notion,store,sourceId,gmail,clock=()=>new Date()}){Object.assign(this,{notion,store,sourceId,gmail,clock});this.busy=false;}
  async state(){const s=await this.store.read();return {latest:s.latest,history:s.history,operations:s.operations||[],updates:s.updates||[],automatic:s.automatic||null,settings:{emailLookbackDays:s.settings?.emailLookbackDays||14},configured:!!this.notion};}
  async saveUpdate({text}){
    if(this.busy)throw new Error('Wait until this refresh finishes before saving an update.');
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('Enter an update of 1–2,000 characters.');
    this.busy=true;
    try{const state=await this.store.read();if((state.updates||[]).some(u=>u.status==='pending'&&u.text===text.trim()))return {saved:true,alreadyQueued:true};state.updates=[...(state.updates||[]),{id:randomUUID(),text:text.trim(),status:'pending',at:this.clock().toISOString()}];await this.store.write(state);return {saved:true};}finally{this.busy=false;}
  }
  async applyAutomatic(){
    const summary={at:this.clock().toISOString(),closedReminders:0,appliedUpdates:0,scheduled:0,dailyGoalUpdates:0,homeUpdated:false,exceptions:[]};
    const initial=await this.store.read(),coverage=initial.latest?.sources,coverageStatus=initial.latest?.status;
    if(!initial.latest?.tasks||initial.latest.status==='failed')return {...summary,exceptions:[{reason:'No successful Notion read is available.'}]};
    for(const op of initial.operations||[])if(op.status!=='verified')summary.exceptions.push({taskId:op.taskId,title:op.title,reason:'An earlier Notion write needs verification; automatic retry is blocked.'});
    const pending=(initial.updates||[]).filter(u=>u.status==='pending');
    // Later explicit instructions about the same task supersede earlier queued ones.
    const prepared=pending.map(update=>({update,parsed:interpretUpdate(update.text,initial.latest.tasks)}));
    for(let i=0;i<prepared.length;i++){
      const {update,parsed}=prepared[i];
      if(parsed.taskId&&prepared.slice(i+1).some(p=>p.parsed.taskId===parsed.taskId)){
        await this.recordUpdateOutcome(update.id,'superseded','Replaced by your later queued decision.');continue;
      }
      if(parsed.exception){summary.exceptions.push({updateId:update.id,reason:parsed.exception});await this.recordUpdateOutcome(update.id,'needs information',parsed.exception);continue;}
      try{
        if(parsed.action==='create')await this.createFromUpdate(update,parsed.title);
        else{
          const s=await this.store.read();
          await this.resolveTask({taskId:parsed.taskId,action:parsed.action,note:update.text.slice(0,1000),confirmed:true},{authorization:batchApproval,runId:s.latest.id,origin:'your queued update'});
          if(parsed.action==='done'&&isDailyGoal(initial.latest.tasks.find(t=>t.id===parsed.taskId))){
            const s=await this.store.read();s.dailyGoal={...s.dailyGoal,masterId:parsed.taskId,lastDay:localParts(this.clock(),'America/New_York').day,completedToday:true};await this.store.write(s);
          }
        }
        await this.recordUpdateOutcome(update.id,'applied','Verified in Notion.');summary.appliedUpdates++;
      }catch(error){summary.exceptions.push({updateId:update.id,title:parsed.title,reason:error.message});await this.recordUpdateOutcome(update.id,'needs verification',error.message);}
    }
    await this.refresh({taskOnly:true});
    const current=await this.store.read(),policy=automaticCleanup(current.latest.tasks,current.taskDecisions,this.clock());
    summary.exceptions.push(...policy.exceptions);
    const outstanding=(await this.store.read()).updates?.filter(u=>['needs information','needs verification'].includes(u.status))||[];
    for(const u of outstanding)if(!summary.exceptions.some(e=>e.updateId===u.id))summary.exceptions.push({updateId:u.id,reason:u.detail});
    for(const action of policy.actions){
      try{await this.resolveTask({...action,confirmed:true},{authorization:batchApproval,runId:current.latest.id,origin:'automatic reminder policy'});summary.closedReminders++;}
      catch(error){summary.exceptions.push({taskId:action.taskId,reason:error.message});}
    }
    try{summary.dailyGoalUpdates=await this.maintainDailyGoal();}catch(error){summary.exceptions.push({reason:'Daily goal: '+error.message});}
    await this.refresh({taskOnly:true});
    // Scheduling is deferred when inbox coverage or your explicit instructions are incomplete.
    let state=await this.store.read();
    if(coverage?.filter(s=>!s.optional).every(s=>s.status==='checked')&&!summary.exceptions.length){
      const blocked=new Set([...state.latest.cleanup.items.map(i=>i.taskId),...(state.operations||[]).filter(o=>o.status!=='verified').map(o=>o.taskId)]);
      // Reading email is not semantic triage. Do not reserve time while email
      // commitments have not been reconciled by the unfinished decision engine.
      if(state.latest.inboxReview.length)summary.exceptions.push({reason:'Email was collected, but automatic email-to-task reconciliation is still being built. Work times remain suggestions.'});
      for(const proposal of state.latest.plan.proposals.filter(p=>!summary.exceptions.length&&!blocked.has(p.taskId))){
        try{await this.approve(proposal.id,true,{authorization:batchApproval,runId:state.latest.id});summary.scheduled++;}
        catch(error){summary.exceptions.push({taskId:proposal.taskId,title:proposal.title,reason:error.message});break;}
      }
    }
    await this.refresh({taskOnly:true});
    state=await this.store.read();state.latest.sources=coverage?coverage.map(s=>s.name==='Central Tasks'?{...s,count:state.latest.tasks.length}:s):state.latest.sources;state.latest.status=coverageStatus||state.latest.status;state.latest.automatic=summary;await this.store.write(state);
    try{
      const pendingHome=state.operations?.find(o=>o.title==='Update Home dated task summary');
      if(pendingHome&&pendingHome.status!=='verified')throw new Error('An earlier Home update needs verification; it will not be overwritten automatically.');
      const preview=await this.homePreview();await this.approveHome({previewId:preview.id,confirmed:true});summary.homeUpdated=true;}catch(error){summary.exceptions.push({reason:'Home summary: '+error.message});}
    state=await this.store.read();state.automatic=summary;state.latest.automatic=summary;await this.store.write(state);return summary;
  }
  async recordUpdateOutcome(id,status,detail){const state=await this.store.read();const update=state.updates?.find(u=>u.id===id);if(update){update.status=status;update.detail=detail;await this.store.write(state);}}
  async createFromUpdate(update,title){
    const state=await this.store.read(),sourceKey='assistant-update:'+update.id;
    if(matchingDecisions(title,state.taskDecisions).length)throw new Error('A remembered cancellation/completion matches this title. No task was recreated.');
    if(state.latest.tasks.some(t=>t.title.trim().toLowerCase()===title.toLowerCase()&&!t.done&&!['Done','Canceled','Cancelled'].includes(t.status)))return;
    const sameTitle=await this.notion.all('/data_sources/'+state.sourceId+'/query',{filter:{property:'Task name',title:{equals:title}}});
    if(sameTitle.some(p=>!['Done','Canceled','Cancelled'].includes(p.properties.Status?.select?.name)))return;
    const existing=await this.notion.all('/data_sources/'+state.sourceId+'/query',{filter:{property:'Source',rich_text:{equals:sourceKey}}});
    if(existing.length)return;
    if((state.operations||[]).some(o=>o.updateId===update.id&&o.status!=='verified'))throw new Error('A prior creation attempt needs verification; it will not be retried automatically.');
    const schema=await this.notion.call('/data_sources/'+state.sourceId);
    if(schema.properties.Source?.type!=='rich_text'||schema.properties['Task name']?.type!=='title')throw new Error('Source/title columns are unavailable.');
    const choices=schema.properties.Status?.select?.options||[],status=choices.find(o=>o.name==='Inbox')?.name||choices.find(o=>o.name==='To do')?.name;
    if(!status)throw new Error('No existing Inbox or To do status is available.');
    const text=content=>[{text:{content}}];
    const properties={'Task name':{title:text(title)},Status:{select:{name:status}},Source:{rich_text:text(sourceKey)}};
    const operation={id:randomUUID(),updateId:update.id,title,at:this.clock().toISOString(),status:'pending verification',action:'create from your update'};
    state.operations=retainOperations([operation,...(state.operations||[])]);await this.store.write(state);
    try{
      const created=await this.notion.call('/pages','POST',{parent:{type:'data_source_id',data_source_id:state.sourceId},properties});
      const verified=await this.notion.call('/pages/'+created.id);
      if(rich(verified.properties.Source?.rich_text)!==sourceKey)throw new Error('Creation verification failed');
      operation.status='verified';operation.taskId=created.id;await this.store.write(state);
    }catch{operation.status='needs verification';await this.store.write(state);throw new Error('Creation outcome is uncertain. It will not be retried automatically.');}
  }
  async maintainDailyGoal(){
    const state=await this.store.read(),report=state.latest,today=localParts(this.clock(),'America/New_York').day;
    const goals=report.tasks.filter(isDailyGoal);
    if(state.dailyGoal?.pendingDay)throw new Error('An earlier daily-goal update needs verification; it will not be retried automatically.');
    if(goals.some(t=>state.taskDecisions?.[t.id]?.verified===false))throw new Error('A daily-goal decision needs verification; it will not be retried automatically.');
    if(!goals.length)return 0;
    let master=goals.find(t=>t.id===state.dailyGoal?.masterId);
    if(master&&state.taskDecisions?.[master.id]?.action==='cancel')return 0;
    if(!master){
      const active=goals.filter(t=>!['Canceled','Cancelled'].includes(t.status));
      master=active.find(t=>t.id===report.cleanup.routines[0]?.keeperId)||active.sort((a,b)=>(b.doDate?.start||'').localeCompare(a.doDate?.start||''))[0];
    }
    if(!master)return 0;
    let changed=0;
    for(const other of goals.filter(t=>t.id!==master.id&&!t.done&&!['Done','Canceled','Cancelled'].includes(t.status))){
      await this.resolveTask({taskId:other.id,action:'cancel',note:'Duplicate daily-goal reminder consolidated automatically. Kept master task: '+master.id,confirmed:true},{authorization:batchApproval,runId:report.id,origin:'automatic daily-goal policy'});changed++;
    }
    const current=await this.notion.call('/pages/'+master.id),fresh=await this.store.read();
    const decision=fresh.taskDecisions?.[master.id];
    const doneToday=(fresh.dailyGoal?.lastDay===today&&fresh.dailyGoal.completedToday)||(current.properties.Done?.checkbox===true&&(master.doDate?.start?.slice(0,10)===today||(decision?.at&&localParts(decision.at,'America/New_York').day===today)));
    if(fresh.dailyGoal?.lastDay===today||doneToday){
      fresh.dailyGoal={...fresh.dailyGoal,masterId:master.id,lastDay:today,completedToday:!!doneToday};await this.store.write(fresh);return changed;
    }
    if(current.last_edited_time!==master.lastEdited||current.archived||current.in_trash)throw new Error('The daily-goal master changed during refresh.');
    const schema=await this.notion.call('/data_sources/'+fresh.sourceId);
    if(!schema.properties.Status?.select?.options?.some(o=>o.name==='To do')||current.properties.Done?.type!=='checkbox'||current.properties['Do date']?.type!=='date')throw new Error('Daily-goal status/date columns are incompatible.');
    const properties={Status:{select:{name:'To do'}},Done:{checkbox:false},'Do date':{date:{start:today}}};
    for(const key of ['Start','Finish by','On calendar'])if(current.properties[key]?.type==='date'&&current.properties[key].date?.start?.slice(0,10)!==today)properties[key]={date:null};
    const operation={id:randomUUID(),taskId:master.id,title:master.title,at:this.clock().toISOString(),action:'refresh daily-goal master',status:'pending verification',before:current.properties,properties};
    fresh.operations=retainOperations([operation,...(fresh.operations||[])]);fresh.dailyGoal={...fresh.dailyGoal,masterId:master.id,pendingDay:today};await this.store.write(fresh);
    try{
      await this.notion.call('/pages/'+master.id,'PATCH',{properties});const verified=await this.notion.call('/pages/'+master.id);
      if(verified.properties.Status?.select?.name!=='To do'||verified.properties.Done?.checkbox!==false||verified.properties['Do date']?.date?.start!==today)throw new Error('Daily-goal verification failed');
      operation.status='verified';fresh.dailyGoal={...fresh.dailyGoal,lastDay:today,pendingDay:null,completedToday:false};
      if(fresh.taskDecisions?.[master.id]?.action==='done'){
        fresh.dailyGoal.history=[fresh.taskDecisions[master.id],...(fresh.dailyGoal.history||[])].slice(0,90);delete fresh.taskDecisions[master.id];
      }
      fresh.latest.needsRefresh=true;await this.store.write(fresh);return changed+1;
    }catch{operation.status='needs verification';await this.store.write(fresh);throw new Error('Daily-goal update needs verification; no completion was assumed.');}
  }
  async setEmailWindow({days}){
    if(this.busy)throw new Error('Stop the refresh and wait for its current batch first.');
    if(![7,14,30].includes(days))throw new Error('Choose 7, 14, or 30 days.');
    this.busy=true;
    try{const state=await this.store.read();state.settings={...state.settings,emailLookbackDays:days};if(state.latest)state.latest.needsRefresh=true;state.homePreview=null;await this.store.write(state);return {saved:true,days};}finally{this.busy=false;}
  }
  async refresh({continueCatchup=false,taskOnly=false}={}){
    if(this.busy)throw new Error('A refresh or update is already running. Wait for it to finish.');
    this.busy=true;
    let state,run;
    try {
      state=await this.store.read();const now=this.clock();
      run={id:randomUUID(),startedAt:now.toISOString(),status:'running',sources:[{name:'Central Tasks',status:'checking'},...pendingSources(state,continueCatchup)]};
      state.latest=run;await this.store.write(state);
      if(!this.notion)throw new Error('Notion is not connected to this app.');
      const slots=['personal','school','professional'];
      state.mailRecords||={};state.mailScans||={};let checkpoint=Promise.resolve();
      const saveProgress=(slot,messages,scan)=>{
        state.mailRecords[slot]=structuredClone(messages);if(scan)state.mailScans[slot]=structuredClone(scan);
        run.sources[slots.indexOf(slot)+1]={name:slot[0].toUpperCase()+slot.slice(1)+' inbox',status:scan?.complete?'checked':scan?.paused?'incomplete':'reading',count:messages.length,detail:scan?.complete||scan?.paused?scan.detail:'Progress saved; catch-up is continuing through the remaining inbox pages.'};
        const snapshot=structuredClone(state);
        checkpoint=checkpoint.then(()=>this.store.write(snapshot));return checkpoint;
      };
      const lookbackDays=state.settings?.emailLookbackDays||14;
      const reads=await Promise.allSettled([readCentral(this.notion,state.sourceId||this.sourceId),...slots.map(slot=>taskOnly?Promise.resolve({slot,status:'cached',messages:state.mailRecords[slot]||[],count:state.mailRecords[slot]?.length||0,detail:'Email was not rechecked in this Notion-only refresh; showing saved records.'}):this.gmail?this.gmail.readInbox(slot,state.mailRecords[slot]||[],(messages,scan)=>saveProgress(slot,messages,scan),state.mailScans[slot],{reuseComplete:continueCatchup,lookbackDays}):Promise.resolve({slot,status:'not connected',messages:[]}))]);
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
      const cleanup=cleanupReview(result.tasks,state.taskDecisions,now);
      const issues=auditCentral(result.tasks,now),plan=buildPlan(result.tasks.filter(t=>!cleanup.heldTaskIds.includes(t.id)),now);
      plan.assumptions[2]='External calendar is not connected. Only commitments recorded in Central Tasks reserve time. Email-derived tasks require your review before creation.';
      const successfulSlots=new Set(slots.filter((slot,i)=>reads[i+1].status==='fulfilled'&&['checked','incomplete','cached'].includes(reads[i+1].value.status)));
      const inboxReview=Object.entries(state.mailRecords).filter(([slot])=>successfulSlots.has(slot)).flatMap(([,records])=>records).filter(m=>!state.mailDecisions?.[m.key]&&(!m.receivedAt||Date.parse(m.receivedAt)>=+now-lookbackDays*86400000)).map(m=>({...m,rememberedDecisions:matchingDecisions(m.subject,state.taskDecisions)}));
      const report={...run,status:result.warnings.length===0&&mailSources.every(s=>s.status==='checked')?'complete':'partial',finishedAt:this.clock().toISOString(),sources:[{name:'Central Tasks',status:'checked',count:result.tasks.length},...mailSources,run.sources.at(-1)],warnings:result.warnings,tasks:result.tasks,issues,plan,cleanup,inboxReview,changes:changesSince(state.baseline?.tasks,result.tasks),notionChecked:true};
      const next={...state,sourceId:result.sourceId,baseline:{checkedAt:report.finishedAt,tasks:result.tasks},latest:report,history:[{id:report.id,status:report.status,startedAt:report.startedAt,finishedAt:report.finishedAt,taskCount:result.tasks.length,issueCount:issues.length},...state.history].slice(0,30)};
      await this.store.write(next);return report;
    }catch(e){
      if(state&&run){
        const failed={...run,status:'failed',finishedAt:this.clock().toISOString(),error:'The Notion read did not finish. Check change history for any earlier updates in this job. The previous successful comparison record was kept.'};
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
      if(matchingDecisions(title,state.taskDecisions).length||matchingDecisions(message.subject,state.taskDecisions).length)throw new Error('A remembered completion or cancellation matches this title. Review that decision before recreating this task.');
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
      state.operations=retainOperations([operation,...(state.operations||[])]);await this.store.write(state);
      try{
        const created=await this.notion.call('/pages','POST',{parent:{type:'data_source_id',data_source_id:state.sourceId},properties});
        const verified=await this.notion.call('/pages/'+created.id);
        if(!verified.properties.Source?.rich_text?.some(t=>(t.plain_text||t.text?.content||'').includes(key)))throw new Error('Source key verification failed');
        operation.status='verified';operation.taskId=created.id;state.mailDecisions[key]={decision:'created',taskId:created.id};state.latest.inboxReview=state.latest.inboxReview.filter(m=>m.key!==key);state.latest.needsRefresh=true;await this.store.write(state);return {created:true,verified:true};
      }catch{operation.status='needs verification';await this.store.write(state);throw new Error('Task creation needs verification. Refresh and inspect Notion; this will not be retried automatically.');}
    }finally{this.busy=false;}
  }
  async resolveTask({taskId,action,note='',confirmed},batch){
    const inBatch=batch?.authorization===batchApproval;
    const wasBusy=this.busy;
    if(confirmed!==true)throw new Error('Confirm this individual task decision first.');
    if(this.busy&&!inBatch)throw new Error('A refresh or update is running.');
    if(!['done','cancel'].includes(action))throw new Error('Choose completed or canceled.');
    if(typeof note!=='string'||note.length>1000)throw new Error('Keep the resolution note under 1,000 characters.');
    this.busy=true;
    try{
      const state=await this.store.read(),report=state.latest,old=report?.tasks?.find(t=>t.id===taskId);
      if(inBatch&&state.taskDecisions?.[taskId]?.verified===false)throw new Error('An earlier task decision needs verification; automatic retry is blocked.');
      if(!old||(report.needsRefresh&&!(inBatch&&batch.runId===report.id)))throw new Error('Refresh and review a current task first.');
      const current=await this.notion.call('/pages/'+taskId);
      if(current.last_edited_time!==old.lastEdited||current.archived||current.in_trash)throw new Error('Task changed in Notion. Refresh and review it again.');
      if(current.properties.Status?.type!=='select'||current.properties.Done?.type!=='checkbox')throw new Error('Status or Done columns changed. No update was made.');
      const schema=await this.notion.call('/data_sources/'+state.sourceId);
      const choices=schema.properties.Status?.select?.options?.map(o=>o.name)||[];
      const status=choices.find(name=>(action==='done'?['done','completed','complete']:['canceled','cancelled']).includes(name.toLowerCase()));
      if(!status)throw new Error('No compatible completed/canceled status exists. No database options were changed.');
      const properties={Status:{select:{name:status}},Done:{checkbox:action==='done'}};
      for(const field of ['Start','Finish by','Do date','On calendar']){
        if(current.properties[field]?.type==='date')properties[field]={date:null};
      }
      if(note.trim()){
        if(current.properties['Next action']?.type!=='rich_text')throw new Error('Next action cannot store the resolution note. Nothing was changed.');
        const original=current.properties['Next action'].rich_text||[];
        if(original.length>98)throw new Error('Existing notes are too long to append safely. Nothing was changed.');
        const cleaned=original.map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>['type','text','mention','equation','annotations'].includes(k))));
        properties['Next action']={rich_text:[...cleaned,{text:{content:'\nResolution ('+localParts(this.clock(),'America/New_York').day+'): '+note.trim()}}]};
      }
      const operation={id:randomUUID(),taskId,title:old.title,at:this.clock().toISOString(),status:'pending verification',action,origin:batch?.origin||'user review',before:current.properties,properties};
      state.operations=retainOperations([operation,...(state.operations||[])]);
      state.taskDecisions||={};state.taskDecisions[taskId]={action,title:old.title,note:note.trim(),at:operation.at,verified:false};
      report.needsRefresh=true;await this.store.write(state);
      try{
        await this.notion.call('/pages/'+taskId,'PATCH',{properties});
        const verified=await this.notion.call('/pages/'+taskId);
        if(verified.properties.Status?.select?.name!==status||verified.properties.Done?.checkbox!==(action==='done'))throw new Error('Status verification failed');
        for(const field of ['Start','Finish by','Do date','On calendar'])if(properties[field]&&verified.properties[field]?.date)throw new Error('Schedule verification failed');
        if(note.trim()&&!(verified.properties['Next action']?.rich_text||[]).map(p=>p.plain_text||p.text?.content||'').join('').includes(note.trim()))throw new Error('Resolution note verification failed');
        operation.status='verified';state.taskDecisions[taskId].verified=true;await this.store.write(state);return {updated:true,verified:true};
      }catch{operation.status='needs verification';await this.store.write(state);throw new Error('The decision was saved, but the Notion update needs verification. Refresh and inspect the task. No automatic retry will occur.');}
    }finally{this.busy=inBatch?wasBusy:false;}
  }
  async resolveRoutine({key,keeperId,confirmed}){
    if(confirmed!==true)throw new Error('Confirm the displayed routine cleanup first.');
    if(this.busy)throw new Error('A refresh or update is running.');
    this.busy=true;let changed=0;
    try{
      const state=await this.store.read(),report=state.latest;
      const group=report?.cleanup?.routines.find(g=>g.key===key);
      if(!group||report.needsRefresh||!group.members.some(m=>m.id===keeperId))throw new Error('Refresh and choose a current routine keeper.');
      const close=group.members.filter(m=>m.id!==keeperId);
      if(close.length>100)throw new Error('More than 100 repeats need a smaller reviewed cleanup batch. Nothing was changed.');
      for(const member of close){const current=await this.notion.call('/pages/'+member.id),old=report.tasks.find(t=>t.id===member.id);if(current.last_edited_time!==old.lastEdited||current.archived||current.in_trash)throw new Error('A routine task changed. Refresh before cleaning this group.');}
      for(const member of close){
        await this.resolveTask({taskId:member.id,action:'cancel',note:'Repeated daily-goal record closed after review. Kept task: '+keeperId,confirmed:true},{authorization:batchApproval,runId:report.id});changed++;
      }
      return {updated:changed,verified:true};
    }catch(error){throw new Error(`${changed} routine records verified so far. ${error.message} Refresh before another cleanup; completed changes will be retained.`);}finally{this.busy=false;}
  }
  async forgetDecision({taskId,confirmed}){
    if(confirmed!==true)throw new Error('Confirm forgetting this local decision.');
    if(this.busy)throw new Error('A refresh or update is running.');
    this.busy=true;
    try{const state=await this.store.read();if(state.taskDecisions)delete state.taskDecisions[taskId];if(state.latest)state.latest.needsRefresh=true;await this.store.write(state);return {forgotten:true,notionChanged:false};}finally{this.busy=false;}
  }
  async homePreview(){
    if(this.busy)throw new Error('Finish or stop the refresh first.');
    this.busy=true;
    try{const state=await this.store.read();const preview=await previewHome(this.notion,state.latest);state.homePreview=preview;await this.store.write(state);return preview;}finally{this.busy=false;}
  }
  async approveHome({previewId,confirmed}){
    if(confirmed!==true)throw new Error('Confirm the displayed Home summary update first.');
    if(this.busy)throw new Error('A refresh or update is running.');
    this.busy=true;
    try{
      const state=await this.store.read(),preview=state.homePreview;
      if(!preview||preview.id!==previewId||state.latest?.needsRefresh||preview.runId!==state.latest?.id)throw new Error('Generate a current Home preview first.');
      if(preview.date!==localParts(this.clock(),'America/New_York').day)throw new Error('The New York date changed. Refresh and generate a new Home preview.');
      for(const change of preview.changes){
        const current=await this.notion.call('/blocks/'+change.id);
        if(current.type!==change.type||current.last_edited_time!==change.lastEdited||JSON.stringify(current[change.type].rich_text)!==JSON.stringify(change.before))throw new Error('Home was edited since the preview. Generate a new preview before approving.');
      }
      const operation={id:randomUUID(),title:'Update Home dated task summary',at:this.clock().toISOString(),status:'pending verification',before:preview.changes.map(c=>({id:c.id,type:c.type,rich_text:c.before})),changes:preview.changes};
      state.operations=retainOperations([operation,...(state.operations||[])]);state.homePreview=null;await this.store.write(state);
      try{
        for(const change of preview.changes){
          await this.notion.call('/blocks/'+change.id,'PATCH',{[change.type]:{rich_text:change.after}});
          const current=await this.notion.call('/blocks/'+change.id);
          if(rich(current[change.type]?.rich_text)!==rich(change.after))throw new Error('Home verification failed');
        }
        operation.status='verified';await this.store.write(state);return {updated:true,verified:true};
      }catch{operation.status='needs verification';await this.store.write(state);throw new Error('Home may be partially updated. Inspect its dated callout before trying again. The original text was retained in the private operation record.');}
    }finally{this.busy=false;}
  }
  async approve(proposalId,confirmed,batch){
    const inBatch=batch?.authorization===batchApproval,wasBusy=this.busy;
    if(confirmed!==true)throw new Error('Confirm this individual Notion change first.');
    if(this.busy&&!inBatch)throw new Error('A refresh or update is already running.');
    this.busy=true;
    try{
      const state=await this.store.read(),report=state.latest;
      const proposal=report?.plan?.proposals.find(p=>p.id===proposalId);
      if(!proposal||(report.needsRefresh&&!(inBatch&&batch.runId===report.id)))throw new Error('Refresh and review a current suggestion first.');
      const current=await this.notion.call(`/pages/${proposal.taskId}`);
      if(current.last_edited_time!==proposal.lastEdited||current.archived||current.in_trash)throw new Error('This task changed in Notion. Refresh before approving it.');
      for(const field of ['Start','Finish by','Do date','On calendar'])if(current.properties[field]?.type!=='date')throw new Error(`The ${field} column is unavailable. Nothing was changed.`);
      const properties={'Start':{date:{start:proposal.start}},'Finish by':{date:{start:proposal.end}},'Do date':{date:{start:localParts(proposal.start,'America/New_York').day}},'On calendar':{date:{start:proposal.start,end:proposal.end}}};
      const operation={id:randomUUID(),taskId:proposal.taskId,title:proposal.title,at:this.clock().toISOString(),status:'pending verification',properties};
      // Persist intent before writing. Never automatically retry a possibly successful write.
      report.needsRefresh=true;report.plan.proposals=inBatch?report.plan.proposals.filter(p=>p.id!==proposalId):[];
      state.operations=retainOperations([operation,...(state.operations||[])]);await this.store.write(state);
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
    }finally{this.busy=inBatch?wasBusy:false;}
  }
}
