// The composer reports its compact, single-row width after it is rendered.
// This initial value also protects the conversation before a composer exists.
const WORKSPACE_LAYOUT=Object.freeze({
 rail:72,projects:280,minimumProjects:264,auxiliary:380,minimumAgent:380,minimumAuxiliary:320
});
function workspaceSlots(width,{minimumAgent=WORKSPACE_LAYOUT.minimumAgent,projects=WORKSPACE_LAYOUT.projects}={}){
 const layout=WORKSPACE_LAYOUT;
 // Reserve the actual open sidebar. Reserving a smaller hypothetical width
 // clips its header and creates a resize feedback loop between the two panes.
 const reservedProjects=projects?Math.max(layout.minimumProjects,projects):0;
 const split=width>=layout.rail+reservedProjects+minimumAgent+layout.minimumAuxiliary;
 const auxiliary=split?Math.min(layout.auxiliary,width-layout.rail-reservedProjects-minimumAgent):Math.min(width-layout.rail,width*(width<=760?.88:.47));
 return {split,projects:split?reservedProjects:0,auxiliary:split?auxiliary:0,defaultAuxiliary:auxiliary};
}
module.exports={WORKSPACE_LAYOUT,workspaceSlots};
