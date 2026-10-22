import {randomUUID} from 'node:crypto';
import {rich} from './notion.js';
import {readHomeTree,planHomeContent} from './home-content.js';

export async function previewHome(notion,report){
  if(!report?.cleanup||report.needsRefresh)throw new Error('Finish a refresh before previewing the Home update.');
  const pages=await notion.all('/search',{query:'Home',filter:{value:'page',property:'object'}});
  const matches=pages.filter(p=>rich(Object.values(p.properties||{}).find(v=>v.type==='title')?.title).toLowerCase()==='home');
  if(matches.length!==1)throw new Error('Could not identify one Home page. No page was changed.');
  const tree=await readHomeTree(notion,matches[0].id);
  // Older API fixtures/blocks may omit has_children on the dated callout.
  const dated=tree.find(b=>b.type==='callout'&&/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(rich(b.callout.rich_text)));
  if(dated&&!dated.children)dated.children=(await notion.call('/blocks/'+dated.id+'/children?page_size=100')).results;
  const result=planHomeContent(tree,report);
  if(!dated)throw new Error('The existing dated Home callout was not found. No page was changed.');
  if(!dated.children?.some(b=>b.type==='paragraph'))throw new Error('The dated callout has no supported summary paragraph. No page was changed.');
  return {id:randomUUID(),runId:report.id,date:report.cleanup.today,pageId:matches[0].id,...result};
}
