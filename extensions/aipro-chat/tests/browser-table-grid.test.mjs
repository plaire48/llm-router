import test from 'node:test';
import assert from 'node:assert/strict';
import {tableGrid} from '../browser-table-grid.js';
const cell=(text,rowSpan=1,colSpan=1)=>({text,rowSpan,colSpan});
test('shared opening hours stay aligned across rowspans instead of shifting to the next room',()=>{
 const grid=tableGrid([
  {group:1,cells:[cell('일반1'),cell('09–21',3),cell('평일')]},
  {group:1,cells:[cell('일반2'),cell('평일')]},
  {group:1,cells:[cell('디지털'),cell('평일')]},
  {group:1,cells:[cell('세계'),cell('09–18'),cell('평일')]},
 ]);
 assert.deepEqual(grid,[['일반1','09–21','평일'],['일반2','09–21','평일'],['디지털','09–21','평일'],['세계','09–18','평일']]);
});
test('rowspan zero stops at its row group and colspan does not shift later cells',()=>{
 assert.deepEqual(tableGrid([{group:1,cells:[cell('묶음',0),cell('A',1,2)]},{group:1,cells:[cell('B'),cell('C')]},{group:2,cells:[cell('새 그룹'),cell('D'),cell('E')]}]),
 [['묶음','A','A'],['묶음','B','C'],['새 그룹','D','E']]);
 assert.equal(tableGrid([{group:1,cells:[cell('X',1,1000)]}]),null);
 assert.equal(tableGrid([{group:1,cells:[cell('X'),cell('Y',2)]},{group:1,cells:[cell('overlap',1,2)]}]),null);
});
