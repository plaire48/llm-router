// The runner of `openwiki --update`, run by Desktop on the user's approval with Desktop's model.
// It is a separate bundle, loaded only when an update runs: its imports (Mermaid checks on a
// DOM, the CLI's providers) are several times the size of the rest of the host.
import {runNativeRepositoryGeneration as repositoryGeneration} from '../../openwiki/src/agent/repository-runner';
import {traceable} from 'langsmith/traceable';
// As in document research, a user's tracing environment must not upload workspace files.
export const runNativeRepositoryGeneration = traceable(repositoryGeneration, {name:'nubi-wiki-update',tracingEnabled:false});
// `openwiki --update` installs its bundled skills in the OpenWiki home before the runner reads them.
export {syncBundledSkills} from '../../openwiki/src/agent/skills';
// From this bundle, so the model and the runner share one LangChain copy.
export {NubiOpenWikiModel} from '../../../extensions/aipro-chat/openwiki-agent.js';
