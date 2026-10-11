import {isPageContentReference} from './goal-review.js';

const MAX_SOURCES = 8, MAX_RANGES = 16, MAX_CHARACTERS = 6000;
const merge = ranges => {
  const output = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = output.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else output.push({...range});
  }
  return output;
};

// Locate a value in this exact JSON serialization by structural path, never by
// text search (the input or another range can contain identical source text).
function valueOffset(value, path) {
  let offset = 0;
  for (const part of path) {
    offset++;
    if (Array.isArray(value)) {
      for (let index = 0; index < part; index++) offset += JSON.stringify(value[index]).length + 1;
    } else {
      for (const key of Object.keys(value)) {
        offset += JSON.stringify(key).length + 1;
        if (key === part) break;
        offset += JSON.stringify(value[key]).length + 1;
      }
    }
    value = value[part];
  }
  return offset;
}

// Retrieval candidates must be original returned body text, not navigation
// indexes or tool guidance. Offsets still address the exact stored JSON wire.
export function pageBodyWireRanges(source) {
  if(source.tool!=='read_page'||source.status!=='observed'||source.truncated)return null;
  let packet;try {packet=JSON.parse(source.text);}catch{return null;}
  if(!isPageContentReference(packet?.result)||JSON.stringify(packet)!==source.text)return null;
  return packet.result.ranges.map((range,index)=>{
    const start=valueOffset(packet,['result','ranges',index,'markdown'])+1;
    return {start,end:start+JSON.stringify(range.markdown).length-2};
  });
}

export function pageRead(source, reads) {
  if (source.tool !== 'read_page' || source.status !== 'observed' || source.truncated) return null;
  let packet;
  try {packet = JSON.parse(source.text);} catch {return null;}
  const page = packet?.result;
  if (!isPageContentReference(page) || page.url.length > 2048 || JSON.stringify(packet) !== source.text) return null;
  const returned = [];
  for (let index = 0; index < page.ranges.length; index++) {
    const range = page.ranges[index];
    let wire = valueOffset(packet, ['result', 'ranges', index, 'markdown']) + 1;
    let original = range.start, readIndex = 0, current;
    // Iterate code points to preserve paired surrogates. Escaped JSON units and
    // emoji cut at a read boundary earn no credit until the whole unit returned.
    for (const char of range.markdown) {
      const end = wire + JSON.stringify(char).length - 2;
      while (reads[readIndex]?.end <= wire) readIndex++;
      if (reads[readIndex]?.start <= wire && reads[readIndex].end >= end) {
        if (current?.end === original) current.end += char.length;
        else {current = {start: original, end: original + char.length}; returned.push(current);}
      } else current = null;
      wire = end; original += char.length;
    }
  }
  const ranges = merge(returned);
  return {url: page.url, frame: page.frame, content_hash: page.content_hash,
    ...(page.source_key ? {source_key: page.source_key} : {}),
    characters: page.characters, returned_ranges: ranges.slice(0, MAX_RANGES), omitted_ranges: Math.max(0, ranges.length - MAX_RANGES)};
}

// Only the coordinator's retained observations and read ledger enter here.
// Reports, cited offsets and model-authored fields never become read receipts.
export function analysisReadReceipt(sources, readRanges) {
  const output = [];
  let omitted = 0;
  for (const [id, ranges] of readRanges) {
    if (!ranges.length) continue;
    const source = sources.get(id);
    if (!source || output.length >= MAX_SOURCES) {omitted++; continue;}
    const reads = merge(ranges);
    const page = pageRead(source, reads);
    const row = {evidence_id: id, tool: source.tool, kind: source.kind, source_status: source.status,
      observation_characters: source.text.length, observation_truncated: source.truncated,
      observation_coverage: !source.truncated && reads.length === 1 && reads[0].start === 0 && reads[0].end === source.text.length ? 'complete' : 'partial',
      returned_wire_ranges: reads.slice(0, MAX_RANGES), omitted_wire_ranges: Math.max(0, reads.length - MAX_RANGES),
      ...(page ? {page_content: page} : {})};
    if (JSON.stringify([...output, row]).length > MAX_CHARACTERS) {omitted++; continue;}
    output.push(row);
  }
  return {scope: 'Historical text returned to this child, in UTF-16 character offsets. Wire ranges refer to stored tool JSON; page_content ranges refer only to original source text actually returned. Not model comprehension, full-page coverage, current state or permission.',
    sources: output, omitted_sources: omitted};
}
