import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../src/spare-parts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {spareStockStatus}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('unknown stock is never silently converted to zero or adequate stock',()=>assert.equal(spareStockStatus({confirmedQuantity:null,safety:1}),'실사 재고 미확인'));
test('a real zero is compared against the safety threshold',()=>{assert.equal(spareStockStatus({confirmedQuantity:0,safety:1}),'안전재고 미달');assert.equal(spareStockStatus({confirmedQuantity:0,safety:0}),'안전재고 충족');});
test('unknown safety stock stays unknown even if stock is known',()=>assert.equal(spareStockStatus({confirmedQuantity:4,safety:null}),'안전재고 기준 미확인'));
