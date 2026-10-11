// How much a tool result may take in the next request of the model.
//
// What the last request left free is not the measure: a full window is what
// compaction is for. Old results are cleared and earlier turns summarized
// before the next request. A result takes what the window holds after that:
// the input limit without the fixed part (system, tools, host receipts,
// protected messages) and without the summary. Token counts are estimates, so
// a fifth stays free.
//
// The results of one response share the room. When the room is used, the
// remaining reads of that response wait for the next one: a whole range later
// serves better than a sliver now.
export const READ_FLOOR=600;
// Lines of one read_source call. The model windows are 256K to 512K (user decision 2026-09-30): with 200 lines,
// 52 of 92 reads of the live run S16 were cut and continued. The room above still bounds a read in a small window.
export const READ_LINES=1000;
export function resultRoom({window,fixed,last,spent=0}) {
  const free=limit=>Math.floor((window.input-limit)*.8)-1024-spent;
  const room=Math.max(free(last),free(fixed+window.summaryOutput));
  if(spent>0)return {room,defer:room<READ_FLOOR};
  return {room:Math.max(room,READ_FLOOR),defer:false};
}
