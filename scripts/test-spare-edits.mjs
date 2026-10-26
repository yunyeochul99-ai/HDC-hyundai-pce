import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../src/spare-edit-values.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {mergeSparePart,sparePatch,spareTextFields,spareNumberFields}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const item={id:'part1',list:'standard',name:'모터',spec:'원본 사양',sourceQuantity:3,quantityText:'3개',sourceAmount:100,sourceSheet:'Sheet1',sourceRow:5,confirmedQuantity:null,safety:1};
const values=original=>Object.fromEntries([...Object.keys(spareTextFields),...Object.keys(spareNumberFields)].map(k=>[k,String(original[k]??'')]));
test('manual corrections survive refreshed source data while preserving source quantities and provenance',()=>{
 const edit={patch:{spec:'수정 사양',confirmedQuantity:0,sourceQuantity:99,id:'bad'}};
 const merged=mergeSparePart(item,edit);assert.equal(merged.spec,'수정 사양');assert.equal(merged.confirmedQuantity,0);assert.equal(merged.sourceQuantity,3);assert.equal(merged.id,'part1');assert.equal(merged.sourceRow,5);
 assert.equal(mergeSparePart({...item,spec:'새 원본'},edit).spec,'수정 사양');assert.equal(item.spec,'원본 사양');
});
test('only changed fields are patched, so unedited fields continue to follow source imports',()=>{
 assert.deepEqual(sparePatch(item,values(item)),{});assert.deepEqual(sparePatch(item,{...values(item),spec:'새 사양'}),{spec:'새 사양'});
});
test('unknown quantities remain null and real zero remains zero',()=>{
 assert.deepEqual(sparePatch(item,{...values(item),confirmedQuantity:'0'}),{confirmedQuantity:0});
 const known={...item,confirmedQuantity:4};assert.deepEqual(sparePatch(known,{...values(known),confirmedQuantity:''}),{confirmedQuantity:null});
});
test('invalid amounts, negative stock and blank names cannot be saved',()=>{
 for(const raw of ['-1','NaN','Infinity','1000000000001'])assert.throws(()=>sparePatch(item,{...values(item),confirmedQuantity:raw}));
 assert.throws(()=>sparePatch(item,{...values(item),name:'  '}));
});
