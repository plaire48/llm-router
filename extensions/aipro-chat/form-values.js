import Big from 'big.js';

// No parseFloat, locale guessing, implicit blanks-as-zero or binary rounding.
const decimal = value => typeof value === 'string' && value.length <= 64 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
export function validSumCheck(check) {
  return decimal(check.expected) && Array.isArray(check.terms) && check.terms.length > 0 && check.terms.length <= 24 &&
    check.terms.every(term => term && typeof term.ref === 'string' && term.ref.length > 0 && term.ref.length <= 200 &&
      (term.multiplier === undefined || decimal(term.multiplier) && term.multiplier.length <= 32 && new Big(term.multiplier).gt('0'))) &&
    new Set(check.terms.map(term => term.ref)).size === check.terms.length;
}

// Serialized into Playwright's isolated read. target() has checked secrecy,
// visibility, ownership and freshness before this function sees a field.
export function numericFieldState(el) {
  const supported = el.tagName === 'INPUT' && ['number', 'text', ''].includes(el.type);
  return {supported, valid: supported && el.isConnected && el.validity.valid && el.getAttribute('aria-invalid') !== 'true',
    value: supported ? el.value.length <= 64 ? el.value : 'invalid-too-long' : ''};
}

export function sumFieldValues(check, fields) {
  if (!validSumCheck(check) || fields.length !== check.terms.length) throw new Error('tool_arguments_invalid');
  let sum = new Big('0');
  for (const [index, field] of fields.entries()) {
    if (!field.supported) return {passed: false, reason: 'unsupported_numeric_field', fieldIndex: index};
    if (!field.valid) return {passed: false, reason: 'invalid_field', fieldIndex: index};
    const value = field.value?.trim();
    if (!value) return {passed: false, reason: 'missing_field_value', fieldIndex: index};
    if (!decimal(value)) return {passed: false, reason: 'ambiguous_number_format', fieldIndex: index};
    sum = sum.plus(new Big(value).times(check.terms[index].multiplier || '1'));
  }
  return sum.eq(check.expected) ? {passed: true} : {passed: false, reason: 'sum_mismatch'};
}
