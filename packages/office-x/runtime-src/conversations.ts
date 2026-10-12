import type {AgentMessage} from '@genoffice/agent-core';
export class Conversations {
  private rows=new Map<string,{scope:string;history:AgentMessage[]}>();
  history(id:string,context:Record<string,unknown>):AgentMessage[]{
    const row=this.rows.get(id);return row?.scope===this.scope(context)?structuredClone(row.history):[];
  }
  remember(id:string,context:Record<string,unknown>,history:AgentMessage[]){
    // Old native snapshot IDs and approvals cannot be replayed on a new run.
    const safe=history.flatMap(m=>m.role==='tool'||!m.text?[]:[{role:m.role,text:m.text.slice(-16000)}]) as AgentMessage[];
    this.rows.delete(id);this.rows.set(id,{scope:this.scope(context),history:safe.slice(-20)});
    while(this.rows.size>20)this.rows.delete(this.rows.keys().next().value!);
  }
  clear(id:string){this.rows.delete(id);}
  private scope(c:Record<string,unknown>){return JSON.stringify([c.app,c.documentId,c.targetId,c.worksheetId,c.workbook,c.worksheet,c.address]);}
}
