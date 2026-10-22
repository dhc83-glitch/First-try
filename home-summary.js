import {randomUUID} from 'node:crypto';
import {rich} from './notion.js';

export async function previewHome(notion,report){
  if(!report?.cleanup||report.needsRefresh)throw new Error('Finish a refresh before previewing the Home update.');
  const pages=await notion.all('/search',{query:'Home',filter:{value:'page',property:'object'}});
  const matches=pages.filter(p=>rich(Object.values(p.properties||{}).find(v=>v.type==='title')?.title).toLowerCase()==='home');
  if(matches.length!==1)throw new Error('Could not identify one Home page. No page was changed.');
  const children=await getChildren(notion,matches[0].id);
  const callout=children.find(b=>b.type==='callout'&&/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(rich(b.callout.rich_text)));
  if(!callout)throw new Error('The existing dated Home callout was not found. No page was changed.');
  const nested=await getChildren(notion,callout.id);
  const paragraph=nested.find(b=>b.type==='paragraph');
  if(!paragraph)throw new Error('The dated callout has no supported summary paragraph. No page was changed.');
  const sources=report.sources.filter(s=>!s.optional).map(s=>s.name+': '+s.status).join('; ');
  const heading=report.cleanup.displayDate+' · task review';
  const text=`${report.tasks.length} Notion tasks checked. ${report.cleanup.items.length} cleanup items need review. ${report.plan.upcoming.length} recorded deadlines in the next seven days or overdue. Source checks: ${sources}. Work-time suggestions and cleanup changes require your approval. This summary does not mean the tasks are completed or that every email has been interpreted.`;
  const changes=[{id:callout.id,type:'callout',lastEdited:callout.last_edited_time,before:callout.callout.rich_text,after:[{text:{content:heading}}]},{id:paragraph.id,type:'paragraph',lastEdited:paragraph.last_edited_time,before:paragraph.paragraph.rich_text,after:[{text:{content:text}}]}];
  return {id:randomUUID(),runId:report.id,date:report.cleanup.today,pageId:matches[0].id,changes};
}
async function getChildren(notion,id){
  const all=[];let cursor;
  do{const result=await notion.call('/blocks/'+id+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));all.push(...result.results);cursor=result.has_more?result.next_cursor:null;}while(cursor);
  return all;
}
