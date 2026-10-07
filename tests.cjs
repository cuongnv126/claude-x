'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const C=require('./core.cjs'),S=require('./storage.cjs');
const {fixture,scan,sync,A,B,D,file,row,writeRow,remove,mutateDb,id,cli,head,sid,g,empty,section,scoped,baseline}=require('./fixtures.cjs');
test('independent metadata changes merge; same-field conflicts require a choice',async()=>{
  let ctx=new C.Context();let merged=await C.mergeSession(file,row(),scoped(row({title:'Rename'}),row({lastActivityAt:40})),baseline(),ctx,()=>{throw Error('unneeded');});
  assert.equal(ctx.conflicts.length,0);assert.equal(merged.value.title,'Rename');assert.equal(merged.value.lastActivityAt,40);
  ctx=new C.Context();merged=await C.mergeSession(file,row(),scoped(row({title:'One'}),row({title:'Two'})),baseline(),ctx,()=>{});
  assert.equal(ctx.conflicts.length,1);assert.match(ctx.conflicts[0].id,/title$/);
  ctx=new C.Context({['session:'+file+'.title']:'v1'});merged=await C.mergeSession(file,row(),scoped(row({title:'One'}),row({title:'Two'})),baseline(),ctx,()=>{});assert.equal(merged.value.title,'Two');
});
test('permissions, deletion and stale newcomer resurrection are never silent',async()=>{
  for(const [base,obs,state]of [[row(),scoped(row({permissionMode:'bypassPermissions'}),row()),baseline()],[row(),scoped(null,row()),baseline()],[null,scoped(row(),null),{scopes:[B],acknowledged:{}}]]){
    const ctx=new C.Context();await C.mergeSession(file,base,obs,state,ctx,()=>{});assert.ok(ctx.conflicts.length>0);
  }
});
test('a new empty account cannot delete sessions; arrays are atomic',async()=>{
  const ctx=new C.Context();const r=await C.mergeSession(file,undefined,scoped(row(),null),{scopes:[]},ctx,()=>{});assert.equal(ctx.conflicts.length,0);assert.deepEqual(r.value,row());
  const arrays=new C.Context();C.mergeValue(['one'],scoped(['one','two'],['one','three']),arrays,'session.array');assert.equal(arrays.conflicts.length,1);
});
test('custom groups merge independent names/members, ask about assignments and stale deletion',()=>{
  const base=C.normalizeGroups(g());let ctx=new C.Context();const a=g('Renamed'),b=g();b.groups.push({id:'g2',name:'New'});b.assignments['code:'+id(22)]='g2';b.order.g2=['code:'+id(22)];
  const merged=C.mergeGroups(base,scoped(a,b),{scopes:[A,B]},ctx);assert.equal(ctx.conflicts.length,0);assert.equal(merged.entities.g1.name,'Renamed');assert.equal(merged.entities.g2.name,'New');
  ctx=new C.Context();const aa=g(),bb=g();aa.assignments['code:'+sid]='g2';bb.assignments['code:'+sid]='g3';aa.groups.push({id:'g2',name:'A'});bb.groups.push({id:'g3',name:'B'});C.mergeGroups(base,scoped(aa,bb),{scopes:[A,B]},ctx);assert.ok(ctx.conflicts.some(c=>c.id.startsWith('assignment:')));
  ctx=new C.Context();C.mergeGroups({...base,entities:{g1:null},layout:[]},scoped(g(),empty()),{scopes:[B]},ctx);assert.ok(ctx.conflicts.some(c=>c.id==='group:g1'));
});
test('complete history extension is automatic; divergent branches preserve distinct files',async()=>{
  const f=await fixture();try{
    const cli2=id(32),p2=path.join(f.cfg.projects,'project',cli2+'.jsonl');fs.copyFileSync(f.transcript,p2);fs.appendFileSync(p2,JSON.stringify({type:'assistant',uuid:id(42),parentUuid:head,message:{content:'more'}})+'\n');
    const next=row({cliSessionId:cli2,lastAssistantUuid:id(42),completedTurns:2});const idx=S.transcriptIndex(f.cfg.projects);assert.equal((await S.inspectHistories([row(),next],idx)).kind,'extension');
    fs.writeFileSync(p2,JSON.stringify({type:'assistant',uuid:id(43),parentUuid:null,message:{content:'branch'}})+'\n');const branch=row({cliSessionId:cli2,lastAssistantUuid:id(43)});
    let ctx=new C.Context();await C.mergeSession(file,row({completedTurns:0}),scoped(row(),branch),{scopes:[A,B]},ctx,rows=>S.inspectHistories(rows,idx));assert.ok(ctx.conflicts.some(c=>c.id==='history:'+file&&c.options.some(o=>o.id==='both')));
    ctx=new C.Context({['history:'+file]:'both'});const r=await C.mergeSession(file,row({completedTurns:0}),scoped(row(),branch),{scopes:[A,B]},ctx,rows=>S.inspectHistories(rows,idx));assert.equal(r.extras.length,1);assert.equal(r.extras[0].value.cliSessionId,cli2);assert.notEqual(r.extras[0].value.sessionId,sid);
    fs.appendFileSync(p2,'invalid\n');assert.equal(await S.historyChain(p2,id(43)),null);
    fs.writeFileSync(p2,JSON.stringify({type:'assistant',uuid:id(43),parentUuid:id(99),message:{content:'missing parent'}})+'\n');assert.equal(await S.historyChain(p2,id(43)),null);
  }finally{f.cleanup();}
});
test('shared conversation file cannot offer preserve-both for two metadata heads',async()=>{
  const f=await fixture();try{const ctx=new C.Context();await C.mergeSession(file,row({completedTurns:0}),scoped(row(),row({lastAssistantUuid:id(99)})),{scopes:[A,B]},ctx,rows=>S.inspectHistories(rows,S.transcriptIndex(f.cfg.projects)));assert.ok(ctx.conflicts.length);assert.ok(!ctx.conflicts[0].options.some(o=>o.id==='both'));}finally{f.cleanup();}
});
test('one changed conversation is compared with the previous history',async()=>{
  let inspected=false;const ctx=new C.Context();const r=await C.mergeSession(file,row(),scoped(row({cliSessionId:id(32)}),row()),baseline(),ctx,async()=>{inspected=true;return {kind:'diverged',retrievable:true};});assert.equal(inspected,true);assert.ok(ctx.conflicts.some(c=>c.id==='history:'+file&&c.options.some(o=>o.id==='both')));assert.equal(r.value.cliSessionId,cli);
});
test('agreeing changed histories still check the baseline; branch access changes require separate confirmation',async()=>{
  const base=row(),next=row({cliSessionId:id(32)});let inspected=false,ctx=new C.Context();await C.mergeSession(file,base,scoped({...next,title:'Rename'},{...next,lastActivityAt:80}),baseline(),ctx,async()=>{inspected=true;return {kind:'diverged',retrievable:true};});assert.ok(inspected);assert.ok(ctx.conflicts.some(c=>c.id==='history:'+file));
  ctx=new C.Context({['history:'+file]:'both'});const r=await C.mergeSession(file,base,scoped(row({title:'A',cuGrantFlags:['control']}),row({cliSessionId:id(32),title:'B',chromeAllowedDomains:['example.test']})),baseline(),ctx,async()=>({kind:'diverged',retrievable:true}));assert.ok(ctx.conflicts.some(c=>c.id.startsWith('access:')&&c.id.endsWith('.cuGrantFlags')));assert.ok(ctx.conflicts.some(c=>c.id.startsWith('access:')&&c.id.endsWith('.chromeAllowedDomains')));assert.equal(r.value.cuGrantFlags,undefined);
});
test('non-Code memberships are preserved per scope in default and manual sections',()=>{
  const old=section(g());old.sections.find(s=>s.id==='pinned').members=['chat:private','code:'+sid];const n=C.normalizeSections(old);assert.deepEqual(n.sections.pinned.members,['code:'+sid]);const result=C.materialSections(n,g(),old);assert.deepEqual(result.sections.find(s=>s.id==='pinned').members,['code:'+sid,'chat:private']);
});
test('valid non-manual section positions survive materialization',()=>{
  const old={sections:[{id:'sessions',kind:'sessions',order:0},{id:'g1',kind:'manual',name:'Tools',order:1},{id:'pinned',kind:'pinned',order:2}]};const restored=C.materialSections(C.normalizeSections(old),g(),old);assert.deepEqual(restored.sections.map(s=>[s.id,s.order]),[['sessions',0],['g1',1],['pinned',2]]);
});
test('malformed UUID chains cannot establish automatic containment',async()=>{
  const f=await fixture();try{fs.writeFileSync(f.transcript,JSON.stringify({uuid:'bad',parentUuid:null,type:'assistant',message:{content:'bad'}})+'\n');assert.equal(await S.historyChain(f.transcript,'bad'),null);}finally{f.cleanup();}
});
test('additions use native migration; confirmed group renames use replacement',async()=>{
  const f=await fixture();try{await sync(f.cfg);let db=await S.readDb(path.join(f.cfg.root,'Local Storage/leveldb'));assert.equal(db.entries.get(db.keys.marker).subarray(1).toString('utf16le'),A+'|migrate');
    const {snap,state}=await scan(f.cfg);try{const renamed={...state.groups,entities:{g1:{id:'g1',name:'Rename'}}};const p={...(await S.plan(f.cfg,snap,state)),groups:renamed};await S.transaction(f.cfg,snap,state,p);}finally{remove(snap);}
    db=await S.readDb(path.join(f.cfg.root,'Local Storage/leveldb'));assert.equal(db.entries.get(db.keys.marker).subarray(1).toString('utf16le'),A);
  }finally{f.cleanup();}
});
test('apply backs up original records/transcripts, preserves unrelated data, repeats without session edits',async()=>{
  const f=await fixture({one:true});try{
    const initial=S.tree(f.cfg.root),raw=S.fileHash(f.transcript);const b=await sync(f.cfg);assert.equal(b.status,'complete');assert.equal(b.transcripts[0].hash,raw);assert.ok(fs.existsSync(path.join(b.path||path.join(f.cfg.data,'backups',b.id),'before/accounts',A,file)));
    assert.ok(fs.existsSync(path.join(f.cfg.root,'claude-code-sessions',B,file)));const db=await S.readDb(path.join(f.cfg.root,'Local Storage/leveldb'));assert.equal(db.primary.state.unrelatedPreference.width,987);assert.equal([...db.entries].find(([k])=>Buffer.from(k,'hex').toString().endsWith('authentication-cache'))[1].toString(),'private-test-login');assert.equal(S.fileHash(f.transcript),raw);
    const x=await scan(f.cfg);assert.equal(x.p.conflicts.length,0);assert.equal(x.p.sessionWrites,0);assert.equal(x.p.preferenceWrites,0);remove(x.snap);
    assert.equal(S.tree(f.cfg.root)['config.json'],initial['config.json']);assert.equal(S.tree(f.cfg.root)['claude-code-sessions/'+A+'/schedule.json'],initial['claude-code-sessions/'+A+'/schedule.json']);
  }finally{f.cleanup();}
});
test('latest five backups retain exact transcripts, deduplicate and collect unreferenced chunks',async()=>{
  const f=await fixture();try{
    await sync(f.cfg);const blobCount=fs.readdirSync(path.join(f.cfg.data,'blobs')).length;
    await sync(f.cfg);assert.equal(fs.readdirSync(path.join(f.cfg.data,'blobs')).length,blobCount);
    const first=S.backupList(f.cfg).at(-1);const old=first.transcripts[0].chunks[0].hash;
    for(let i=0;i<6;i++){fs.appendFileSync(f.transcript,JSON.stringify({type:'queue-operation',operation:'append',content:'unique'+i})+'\n');await sync(f.cfg);}
    const list=S.backupList(f.cfg);assert.equal(list.length,5);assert.ok(!list.some(b=>b.id===first.id));assert.ok(!fs.existsSync(path.join(f.cfg.data,'blobs',old+'.gz')));
    for(const b of list){const out=path.join(f.dir,'verify-'+b.id);S.restorePayload(f.cfg,b.transcripts[0],out);assert.equal(S.fileHash(out),b.transcripts[0].hash);}
  }finally{f.cleanup();}
});
test('selective restore preserves current login/preferences/schedules and newer scopes; collisions ask first',async()=>{
  const f=await fixture();try{
    const b=await sync(f.cfg);writeRow(f.cfg,A,row({title:'Today'}));writeRow(f.cfg,B,row({title:'Today'}));fs.appendFileSync(f.transcript,JSON.stringify({type:'queue-operation',content:'changed'})+'\n');
    const key='_https://claude.ai\0\x01';await mutateDb(f.cfg,async db=>{const p=S.decode(await db.get(Buffer.from(key+'dframe-store','latin1')));p.state.unrelatedPreference.width=555;await db.put(Buffer.from(key+'dframe-store','latin1'),S.encode(p));await db.put(Buffer.from(key+'authentication-cache','latin1'),Buffer.from('today-login'));});
    fs.writeFileSync(path.join(f.cfg.root,'claude-code-sessions',A,'schedule.json'),'today schedule');fs.mkdirSync(path.join(f.cfg.root,'claude-code-sessions',D),{recursive:true});writeRow(f.cfg,D,row({title:'New account'}));
    const {snap,state}=await scan(f.cfg);try{
      const unresolved=await S.restorePlan(f.cfg,snap,state,b.id);assert.ok(unresolved.conflicts.some(c=>c.id.startsWith('restore-transcript:')));assert.ok(unresolved.conflicts.some(c=>c.id==='restore:'+b.id));
      const p=await S.restorePlan(f.cfg,snap,state,b.id,{['restore-transcript:'+f.transcript]:'restore',['restore:'+b.id]:'restore'});assert.equal(p.conflicts.length,0);await S.transaction(f.cfg,snap,state,p);
    }finally{remove(snap);}
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.cfg.root,'claude-code-sessions',A,file))).title,'Original');assert.equal(JSON.parse(fs.readFileSync(path.join(f.cfg.root,'claude-code-sessions',D,file))).title,'New account');assert.equal(fs.readFileSync(path.join(f.cfg.root,'claude-code-sessions',A,'schedule.json'),'utf8'),'today schedule');assert.equal(S.fileHash(f.transcript),b.transcripts[0].hash);
    const db=await S.readDb(path.join(f.cfg.root,'Local Storage/leveldb'));assert.equal(db.primary.state.unrelatedPreference.width,555);assert.equal([...db.entries].find(([k])=>Buffer.from(k,'hex').toString().endsWith('authentication-cache'))[1].toString(),'today-login');assert.equal(db.primary.state.lastSidebarScopeKey,A);
    const x=await scan(f.cfg);assert.ok(x.p.conflicts.some(c=>c.id==='session:'+file||c.id.endsWith('.title')));remove(x.snap);
  }finally{f.cleanup();}
});
test('failed installation rolls back exact trees and preserves the backup',async()=>{
  const f=await fixture();try{await sync(f.cfg);writeRow(f.cfg,A,row({title:'Rename'}));const before=S.tree(f.cfg.root),state=S.fileHash(path.join(f.cfg.data,'state.json'));await assert.rejects(sync(f.cfg,{}, {failAfter:1}),/Injected/);assert.deepEqual(S.tree(f.cfg.root),before);assert.equal(S.fileHash(path.join(f.cfg.data,'state.json')),state);assert.equal(S.backupList(f.cfg)[0].status,'rolled-back');assert.ok(!fs.existsSync(path.join(f.cfg.data,'pending.json')));}finally{f.cleanup();}
});
test('interrupted replacement supports rollback or verified finish, protects pending backup, rejects identity changes',async()=>{
  const f=await fixture();try{
    await sync(f.cfg);writeRow(f.cfg,A,row({title:'Rename'}));const before=S.tree(f.cfg.root);await assert.rejects(sync(f.cfg,{}, {failAfter:1,leaveInterrupted:true}),/Injected/);assert.ok(fs.existsSync(path.join(f.cfg.data,'pending.json')));S.retain(f.cfg);assert.ok(S.backupList(f.cfg).some(b=>b.path===JSON.parse(fs.readFileSync(path.join(f.cfg.data,'pending.json'))).run));await assert.rejects(S.recover(f.cfg,'finish'),/incomplete/);
    S.atomic(path.join(f.cfg.root,'config.json'),{lastKnownAccountUuid:id(2)});await assert.rejects(S.recover(f.cfg,'rollback'),/Account changed/);S.atomic(path.join(f.cfg.root,'config.json'),{lastKnownAccountUuid:id(1),unrelated:'login'});
    await S.recover(f.cfg,'rollback');assert.deepEqual(S.tree(f.cfg.root),before);
    await assert.rejects(sync(f.cfg,{}, {failAfter:3,leaveInterrupted:true}),/Injected/);await S.recover(f.cfg,'finish');assert.equal(JSON.parse(fs.readFileSync(path.join(f.cfg.root,'claude-code-sessions',B,file))).title,'Rename');
  }finally{f.cleanup();}
});
test('external edits and corrupt deduplicated backup blobs stop before live replacement',async()=>{
  const f=await fixture();try{
    await sync(f.cfg);let x=await scan(f.cfg);writeRow(f.cfg,A,row({title:'external'}));await assert.rejects(S.transaction(f.cfg,x.snap,x.state,x.p),/Sessions changed/);remove(x.snap);
    const b=S.backupList(f.cfg)[0],chunk=b.transcripts[0].chunks[0].hash;fs.writeFileSync(path.join(f.cfg.data,'blobs',chunk+'.gz'),'corrupt');const before=S.tree(f.cfg.root);await assert.rejects(sync(f.cfg),/header|corrupt/);assert.deepEqual(S.tree(f.cfg.root),before);
  }finally{f.cleanup();}
});
test('corrupted held originals and state files block recovery before any live writes',async()=>{
  const f=await fixture();try{await sync(f.cfg);writeRow(f.cfg,A,row({title:'Rename'}));await assert.rejects(sync(f.cfg,{}, {failAfter:1,leaveInterrupted:true}),/Injected/);const j=JSON.parse(fs.readFileSync(path.join(f.cfg.data,'pending.json')));fs.writeFileSync(path.join(j.targets[0].held,'schedule.json'),'corrupt');const before=S.tree(f.cfg.root);await assert.rejects(S.recover(f.cfg,'rollback'),/Held original changed/);assert.deepEqual(S.tree(f.cfg.root),before);assert.ok(fs.existsSync(path.join(f.cfg.data,'pending.json')));}finally{f.cleanup();}
});
test('a killed owner releases both new and legacy locks safely',async()=>{
  const f=await fixture();try{const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);child.kill('SIGKILL');await new Promise(r=>child.on('exit',r));f.cfg.legacyState=path.join(f.dir,'legacy-state.json');S.atomic(f.cfg.legacyState,{});
    for(const dir of [path.join(f.cfg.data,'operation.lock'),f.cfg.legacyState+'.lock']){fs.mkdirSync(dir);S.atomic(path.join(dir,'owner.json'),{pid:child.pid,tool:'claude-x',root:f.cfg.root});}
    const unlock=S.lock(f.cfg);unlock();assert.ok(!fs.existsSync(f.cfg.legacyState+'.lock'));fs.mkdirSync(f.cfg.legacyState+'.lock');assert.throws(()=>S.lock(f.cfg),/does not belong/);
  }finally{f.cleanup();}
});
test('preview does not prune backups or mutate live/state data',async()=>{
  const f=await fixture();try{
    await sync(f.cfg);const b=S.backupList(f.cfg)[0];const copy=path.join(f.cfg.data,'backups','2000-01-01T00-00-00-000Z-aaaaaaaa');fs.cpSync(b.path,copy,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(copy,'manifest.json')));manifest.id=path.basename(copy);S.atomic(path.join(copy,'manifest.json'),manifest);
    const live=S.tree(f.cfg.root),backups=S.tree(path.join(f.cfg.data,'backups')),state=S.fileHash(path.join(f.cfg.data,'state.json'));
    const ui={info(){},plan(){},warn(){},close(){},interactive:false};await require('./cli.cjs').runOperation(f.cfg,ui,'preview');assert.deepEqual(S.tree(f.cfg.root),live);assert.deepEqual(S.tree(path.join(f.cfg.data,'backups')),backups);assert.equal(S.fileHash(path.join(f.cfg.data,'state.json')),state);
  }finally{f.cleanup();}
});
test('corrupt state keys and tampered backed-up state are rejected',async()=>{
  const f=await fixture();try{const b=await sync(f.cfg);const statePath=path.join(f.cfg.data,'state.json'),state=JSON.parse(fs.readFileSync(statePath));state.sessions['../../escape.json']=row();S.atomic(statePath,state);const snap=await S.snapshot(f.cfg);await assert.rejects(S.importState(f.cfg,snap),/Unmanaged session/);delete state.sessions['../../escape.json'];S.atomic(statePath,state);const before=path.join(S.backupList(f.cfg)[0].path,'state-before.json');fs.appendFileSync(before,' ');await assert.rejects(S.restorePlan(f.cfg,snap,state,b.id),/fingerprint changed/);remove(snap);}finally{f.cleanup();}
});
test('legacy import uses verified baseline content and preserves known null tombstones',async()=>{
  const f=await fixture();try{
    const legacy=path.join(f.dir,'legacy'),run=path.join(legacy,'backups','old-run');fs.mkdirSync(path.join(run,'account-before',A),{recursive:true});const raw=Buffer.from(JSON.stringify(row()));fs.writeFileSync(path.join(run,'account-before',A,file),raw);f.cfg.legacyState=path.join(legacy,'sync-state.json');
    const snap=await S.snapshot(f.cfg);const hash=v=>S.hash(Buffer.from(JSON.stringify(v)));const old={root:f.cfg.root,scopes:[A,B],baseline:Object.fromEntries([A,B].map(s=>[s,{[file]:S.hash(raw),['local_'+id(22)+'.json']:null}])),preferences:{primaryGroups:{baseline:Object.fromEntries([A,B].map(s=>[s,hash(snap.db.primary.state.customGroupsByScope[s])]))},primarySections:{baseline:Object.fromEntries([A,B].map(s=>[s,hash(snap.db.primary.state.codeSidebarByScope[s])]))}}};remove(snap);S.atomic(f.cfg.legacyState,old);
    writeRow(f.cfg,A,row({title:'Edited A'}));writeRow(f.cfg,B,row({title:'Edited B'}));let x=await S.snapshot(f.cfg);const imported=await S.importState(f.cfg,x);assert.deepEqual(imported.sessions[file],row());assert.equal(imported.sessions['local_'+id(22)+'.json'],null);remove(x);
    fs.rmSync(path.join(run,'account-before',A,file));x=await S.snapshot(f.cfg);await assert.rejects(S.importState(f.cfg,x),/baseline is unavailable/);remove(x);
  }finally{f.cleanup();}
});
test('preserved branches retain the originating account group',async()=>{
  const f=await fixture();try{
    const oldCli=id(33),otherCli=id(32);fs.copyFileSync(f.transcript,path.join(f.cfg.projects,'project',oldCli+'.jsonl'));fs.appendFileSync(f.transcript,JSON.stringify({uuid:id(42),parentUuid:head,type:'assistant',message:{content:'A'}})+'\n');fs.writeFileSync(path.join(f.cfg.projects,'project',otherCli+'.jsonl'),JSON.stringify({uuid:id(43),parentUuid:null,type:'assistant',message:{content:'B'}})+'\n');writeRow(f.cfg,A,row({title:'A',lastAssistantUuid:id(42)}));writeRow(f.cfg,B,row({title:'B',cliSessionId:otherCli,lastAssistantUuid:id(43)}));
    const snap=await S.snapshot(f.cfg),state=await S.importState(f.cfg,snap);state.scopes=[A,B];state.sessions={[file]:row({cliSessionId:oldCli})};state.groups=C.normalizeGroups({groups:[{id:'g0',name:'Old'},{id:'g1',name:'A'},{id:'g2',name:'B'}],assignments:{['code:'+sid]:'g0'},order:{g0:['code:'+sid]}});state.sections=C.normalizeSections(section(C.materialGroups(state.groups)));
    for(const [scope,group]of [[A,'g1'],[B,'g2']])snap.db.primary.state.customGroupsByScope[scope]={groups:C.materialGroups(state.groups).groups,assignments:{['code:'+sid]:group},order:{[group]:['code:'+sid]}};
    const p=await S.plan(f.cfg,snap,state,{['history:'+file]:'both',['assignment:code:'+sid]:'v0'});const extra=Object.entries(p.sessions).find(([name,v])=>name!==file&&v?.cliSessionId===otherCli);assert.ok(extra);assert.equal(p.groups.assignments['code:'+sid],'g1');assert.equal(p.groups.assignments['code:'+extra[1].sessionId],'g2');remove(snap);
  }finally{f.cleanup();}
});
