#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { compactToolValue, toolOutput } from '../intelligence/tool-output.mjs';
import { buildContextPack } from '../intelligence/context-pack.mjs';
import { buildOrchestrationPlan } from '../intelligence/orchestration-plan.mjs';
import { loadKnowledge, resolveTask } from '../intelligence/workspace-knowledge.mjs';
import { saveTaskEvidence, readTaskEvidence } from '../intelligence/task-evidence.mjs';

const knowledge = loadKnowledge();
const query = 'Reduce agent token duplication in GitHub workflows';
assert.deepEqual(resolveTask(query, knowledge).modules.map(m => m.id), ['totem-workspace']);
assert.deepEqual(resolveTask('調整驗證輸出', knowledge, { moduleId: 'totem-workspace' }).modules.map(m => m.id), ['totem-workspace']);
assert.throws(() => resolveTask('typo', knowledge, { moduleId: 'missing-module' }), /Unknown/);
const focused = resolveTask('Fix TotemRemnant and TotemNexus synchronization', knowledge, { moduleId: 'totem-remnant' });
assert.deepEqual(new Set(focused.modules.map(m => m.id)), new Set(['totem-remnant', 'totem-nexus']));
for (const task of ['Fix Remnant and Nexus synchronization', '修正殘響與樞紐同步']) {
 assert.deepEqual(new Set(resolveTask(task, knowledge, {moduleId:'totem-remnant'}).modules.map(m=>m.id)), new Set(['totem-remnant','totem-nexus']));
}
const plan = buildOrchestrationPlan({ query: 'Fix local translation', moduleId: 'totem-remnant', knowledge });
assert.deepEqual(plan.writeScope.map(s => s.moduleId), ['totem-remnant']);
assert.ok(plan.readScope.some(s => s.moduleId === 'totem-core'), 'Audited dependencies remain in read scope');
const pack = buildContextPack(query, { knowledge, includeCode: false, moduleId: 'totem-workspace' });
const compact = toolOutput(pack), full = toolOutput(pack, 'full');
assert.deepEqual(compact.value.routing, pack.routing);
assert.deepEqual(compact.value.validation, pack.validation);
assert.equal(compact.value.rendered, undefined);
assert.deepEqual(JSON.parse(compact.text), compact.value);
const compactPlan = compactToolValue(plan);
for (const key of ['execution','readScope','writeScope','waves','requiredValidation','securityConstraints','releaseConstraints','riskConstraints','engineeringConstraints']) assert.deepEqual(compactPlan[key], plan[key]);
assert.equal(compactPlan.executionWaves, undefined);
assert.deepEqual(toolOutput(plan, 'full').value, plan);
assert.throws(() => toolOutput(plan, 'invalid'), /response_detail/);
assert.ok(Buffer.byteLength(compact.text) < Buffer.byteLength(full.text) * .7);

const calls = [
 { jsonrpc:'2.0',id:1,method:'tools/list' },
 ...['compact','full'].map((detail, i) => ({ jsonrpc:'2.0',id:i+2,method:'tools/call',params:{name:'context_pack',arguments:{query,module_id:'totem-workspace',include_code:false,response_detail:detail}} }))
];
const output = execFileSync(process.execPath, ['mcp/server.mjs'], { input:calls.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8' }).trim().split('\n').map(JSON.parse);
assert.ok(output[0].result.tools.every(t => t.inputSchema.properties.response_detail));
assert.equal(output[1].result.isError, false);
assert.equal(output[1].result.structuredContent.rendered, undefined);
assert.ok(output[2].result.structuredContent.rendered);
assert.deepEqual(JSON.parse(output[1].result.content[0].text), output[1].result.structuredContent);
assert.deepEqual(output[1].result.structuredContent.routing, output[2].result.structuredContent.routing);

const temp = fs.mkdtempSync(path.join(os.tmpdir(),'totem-token-efficiency-'));
try {
 const repo = path.join(temp,'repo'); fs.mkdirSync(repo);
 const git = (...args) => execFileSync('git',args,{cwd:repo,stdio:'pipe'});
 git('init'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
 fs.writeFileSync(path.join(repo,'source.txt'),'before'); git('add','source.txt');git('commit','-m','fixture');
 const notes={findings:['Short verified finding'],validation:['Record only; no approval'],pending:['Check CI']};
 assert.throws(()=>saveTaskEvidence(repo,'not-ignored',notes,['source.txt']),/Git-ignored/);
 fs.appendFileSync(path.join(repo,'.git/info/exclude'),'\n.totem-index/\n');
 saveTaskEvidence(repo,'sample',notes,['source.txt','new.txt']);
 assert.equal(readTaskEvidence(repo,'sample').status,'current');
 fs.writeFileSync(path.join(repo,'source.txt'),'after!');
 assert.deepEqual(readTaskEvidence(repo,'sample').changedInputs,['source.txt']);
 fs.writeFileSync(path.join(repo,'source.txt'),'before');fs.writeFileSync(path.join(repo,'new.txt'),'new');
 assert.deepEqual(readTaskEvidence(repo,'sample').changedInputs,['new.txt']);fs.unlinkSync(path.join(repo,'new.txt'));
 git('commit','--allow-empty','-m','new commit');assert.equal(readTaskEvidence(repo,'sample').commitChanged,true);
 assert.throws(()=>saveTaskEvidence(repo,'../escape',notes,['source.txt']),/Task id/);
 fs.symlinkSync(path.join(temp,'outside.txt'),path.join(repo,'escape'));fs.writeFileSync(path.join(temp,'outside.txt'),'outside');
 assert.throws(()=>saveTaskEvidence(repo,'escape',notes,['escape']),/escapes/);
 assert.throws(()=>saveTaskEvidence(repo,'extra',{authorization:['approved']},['source.txt']),/Use findings/);

 const module = path.join(temp,'module');
 const resources=path.join(module,'src/main/resources');
 fs.mkdirSync(path.join(resources,'assets/totem/lang'),{recursive:true});
 fs.mkdirSync(path.join(module,'.github/staging'),{recursive:true});
 fs.writeFileSync(path.join(module,'gradle.properties'),'mod_version=1.2.3\narchives_base_name=totem-fixture\nminecraft_version=26.2\n');
 const metadata={id:'totem-fixture',version:'${version}',depends:{minecraft:'~26.2',java:'>=25','totem-core':'>=0.7.21 <0.8.0'}};
 fs.writeFileSync(path.join(resources,'fabric.mod.json'),JSON.stringify(metadata));
 fs.writeFileSync(path.join(module,'.github/staging/modrinth-changelog-1.2.3.md'),'Release notes');
 const lang=path.join(resources,'assets/totem/lang');
 fs.writeFileSync(path.join(lang,'en_us.json'),JSON.stringify({title:'%d items: %s'}));
 fs.writeFileSync(path.join(lang,'zh_tw.json'),JSON.stringify({title:'%2$s：%1$d 個'}));
 const preflight=(...args)=>{
  const r=spawnSync('python3',['scripts/release-preflight.py',module,...args],{encoding:'utf8'});
  assert.notEqual(r.status,null,r.stderr);return {status:r.status,report:JSON.parse(r.stdout)};
 };
 assert.equal(preflight().status,0);
 assert.equal(preflight().report.artifact.checked,false);
 assert.equal(preflight('--expected-module','totem-other').status,1);
 const {id: ignoredId, ...noId}=metadata;
 fs.writeFileSync(path.join(resources,'fabric.mod.json'),JSON.stringify(noId));
 assert.ok(preflight().report.errors.some(e=>e.code==='module-id'));
 fs.writeFileSync(path.join(lang,'zh_tw.json'),JSON.stringify({title:'%s items: %d'}));
 fs.writeFileSync(path.join(resources,'fabric.mod.json'),JSON.stringify({...metadata,version:'9.9.9'}));
 const failed=preflight();assert.equal(failed.status,1);
 assert.ok(failed.report.errors.some(e=>e.code==='version'));
 assert.ok(failed.report.errors.some(e=>e.code==='locale-format'));
 fs.writeFileSync(path.join(resources,'fabric.mod.json'),JSON.stringify(metadata));
 fs.writeFileSync(path.join(lang,'zh_tw.json'),JSON.stringify({title:'%2$s：%1$d 個'}));
 const jar=path.join(temp,'totem-fixture-1.2.3.jar');
 execFileSync('python3',['-c','import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("fabric.mod.json",sys.argv[2]); z.close()',jar,JSON.stringify({...metadata,version:'1.2.3'})]);
 const goodJar=preflight('--jar',jar);assert.equal(goodJar.status,0);assert.equal(goodJar.report.artifact.checked,true);
 assert.equal(preflight('--jar',jar,'--expected-sha512','wrong').status,1);
 assert.equal(preflight('--expected-sha512','wrong').status,1);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log(JSON.stringify({status:'passed',checks:['MCP full/compact parity','constraint preservation','focused routing with audited impact','stale evidence detection','source/artifact preflight'],sampleBytes:{full:Buffer.byteLength(full.text),compact:Buffer.byteLength(compact.text)}}));
