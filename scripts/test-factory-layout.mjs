import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/factory-layout.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {equipmentZone,zoneWork,workTone,workMatchesPeriod}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const layout={sheets:[{zones:[{id:'H1'},{id:'H2'}]}],extraZones:[{id:'YARD'}],assignments:[{equipmentId:'CRANE-1',zoneId:'H1'}]};
const work=(extra={})=>({id:'work',equipmentId:'CRANE-1',status:'접수',priority:'보통',dueDate:'2026-11-05',planning:{approval:'승인',plannedDate:'2026-11-02',plannedEndAt:'2026-11-05T17:00'},...extra});
test('locations use exact equipment identifiers and explicit owner corrections, never name similarity',()=>{
 assert.equal(equipmentZone('CRANE-1',layout,[]),'H1');assert.equal(equipmentZone('CRANE-2',layout,[]),'unknown');
 assert.equal(equipmentZone('CRANE-1',layout,[{equipment_id:'CRANE-1',zone_id:'H2'}]),'H2');
 assert.equal(equipmentZone('CRANE-1',layout,[{equipment_id:'CRANE-1',zone_id:''}]),'unknown');
 assert.equal(equipmentZone('CRANE-1',layout,[{equipment_id:'CRANE-1',zone_id:'invalid'}]),'unknown');
});
test('zone totals partition work exactly once without changing source records or merging legal targets',()=>{
 const records=[work(),work({id:'legal',equipmentId:'LEGAL-1'}),work({id:'other',equipmentId:'CRANE-2'})];
 const groups=['H1','H2','YARD','unknown'].flatMap(z=>zoneWork(records,z,layout,[]));assert.equal(groups.length,3);assert.equal(new Set(groups.map(r=>r.id)).size,3);assert.equal(records[0].equipmentId,'CRANE-1');
});
test('status colours describe recorded work, and empty does not mean healthy equipment',()=>{
 assert.equal(workTone([],'2026-10-30'),'empty');assert.equal(workTone([work({status:'완료',dueDate:'2026-01-01'})],'2026-10-30'),'done');
 assert.equal(workTone([work({priority:'긴급'})],'2026-10-30'),'attention');assert.equal(workTone([work({dueDate:'2026-10-29'})],'2026-10-30'),'attention');
 assert.equal(workTone([work({status:'진행'})],'2026-10-30'),'running');assert.equal(workTone([work({planning:undefined})],'2026-10-30'),'review');assert.equal(workTone([work()],'2026-10-30'),'planned');
});
test('date filters cover multi-day work, overdue records, unplanned records and future forecasts honestly',()=>{
 assert.equal(workMatchesPeriod(work(),'2026-11-03','today'),true);assert.equal(workMatchesPeriod(work(),'2026-10-30','today'),false);
 assert.equal(workMatchesPeriod(work(),'2026-10-30','30'),true);assert.equal(workMatchesPeriod(work({planning:undefined,dueDate:'2027-01-01'}),'2026-10-30','30'),false);
 assert.equal(workMatchesPeriod(work({planning:undefined,dueDate:''}),'2026-10-30','30'),true);assert.equal(workMatchesPeriod(work({status:'완료',planning:undefined}),'2026-10-30','today'),false);
});
