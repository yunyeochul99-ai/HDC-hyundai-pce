import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/statutory-plans.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {readStatutoryDetails,writeStatutoryDetails,statutorySummary,statutoryFields}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
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
