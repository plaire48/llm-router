// DeepAgents' browser entry also exports an unused LangSmith sandbox client.
// Its file-upload helpers must never become filesystem access in this host.
export async function readFile() {throw new Error('filesystem_unavailable_in_browser');}
export async function writeFile() {throw new Error('filesystem_unavailable_in_browser');}
export async function mkdir() {throw new Error('filesystem_unavailable_in_browser');}
