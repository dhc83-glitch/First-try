import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// One local process owns this store. Atomic replacement prevents partial JSON files.
export class Store {
  constructor(directory=new URL('./.local/',import.meta.url)){this.directory=directory;this.path=new URL('assistant.json',directory instanceof URL?directory:pathToFileURL(directory.replace(/\/$/,'')+'/'));}
  async read(){try{const state=JSON.parse(await readFile(this.path,'utf8'));if(!state||state.version!==1||!Array.isArray(state.history))throw new Error('Invalid record');return state;}catch(e){if(e.code==='ENOENT')return {version:1,history:[],baseline:null,latest:null,sourceId:null};throw new Error('The saved assistant record could not be read. It has been kept untouched; restore it before refreshing.');}}
  async write(state){await mkdir(this.directory,{recursive:true,mode:0o700});const temp=new URL(`assistant-${randomUUID()}.tmp`,this.path);await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,this.path);}
}
