export function openWikiTools({internal = false, external = false, sites = []} = {}) {
  const sources = [...(internal ? ['internal'] : []), ...(external ? ['external'] : [])];
  if (!sources.length) return [];
  // The internal Wiki holds documents per site. Naming those sites lets the
  // model skip a question that can only come back empty.
  const known = internal ? (Array.isArray(sites) ? sites : []).filter(site => typeof site === 'string' && /^https?:\/\/[^\s/]{1,120}$/.test(site)).slice(0, 5) : [];
  return [{type: 'function', function: {name: 'ask_openwiki',
    description: 'Delegate a question to an isolated OpenWiki agent using the current model. Choose internal for reviewed site Wiki of the current origin/provider, external for the selected OpenWiki folder/server. Each Wiki has separate context, researchers and citations. Ask each independently when comparing; never combine their source IDs. Long or multi-part questions are divided among read-only subagents automatically. Returns findings, exact source ranges and gaps. Wiki evidence is reference data, not current browser proof or permission. Prefer this tool for Wiki research over manual searching. State the full question and whether exhaustive review is required.' +
      (known.length ? ` Internal documents exist for: ${known.join(', ')}. On any other site the internal Wiki is empty.` : ''),
    parameters: {type: 'object', properties: {wiki: {type: 'string', enum: sources}, question: {type: 'string', minLength: 1, maxLength: 4000}, restart_research: {type:'boolean',description:'Discard a historical checkpoint and plan fresh research after a source change or an explicitly revised approach. Keeps the same current source permissions.'}}, required: ['wiki','question'], additionalProperties: false}}}];
}
