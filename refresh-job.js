// The server owns catch-up, so closing or reloading the browser does not stop it.
// A server restart requires one click to resume the durable Gmail cursors.
export class RefreshJob {
  constructor(assistant){this.assistant=assistant;this.current=null;this.stopRequested=false;}
  get running(){return this.current?.status==='running';}
  start(){
    if(this.running)return this.current;
    if(this.assistant.busy)throw new Error('A task update is already running.');
    this.stopRequested=false;this.current={status:'running',startedAt:new Date().toISOString(),rounds:0};
    this.done=this.run();return this.current;
  }
  stop(){this.stopRequested=true;return {stopping:this.running};}
  async run(){
    try{
      while(!this.stopRequested){
        const report=await this.assistant.refresh({continueCatchup:this.current.rounds>0});
        this.current.rounds++;
        if(!report.sources.some(s=>s.canContinue)){
          if(typeof this.assistant.applyAutomatic==='function'&&!this.stopRequested){this.current.phase='updating Notion';this.current.automatic=await this.assistant.applyAutomatic({onPhase:phase=>{this.current.phase=phase;}});}
          this.current.status=this.current.automatic?.exceptions?.length?'needs attention':report.status==='complete'?'complete':'paused';break;
        }
        // Yield between bounded batches; Gmail's shared gate controls API pacing.
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(this.stopRequested)this.current.status='stopped';
    }catch{this.current.status='failed';this.current.error='Refresh stopped safely. Check the source report; click Refresh to resume saved progress.';}
    this.current.finishedAt=new Date().toISOString();
  }
}
