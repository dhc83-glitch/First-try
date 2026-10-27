import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';
const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Supervisor did not reach expected state');};
test('supervisor automatically restores previous code when an updated worker cannot start',async t=>{
 const root=await mkdtemp(join(tmpdir(),'supervisor-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.local/code-backups/previous'),{recursive:true});
 await writeFile(join(root,'package.json'),'{"type":"module"}');for(const file of ['launcher.js','updater.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
 const old=`import {existsSync,unlinkSync} from 'node:fs'; console.log('TEST_READY');process.send({type:'ready'});process.on('message',m=>{if(m.type==='shutdown')process.exit(0)});setInterval(()=>{if(existsSync('.local/trigger')){unlinkSync('.local/trigger');process.send({type:'restart'})}},30);`;
 await writeFile(join(root,'server.js'),old);await writeFile(join(root,'.local/code-backups/previous/server.js'),old);await writeFile(join(root,'.local/private.json'),'KEEP');
 const child=spawn(process.execPath,[join(root,'launcher.js')],{cwd:root,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);t.after(()=>child.kill('SIGTERM'));
 await wait(async()=>logs.includes('TEST_READY'));
 await writeFile(join(root,'server.js'),'this is not valid JavaScript !!!');await writeFile(join(root,'.local/update-state.json'),JSON.stringify({status:'restarting',current:'new',previous:'old',backup:'previous',files:[{path:'server.js',existed:true}]}));await writeFile(join(root,'.local/trigger'),'restart');
 await wait(async()=>{try{return JSON.parse(await readFile(join(root,'.local/update-state.json'),'utf8')).status==='rolled back';}catch{return false;}});
 await wait(async()=>logs.split('TEST_READY').length===3);assert.equal(await readFile(join(root,'server.js'),'utf8'),old);assert.equal(await readFile(join(root,'.local/private.json'),'utf8'),'KEEP');
 child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));
});
