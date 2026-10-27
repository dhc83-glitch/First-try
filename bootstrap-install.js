import {readFile,writeFile,mkdir,copyFile,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';
const exec=promisify(execFile),source=fileURLToPath(new URL('.',import.meta.url)),target=resolve(process.argv[2]||'');
if(!process.argv[2]||target===resolve(source))throw Error('Choose your existing assistant folder, not the downloaded update folder.');
const pkg=JSON.parse(await readFile(join(target,'package.json'),'utf8'));if(pkg.name!=='personal-task-auditor')throw Error('This is not the existing assistant folder.');
const files=JSON.parse(await readFile(join(source,'install-files.json'),'utf8'));for(const file of files){if(!/^(?:public\/|test\/)?[\w.-]+\.(js|json|css|html|md)$/.test(file)||file.includes('..'))throw Error('Invalid install file.');if(file.endsWith('.js'))await exec(process.execPath,['--check',join(source,file)]);}
// Verify the listening process belongs to the selected app before stopping it.
let pids=[];try{pids=(await exec('/usr/sbin/lsof',['-tiTCP:3000','-sTCP:LISTEN'])).stdout.trim().split(/\s+/).filter(Boolean);}catch{}
for(const pid of pids){
 const cwd=(await exec('/usr/sbin/lsof',['-a','-p',pid,'-d','cwd','-Fn'])).stdout.split('\n').find(s=>s.startsWith('n'))?.slice(1);
 const cmd=(await exec('/bin/ps',['-p',pid,'-o','command='])).stdout;
 if(cwd!==target||!cmd.includes('node')||!/(server|launcher)\.js/.test(cmd))throw Error('Port 3000 belongs to another app. No process was stopped.');
 const config=await fetch('http://127.0.0.1:3000/api/config').then(r=>r.json());
 const state=await fetch('http://127.0.0.1:3000/api/assistant/state',{method:'POST',headers:{'Content-Type':'application/json','X-Auditor-Token':config.csrf},body:'{}'}).then(r=>r.json());
 if(state.busy||state.job?.status==='running')throw Error('Refresh is still running. Let it finish, then open the installer again.');
 const parent=(await exec('/bin/ps',['-p',pid,'-o','ppid='])).stdout.trim();const parentCmd=(await exec('/bin/ps',['-p',parent,'-o','command='])).stdout;
 if(parentCmd.includes('launcher.js')){const parentCwd=(await exec('/usr/sbin/lsof',['-a','-p',parent,'-d','cwd','-Fn'])).stdout.split('\n').find(s=>s.startsWith('n'))?.slice(1);if(parentCwd!==target)throw Error('App launcher location could not be verified.');process.kill(Number(parent),'SIGTERM');}else process.kill(Number(pid),'SIGTERM');
}
for(const pid of pids){for(let i=0;i<50;i++){try{process.kill(Number(pid),0);}catch{break;}await new Promise(r=>setTimeout(r,100));if(i===49)throw Error('The old app has not stopped. No files were installed.');}}
const backup=join(target,'.local/code-backups','bootstrap-'+randomUUID()),saved=[];await mkdir(backup,{recursive:true,mode:0o700});
try{for(const file of files){let existed=true;try{await mkdir(dirname(join(backup,file)),{recursive:true});await copyFile(join(target,file),join(backup,file));}catch(e){if(e.code!=='ENOENT')throw e;existed=false;}saved.push({file,existed});}
 await writeFile(join(backup,'files.json'),JSON.stringify(saved),{mode:0o600});
 for(const file of files){await mkdir(dirname(join(target,file)),{recursive:true});await copyFile(join(source,file),join(target,file)+'.bootstrap');await rename(join(target,file)+'.bootstrap',join(target,file));}
}catch(error){for(const {file,existed}of saved){if(existed)await copyFile(join(backup,file),join(target,file));else await rm(join(target,file),{force:true});}throw error;}
console.log('Update installed. Your connections and records are preserved. Future updates are available on the assistant page.');
const child=spawn(process.execPath,['--use-env-proxy','--env-file-if-exists=.env','launcher.js'],{cwd:target,stdio:'inherit'});
setTimeout(()=>exec('/usr/bin/open',['http://127.0.0.1:3000']).catch(()=>{}),1500).unref();
child.on('exit',code=>{process.exitCode=code||0;});
