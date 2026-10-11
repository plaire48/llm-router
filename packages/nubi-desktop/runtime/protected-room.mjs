// Which protected messages stay when a compacted request did not fit.
//
// Every attempt of a compaction may cost a summary of the same span, so one
// attempt removes as many messages as the room needs, largest first. The first
// attempt keeps what the room holds; a later attempt leaves every removable
// message to the summary. Each attempt removes at least one while any is
// removable. keep holds the messages that are never removed: the first request
// and the message being answered.
export function relaxProtected(messages,{keep=[],room,attempt=1,measure}) {
  const removable=messages.filter(message=>!keep.includes(message));
  let total=messages.reduce((sum,message)=>sum+measure(message),0);const removed=[];
  for(const message of [...removable].sort((a,b)=>measure(b)-measure(a))){
    if(attempt<=1&&removed.length&&total<=room)break;
    removed.push(message);total-=measure(message);
  }
  return {kept:messages.filter(message=>!removed.includes(message)),removed};
}
