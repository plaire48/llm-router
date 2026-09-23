import {hash} from './files.mjs';

const TTL=120000;
function key(binding,target){return hash(JSON.stringify({binding:binding.id,target}));}
// Host observations only. Failed reads, changed targets and issued/unknown writes never qualify.
export function recordUiaFailure(service,binding,target,observation){
  const fingerprint=key(binding,target),now=Date.now();
  let state=service.computerFallback;
  if(!state||state.fingerprint!==fingerprint||now-state.at>TTL)state={fingerprint,at:now,observations:[]};
  if(!state.observations.includes(observation.id))state.observations.push(observation.id);
  state.observations=state.observations.slice(-3);state.at=now;service.computerFallback=state;
  return fallbackStatus(service,binding,target);
}
export function fallbackStatus(service,binding,target){
  const state=service.computerFallback,valid=state&&state.fingerprint===key(binding,target)&&Date.now()-state.at<=TTL;
  return {eligible:!!valid&&state.observations.length>=3,failures:valid?state.observations.length:0,required:3,fingerprint:valid?state.fingerprint:null};
}
