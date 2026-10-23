import {dayOf} from './briefing.js';
import {shiftDay,weeklyReview,dailyPriorities,refreshSummary} from './planning.js';

export function createOrganizer({api,el,say,reload,format,taskLink}){
  const root=document.getElementById('organizerPanel');
  let state,editing=null,editingRevision=null,revision=0,requestId=crypto.randomUUID(),listKey='',busy=false;
  const button=(title,fn)=>{const b=el('button',title);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){say(e.message,true);}finally{b.disabled=busy;}};return b;};
  const label=(title,input)=>{const l=el('label',title);input.setAttribute('aria-label',title);l.append(input);return l;};
  const input=(type='text',max=200)=>{const n=el('input');n.type=type;n.maxLength=max;return n;};
  const options=choices=>{const s=el('select');for(const [value,title] of choices){const o=el('option',title);o.value=value;s.append(o);}return s;};
  const group=(title)=>{const d=el('details');d.append(el('summary',title));return d;};
  const taskCard=(task,detail)=>{const card=el('article',undefined,'brief-task');card.append(el('h3',task.title),el('p',detail));if(task.notes)card.append(el('p',task.notes,'hint'));taskLink(task,card);return card;};
  root.append(el('h2','Make room for the week'));
  const summary=el('div');summary.id='refreshDigest';root.append(summary);
  const priorities=group('A short list for today');priorities.open=true;priorities.id='priorityView';const priorityBody=el('div');priorities.append(priorityBody);root.append(priorities);
  const weekly=group('Weekly review');weekly.id='weeklyView';const weeklyBody=el('div');weekly.append(weeklyBody);root.append(weekly);

  const capture=group('Quick capture → Notion');capture.id='captureView';
  capture.append(el('p','Save a task here, then Refresh to create it in Central Tasks. Its actual deadline stays separate from planned work time.','hint'));
  const captureForm=el('form'),captureTitle=input(),captureDue=input('date'),captureArea=input('text',80),captureNext=el('textarea');captureTitle.required=true;captureNext.maxLength=1500;captureNext.rows=2;
  captureArea.setAttribute('list','knownAreas');const areas=el('datalist');areas.id='knownAreas';
  const captureGrid=el('div',undefined,'grid');captureGrid.append(label('Task',captureTitle),label('Actual deadline (optional)',captureDue),label('Existing Notion area (optional)',captureArea));
  const captureSave=el('button','Save task for next refresh');captureSave.type='submit';
  captureForm.append(captureGrid,label('Next action (optional)',captureNext),captureSave,areas);capture.append(captureForm);root.append(capture);
  captureForm.onsubmit=async e=>{e.preventDefault();captureSave.disabled=true;try{await api('assistant/capture',{requestId,title:captureTitle.value,due:captureDue.value,area:captureArea.value,nextAction:captureNext.value});captureForm.reset();requestId=crypto.randomUUID();say('Task saved. Click Refresh to create it in Notion.');await reload();}catch(error){say(error.message,true);}finally{captureSave.disabled=busy;}};

  const local=group('Personal organizer');local.id='localOrganizerView';local.open=true;
  local.append(el('p','Reminders, follow-ups, preparation, and errands saved on this computer. They are separate from Central Tasks. Due reminders appear here when you open the app; notifications are not sent.','hint'));
  const formDetails=group('Add a reminder, follow-up, appointment, or errand');formDetails.id='organizerFormView';
  const form=el('form'),kind=options([['reminder','Recurring or one-time reminder'],['followup','Follow-up'],['appointment','Appointment preparation'],['errand','Shopping / errand']]),title=input(),due=input('date'),repeat=options([['none','Once'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['yearly','Yearly']]),contact=input('text',150),lastContact=input('date'),location=input('text',200),notes=el('textarea'),checklist=el('textarea');title.required=true;notes.maxLength=1500;checklist.maxLength=9000;notes.rows=2;checklist.rows=4;
  const repeatLabel=label('Repeat',repeat),contactLabel=label('Person or organization',contact),lastLabel=label('Last contacted (optional)',lastContact),locationLabel=label('Store or location (optional)',location),checkLabel=label('Checklist — one item per line',checklist);
  const dueLabel=label('Reminder date (optional)',due),grid=el('div',undefined,'grid');grid.append(label('Type',kind),label('Title',title),dueLabel,repeatLabel,contactLabel,lastLabel,locationLabel);
  const template=button('Use appointment preparation checklist',()=>{if(checklist.value.trim()&&!confirm('Replace this draft checklist with the preparation template?'))return;checklist.value='Confirm time and location\nGather documents\nWrite down questions\nPlan travel and arrival time';});
  const save=el('button','Save in personal organizer');save.type='submit';
  const reset=()=>{editing=null;editingRevision=null;form.reset();save.textContent='Save in personal organizer';formDetails.firstChild.textContent='Add a reminder, follow-up, appointment, or errand';updateKind();};
  const cancel=button('Clear draft',reset);
  form.append(grid,label('Notes / next action',notes),checkLabel,template,el('p','Recurring dates advance when you complete an occurrence. Monthly reminders retain the original day where the month permits it; missed occurrences do not accumulate.','hint'),save,cancel);formDetails.append(form);local.append(formDetails);
  function updateKind(){repeatLabel.hidden=kind.value!=='reminder';contactLabel.hidden=lastLabel.hidden=kind.value!=='followup';locationLabel.hidden=!['appointment','errand'].includes(kind.value);checkLabel.hidden=!['appointment','errand','reminder'].includes(kind.value);template.hidden=kind.value!=='appointment';dueLabel.firstChild.textContent=kind.value==='followup'?'Next check date (optional)':kind.value==='appointment'?'Prepare by (optional)':'Reminder date (optional)';due.setAttribute('aria-label',dueLabel.firstChild.textContent);}
  kind.onchange=updateKind;updateKind();
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{
    const previous=state.organizer.items.find(i=>i.id===editing),checks=checklist.value.split('\n').map(s=>s.trim()).filter(Boolean).map(label=>({label,done:previous?.checklist?.find(c=>c.label===label)?.done||false}));
    await mutate({action:'save',id:editing,...(editing?{revision:editingRevision}:{}),item:{kind:kind.value,title:title.value,due:due.value,repeat:kind.value==='reminder'?repeat.value:'none',contact:kind.value==='followup'?contact.value:'',lastContact:kind.value==='followup'?lastContact.value:'',location:['appointment','errand'].includes(kind.value)?location.value:'',notes:notes.value,checklist:checks}});reset();say('Saved in your personal organizer.');
  }catch(error){say(error.message,true);}finally{save.disabled=busy;}};
  const filter=options([['open','All open items'],['due','Due now'],['reminder','Reminders'],['followup','Follow-ups'],['appointment','Appointment preparation'],['errand','Shopping / errands'],['closed','Closed items']]);
  const list=el('div'),history=group('Organizer history and restore');history.id='organizerHistoryView';const historyBody=el('div');history.append(historyBody);local.append(label('Show organizer items',filter),list,history);root.append(local);filter.onchange=renderItems;
  const changes=group('Inspect or restore a Notion change');changes.id='recoveryView';const changeBody=el('div');changes.append(el('p','Supported verified task edits can be restored after a preview. Later edits block restore. Home sections and task creation are available for inspection only.','hint'),changeBody);root.append(changes);
  const dialog=el('dialog'),dialogBody=el('div');dialog.append(dialogBody);document.body.append(dialog);
  async function mutate(payload){await api('assistant/organizer',{revision,...payload});await reload();}
  function edit(item){editing=item.id;editingRevision=revision;kind.value=item.kind;title.value=item.title;due.value=item.due;repeat.value=item.repeat;contact.value=item.contact;lastContact.value=item.lastContact;location.value=item.location;notes.value=item.notes;checklist.value=item.checklist.map(c=>c.label).join('\n');updateKind();save.textContent='Save changes';formDetails.firstChild.textContent='Edit '+item.title;formDetails.open=true;title.focus();formDetails.scrollIntoView({behavior:'smooth',block:'center'});}
  function renderItems(){
    if(!state)return;list.replaceChildren();const today=dayOf(new Date()),all=state.organizer.items;
    const visible=all.filter(i=>filter.value==='closed'?i.closed:!i.closed&&(filter.value==='open'||filter.value==='due'&&i.due&&i.due<=today||i.kind===filter.value)).sort((a,b)=>(a.location||'').localeCompare(b.location||'')||(a.due||'9999').localeCompare(b.due||'9999')||a.title.localeCompare(b.title));
    if(!visible.length)list.append(el('p','Nothing in this view. Add an item above whenever you need it.'));
    // Keep large shopping lists cheap to render until requested.
    let shown=0,lastLocation;const more=button('Show more',()=>fill());
    const fill=()=>{more.remove();for(const item of visible.slice(shown,shown+30)){
      if(item.kind==='errand'&&item.location!==lastLocation){list.append(el('h3',item.location||'No location specified'));lastLocation=item.location;}
      const card=el('article',undefined,'brief-task');card.append(el('h3',item.title));
      const date=item.due?(item.due<today?'Overdue · ':item.due===today?'Today · ':'')+item.due:'No reminder date';
      card.append(el('p',[item.kind,date,item.repeat!=='none'?'Repeats '+item.repeat:'',item.closed?'Closed':''].filter(Boolean).join(' · ')));
      if(item.contact)card.append(el('p','Waiting on '+item.contact+(item.lastContact?' · Last contacted '+item.lastContact:'')));
      if(item.location)card.append(el('p','Location: '+item.location));if(item.notes)card.append(el('p',item.notes));
      if(item.lastCompletedAt)card.append(el('p','Last occurrence completed '+format(item.lastCompletedAt),'hint'));
      item.checklist.forEach((c,index)=>{const check=input('checkbox');check.checked=c.done;check.disabled=busy||item.closed;check.onchange=async()=>{check.disabled=true;try{await mutate({action:'check',id:item.id,index,done:check.checked});}catch(error){check.checked=!check.checked;check.disabled=busy;say(error.message,true);}};card.append(label(c.label,check));});
      if(!item.closed){const row=el('div',undefined,'row');row.append(button('Edit',()=>edit(item)),button(item.repeat!=='none'?'Complete occurrence':item.kind==='followup'?'Mark resolved':'Complete',()=>mutate({action:'complete',id:item.id})),button('Archive',()=>mutate({action:'archive',id:item.id})));
        if(item.kind==='followup')row.append(button('Record follow-up',async()=>{const nextCheck=prompt('You followed up today. When should you check again? (YYYY-MM-DD)',shiftDay(today,7));if(nextCheck)await mutate({action:'contacted',id:item.id,nextCheck});}));card.append(row);}
      list.append(card);
    }shown+=30;if(shown<visible.length)list.append(more);};fill();
    list.querySelectorAll('button').forEach(b=>b.disabled=busy);
  }
  function renderHistory(){
    historyBody.replaceChildren();const org=state.organizer;
    if(!org.history.length)historyBody.append(el('p','Your organizer changes will appear here.'));
    for(const [index,h]of org.history.entries()){
      const row=el('article',undefined,'brief-task');row.append(el('p',format(h.at)+' · '+h.action+' · '+h.title));
      if(index===0&&h.action!=='restore'){const restore=button('Preview restore',()=>{
        dialogBody.replaceChildren(el('h2','Restore the latest organizer change?'),el('p','This restores your local organizer to the saved version before this change. Notion is unchanged.'));
        const preview=el('pre');preview.textContent=JSON.stringify(h.before,null,2);dialogBody.append(preview,button('Cancel',()=>dialog.close()),button('Restore organizer',async()=>{await mutate({action:'restore',historyId:h.id});dialog.close();say('The organizer was restored.');}));dialog.showModal();
      });restore.disabled=busy;row.append(restore);}historyBody.append(row);
    }
  }
  function renderRecovery(){
    changeBody.replaceChildren();if(!state.operations.length)changeBody.append(el('p','No Notion changes recorded yet.'));
    let shown=0;const more=button('Show more changes',()=>fill());
    const fill=()=>{more.remove();for(const op of state.operations.slice(shown,shown+15)){
      const detail=group(format(op.at)+' · '+op.title+' · '+op.status);const pre=el('pre');
      const fields=op.properties?Object.fromEntries(Object.keys(op.properties).map(k=>[k,{before:op.before?.[k],after:op.properties[k]}])):{original:op.before||'No saved original',detail:op.detail||op.action||'Task creation'};
      pre.textContent=JSON.stringify(fields,null,2);detail.append(pre);
      if(op.before&&op.properties&&op.taskId&&op.status==='verified'&&!op.restoredBy&&op.action!=='restore'){
        const b=button('Preview restore',async()=>{
          const preview=await api('assistant/recovery-preview',{id:op.id});
          dialogBody.replaceChildren(el('h2','Restore '+preview.title+'?'),el('p','The saved previous values will replace the listed fields. A later task edit will block this restore. A future Refresh can apply routine reminder policies again.'));
          for(const field of preview.fields){dialogBody.append(el('h3',field.field));const p=el('pre');p.textContent='Current: '+JSON.stringify(field.current,null,2)+'\nRestore: '+JSON.stringify(field.restore,null,2);dialogBody.append(p);}
          dialogBody.append(button('Cancel',()=>dialog.close()),button('Confirm restore in Notion',async()=>{await api('assistant/restore',{id:preview.id,lastEdited:preview.lastEdited,confirmed:true});dialog.close();await reload();say('Restored and verified in Notion. Refresh to update the task views.');}));dialog.showModal();
        });b.disabled=busy;detail.append(b);
      }changeBody.append(detail);
    }shown+=15;if(shown<state.operations.length)changeBody.append(more);};fill();
  }
  function renderPlanning(){
    const report=state.latest,p=dailyPriorities(report);priorityBody.replaceChildren();
    priorityBody.append(el('p','Up to three suggestions within '+p.capacity+' minutes of remaining recorded availability (capped at two hours). Review external commitments first.','hint'));
    for(const item of p.items)priorityBody.append(taskCard(item.task,item.reason+' · '+item.minutes+' min'+(!item.task.effort?' estimated':'')));
    if(!p.items.length)priorityBody.append(el('p','No suitable short tasks fit the remaining recorded time. Check deadlines and unresolved decisions in the weekly review.'));
    const review=weeklyReview(report,state.operations,state.organizer);weeklyBody.replaceChildren(el('p','Review window: '+review.since+' through today. Upcoming deadlines: tomorrow through '+review.through+'. Completion totals use this app’s retained history; restored changes are excluded. Completions made directly in Notion may be missing.','hint'));
    const sections=[['Recorded completions',review.completed,i=>el('p',i.title+' · '+format(i.at)+' · '+i.source)],['Overdue work',review.overdue,t=>taskCard(t,'Due '+format(t.due.start))],['Deadlines in the next seven days',review.upcoming,t=>taskCard(t,'Due '+format(t.due.start))],['Waiting on someone',review.waiting,t=>taskCard(t,t.notes||'Record who you are waiting on in the personal organizer.')],['Decisions needed',review.decisions,i=>el('p',i.title+' — '+i.reason)]];
    for(const [title,items,render]of sections){const d=group(title+' ('+items.length+')');if(!items.length)d.append(el('p','Nothing recorded in this category.'));let shown=false;d.ontoggle=()=>{if(d.open&&!shown){shown=true;for(const i of items)d.append(render(i));}};weeklyBody.append(d);}
    const digest=refreshSummary(state);summary.replaceChildren();summary.append(el('h3','Your last refresh'),el('p',report?'Read '+format(report.finishedAt||report.startedAt)+' · '+digest.checked+' required sources checked · '+digest.added+' added · '+digest.changed+' changed · '+digest.verified+' verified task updates':'Refresh to load Central Tasks.'));
    if(state.job?.status==='running')summary.append(el('p','Refresh is still running. This is a saved snapshot.','source-pending'));
    if(report?.error)summary.append(el('p',report.error,'source-pending'));
    for(const source of digest.missing)summary.append(el('p',source.name+' · '+source.status+(source.detail?' — '+source.detail:''),'source-pending'));
    for(const e of digest.exceptions)summary.append(el('p',(e.title?e.title+' — ':'')+e.reason,'source-pending'));
    if(digest.unverified)summary.append(el('p',digest.unverified+' changes need verification. Inspect the change history below.','source-pending'));
    if(report?.needsRefresh)summary.append(el('p','A change was saved after this snapshot. Refresh before relying on the plan.','source-pending'));
    summary.append(el('p','Email collection does not mean every message has been interpreted. External calendars remain outside this plan.','hint'));
  }
  return {update(next){
    state={operations:[],...next,organizer:next.organizer||{revision:0,items:[],history:[]}};revision=state.organizer.revision;busy=state.job?.status==='running';
    form.querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=busy);captureForm.querySelectorAll('input,textarea,button').forEach(n=>n.disabled=busy);
    const key=JSON.stringify([state.organizer,state.operations,state.latest,state.job?.status]);if(key===listKey)return;listKey=key;
    renderPlanning();renderItems();renderHistory();renderRecovery();areas.replaceChildren();for(const name of [...new Set((state.latest?.tasks||[]).map(t=>t.category).filter(Boolean))]){const option=el('option');option.value=name;areas.append(option);}
  },captureDraft(fields){
    if(busy)return;
    if((captureTitle.value||captureDue.value||captureNext.value||captureArea.value)&&!confirm('Replace your unsaved task draft with a bill or renewal example?'))return;
    captureTitle.value=fields.title||'';captureNext.value=fields.nextAction||'';captureArea.value=fields.area||'';captureDue.value=fields.due||'';
    capture.open=true;captureTitle.focus();capture.scrollIntoView({behavior:'smooth',block:'center'});
  },tick(){if(state){renderPlanning();renderItems();}}};
}
