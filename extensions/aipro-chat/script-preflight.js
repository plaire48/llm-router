import {parse} from 'acorn';
import {scriptFailure} from './script-feedback.js';
import {PAGE_BUILDERS, LOCATOR_BUILDERS, LOCATOR_ACTIONS, LOCATOR_READS, PAGE_METHODS, BROWSER_METHODS, REF_METHODS} from './browser-script-api.js';

const methods = {
  page: new Set([...PAGE_BUILDERS, ...PAGE_METHODS]),
  locator: new Set([...LOCATOR_BUILDERS, ...LOCATOR_ACTIONS, ...LOCATOR_READS]),
  ref: new Set(REF_METHODS),
  browser: new Set(['ref', ...BROWSER_METHODS]),
};
const unavailable = new Set(['window', 'document', 'chrome', 'fetch', 'XMLHttpRequest', 'WebSocket', 'process', 'require']);
const children = node => Object.values(node).flatMap(value => Array.isArray(value) ? value.filter(item => item?.type) : value?.type ? [value] : []);
const property = node => !node.computed ? node.property.name : node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : null;
function names(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'Property') return names(pattern.value);
  if (pattern.type === 'AssignmentPattern') return names(pattern.left);
  return children(pattern).flatMap(names);
}
function scope(parent) {
  const bindings = new Map();
  return {bindings, lookup(name) {return bindings.has(name) ? bindings.get(name) : parent ? parent.lookup(name) : name === 'page' || name === 'browser' ? name : unavailable.has(name) ? 'unavailable' : null;}};
}
function declareBlock(node, env) {
  for (const child of node.body || []) {
    if (child.type === 'VariableDeclaration') for (const decl of child.declarations) for (const name of names(decl.id)) env.bindings.set(name, null);
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(child.type) && child.id) env.bindings.set(child.id.name, null);
  }
}
function declareVars(node, env) {
  if (/Function/.test(node.type)) return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') for (const decl of node.declarations) for (const name of names(decl.id)) env.bindings.set(name, null);
  for (const child of children(node)) declareVars(child, env);
}
function receiver(node, env) {
  if (!node) return null;
  if (node.type === 'Identifier') return env.lookup(node.name);
  if (node.type === 'ChainExpression') return receiver(node.expression, env);
  if (node.type === 'MemberExpression') {
    const owner = receiver(node.object, env), key = property(node);
    if (owner === 'unavailable' || owner === 'unsupported') return owner;
    return owner && key && !methods[owner]?.has(key) ? 'unsupported' : null;
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const owner = receiver(node.callee.object, env), key = property(node.callee);
    if (owner === 'browser' && key === 'ref') return 'ref';
    if (['page', 'locator'].includes(owner) && methods[owner].has(key) && LOCATOR_BUILDERS.includes(key)) return 'locator';
  }
  return null;
}
function browserCall(node, env) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  const owner = receiver(node.callee.object, env), key = property(node.callee);
  return methods[owner]?.has(key) && !(owner === 'browser' && key === 'ref') && !(['page', 'locator'].includes(owner) && LOCATOR_BUILDERS.includes(key));
}
function failure(reason, node) {
  return {...scriptFailure({reason}), logs: [], calls: 0, phase: 'preflight',
    location: {line: Math.max(1, (node?.loc?.start?.line || node?.loc?.line || 2) - 1), column: (node?.loc?.start?.column ?? node?.loc?.column ?? 0) + 1},
    recovery: 'No browser command was issued by this script. Correct the reported line using the declared facade. Inspect the page before writing.',
    example: 'const state = await browser.snapshot(); return state;'};
}

// Conservative validation of statically known facade calls. Dynamic JavaScript
// still runs in the bounded VM and all actions keep the host's safety checks.
// This is neither a security boundary nor a promise that a locator will work.
export function preflightScript(code) {
  // Each cause has its own correction; one vague "형식 오류" left the model repeating it.
  if (typeof code !== 'string' || !code.trim()) return failure('script_code_missing');
  if (code.length > 20000) return failure('script_too_long');
  let body;
  try {body = parse(`async function __nubi__() {\n${code}\n}`, {ecmaVersion: 2022, locations: true}).body[0].body;}
  catch (error) {return failure(error instanceof SyntaxError ? 'script_syntax' : 'script_invalid', error);}
  let problem;
  function visit(node, env) {
    if (problem || !node) return;
    if (/Function/.test(node.type)) {
      const local = scope(env);
      if (node.id) local.bindings.set(node.id.name, null);
      for (const param of node.params) for (const name of names(param)) local.bindings.set(name, null);
      declareVars(node.body, local);
      for (const param of node.params) visit(param, local);
      visit(node.body, local); return;
    }
    if (node.type === 'BlockStatement') {
      const local = scope(env); declareBlock(node, local);
      for (const child of node.body) visit(child, local); return;
    }
    if (node.type === 'CatchClause') {
      const local = scope(env); for (const name of names(node.param)) local.bindings.set(name, null);
      visit(node.body, local); return;
    }
    if (['ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
      const local = scope(env), declaration = node.init || node.left;
      if (declaration?.type === 'VariableDeclaration') for (const decl of declaration.declarations) for (const name of names(decl.id)) local.bindings.set(name, null);
      for (const child of children(node)) visit(child, local); return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        visit(decl.init, env);
        if (node.kind === 'const' && decl.id.type === 'Identifier') env.bindings.set(decl.id.name, receiver(decl.init, env));
      }
      return;
    }
    if (node.type === 'ImportExpression') {problem = failure('script_api', node); return;}
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee;
      if (callee.type === 'MemberExpression') {
        const owner = receiver(callee.object, env), key = property(callee);
        if (owner === 'unavailable' || owner === 'unsupported' || methods[owner] && key && !methods[owner].has(key)) problem = failure('script_api', node);
      } else if (callee.type === 'Identifier' && env.lookup(callee.name) === 'unavailable') problem = failure('script_api', node);
    }
    if (node.type === 'ExpressionStatement' && browserCall(node.expression, env)) problem = failure('script_unawaited', node);
    for (const child of children(node)) visit(child, env);
  }
  const root = scope(); declareVars(body, root);
  try {visit(body, root);} catch {return failure('script_invalid');}
  return problem || null;
}
