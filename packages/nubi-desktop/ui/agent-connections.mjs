// The header's agent connection (user decision 2026-10-01): a request another Nubi sends waits here until this
// user accepts or declines it, and the header counts the requests that wait.
export const incomingRequests=project=>(project?.peerTasks||[]).filter(job=>job.recipient==='desktop'&&job.state==='submitted');
export const pairedRoles=project=>new Set((project?.peerLinks||[]).filter(link=>link.expiresAt>Date.now()).map(link=>link.role));
// The other tasks exchanged in this project, newest first, each with the conversation it belongs to.
export const exchangedTasks=project=>(project?.peerTasks||[]).filter(job=>!(job.recipient==='desktop'&&job.state==='submitted'))
  .map(job=>({...job,conversation:job.recipient==='desktop'?job.localTaskId:job.sourceTaskId}))
  .sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
export const badgeText=count=>count>9?'9+':String(count);
