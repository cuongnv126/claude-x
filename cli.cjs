#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const S=require('./storage.cjs'),{UI,Cancelled}=require('./tui.cjs');
const VERSION='1.0.0';
const HELP=`claude-x — merge Claude Desktop Code accounts

Usage: claude-x [option]
  (no option)        Open the terminal menu
  --sync             Merge now; ask about every conflict first
  --preview          Read-only merge preview; no live changes or retained backup
  --status           Show account folders and last sync
  --backups          List the latest five restorable snapshots
  --restore ID       Restore managed history/groups from a snapshot
  --recover          Recover an interrupted installation
  --help             Show this help
  --version          Show version

Quit Claude Desktop before merging, previewing, or restoring.
Compatible changes merge automatically. Conflicts never choose by timeout.
Every apply/restore backs up current records, sidebar and reachable transcripts
first. Backups use compressed deduplicated history and retain the latest five.
Cloud group settings are uploaded through Claude for the signed-in account;
rerun after switching accounts. Separate histories are kept as branches when
both conversation files are recoverable. Original transcripts are not rewritten
during a merge. Ordinary Chat/Cowork/cloud conversations are outside this tool.
`;
function configuration(){const file=path.join(__dirname,'config.json');const input=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};const fallback=path.resolve(__dirname,'../claude-account-sync/sync-state.json');return S.defaultConfig({root:input.root||undefined,projects:input.projects||undefined,data:input.data||undefined,legacyState:input.legacyState|| (fs.existsSync(fallback)?fallback:undefined)});}
function tidy(cfg){if(fs.existsSync(path.join(cfg.data,'pending.json')))return;const root=path.join(cfg.data,'backups');if(fs.existsSync(root))for(const name of fs.readdirSync(root)){const dir=path.join(root,name);if(/^[0-9TZ-]+-[a-f0-9]{8}$/.test(name)&&!fs.existsSync(path.join(dir,'manifest.json')))fs.rmSync(dir,{recursive:true,force:true});}S.retain(cfg);}
async function waitClosed(cfg,ui){while(!cfg.testMode&&S.running()){ui.warn('Claude Desktop is running. Quit it normally to protect active sessions.');const answer=(await ui.read('Press Enter after quitting, or q to cancel: ')).trim();if(answer.toLowerCase()==='q')throw new Cancelled();}}
function status(cfg,ui){const state=fs.existsSync(path.join(cfg.data,'state.json'))?JSON.parse(fs.readFileSync(path.join(cfg.data,'state.json'),'utf8')):null;const folders=S.scopes(cfg.root);ui.heading('claude-x · Account history');ui.line(`Claude: ${!cfg.testMode&&S.running()?'running':'closed'}`);ui.line(`Accounts: ${new Set(folders.map(s=>s.split('/')[0])).size} · Organization folders: ${folders.length}`);ui.line(`Last sync: ${state?.lastSync||'not yet run'}`);ui.line(`Saved backups: ${S.backupList(cfg).length}/5`);let backupBytes=0;const count=dir=>{if(!fs.existsSync(dir))return;for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())count(p);else if(d.isFile())backupBytes+=fs.statSync(p).size;}};count(path.join(cfg.data,'backups'));count(path.join(cfg.data,'blobs'));ui.line(`Backup storage: ${(backupBytes/1024/1024).toFixed(1)} MiB (compressed history shared across snapshots)`);if(state){ui.line(`Shared sessions: ${Object.keys(state.sessions).filter(f=>f.startsWith('local_')&&state.sessions[f]).length}`);ui.line(`Shared groups: ${Object.values(state.groups?.entities||{}).filter(Boolean).length}`);}for(const scope of folders)ui.info(`  ${scope.split('/').map(x=>x.slice(0,8)).join('/')}`);}
function showBackups(cfg,ui){const list=S.backupList(cfg);ui.heading('Latest backups');if(!list.length)ui.info('No snapshots yet. The first merge backs up current state before applying.');for(const b of list)ui.line(`${b.id}  ${b.status}  ${b.scopes.length} folders · ${b.transcripts?.length||0} conversation files`);return list;}
async function resolvePlan(builder,ui,preview){const choices={};let p=await builder(choices);ui.plan(p);if(preview)return p;while(p.conflicts.length){if(!ui.interactive)throw Error(`${p.conflicts.length} conflict(s) need confirmation. Run claude-x interactively; nothing was applied.`);const c=p.conflicts[0];choices[c.id]=await ui.resolve(c);p=await builder(choices);}ui.good('All conflicts resolved.');return p;}
async function runOperation(cfg,ui,mode,restoreId){
  await waitClosed(cfg,ui);
  if(fs.existsSync(path.join(cfg.data,'pending.json')))throw Error('An interrupted sync needs recovery first. Run claude-x --recover.');
  if(cfg.legacyState&&fs.existsSync(path.join(path.dirname(cfg.legacyState),'pending-transaction.json')))throw Error('The old helper has an interrupted operation. Recover it before claude-x.');
  const unlock=S.lock(cfg);let snap,transactionStarted=false;
  try{
    ui.info('Scanning local accounts and saved sidebar state…');snap=await S.snapshot(cfg);
    const state=await S.importState(cfg,snap);
    const build=choices=>mode==='restore'?S.restorePlan(cfg,snap,state,restoreId,choices):S.plan(cfg,snap,state,choices);
    const p=await resolvePlan(build,ui,mode==='preview');
    if(mode==='preview'){ui.info('Preview complete. Live data, sync state and retained backups were unchanged.');return p;}
    if(cfg.abort?.())throw new Cancelled();
    ui.heading('Saving current state before applying');let previous=0;
    const progress=s=>{if(Date.now()-previous>1500){ui.info(s);previous=Date.now();}};
    transactionStarted=true;
    const b=await S.transaction(cfg,snap,state,p,progress);
    ui.good(`Merged ${p.sessionCount} sessions and ${p.groupCount} groups across ${p.accountCount} accounts.`);
    if(mode==='restore')ui.good('Restore complete; current sign-in and unrelated settings were preserved.');
    ui.line(`Backup: ${b.id} (${S.backupList(cfg).length}/5 retained)`);
    ui.info('Reopen Claude while online to save the merged groups in the signed-in account. Rerun after each account switch.');return p;
  }finally{
    if(snap)fs.rmSync(snap.tmp,{recursive:true,force:true});
    try{if(transactionStarted)tidy(cfg);}finally{unlock();}
  }
}
async function recovery(cfg,ui){await waitClosed(cfg,ui);const unlock=S.lock(cfg);try{if(!fs.existsSync(path.join(cfg.data,'pending.json'))){ui.good('No interrupted operation needs recovery.');return;}const choice=await ui.choose('Recover interrupted sync',[{id:'rollback',label:'Roll back to the verified pre-sync state (Recommended)',description:'Changed interrupted copies are preserved inside the transaction backup.'},{id:'finish',label:'Finish the sync if every replacement was completed',description:'Refuses if any file differs from the planned result.'}]);await S.recover(cfg,choice);ui.good('Recovery complete.');}finally{unlock();}}
async function main({cfg=configuration(),ui=new UI(),args=process.argv.slice(2)}={}){cfg=S.defaultConfig(Object.fromEntries(Object.entries(cfg).filter(([,v])=>v!==undefined)));let abort=false;cfg.abort=()=>abort;const interrupt=()=>{abort=true;ui.cancel();};process.on('SIGINT',interrupt);try{if(args[0]==='--help'){ui.line(HELP);return;}if(args[0]==='--version'){ui.line('claude-x '+VERSION);return;}fs.mkdirSync(cfg.data,{recursive:true,mode:0o700});if(args.length){const flag=args[0];if(!['--sync','--preview','--status','--backups','--restore','--recover'].includes(flag)||args.length!==(flag==='--restore'?2:1))throw Error('Unknown option. Run claude-x --help.');if(flag==='--status')return status(cfg,ui);if(flag==='--backups')return showBackups(cfg,ui);if(flag==='--recover')return await recovery(cfg,ui);return await runOperation(cfg,ui,flag==='--restore'?'restore':flag==='--preview'?'preview':'sync',args[1]);}status(cfg,ui);const mode=await ui.choose('Choose an operation',[{id:'sync',label:'Merge all local accounts (default)'},{id:'preview',label:'Preview changes without applying'},{id:'backups',label:'Browse backups and restore'},{id:'recover',label:'Recover an interrupted sync'},{id:'help',label:'Help'}],{defaultId:'sync'});if(mode==='help'){ui.line(HELP);return;}if(mode==='recover')return await recovery(cfg,ui);if(mode==='backups'){const list=showBackups(cfg,ui);if(!list.length)return;const id=await ui.choose('Choose a backup to restore',list.map(b=>({id:b.id,label:b.id,description:b.createdAt+' · '+b.status})));return await runOperation(cfg,ui,'restore',id);}return await runOperation(cfg,ui,mode);}finally{process.removeListener('SIGINT',interrupt);ui.close();}}
if(require.main===module)main().catch(e=>{process.stderr.write((e instanceof Cancelled?e.message:'Stopped: '+e.message)+'\n');process.exitCode=e instanceof Cancelled?130:1;});
module.exports={main,runOperation,VERSION,HELP,configuration};
