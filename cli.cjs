#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const S=require('./storage.cjs'),{UI,Cancelled,clean,count,ago,backupChoice}=require('./tui.cjs');
const VERSION='1.0.0';
const HELP=`claude-x — merge Claude Desktop Code accounts

Usage
  claude-x [option]

Options
  (no option)    Open the terminal menu
  --sync         Merge now; ask about every conflict first
  --preview      Read-only merge preview; no live changes or retained backup
  --status       Show account folders and last sync
  --backups      List the latest five restorable snapshots
  --restore ID   Restore managed history/groups from a snapshot
  --recover      Recover an interrupted installation
  --name ID NAME Show NAME (such as an email) for an account; omit NAME to clear
  --help         Show this help
  --version      Show version

Safety
  Quit Claude Desktop before merging, previewing, or restoring.
  Compatible changes merge automatically. Conflicts never choose by timeout.
  Every apply/restore backs up current records, sidebar and reachable
  transcripts first. Backups use compressed deduplicated history and retain
  the latest five.

Accounts
  Cloud group settings are uploaded through Claude for the signed-in account;
  rerun after switching accounts. Separate histories are kept as branches when
  both conversation files are recoverable. Original transcripts are not
  rewritten during a merge.

Scope
  Ordinary Chat/Cowork/cloud conversations are outside this tool.

Keys
  ↑/↓ or j/k move · 1-9 jump · Enter select · q or Esc cancel
  Set NO_COLOR=1 for plain output.
`;
function configuration(){const file=path.join(__dirname,'config.json');const input=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};const fallback=path.resolve(__dirname,'../claude-account-sync/sync-state.json');return S.defaultConfig({root:input.root||undefined,projects:input.projects||undefined,data:input.data||undefined,legacyState:input.legacyState|| (fs.existsSync(fallback)?fallback:undefined)});}
function tidy(cfg){if(fs.existsSync(path.join(cfg.data,'pending.json')))return;const root=path.join(cfg.data,'backups');if(fs.existsSync(root))for(const name of fs.readdirSync(root)){const dir=path.join(root,name);if(/^[0-9TZ-]+-[a-f0-9]{8}$/.test(name)&&!fs.existsSync(path.join(dir,'manifest.json')))fs.rmSync(dir,{recursive:true,force:true});}S.retain(cfg);}
async function waitClosed(cfg,ui){if(cfg.testMode||!S.running())return;await ui.waitUntil(()=>!S.running(),{title:'Claude Desktop is running',hint:'Quit it normally to protect active sessions; claude-x continues once it has closed.',prompt:'Press Enter after quitting, or q to cancel: ',done:'Claude Desktop closed'});}
// Names shown instead of account ids: set with --name, or learned from the account Claude Code is signed into.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const namesFile=cfg=>path.join(cfg.data,'accounts.json');
function readNames(cfg){try{const v=JSON.parse(fs.readFileSync(namesFile(cfg),'utf8'));return v&&v.accounts&&typeof v.accounts==='object'&&!Array.isArray(v.accounts)?v:null;}catch(e){return e.code==='ENOENT'?{version:1,accounts:{}}:null;}}
function nameMap(cfg){const map={},seen=new Set();for(const [id,v] of Object.entries(readNames(cfg)?.accounts||{})){const key=id.slice(0,8);if(seen.has(key))delete map[key];else if(v?.label)map[key]=clean(v.label);seen.add(key);}return map;}
function learnName(cfg){
  // ~/.claude.json records Claude Code's signed-in account; only its id and email are read, never tokens.
  const known=readNames(cfg);let signed;if(!known)return;try{signed=JSON.parse(fs.readFileSync(cfg.claudeCode,'utf8')).oauthAccount;}catch{return;}
  const id=String(signed?.accountUuid||'').toLowerCase(),email=clean(signed?.emailAddress).slice(0,120);let accounts=[];try{accounts=S.scopes(cfg.root).map(s=>s.split('/')[0]);}catch{}
  if(!UUID.test(id)||!email||!accounts.includes(id)||known.accounts[id]?.source==='manual'||known.accounts[id]?.label===email)return;
  known.accounts[id]={label:email,source:'claude-code'};S.atomic(namesFile(cfg),known);
}
function nameAccount(cfg,ui,prefix,label){
  const key=clean(prefix).toLowerCase(),matches=[...new Set(S.scopes(cfg.root).map(s=>s.split('/')[0]))].filter(a=>a.startsWith(key));
  if(key.length<4)throw Error('Use at least 4 characters of the account ID. Run claude-x --status to see them.');
  if(matches.length!==1)throw Error(matches.length?`${key} matches several accounts; use more characters.`:`No local account ID starts with ${key}. Run claude-x --status to see them.`);
  const known=readNames(cfg);if(!known)throw Error('accounts.json in the claude-x data folder is unreadable; fix or remove it first.');
  const [id]=matches,name=clean(label).slice(0,120);
  if(name)known.accounts[id]={label:name,source:'manual'};else delete known.accounts[id];
  S.atomic(namesFile(cfg),known);learnName(cfg);ui.setNames(nameMap(cfg));
  return name?`✔ ${id.slice(0,8)} now shows as ${name}`:`✔ Removed the name for ${id.slice(0,8)}`;
}
async function nameMenu(cfg,ui){
  const map=nameMap(cfg),accounts=[...new Set(S.scopes(cfg.root).map(s=>s.split('/')[0]))];
  const id=await ui.choose('Which account?',accounts.map(a=>({id:a,label:map[a.slice(0,8)]?`${map[a.slice(0,8)]} (${a.slice(0,8)})`:a.slice(0,8)})),{compact:true});
  const name=(await ui.read(ui.bar('Email or name (Enter keeps it, - clears it): '))).trim();
  if(!name){ui.outro('Nothing changed.','muted');return;}
  const done=nameAccount(cfg,ui,id,name==='-'?'':name);ui.status(overview(cfg));ui.outro(done);
}
function overview(cfg){
  const statePath=path.join(cfg.data,'state.json'),state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
  const folders=S.scopes(cfg.root),backups=S.backupList(cfg);let signedIn=null;try{signedIn=S.account(cfg.root);}catch{}
  let backupBytes=0;const size=dir=>{if(!fs.existsSync(dir))return;for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())size(p);else if(d.isFile())backupBytes+=fs.statSync(p).size;}};size(path.join(cfg.data,'backups'));size(path.join(cfg.data,'blobs'));
  const shared=state&&new Set(Object.keys(state.sessions).filter(f=>f.startsWith('local_')&&state.sessions[f]));
  const files=scope=>{try{return fs.readdirSync(path.join(cfg.root,'claude-code-sessions',scope)).filter(f=>/^local_.*\.json$/.test(f));}catch{return null;}};
  return {running:!cfg.testMode&&S.running(),lastSync:state?.lastSync,pending:fs.existsSync(path.join(cfg.data,'pending.json')),
    shared:state&&{sessions:Object.keys(state.sessions).filter(f=>f.startsWith('local_')&&state.sessions[f]).length,groups:Object.values(state.groups?.entities||{}).filter(Boolean).length},
    backups:{count:backups.length,max:5,bytes:backupBytes,latest:backups[0]?.createdAt},
    folders:folders.map(scope=>{const list=files(scope);return {scope,sessions:list?.length??null,fresh:shared&&list?list.filter(f=>!shared.has(f)).length:0,signedIn:scope.split('/')[0]===signedIn};})};
}
async function resolvePlan(builder,ui,{preview,title,verb,account}){const choices={};let p=await builder(choices);ui.plan(p,{title,verb,preview,account});if(preview)return p;for(let done=0;p.conflicts.length;done++){if(!ui.interactive)throw Error(`${p.conflicts.length} conflict(s) need confirmation. Run claude-x interactively; nothing was applied.`);const c=p.conflicts[0];choices[c.id]=await ui.resolve(c,{index:done+1,total:done+p.conflicts.length});p=await ui.task('Updating the plan',()=>builder(choices),{quiet:true});}return p;}
async function runOperation(cfg,ui,mode,restoreId){
  await waitClosed(cfg,ui);
  if(fs.existsSync(path.join(cfg.data,'pending.json')))throw Error('An interrupted sync needs recovery first. Run claude-x --recover.');
  if(cfg.legacyState&&fs.existsSync(path.join(path.dirname(cfg.legacyState),'pending-transaction.json')))throw Error('The old helper has an interrupted operation. Recover it before claude-x.');
  const unlock=S.lock(cfg),restore=mode==='restore';let snap,transactionStarted=false;
  try{
    snap=await ui.task('Scanning local accounts and saved sidebar state',()=>S.snapshot(cfg),{done:s=>`Scanned ${count(new Set(s.scopes.map(x=>x.split('/')[0])).size,'account')} · ${count(s.scopes.length,'folder')}`});
    const state=await S.importState(cfg,snap);
    const build=choices=>restore?S.restorePlan(cfg,snap,state,restoreId,choices):S.plan(cfg,snap,state,choices);
    const p=await resolvePlan(build,ui,{preview:mode==='preview',title:restore?'Restore preview':'Merge preview',verb:restore?'restore':'merge',account:snap.account});
    if(mode==='preview'){ui.outro('Preview only — live data, sync state and retained backups were unchanged.','muted');return p;}
    if(cfg.abort?.())throw new Cancelled();
    const progress=t=>s=>{const m=/^(.*?)\s*(\d+)\/(\d+)$/.exec(s);if(!m)return t.update(s);const [current,total]=[Number(m[2]),Number(m[3])];if(current<total)t.update(m[1],{current,total});else t.update(restore?'Restoring the snapshot':'Applying the merged result');};
    transactionStarted=true;
    const b=await ui.task('Saving current state before applying',t=>S.transaction(cfg,snap,state,p,progress(t)),{done:()=>restore?'Backed up current state and restored the snapshot':'Backed up current state and applied the merge'});
    ui.result({plan:p,account:snap.account,title:restore?'Restored':'Merged',
      rows:[['Backup',b.id,`${S.backupList(cfg).length} of 5 kept`]],
      notes:restore?['Current sign-in and unrelated settings were preserved.']:[],
      next:[`Reopen Claude while online to save the merged groups in the signed-in account (${ui.names?.[String(snap.account).slice(0,8)]||String(snap.account).slice(0,8)}).`,'Rerun claude-x after each account switch.'],
      outro:restore?'Restore complete':'Merge complete'});
    return p;
  }finally{
    if(snap)fs.rmSync(snap.tmp,{recursive:true,force:true});
    try{if(transactionStarted)tidy(cfg);}finally{unlock();}
  }
}
async function recovery(cfg,ui){await waitClosed(cfg,ui);const unlock=S.lock(cfg);try{if(!fs.existsSync(path.join(cfg.data,'pending.json'))){ui.outro('No interrupted operation needs recovery.');return;}const choice=await ui.choose('Recover interrupted sync',[{id:'rollback',label:'Roll back to the verified pre-sync state (Recommended)',description:'Changed interrupted copies are preserved inside the transaction backup.'},{id:'finish',label:'Finish the sync if every replacement was completed',description:'Refuses if any file differs from the planned result.'}],{detail:'A previous run was interrupted while installing changes. Keep Claude closed until recovery completes.'});await ui.task(choice==='rollback'?'Rolling back':'Finishing the sync',()=>S.recover(cfg,choice),{done:()=>choice==='rollback'?'Rolled back to the verified pre-sync state':'Finished the interrupted sync'});ui.outro(`✔ Recovery complete`);}finally{unlock();}}
async function menu(cfg,ui){
  const info=overview(cfg),backups=S.backupList(cfg);ui.status(info);
  const mode=await ui.choose('What would you like to do?',[
    {id:'sync',label:'Merge all local accounts',description:'Back up current state, then merge sessions and groups. Conflicts ask you first.'},
    {id:'preview',label:'Preview changes',badge:'read-only',description:'See what a merge would change without writing anything.'},
    {id:'backups',label:'Browse backups and restore',description:backups.length?`${count(backups.length,'snapshot')} · latest ${ago(backups[0].createdAt)}`:'No snapshots yet. The first merge creates one.'},
    {id:'recover',label:'Recover an interrupted sync',description:info.pending?'A previous run was interrupted while installing changes.':'Only needed after an interrupted run.'},
    {id:'names',label:'Name accounts',description:'Show an email or name instead of an account ID.'},
    {id:'help',label:'Help',description:'Options, safety notes and key bindings.'}
  ].map(o=>o.id===(info.pending?'recover':'sync')?{...o,badge:'recommended'}:o),{defaultId:info.pending?'recover':'sync',compact:true,hint:'↑/↓ move · enter select · q quit'});
  if(mode==='help'){ui.end();ui.help(HELP);return;}
  if(mode==='recover')return await recovery(cfg,ui);
  if(mode==='names')return await nameMenu(cfg,ui);
  if(mode==='backups'){if(!backups.length){ui.outro('No snapshots yet. The first merge backs up current state before applying.','muted');return;}const id=await ui.choose('Choose a backup to restore',backups.map(backupChoice),{compact:true});return await runOperation(cfg,ui,'restore',id);}
  return await runOperation(cfg,ui,mode);
}
async function main({cfg=configuration(),ui=new UI(),args=process.argv.slice(2)}={}){cfg=S.defaultConfig(Object.fromEntries(Object.entries(cfg).filter(([,v])=>v!==undefined)));let abort=false;cfg.abort=()=>abort;const interrupt=()=>{abort=true;ui.cancel();};process.on('SIGINT',interrupt);
  try{
    if(args[0]==='--help'){ui.help(HELP);return;}if(args[0]==='--version'){ui.line('claude-x '+VERSION);return;}
    fs.mkdirSync(cfg.data,{recursive:true,mode:0o700});
    const flag=args[0],titles={'--sync':'merge','--preview':'preview','--status':'status','--backups':'backups','--restore':'restore','--recover':'recover','--name':'name accounts'};
    if(args.length&&(!titles[flag]||!(flag==='--name'?[2,3]:[flag==='--restore'?2:1]).includes(args.length)))throw Error('Unknown option. Run claude-x --help.');
    learnName(cfg);ui.setNames(nameMap(cfg));
    ui.intro('claude-x',args.length?titles[flag]:`${VERSION} · merge Claude Desktop Code accounts`);
    if(!args.length)await menu(cfg,ui);
    else if(flag==='--status'){ui.status(overview(cfg));ui.outro('claude-x --sync to merge · claude-x --help for all options','muted');}
    else if(flag==='--backups'){const list=S.backupList(cfg);ui.backups(list);ui.outro(list.length?'Restore one with claude-x --restore ID':'','muted');}
    else if(flag==='--recover')await recovery(cfg,ui);
    else if(flag==='--name'){const done=nameAccount(cfg,ui,args[1],args[2]||'');ui.status(overview(cfg));ui.outro(done);}
    else await runOperation(cfg,ui,flag==='--restore'?'restore':flag==='--preview'?'preview':'sync',args[1]);
    ui.end();
  }catch(e){ui.fail(e);if(e&&typeof e==='object')e.reported=true;throw e;}finally{process.removeListener('SIGINT',interrupt);ui.close();}}
if(require.main===module)main().catch(e=>{if(!e.reported)process.stderr.write((e instanceof Cancelled?e.message:'Stopped: '+e.message)+'\n');process.exitCode=e instanceof Cancelled?130:1;});
module.exports={main,runOperation,VERSION,HELP,configuration};
