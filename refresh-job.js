// The server owns catch-up, so closing or reloading the browser does not stop it.
// A task-only briefing is published first; Gmail catch-up cannot hold the date back.
import {localParts} from './audit.js';
export class RefreshJob {
  constructor(assistant){this.assistant=assistant;this.current=null;this.stopRequested=false;}
  get running(){return this.current?.status==='running';}
  start({dayOnly=false}={}){
    if(this.running)return this.current;
    if(this.assistant.busy)throw new Error('A task update is already running.');
    this.stopRequested=false;this.current={status:'running',startedAt:new Date().toISOString(),rounds:0,dayOnly};
    this.done=this.run();return this.current;
  }
  stop(){this.stopRequested=true;return {stopping:this.running};}
  async run(){
    try{
      if(typeof this.assistant.refreshDay==='function'){
        this.current.phase='Updating today’s task briefing';
        this.current.day=await this.assistant.refreshDay();
        if(this.current.dayOnly){this.current.status=this.stopRequested?'stopped':this.current.day.homeUpdated&&!this.current.day.exceptions?.length?'complete':'needs attention';return;}
      }
      while(!this.stopRequested){
        this.current.phase='Reading connected inboxes';
        const report=await this.assistant.refresh({continueCatchup:this.current.rounds>0,sameRun:!!this.current.day&&this.current.rounds===0});
        this.current.rounds++;
        if(!report.sources.some(s=>s.canContinue)){
          if(typeof this.assistant.applyAutomatic==='function'&&!this.stopRequested){this.current.phase='updating Notion';this.current.automatic=await this.assistant.applyAutomatic({onPhase:phase=>{this.current.phase=phase;}});}
          this.current.status=this.current.automatic?.exceptions?.length?'needs attention':report.status==='complete'?'complete':'paused';break;
        }
        // Yield between bounded batches; Gmail's shared gate controls API pacing.
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(this.stopRequested)this.current.status='stopped';
    }catch(error){this.current.status='failed';this.current.error=(this.current.day?.homeUpdated?'Today’s task briefing was published, but the remaining refresh stopped. ':'Refresh stopped before completion. ')+(error.message||'Check source details.').slice(0,1000);}
    finally{this.current.finishedAt=new Date().toISOString();}
  }
}

// Runs only while the local server is open. Check again after sleep/restart and
// retry failed publications after five minutes, never over an active edit/update.
export class DailyRollover {
  constructor(job,{clock=()=>new Date(),canRun=()=>true}={}){Object.assign(this,{job,clock,canRun});this.checking=false;this.lastAttempt=0;}
  async tick(){
    if(this.checking||this.job.running||this.job.assistant.busy||!this.canRun())return;
    this.checking=true;
    try{
      const now=this.clock(),state=await this.job.assistant.state(),publication=state.publication||state.latest?.publication;
      if(!state.configured||publication?.status==='verified'&&publication.date===localParts(now,'America/New_York').day||+now-this.lastAttempt<300000)return;
      // state() is asynchronous; recheck the guards before starting a writer.
      if(this.job.running||this.job.assistant.busy||!this.canRun())return;
      this.lastAttempt=+now;this.job.start({dayOnly:true});
    }finally{this.checking=false;}
  }
}
