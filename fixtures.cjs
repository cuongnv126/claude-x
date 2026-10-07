'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const C=require('./core.cjs'),S=require('./storage.cjs');
const {ClassicLevel}=require('./runtime/node_modules/classic-level');
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-a111-111111111111`;
const A=id(1)+'/'+id(11),B=id(2)+'/'+id(11),D=id(3)+'/'+id(11);
const sid='local_'+id(21),file=sid+'.json',cli=id(31),head=id(41);
const row=(extra={})=>({sessionId:sid,title:'Original',cliSessionId:cli,lastAssistantUuid:head,completedTurns:1,createdAt:1,lastActivityAt:10,...extra});
const empty=()=>({groups:[],assignments:{},order:{}});
const g=(name='Tools')=>({groups:[{id:'g1',name}],assignments:{['code:'+sid]:'g1'},order:{g1:['code:'+sid]}});
const section=groups=>C.materialSections({sections:{pinned:{id:'pinned',kind:'pinned'},routines:{id:'routines',kind:'routines'},sessions:{id:'sessions',kind:'sessions'}},migratedFrom:1},groups);
const scoped=(a,b)=>[{scope:A,value:a},{scope:B,value:b}];
const baseline=(r=row())=>({scopes:[A,B],sessions:{[file]:r},acknowledged:{[A]:{sessions:{[file]:C.hash(r)}},[B]:{sessions:{[file]:C.hash(r)}}}});
async function fixture({one=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-x-test-'));
  const cfg=S.defaultConfig({root:path.join(dir,'Claude'),projects:path.join(dir,'projects'),data:path.join(dir,'data'),testMode:true});
  fs.mkdirSync(cfg.data,{recursive:true});fs.mkdirSync(path.join(cfg.projects,'project'),{recursive:true});
  S.atomic(path.join(cfg.root,'config.json'),{lastKnownAccountUuid:id(1),unrelated:'login'});
  for(const scope of [A,B]){fs.mkdirSync(path.join(cfg.root,'claude-code-sessions',scope),{recursive:true});fs.writeFileSync(path.join(cfg.root,'claude-code-sessions',scope,'schedule.json'),JSON.stringify({owner:scope}));}
  fs.writeFileSync(path.join(cfg.root,'claude-code-sessions',A,file),JSON.stringify(row()));
  if(!one)fs.writeFileSync(path.join(cfg.root,'claude-code-sessions',B,file),JSON.stringify(row()));
  const payload=[{type:'user',uuid:id(40),parentUuid:null,message:{role:'user',content:'hello'}},{type:'assistant',uuid:head,parentUuid:id(40),message:{role:'assistant',content:'response'}}].map(JSON.stringify).join('\n')+'\n';
  fs.writeFileSync(path.join(cfg.projects,'project',cli+'.jsonl'),payload);
  const dbpath=path.join(cfg.root,'Local Storage/leveldb');fs.mkdirSync(dbpath,{recursive:true});
  const db=new ClassicLevel(dbpath,{keyEncoding:'buffer',valueEncoding:'buffer'});await db.open();
  const groups={[A]:g(),[B]:g()},sections=Object.fromEntries(Object.entries(groups).map(([s,v])=>[s,section(v)]));
  const prefix='_https://claude.ai\0\x01';
  await db.put(Buffer.from(prefix+'dframe-store','latin1'),S.encode({state:{customGroupsByScope:groups,codeSidebarByScope:sections,lastSidebarScopeKey:A,unrelatedPreference:{width:987}},version:1}));
  await db.put(Buffer.from(prefix+'LSS-persisted.dframe-group-scopes','latin1'),S.encode({value:groups,timestamp:1,tabId:'original'}));
  await db.put(Buffer.from(prefix+'LSS-persisted.dframe-code-sections','latin1'),S.encode({value:sections,timestamp:1,tabId:'original'}));
  await db.put(Buffer.from(prefix+'authentication-cache','latin1'),Buffer.from('private-test-login'));await db.close();
  return {cfg,dir,transcript:path.join(cfg.projects,'project',cli+'.jsonl'),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
async function scan(cfg){const snap=await S.snapshot(cfg),state=await S.importState(cfg,snap);return {snap,state,p:await S.plan(cfg,snap,state)};}
const remove=snap=>fs.rmSync(snap.tmp,{recursive:true,force:true});
async function sync(cfg,choices={},options={}){const {snap,state}=await scan(cfg);try{const p=await S.plan(cfg,snap,state,choices);assert.equal(p.conflicts.length,0,JSON.stringify(p.conflicts));return await S.transaction(cfg,snap,state,p,()=>{},options);}finally{remove(snap);}}
async function mutateDb(cfg,fn){const p=path.join(cfg.root,'Local Storage/leveldb'),db=new ClassicLevel(p,{keyEncoding:'buffer',valueEncoding:'buffer',createIfMissing:false});await db.open();try{await fn(db);}finally{await db.close();}}
const writeRow=(cfg,scope,value)=>fs.writeFileSync(path.join(cfg.root,'claude-code-sessions',scope,file),JSON.stringify(value));

module.exports={fixture,scan,sync,A,B,D,file,row,writeRow,remove,mutateDb,id,cli,head,sid,g,empty,section,scoped,baseline};
