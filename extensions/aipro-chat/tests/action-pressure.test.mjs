import test from 'node:test';
import assert from 'node:assert/strict';
import {actionPressure} from './fixtures/action-pressure.mjs';
const tools = ['read_page', 'click_element', 'fill_form'].map(name => ({type: 'function', function: {name, parameters: {type: 'object', properties: {ref: {type: 'string'}, query: {type: 'string'}}}}}));
for (const operation of ['click_element', 'fill_form']) for (const steer of [false, true]) {
  test(`${operation} recovery survives full analysis queue, steering=${steer}`, async () => {
    const result = await actionPressure({tools, operation, steer, execute: async name => {
      assert(['read_page', operation].includes(name));
      return name === 'read_page' ? {text: '관찰한 메뉴'} : {error: 'script_obscured', actionIssued: false};
    }});
    assert.equal(result.reports, 6);
  });
}
