// Compile the existing maintained OpenWiki implementation; do not fork its protocol.
export {createNubiApi} from '../../openwiki/src/visualize/nubi';
export {buildGraph} from '../../openwiki/src/visualize/graph';
export {retrieveWikiEvidence} from '../../openwiki/src/visualize/retrieval';
export {parseFrontmatterFields} from '../../openwiki/src/okf/frontmatter';
export {ClaimsStore} from '../../openwiki/src/claims/brains/code/store';
export {isGroundedWikiPage,toClaimsSidecarRelativePath} from '../../openwiki/src/claims/brains/code/paths';
export {RepositoryEvidenceResolver} from '../../openwiki/src/claims/evidence/repository/resolver';
export {parseRepositoryEvidenceResource} from '../../openwiki/src/claims/evidence/repository/resource';
export {OpenWikiIgnore} from '../../openwiki/src/agent/openwiki-ignore';

import {runWikiQuestion as researchQuestion} from '../../openwiki/src/agent/wiki-question';
import {traceable} from 'langsmith/traceable';
// A user's unrelated tracing environment must not upload workspace documents.
// Disable tracing within this async scope, without mutating process.env.
export const runWikiQuestion = traceable(researchQuestion, {name:'nubi-document-research',tracingEnabled:false});
export {NubiOpenWikiModel,isWikiAuthenticationError} from '../../../extensions/aipro-chat/openwiki-agent.js';
export {createWikiQuestionSearch} from '../../../extensions/aipro-chat/openwiki-retrieval.js';
