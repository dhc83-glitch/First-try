import {readFile,writeFile,mkdir,copyFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const releaseURL='https://raw.githubusercontent.com/dhc83-glitch/First-try/codex/assistant-releases/release.json';
const safePath=p=>typeof p==='string'&&/^(?:public\/|test\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|json|css|html|md)$/.test(p)&&!p.includes('..');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function save(path,data){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path+'.tmp',JSON.stringify(data),{mode:0o600});await rename(path+'.tmp',path);}
export async function updateState(root){try{return JSON.parse(await readFile(join(root,'.local/update-state.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw Error('Update history is unreadable; no code will be replaced.');}}
export async function restoreBackup(root,state){
  if(!state.backup||!Array.isArray(state.files))throw Error('No previous version is available.');
  for(const file of state.files){if(!safePath(file.path))throw Error('Invalid backup path.');const target=join(root,file.path);if(file.existed){await mkdir(dirname(target),{recursive:true});await copyFile(join(root,'.local/code-backups',state.backup,file.path),target);}else await rm(target,{force:true});}
  const restored={...state,status:'rolled back',current:state.previous||null,detail:'Previous code restored. Saved records and connections were preserved.'};await save(join(root,'.local/update-state.json'),restored);return restored;
}
export class Updater{
 constructor({root=fileURLToPath(new URL('.',import.meta.url)),fetcher=fetch,restart=null,validate=async path=>exec(process.execPath,['--check',path],{timeout:15000}),manifestURL=releaseURL}={}){Object.assign(this,{root:resolve(root),fetcher,restart,validate,manifestURL});this.busy=false;this.candidate=null;}
 async status(){const s=await updateState(this.root);return {managed:!!this.restart,busy:this.busy,current:s.current||'installed code',status:s.status||'ready',detail:s.detail||'',canRollback:!!s.backup&&s.status==='installed',candidate:this.candidate?{version:this.candidate.version,sha:this.candidate.sha}:null};}
 async download(url){const r=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Update download failed (HTTP '+r.status+'). Your running version is unchanged.');const b=Buffer.from(await r.arrayBuffer());if(b.length>1024*1024)throw Error('An update file is too large.');return b;}
 async check(){if(this.busy)throw Error('An update is already in progress.');this.busy=true;try{
   const m=JSON.parse((await this.download(this.manifestURL)).toString());
   if(!/^\d+\.\d+\.\d+$/.test(m.version)||!/^[a-f0-9]{40}$/.test(m.sha)||!Array.isArray(m.files)||!m.files.length||m.files.length>100||m.files.some(f=>!safePath(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256))||new Set(m.files.map(f=>f.path)).size!==m.files.length||!['package.json','server.js','launcher.js','updater.js'].every(p=>m.files.some(f=>f.path===p)))throw Error('The update manifest is invalid.');
   this.candidate=m;return {...await this.status(),available:(await updateState(this.root)).current!==m.sha};
 }finally{this.busy=false;}}
 async install({sha}){if(!this.restart)throw Error('Install the one-time launcher first to enable browser updates.');if(this.busy)throw Error('An update is already in progress.');if(!this.candidate||sha!==this.candidate.sha)throw Error('Check for updates again before installing.');this.busy=true;
  const m=this.candidate,id=randomUUID(),stage=join(this.root,'.local/update-stage',id),stateFile=join(this.root,'.local/update-state.json');let state,applying=false;
  try{
   const old=await updateState(this.root);if(old.current===sha)return {installed:true,restart:false};
   let total=0;for(const f of m.files){const data=await this.download('https://raw.githubusercontent.com/dhc83-glitch/First-try/'+m.sha+'/'+f.path);total+=data.length;if(total>8*1024*1024||hash(data)!==f.sha256)throw Error('Update integrity check failed.');const path=join(stage,f.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,data,{mode:0o600});if(f.path.endsWith('.js'))await this.validate(path);}
   // Mark staging as ESM before checking any copied JavaScript (package may be listed later).
   const pkg=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));if(pkg.name!=='personal-task-auditor'||pkg.type!=='module')throw Error('This release is not compatible with the assistant.');
   state={status:'applying',current:sha,previous:old.current||null,backup:id,files:[],version:m.version};
   for(const f of m.files){let existed=true;const backup=join(this.root,'.local/code-backups',id,f.path);try{await mkdir(dirname(backup),{recursive:true,mode:0o700});await copyFile(join(this.root,f.path),backup);}catch(e){if(e.code!=='ENOENT')throw e;existed=false;}state.files.push({path:f.path,existed});}
   await save(stateFile,state);applying=true;
   for(const f of m.files){const target=join(this.root,f.path);await mkdir(dirname(target),{recursive:true});await copyFile(join(stage,f.path),target+'.update');await rename(target+'.update',target);}
   state.status='restarting';await save(stateFile,state);this.restarting=true;setTimeout(()=>this.restart(),200);return {installed:true,restart:true};
  }catch(e){if(applying)await restoreBackup(this.root,state);throw e;}finally{await rm(stage,{recursive:true,force:true});this.busy=false;}
 }
 async rollback(){if(!this.restart||this.busy)throw Error('Rollback is unavailable right now.');this.busy=true;try{const state=await updateState(this.root);if(state.status!=='installed')throw Error('No installed update is available to roll back.');await restoreBackup(this.root,state);this.restarting=true;setTimeout(()=>this.restart(),200);return {restart:true};}finally{this.busy=false;}}
}
export async function markUpdateHealthy(root){const state=await updateState(root);if(state.status==='restarting'){state.status='installed';state.detail='Update started successfully.';await save(join(root,'.local/update-state.json'),state);}}
