import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSession, groupSessionsByDate, openSession, restoreSessionNavigation, saveSessionNavigation} from '../ui/session-navigation.mjs';

test('open tabs persist per project, discard stale IDs and closing never deletes a task', () => {
  const values = new Map(), storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)};
  const tasks = [{id:'one'}, {id:'two'}];
  saveSessionNavigation('project-a', ['one','two','removed'], 'two', storage);
  assert.deepEqual(restoreSessionNavigation('project-a',tasks,storage),{tabs:['one','two'],selected:'two'});
  assert.deepEqual(restoreSessionNavigation('project-b',tasks,storage),{tabs:[],selected:null});
  assert.deepEqual(openSession(['one'],'two'),['one','two']);
  assert.deepEqual(closeSession(['one','two'],'two','two'),{tabs:['one'],selected:'one'});
  assert.deepEqual(tasks,[{id:'one'},{id:'two'}]);
  values.set('nubi-session-tabs-v1:project-a','{broken');
  assert.deepEqual(restoreSessionNavigation('project-a',tasks,storage),{tabs:[],selected:null});
});

test('history groups sessions by local day without changing their stored order', () => {
  const today = new Date(2026,8,25,13), yesterday = new Date(2026,8,24,10), older = new Date(2026,7,2,9);
  const tasks = [{id:'old',createdAt:older.toISOString()},{id:'today',createdAt:today.toISOString()},{id:'yesterday',createdAt:yesterday.toISOString()}];
  const groups = groupSessionsByDate(tasks,today);
  assert.deepEqual(groups.map(group => [group.label,group.tasks.map(task => task.id)]),[['오늘',['today']],['어제',['yesterday']],['2026년 8월 2일',['old']]]);
  assert.equal(tasks[0].id,'old');
});
