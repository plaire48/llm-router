import { AgentLoop, composeSkills, type AgentTransport, type AgentSkill, type AgentMessage, type AgentRunResult } from '@genoffice/agent-core';
import {officeSkill} from './office-skill';
import {textSkill} from './text-skill';
import { excelSkill, type NativeCall } from './excel-skill';

export function startAgent(options: {
  transport: AgentTransport; request: string; context: Record<string, unknown>; native: NativeCall;
  history?: AgentMessage[];
  additionalSkills?: AgentSkill[];
  event: (type: string, data: unknown) => void;
}): { cancel(): void; result: Promise<AgentRunResult>; messages(): AgentMessage[] } {
  let resolve!: (value: AgentRunResult) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<AgentRunResult>((yes, no) => { resolve = yes; reject = no; });
  const failures=new Map<string,number>();let abortReason='';
  const loop = new AgentLoop({
    transport: options.transport,
    skill: composeSkills('office-x', 'Use the supplied Office and GenOffice web search, rendering, conversion and recovery tools. Honor the selected current-document or new-document destination.', [(['word','powerpoint'].includes(String(options.context.app))?textSkill:excelSkill)(options.native, options.context), officeSkill(options.native,options.context), ...(options.additionalSkills||[])]),
    maxTurns: 100, maxHistory: 60,
    compaction: { maxBytes: 128 * 1024, keepRecentBytes: 48 * 1024 },
    events: {
      onText: text => options.event('text', text),
      onUsage: usage => options.event('usage', usage),
      onToolStart: call => options.event('tool', call.name),
      onToolExecuted: event => {
        options.event('tool_executed', {name:event.call.name,...event.execution});
        if(event.execution.mutated&&!event.execution.isError){failures.clear();return;}
        if(!event.execution.isError)return;
        let detail:any;try{detail=JSON.parse(event.execution.output);}catch{return;}
        const code=detail.error;
        if(typeof code!=='string'||!(/^(office_[a-z_]+|native_execution_failed|writes_stopped_for_this_run)$/.test(code)))return;
        const key=[event.call.name,code,detail.failedMember||''].join(':');const count=(failures.get(key)||0)+1;failures.set(key,count);
        if(count>=3){abortReason='office_repeated_tool_failure';loop.cancel();}
      },
      onDone: value => abortReason?reject(new Error(abortReason)):resolve(value), onError: error => reject(new Error(abortReason||error)),
    },
  });
  if(options.history)loop.restore(options.history);
  loop.run(options.request);
  return { cancel: () => loop.cancel(), result, messages:()=>structuredClone([...loop.messages]) };
}
