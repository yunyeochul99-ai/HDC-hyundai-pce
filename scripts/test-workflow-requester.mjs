import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/workflow-requester.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {workflowRequester}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const event=(id,stage,actor_name,occurred_at='2026-10-23T05:15:20Z')=>({id,stage,actor_name,occurred_at});
test('direct plan requester is the actual initial registration account',()=>{
 const plan=event(1,'plan','Requester');
 assert.equal(workflowRequester([plan,event(2,'approve','Approver')]),plan);
});
test('linked discovery request remains authoritative over a later work plan',()=>{
 const request=event(1,'request','Discoverer','2026-10-20T00:00:00Z');
 assert.equal(workflowRequester([event(3,'plan','Planner'),request,event(2,'accept','Receiver')]),request);
});
test('unsorted events select first requester without mutating history',()=>{
 const first=event(1,'plan','Original','2026-10-20T00:00:00Z');
 const later=event(2,'plan','Later');const history=[later,first];
 assert.equal(workflowRequester(history),first);assert.equal(history[0],later);
});
test('approval and completion alone do not fabricate a requester',()=>{
 assert.equal(workflowRequester([event(1,'approve','Approver'),event(2,'complete','Completer')]),undefined);
 assert.equal(workflowRequester([]),undefined);
});
