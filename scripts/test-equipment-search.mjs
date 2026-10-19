import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/equipment-options.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {equipmentOptions,matchesEquipmentSearch}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const equipment=[{id:'H1TC1',name:'타워크레인 1호기',grade:'A',category:'크레인',model:'744CS'},{id:'H2TC2',name:'타워 크레인 2호기',grade:'B',category:'크레인'},{id:'BP',name:'배치플랜트',grade:'A',category:'B/P'}];
const options={sort:'name',category:'',grade:'',search:''};
test('tower search narrows equipment despite name spacing and query whitespace',()=>{
 assert.deepEqual(equipmentOptions(equipment,{...options,search:' 타워 크레인 '}).map(e=>e.id).sort(),['H1TC1','H2TC2']);
});
test('code and model search is case insensitive including full width input',()=>{
 assert.deepEqual(equipmentOptions(equipment,{...options,search:'ｈ１ｔｃ１'}).map(e=>e.id),['H1TC1']);
 assert.equal(equipmentOptions(equipment,{...options,search:'744cs'})[0].id,'H1TC1');
});
test('search combines with grade and category without mutating the source',()=>{
 const original=JSON.stringify(equipment);
 assert.deepEqual(equipmentOptions(equipment,{...options,search:'타워크레인',grade:'B',category:'크레인'}).map(e=>e.id),['H2TC2']);
 assert.equal(JSON.stringify(equipment),original);
});
test('clearing search restores results and unknown search has no results',()=>{
 assert.equal(equipmentOptions(equipment,{...options,search:'없는설비'}).length,0);
 assert.equal(equipmentOptions(equipment,options).length,3);
 assert.equal(matchesEquipmentSearch('점검 담당 홍길동',' 홍 길 동 '),true);
});

