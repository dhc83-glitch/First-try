import {localTasks} from './public/task-state.js';
import {randomUUID} from 'node:crypto';
import {dayOf} from './public/briefing.js';

export function validDay(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
}
function text(value,max=200){if(typeof value!=='string'||value.length>max)throw Error('A text field is missing or too long.');return value.trim();}
export function captureFields(input){
  const title=text(input.title);if(!title)throw Error('Enter a task title.');
  const due=text(input.due||'',10);if(due&&!validDay(due))throw Error('Enter a valid deadline.');
  return {title,due,area:text(input.area||'',80),nextAction:text(input.nextAction||'',1500)};
}
export function reminderFields(input){
  const title=text(input.title);if(!title)throw Error('Enter a reminder title.');
  const kind=input.kind||'reminder';if(!['reminder','followup','appointment','errand'].includes(kind))throw Error('Choose a reminder type.');
  const due=text(input.due||'',10);if(due&&!validDay(due))throw Error('Enter a valid reminder date.');
  const repeat=input.repeat||'none';if(!['none','daily','weekly','monthly','yearly'].includes(repeat))throw Error('Choose a repeat frequency.');
  if(repeat!=='none'&&!due)throw Error('Repeating reminders need a date.');
  if(kind!=='reminder'&&repeat!=='none')throw Error('Only routine reminders can repeat.');
  const contact=text(input.contact||'',150),location=text(input.location||'',200),notes=text(input.notes||'',1500);
  const lastContact=text(input.lastContact||'',10);if(lastContact&&!validDay(lastContact))throw Error('Enter a valid last-contact date.');
  if(!Array.isArray(input.checklist||[])||(input.checklist||[]).length>30)throw Error('Use up to 30 checklist items.');
  const checklist=(input.checklist||[]).map(item=>{const label=text(item.label,300);if(!label)throw Error('Checklist items need text.');return {label,done:item.done===true};});
  return {title,kind,due,repeat,contact,location,notes,lastContact,checklist,notionTaskId:text(input.notionTaskId||'',80)};
}
export function nextOccurrence(due,repeat,after,anchorDay=Number(due.slice(8)),anchorMonth=Number(due.slice(5,7))){
  if(!validDay(due)||!validDay(after)||!['daily','weekly','monthly','yearly'].includes(repeat))throw Error('Invalid recurrence.');
  let date=new Date(due+'T12:00:00Z');
  // Advance from the recorded occurrence and skip missed dates without creating backlog.
  do{
    if(repeat==='daily'||repeat==='weekly')date.setUTCDate(date.getUTCDate()+(repeat==='daily'?1:7));
    else{
      const year=date.getUTCFullYear()+(repeat==='yearly'?1:0),month=repeat==='yearly'?anchorMonth-1:date.getUTCMonth()+1;
      date=new Date(Date.UTC(year,month,1,12));
      const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
      date.setUTCDate(Math.min(anchorDay,last));
    }
  }while(date.toISOString().slice(0,10)<=after);
  const result=date.toISOString().slice(0,10);if(!validDay(result))throw Error('The next occurrence is outside the supported date range.');return result;
}

export async function editOrganizer(assistant,input){
  if(assistant.busy)throw Error('Wait until the refresh or update finishes.');
  assistant.busy=true;
  try{
    const state=await assistant.store.read(),org=state.organizer||{revision:0,items:[],history:[]};
    if(input.revision!==org.revision)throw Error('The organizer changed. Reload before saving.');
    const now=assistant.clock().toISOString(),today=dayOf(now),before=structuredClone(org.items),historyId=randomUUID();
    org.completions||=[];
    const item=org.items.find(i=>i.id===input.id);
    if(input.action==='save'){
      const fields=reminderFields(input.item||{});
      if(fields.notionTaskId&&!state.latest?.tasks?.some(t=>t.id===fields.notionTaskId))throw Error('Choose a current Notion task to link.');
      if(input.id&&!item)throw Error('Reminder not found.');
      if(item){
        if(item.closed)throw Error('Restore a closed reminder from history before editing.');
        const changedDate=item.due!==fields.due||item.repeat!==fields.repeat;
        Object.assign(item,fields,{updatedAt:now});
        if(changedDate){item.anchorDay=Number(fields.due.slice(8));item.anchorMonth=Number(fields.due.slice(5,7));}
      }else{
        if(org.items.length>=1000)throw Error('The organizer has reached its 1,000-reminder limit.');
        org.items.push({id:randomUUID(),...fields,anchorDay:Number(fields.due.slice(8)),anchorMonth:Number(fields.due.slice(5,7)),createdAt:now,updatedAt:now,closed:false});
      }
    }else if(input.action==='check'){
      if(!item||item.closed||!Number.isInteger(input.index)||!item.checklist[input.index])throw Error('Checklist item not found.');
      item.checklist[input.index].done=input.done===true;item.updatedAt=now;
    }else if(input.action==='contacted'){
      if(!item||item.closed||item.kind!=='followup')throw Error('Follow-up not found.');
      if(!validDay(input.nextCheck)||input.nextCheck<=today)throw Error('Choose a next check after today.');
      item.lastContact=today;item.due=input.nextCheck;item.updatedAt=now;
    }else if(input.action==='complete'||input.action==='archive'){
      if(!item||item.closed)throw Error('This reminder is already closed or missing.');
      item.updatedAt=now;
      if(input.action==='complete'&&item.repeat!=='none'){
        if(item.due>today)throw Error('Complete recurring reminders on or after their recorded date.');
        item.lastCompletedAt=now;item.due=nextOccurrence(item.due,item.repeat,today,item.anchorDay,item.anchorMonth);
        item.checklist=item.checklist.map(c=>({...c,done:false}));
      }else {item.closed=true;item.closedAt=now;item.closedReason=input.action;}
      if(input.action==='complete'&&item.notionTaskId){
        const linked=state.latest?.tasks?.find(t=>t.id===item.notionTaskId);if(!linked)throw Error('The linked task must be refreshed before completion.');
        state.updates=[...(state.updates||[]),{id:randomUUID(),text:'Completed linked task: '+linked.title,status:'pending',at:now,organizerEventId:historyId,decision:{taskId:linked.id,title:linked.title,action:'done'}}];
      }
      if(input.action==='complete')org.completions.push({id:historyId,itemId:item.id,title:item.title,at:now});
    }else if(input.action==='restore'){
      // Only the newest revision can be undone; this cannot erase subsequent edits.
      const entry=org.history[0];
      if(!entry||entry.id!==input.historyId||entry.action==='restore')throw Error('Only the most recent organizer change can be restored.');
      org.items=structuredClone(entry.before);
      org.completions=org.completions.filter(c=>c.id!==entry.id);
      for(const update of state.updates||[])if(update.organizerEventId===entry.id&&update.status==='pending'){update.status='superseded';update.detail='Organizer completion was restored before Refresh.';}
    }else throw Error('Unsupported organizer action.');
    org.completions=org.completions.filter(c=>Date.parse(c.at)>=Date.parse(now)-90*86400000).slice(-500);
    org.revision++;org.history=[{id:historyId,at:now,action:input.action,title:item?.title||input.item?.title||'Organizer',...(input.action==='restore'?{undoneId:input.historyId}:{}),before},...org.history].slice(0,30);
    state.organizer=org;if(state.latest){state.latest.organizerTasks=localTasks(org);state.latest.needsRefresh=true;}await assistant.store.write(state);return {saved:true,revision:org.revision};
  }finally{assistant.busy=false;}
}
