import test from 'node:test';
import assert from 'node:assert/strict';
import {validSumCheck, sumFieldValues} from '../form-values.js';

const check = (expected, factors = ['1','1']) => ({kind:'field_sum', expected, terms:factors.map((multiplier,i)=>({ref:`field-${i}`,multiplier}))});
const fields = values => values.map(value=>({supported:true,valid:true,value}));
test('observed mixed-unit form values use exact decimal arithmetic',()=>{
  assert.deepEqual(sumFieldValues(check('480',['60','1']),fields(['5','180'])),{passed:true});
  assert.deepEqual(sumFieldValues(check('0.3'),fields(['0.1','0.2'])),{passed:true});
  assert.deepEqual(sumFieldValues(check('480'),fields(['300','120'])),{passed:false,reason:'sum_mismatch'});
  assert.deepEqual(sumFieldValues(check('9007199254740994'),fields(['9007199254740993','1'])),{passed:true});
});
test('blanks, locale ambiguity and invalid controls cannot silently pass a total',()=>{
  for (const [value,reason] of [['','missing_field_value'],['  ','missing_field_value'],['1,000','ambiguous_number_format'],['4:00','ambiguous_number_format'],['480분','ambiguous_number_format'],['Infinity','ambiguous_number_format'],['1e3','ambiguous_number_format']]) {
    assert.deepEqual(sumFieldValues(check('480'),fields([value,'480'])),{passed:false,reason,fieldIndex:0});
  }
  for(const [key,reason] of [['supported','unsupported_numeric_field'],['valid','invalid_field']]) {
    const values=fields(['240','240']);values[0][key]=false;
    assert.deepEqual(sumFieldValues(check('480'),values),{passed:false,reason,fieldIndex:0});
  }
});
test('duplicate targets, negative/zero factors and oversized totals are rejected',()=>{
  for(const invalid of [{...check('480'),terms:[]},check('480',['0','1']),check('480',['-1','1']),check('x'.repeat(65)),{...check('480'),terms:[{ref:'same'},{ref:'same'}]},check('480',Array(25).fill('1'))]) assert.equal(validSumCheck(invalid),false);
  assert.throws(()=>sumFieldValues(check('480'),fields(['480'])),/tool_arguments_invalid/);
  const result=sumFieldValues(check('480'),fields(['479','0']));
  assert.deepEqual(Object.keys(result).sort(),['passed','reason']);
});
