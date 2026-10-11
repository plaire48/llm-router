import {test} from 'node:test';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';

// A test of a feature this release keeps off is skipped with its reason, not deleted: the code stays, and the test
// returns with the feature (runtime/beta-features.mjs). Found 2026-10-05: 175 of these tests ran red for days because
// the host threw a2a_disabled or computer_beta_disabled before any assertion, and the suite said nothing useful.
export function featureTest(feature){
  if(!Object.hasOwn(DESKTOP_FEATURES,feature))throw new Error('unknown_feature:'+feature);
  if(DESKTOP_FEATURES[feature])return test;
  const skip=`${feature} is off in this release (runtime/beta-features.mjs)`;
  const skipped=(name,options,fn)=>typeof options==='function'||options===undefined?test(name,{skip},options):test(name,{...options,skip},fn);
  skipped.skip=test.skip;skipped.only=skipped;skipped.todo=test.todo;
  return skipped;
}
