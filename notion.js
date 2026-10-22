const API='https://api.notion.com/v1';
export class Notion {
  constructor(token, fetcher=fetch){this.token=token;this.fetcher=fetcher;}
  async call(path,method='GET',body){
    for(let attempt=0;attempt<4;attempt++){
      const res=await this.fetcher(API+path,{method,headers:{Authorization:`Bearer ${this.token}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
      if(res.status===429&&attempt<3){await new Promise(r=>setTimeout(r,Math.min(10,Number(res.headers.get('retry-after'))||1)*1000));continue;}
      const data=await res.json();
      if(!res.ok) throw new Error(`Notion ${res.status}: ${data.message||'Request failed'}`);
      return data;
    }
  }
  async all(path,body){let results=[],cursor; do {const data=await this.call(path,'POST',{...body,page_size:100,...(cursor?{start_cursor:cursor}:{})});results.push(...data.results);cursor=data.has_more?data.next_cursor:null;}while(cursor);return results;}
  async discover(){
    const sources=new Map((await this.all('/search',{filter:{value:'data_source',property:'object'}})).map(d=>[d.id,d]));
    // Search may omit sources whose individual pages are nevertheless shared.
    // Recover those sources through page parents; do not read page bodies.
    const pages=await this.all('/search',{filter:{value:'page',property:'object'}});
    const parents=new Set(pages.filter(p=>p.parent?.type==='data_source_id').map(p=>p.parent.data_source_id));
    for(const id of parents){
      if(sources.has(id))continue;
      try{sources.set(id,await this.call(`/data_sources/${id}`));}
      catch(e){if(!/Notion (403|404):/.test(e.message))throw e;}
    }
    return [...sources.values()].map(d=>({id:d.id,title:rich(d.title)||'Untitled database',databaseId:d.parent?.database_id}));
  }
  async source(id){
    // Users can paste either a database ID or a data source ID.
    try {const db=await this.call(`/databases/${id}`);if(db.data_sources?.length===1)return this.call(`/data_sources/${db.data_sources[0].id}`);if(db.data_sources?.length>1)throw new Error('This database has multiple data sources. Select one from Find databases.');if(db.object==='database'&&db.data_sources?.length===0)throw new Error('This is a linked view, or its original data source is unavailable. In Notion, open the original database from this view and share that database with your integration. Then use Find shared databases.');}
    catch(e){if(!/Notion (400|404):/.test(e.message))throw e;}
    return this.call(`/data_sources/${id}`);
  }
}
export const rich = a => (a||[]).map(v=>v.plain_text??v.text?.content??'').join('');
export function value(p){if(!p)return '';switch(p.type){case 'title':return rich(p.title);case 'rich_text':return rich(p.rich_text);case 'select':return p.select?.name||'';case 'status':return p.status?.name||'';case 'multi_select':return p.multi_select.map(x=>x.name).join(', ');case 'date':return p.date;default:return '';}}
export function task(page,map){const get=k=>value(page.properties[map[k]]);return {id:page.id,url:page.url,lastEdited:page.last_edited_time,title:get('title')||'Untitled task',status:get('status'),due:get('due')||null,scheduled:get('scheduled')||null,category:get('category'),priority:get('priority'),notes:get('notes')};}
