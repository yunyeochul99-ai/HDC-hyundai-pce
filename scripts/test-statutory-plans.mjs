import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/statutory-plans.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {readStatutoryDetails,writeStatutoryDetails,statutorySummary,statutoryFields,sortStatutoryPlans,statutoryTiming}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('register values, symbols and manually entered dates survive a save/edit round trip',()=>{
 const details={...readStatutoryDetails('기존 근거\n보존'),group:'설비',sequence:'01',quantity:'1식',capacity:'2 m³',lastDate:'2026-04-18',nextDate:'2028-04-18',agency:'검사기관',modelNumber:'MODEL-A',application:'작동기능점검',managementNumber:'☆'};
 const encoded=writeStatutoryDetails(details);
 assert.deepEqual(readStatutoryDetails(encoded),details);
 assert.ok(encoded.length<=2000);
 for(const [,label] of statutoryFields) assert.ok(statutorySummary(encoded).includes(label+':'));
});
test('legacy and malformed evidence are preserved without losing original text',()=>{
 for(const evidence of ['일반 계획의 근거','HDC-STATUTORY-V1\ninvalid','HDC-STATUTORY-V1\n{}'])assert.equal(readStatutoryDetails(evidence).evidence,evidence);
});
test('missing dates remain blank; impossible and reversed dates are rejected',()=>{
 const empty=readStatutoryDetails();assert.deepEqual(readStatutoryDetails(writeStatutoryDetails(empty)),empty);
 for(const date of ['2026-02-30','2026-13-01','bad'])assert.throws(()=>writeStatutoryDetails({...empty,lastDate:date}));
 assert.throws(()=>writeStatutoryDetails({...empty,lastDate:'2028-01-01',nextDate:'2027-01-01'}));
});
test('oversized details fail before sending a request to the server',()=>{
 assert.throws(()=>writeStatutoryDetails({...readStatutoryDetails(),agency:'a'.repeat(101)}));
 assert.throws(()=>writeStatutoryDetails(readStatutoryDetails('a'.repeat(2001))));
});
test('schedule sorts across years and months; blank and invalid dates are last without mutating input',()=>{
 const plan=(id,date)=>({id,title:id,evidence:date==='invalid'?'HDC-STATUTORY-V1\n'+JSON.stringify({...readStatutoryDetails(),nextDate:'2027-02-30'}):writeStatutoryDetails({...readStatutoryDetails(),nextDate:date})});
 const plans=[plan('later','2028-01-01'),plan('blank',''),plan('next-month','2027-02-01'),plan('first','2026-12-31'),plan('invalid','invalid')];
 assert.deepEqual(sortStatutoryPlans(plans).map(p=>p.id),['first','next-month','later','blank','invalid']);
 assert.equal(plans[0].id,'later');
 assert.deepEqual(sortStatutoryPlans([plan('b','2027-01-01'),plan('a','2027-01-01')]).map(p=>p.id),['a','b']);
});
test('timing handles today, overdue, the 30-day boundary and leap years',()=>{
 assert.equal(statutoryTiming('2026-10-22','2026-10-23').days,-1);
 assert.equal(statutoryTiming('2026-10-23','2026-10-23').label,'오늘');
 assert.equal(statutoryTiming('2026-11-22','2026-10-23').tone,'amber');
 assert.equal(statutoryTiming('2026-11-23','2026-10-23').tone,'blue');
 assert.equal(statutoryTiming('2028-03-01','2028-02-28').days,2);
 assert.equal(statutoryTiming('2027-02-30','2026-10-23').days,null);
 assert.equal(statutoryTiming('','2026-10-23').days,null);
});
test('completion schedule sorts recent inspection dates newest first, leaving missing dates last',()=>{
 const plan=(id,lastDate,nextDate)=>({id,title:id,evidence:writeStatutoryDetails({...readStatutoryDetails(),lastDate,nextDate})});
 const plans=[plan('old','2025-02-13','2027-02-13'),plan('missing','',''),plan('recent','2026-09-08','2028-09-18'),plan('middle','2026-04-07','2028-06-16')];
 assert.deepEqual(sortStatutoryPlans(plans,'lastDate',true).map(p=>p.id),['recent','middle','old','missing']);
 assert.deepEqual(sortStatutoryPlans(plans).map(p=>p.id),['old','middle','recent','missing']);
 assert.equal(readStatutoryDetails(plans[2].evidence).nextDate,'2028-09-18');
});
