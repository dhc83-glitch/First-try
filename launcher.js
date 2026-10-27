// Stable supervisor: keeps the server running across in-app code updates.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {updateState,restoreBackup,markUpdateHealthy} from './updater.js';
const root=fileURLToPath(new URL('.',import.meta.url));
let child,stopping=false,restarting=false,timer;
async function start(){
 const state=await updateState(root);
 if(state.status==='applying')await restoreBackup(root,state);
 child=fork(new URL('./server.js',import.meta.url),[],{cwd:root,execArgv:['--use-env-proxy'],stdio:['inherit','inherit','inherit','ipc'],env:{...process.env,ASSISTANT_MANAGED:'1'}});
 let ready=false;
 timer=setTimeout(()=>{if(!ready)child.kill('SIGTERM');},20000);
 child.on('message',async message=>{
  if(message?.type==='ready'){ready=true;clearTimeout(timer);await markUpdateHealthy(root);}
  if(message?.type==='restart'&&!stopping){restarting=true;const previousChild=child;previousChild.send({type:'shutdown'});setTimeout(()=>{if(previousChild.exitCode===null)previousChild.kill('SIGTERM');},5000).unref();}
 });
 child.on('exit',async()=>{clearTimeout(timer);if(stopping)return;
   if(restarting){restarting=false;await start();return;}
   const pending=await updateState(root);
   if(!ready&&pending.status==='restarting'){console.error('Updated app could not start; restoring the previous code.');await restoreBackup(root,pending);await start();return;}
   console.error('Assistant stopped. Your records are preserved.');process.exitCode=1;
 });
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(timer);child?.kill(signal);});
await start();
