'use strict';
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const clone=v=>v===undefined?undefined:structuredClone(v);
function stable(v){if(v===undefined)return 'undefined';if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
const hash=v=>crypto.createHash('sha256').update(stable(v)).digest('hex');
const equal=(a,b)=>stable(a)===stable(b);
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const label=s=>s.split('/').map(x=>x.slice(0,8)).join('/');
const activity=new Set(['lastActivityAt','lastFocusedAt','latestUserFrameAt']);
const conversationKeys=new Set(['cliSessionId','unarchivedCliSessionId','preClearCliSessionId','priorCliSessionIds','lastAssistantUuid','completedTurns','postTurnSummary','postTurnSummaryFor','turnWrapUp','titleTurn','pendingRewindTo','absorbedPastLeaf']);
const protectedKeys=new Set(['permissionMode','chromePermissionMode','remoteMcpServersConfig','alwaysAllowedReasons','sessionPermissionUpdates','bypassChosenInApp','autoChosenInApp','cuAllowedApps','cuGrantFlags','cuFlagsGrantedAt','chromeAllowedDomains','chromePermsBeforeUnsupervised','enabledMcpTools','withheldConnectorHosts']);
function short(v){if(v===undefined)return '(not present)';if(v===null)return '(deleted / unassigned)';if(typeof v==='object'){if(typeof v.name==='string')return short(v.name);if(typeof v.title==='string')return short(v.title);return Array.isArray(v)?`${v.length} items`:`object (${Object.keys(v).length} fields)`;}return String(v).replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,140);}
class Context {
  constructor(choices={}){this.choices=choices;this.conflicts=[];this.decisions=[];}
  pick(id,title,detail,options,fallback) {
    const conflict={id,title,detail,options:options.map(({value,...o})=>o)};
    if(!own(this.choices,id)){this.conflicts.push(conflict);return clone(fallback);}
    const selected=options.find(o=>o.id===this.choices[id]);assert(selected,`Invalid decision for ${id}`);
    this.decisions.push({id,title,choice:selected.id});return clone(selected.value);
  }
}
function unique(obs){const found=new Map();for(const o of obs){const k=hash(o.value);if(!found.has(k))found.set(k,o);}return [...found.values()];}
function selectConflict(ctx,id,title,base,obs,extra={}) {
  const session=id.match(/^session:(local_[a-f0-9-]{36}\.json)/i)?.[1];
  if(session&&ctx.sessionTitles?.[session])title=`${ctx.sessionTitles[session]} / ${id.slice(('session:'+session+'.').length)}`;
  if(id.startsWith('assignment:')&&ctx.memberTitles?.[id.slice(11)])title='Group assignment: '+ctx.memberTitles[id.slice(11)];
  const options=unique(obs).map((o,i)=>({id:'v'+i,label:`${label(o.scope)}: ${ctx.groupNames?.[o.value]||short(o.value)}`,value:o.value}));
  if((base!==undefined||ctx.knownRecords?.has(session))&&!options.some(o=>equal(o.value,base)))options.push({id:'base',label:'Keep the previous synced value: '+short(base),value:base});
  return ctx.pick(id,title,extra.detail||'These changes cannot be combined without choosing a value.',options,base===undefined?obs[0]?.value:base);
}
function mergeValue(base,obs,ctx,path,{ordered=false,force=false}={}) {
  const changed=obs.filter(o=>!equal(o.value,base));
  if(!changed.length)return clone(base);
  const variants=unique(changed);
  const key=path.split('.').at(-1);
  if(force)return selectConflict(ctx,path,path,base,variants);
  if(variants.length===1)return clone(variants[0].value);
  if(activity.has(key)&&variants.every(o=>typeof o.value==='number'&&Number.isFinite(o.value)))return Math.max(...variants.map(o=>o.value));
  if((plain(base)||base===undefined)&&variants.every(o=>plain(o.value))) {
    const result={};const keys=new Set([...Object.keys(base||{}),...variants.flatMap(o=>Object.keys(o.value))]);
    for(const k of keys){const v=mergeValue(base?.[k],variants.map(o=>({...o,value:o.value[k]})),ctx,path+'.'+k);if(v!==undefined)result[k]=v;}
    return result;
  }
  if(ordered&&Array.isArray(base)&&variants.every(o=>Array.isArray(o.value)&&base.every((x,i)=>equal(o.value[i],x)))) {
    const result=clone(base);for(const o of variants)for(const v of o.value.slice(base.length))if(!result.some(x=>equal(x,v)))result.push(clone(v));return result;
  }
  return selectConflict(ctx,path,path,base,variants);
}
function changedObservations(base,observations,enrolled,ack={}) {
  return observations.filter(o=>{
    if(base===undefined&&o.value===null)return false;
    if(!enrolled.includes(o.scope))return o.value!==null&&!equal(o.value,base);
    const previous=own(ack,o.scope)?ack[o.scope]:hash(base);
    return hash(o.value)!==previous;
  });
}
function bundle(record){if(!record)return null;return Object.fromEntries(Object.entries(record).filter(([k])=>conversationKeys.has(k)));}
function refs(r){return [r?.cliSessionId,r?.unarchivedCliSessionId,r?.preClearCliSessionId,...r?.priorCliSessionIds||[]].filter(Boolean);}
function cloneId(file,record){const h=hash([file,record]);return `local_${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
async function mergeSessionRaw(file,base,observations,state,ctx,inspect) {
  if(base&&typeof base==='object'){ctx.knownRecords ||= new Set();ctx.knownRecords.add(file);}
  const ack=Object.fromEntries(observations.filter(o=>own(state.acknowledged?.[o.scope]?.sessions,file)).map(o=>[o.scope,state.acknowledged[o.scope].sessions[file]]));
  const changed=state.reviewSessions?.includes(file)?observations.filter(o=>o.value!==null||base!==undefined):changedObservations(base,observations,state.scopes||[],ack);
  const newcomer=changed.filter(o=>!(state.scopes||[]).includes(o.scope));
  let variants=unique(changed);if(!variants.length)return {value:clone(base),extras:[]};
  const title=observations.find(o=>o.value)?.value?.title||file;
  const mustChooseDeletion=base!==undefined&&variants.some(o=>o.value===null)&&base!==null;
  const resurrection=base===null&&variants.some(o=>o.value!==null);
  const staleNewcomer=base!==undefined&&newcomer.some(o=>!equal(o.value,base));
  if(mustChooseDeletion||resurrection||staleNewcomer||variants.some(o=>o.value===null)) {
    const opts=unique([...variants,...base!==undefined?[{scope:'previous/sync',value:base}]:[]]).map((o,i)=>({id:'v'+i,label:`${label(o.scope)}: ${o.value===null?'Delete this session':short(o.value?.title||'Keep session')}`,value:o.value}));
    return {value:ctx.pick('session:'+file,`Session: ${title}`,mustChooseDeletion?'Deletion must be confirmed; another account may still contain this session.':resurrection?'A previously deleted session has reappeared.':'A new account contains a different copy of an existing session.',opts,base??variants.find(o=>o.value)?.value??null),extras:[]};
  }
  if(variants.length===1){let r=clone(variants[0].value),extras=[];
    if(base&&typeof base==='object'&&!equal(bundle(base),bundle(r))){
      const relation=await inspect([base,r]);
      if(relation.kind!=='extension'||relation.index!==1){
        const opts=[{id:'current',label:'Keep changed account: '+short(r.title)+' (history '+String(r.cliSessionId||'draft').slice(0,8)+')',value:{record:r}},{id:'previous',label:'Keep the previous synced conversation',value:{record:base}}];
        if(relation.retrievable&&base.cliSessionId&&r.cliSessionId&&base.cliSessionId!==r.cliSessionId)opts.unshift({id:'both',label:'Preserve both histories as separate sessions (Recommended)',value:{both:true}});
        const chosen=ctx.pick('history:'+file,'Conversation changed: '+title,relation.detail||'This change could not be proved to extend the previous conversation.',opts,{record:base});
        if(chosen.both){const old=clone(base);old.sessionId=cloneId(file,old);old.title=(old.title||title)+' [previous branch]';extras=[{file:old.sessionId+'.json',value:old,source:file,sourceScope:'previous'}];}else r=clone(chosen.record);
      }
    }
    return {value:r,extras};}
  const historyVariants=unique(variants.map(o=>({...o,value:bundle(o.value)})));
  let history=historyVariants[0]?.value;
  if(historyVariants.length>1||(base&&typeof base==='object'&&!equal(bundle(base),history))) {
    const candidates=base&&typeof base==='object'?[base,...variants.map(o=>o.value)]:variants.map(o=>o.value);const offset=candidates.length-variants.length;
    const relation=await inspect(candidates);
    if(relation.kind==='extension'&&relation.index>=offset)history=bundle(variants[relation.index-offset].value);
    else {
      const opts=variants.map((o,i)=>({id:'v'+i,label:`Keep ${label(o.scope)} — ${short(o.value.title)} (history ${String(o.value.cliSessionId||'draft').slice(0,8)})`,value:{record:o.value}}));
      if(base&&!variants.some(o=>equal(o.value,base)))opts.push({id:'previous',label:'Keep the previous synced session and conversation',value:{record:base}});
      if(relation.retrievable&&new Set(variants.map(o=>o.value.cliSessionId)).size===variants.length)opts.unshift({id:'both',label:'Preserve all branches as separate sessions (Recommended)',description:'Original conversation files are unchanged; each branch gets its own sidebar session.',value:{both:true}});
      const result=ctx.pick('history:'+file,`Conversation branches: ${title}`,relation.detail||'Conversation state differs; combining records could select the wrong conversation.',opts,{record:base||variants[0].value});
      if(result.both){const original=clone(variants[0].value),extras=variants.slice(1).map(o=>{const r=clone(o.value);r.sessionId=cloneId(file,r);r.title=(r.title||title)+` [branch ${label(o.scope)}]`;return {file:r.sessionId+'.json',value:r,source:file,sourceScope:o.scope};});return {value:original,extras};}
      return {value:clone(result.record),extras:[]};
    }
  }
  const result={};const keys=new Set([...Object.keys(base||{}),...variants.flatMap(o=>Object.keys(o.value))]);
  for(const key of keys){if(conversationKeys.has(key))continue;const v=mergeValue(base?.[key],variants.map(o=>({...o,value:o.value[key]})),ctx,`session:${file}.${key}`,{});if(v!==undefined)result[key]=v;}
  Object.assign(result,clone(history));assert.equal(result.sessionId,file.slice(0,-5),'Session identity/filename mismatch');return {value:result,extras:[]};
}
async function mergeSession(file,base,observations,state,ctx,inspect){
  const result=await mergeSessionRaw(file,base,observations,state,ctx,inspect);
  for(const output of [{file,value:result.value},...result.extras]){const r=output.value;if(!r||typeof r!=='object')continue;
    for(const key of protectedKeys)if(!equal(r[key],base?.[key])){const id='access:'+output.file+'.'+key,obs=[{scope:'selected/version',value:r[key]}];
      const options=[{id:'selected',label:'Use selected session setting: '+short(r[key]),value:r[key]},{id:'previous',label:'Keep previous access setting: '+short(base?.[key]),value:base?.[key]}];
      const value=ctx.pick(id,'Access setting: '+(r.title||file)+' / '+key,'Confirm this access-setting change separately from the history choice.',options,base?.[key]);if(value===undefined)delete r[key];else r[key]=value;
    }
  }return result;
}
function normalizeGroups(value,base) {
  const g=value||{groups:[],assignments:{},order:{}};
  assert(Array.isArray(g.groups)&&plain(g.assignments||{})&&plain(g.order||{}),'Unsupported custom-group format');
  const entities=Object.fromEntries(g.groups.map(x=>{assert(typeof x.id==='string'&&typeof x.name==='string','Malformed group');return [x.id,clone(x)];}));
  for(const id of Object.keys(base?.entities||{}))if(!own(entities,id))entities[id]=null;
  const assignments=Object.fromEntries(Object.entries(g.assignments||{}).filter(([k])=>k.startsWith('code:')).map(([k,v])=>[k,v]));
  for(const id of Object.keys(base?.assignments||{}))if(!own(assignments,id))assignments[id]=null;
  const order=Object.fromEntries(Object.entries(g.order||{}).map(([k,v])=>{assert(Array.isArray(v),'Unsupported group order');return [k,v.filter(x=>typeof x==='string'&&x.startsWith('code:'))];}));
  return {entities,layout:g.groups.map(x=>x.id),assignments,order};
}
function materialGroups(n,old={}) {
  const groups=n.layout.filter(id=>n.entities[id]).map(id=>clone(n.entities[id]));for(const [id,g]of Object.entries(n.entities))if(g&&!groups.some(x=>x.id===id))groups.push(clone(g));
  const assignments={...Object.fromEntries(Object.entries(old.assignments||{}).filter(([k])=>!k.startsWith('code:'))),...Object.fromEntries(Object.entries(n.assignments).filter(([,v])=>v!==null))};
  const order={};for(const [id,v]of Object.entries(n.order)){if(!n.entities[id])continue;order[id]=[...new Set([...v,...(old.order?.[id]||[]).filter(k=>!k.startsWith('code:'))])];}
  return {...clone(old),groups,assignments,order};
}
function normalizeSections(s){if(!s)return null;assert(Array.isArray(s.sections),'Unsupported sidebar format');return {...clone(s),sections:Object.fromEntries(s.sections.map(x=>{const v=clone(x);if(v.kind==='manual'){delete v.members;delete v.order;delete v.name;}else if(v.members){assert(Array.isArray(v.members)&&v.members.every(x=>typeof x==='string'),'Unsupported section memberships');v.members=v.members.filter(x=>x.startsWith('code:'));}return [v.id,v];}))};}
function materialSections(n,groups,old) {
  const defaults=Object.values(n?.sections||normalizeSections(old)?.sections||{}).filter(x=>x.kind!=='manual');
  const pick=id=>clone(defaults.find(x=>x.id===id));const sections=[];
  for(const id of ['pinned','routines']){const v=pick(id);if(v)sections.push(v);}
  for(const group of groups.groups){const v=clone(n?.sections?.[group.id]||{id:group.id,kind:'manual',sortBy:'recency',ascending:false,show:{metadata:true,emptyGroups:false},collapsed:false});const assigned=Object.keys(groups.assignments).filter(k=>groups.assignments[k]===group.id);v.name=group.name;v.members=[...new Set([...(groups.order[group.id]||[]).filter(k=>assigned.includes(k)),...assigned])];sections.push(v);}
  for(const v of defaults)if(!sections.some(x=>x.id===v.id))sections.push(clone(v));for(const v of sections)if(v.kind!=='manual'){const external=old?.sections?.find(x=>x.id===v.id)?.members?.filter(x=>!x.startsWith('code:'))||[];if(v.members||external.length)v.members=[...new Set([...(v.members||[]),...external])];}const occupied=new Set();for(const v of sections.filter(v=>v.kind!=='manual')){if(!Number.isSafeInteger(v.order)||v.order<0||occupied.has(v.order)){let slot=0;while(occupied.has(slot))slot++;v.order=slot;}occupied.add(v.order);}const oldSlots=(old?.sections||[]).filter(v=>v.kind==='manual'&&Number.isSafeInteger(v.order)&&v.order>=0).map(v=>v.order).sort((a,b)=>a-b);let cursor=0,index=0;for(const v of sections.filter(v=>v.kind==='manual')){let slot=oldSlots[index++]??cursor;slot=Math.max(cursor,slot);while(occupied.has(slot))slot++;v.order=slot;occupied.add(slot);cursor=slot+1;}sections.sort((a,b)=>a.order-b.order);
  return {...clone(old),...clone(n),sections,prefsSeeded:true};
}
function mergeGroups(base,observations,state,ctx) {
  const normalized=observations.map(o=>({...o,value:normalizeGroups(o.value,base)}));
  const relevant=normalized.filter(o=>state.scopes?.includes(o.scope)||o.value.layout.length);
  const variants=relevant.filter(o=>!equal(o.value,base));
  if(!variants.length)return clone(base);
  let result={entities:{},layout:[],assignments:{},order:{}};
  const ids=new Set([...Object.keys(base?.entities||{}),...relevant.flatMap(o=>Object.keys(o.value.entities))]);
  for(const id of ids){const b=base?.entities?.[id];const obs=relevant.map(o=>({...o,value:own(o.value.entities,id)?o.value.entities[id]:b===undefined?undefined:null}));const deleting=b&&obs.some(o=>o.value===null);const resurrect=b===null&&obs.some(o=>o.value);const stale=base&&obs.some(o=>!state.scopes?.includes(o.scope)&&o.value!==undefined&&!equal(o.value,b));result.entities[id]=mergeValue(b,obs,ctx,'group:'+id,{force:!!deleting||resurrect||!!stale});}
  result.layout=mergeValue(base?.layout||[],relevant.map(o=>({...o,value:o.value.layout})),ctx,'group-order',{ordered:true})||[];
  ctx.groupNames=Object.fromEntries(Object.entries(result.entities).filter(([,g])=>g).map(([id,g])=>[id,g.name]));
  const members=new Set([...Object.keys(base?.assignments||{}),...relevant.flatMap(o=>Object.keys(o.value.assignments))]);
  for(const key of members){const b=base?.assignments?.[key];const obs=relevant.map(o=>({...o,value:own(o.value.assignments,key)?o.value.assignments[key]:b===undefined?undefined:null}));const stale=b!==undefined&&obs.some(o=>!state.scopes?.includes(o.scope)&&o.value!==undefined&&!equal(o.value,b));const v=mergeValue(b,obs,ctx,'assignment:'+key,{force:stale});if(v!==undefined)result.assignments[key]=v;}
  for(const id of new Set([...Object.keys(base?.order||{}),...relevant.flatMap(o=>Object.keys(o.value.order))]))result.order[id]=mergeValue(base?.order?.[id]||[],relevant.map(o=>({...o,value:o.value.order[id]||[]})),ctx,'member-order:'+id,{ordered:true})||[];
  for(const [key,id]of Object.entries(result.assignments))if(id&&!result.entities[id]){const choices=[{id:'clear',label:'Leave the session ungrouped',value:null},...Object.entries(result.entities).filter(([,g])=>g).map(([id,g])=>({id,label:'Move to '+g.name,value:id}))];const oldGroup=relevant.map(o=>o.value.entities[id]).find(Boolean);if(oldGroup)choices.push({id:'restore',label:'Restore group '+oldGroup.name,value:'__restore'});const chosen=ctx.pick('orphan:'+key,'Assignment references a removed group',key,choices,null);if(chosen==='__restore'){result.entities[id]=clone(oldGroup);result.assignments[key]=id;}else result.assignments[key]=chosen;}
  result.layout=result.layout.filter(id=>result.entities[id]);for(const [id,g]of Object.entries(result.entities))if(g&&!result.layout.includes(id))result.layout.push(id);
  return result;
}
function mergeSections(base,observations,ctx){return mergeValue(base,observations.map(o=>({...o,value:normalizeSections(o.value)})),ctx,'sidebar');}
module.exports={own,clone,stable,hash,equal,plain,label,Context,mergeValue,mergeSession,normalizeGroups,materialGroups,normalizeSections,materialSections,mergeGroups,mergeSections,refs,conversationKeys};
