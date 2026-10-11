'use strict';
const readline=require('node:readline');

class Cancelled extends Error { constructor() { super('Cancelled. No planned changes were applied.'); this.name='Cancelled'; } }
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').trim();
function summarize(value) {
  if(value === undefined) return '(not present)';
  if(value === null) return '(deleted)';
  if(typeof value === 'string') return clean(value).slice(0,160);
  if(Array.isArray(value)) return `${value.length} item(s)`;
  if(typeof value === 'object') return `object (${Object.keys(value).length} fields)`;
  return String(value);
}

// Terminal cell width of sanitized text; styled text is measured without its SGR codes.
function cellWidth(cp) {
  if((cp>=0x300&&cp<=0x36f)||(cp>=0x200b&&cp<=0x200f)||(cp>=0xfe00&&cp<=0xfe0f))return 0;
  if((cp>=0x1100&&cp<=0x115f)||(cp>=0x2e80&&cp<=0xa4cf&&cp!==0x303f)||(cp>=0xac00&&cp<=0xd7a3)||(cp>=0xf900&&cp<=0xfaff)||(cp>=0xfe30&&cp<=0xfe4f)||(cp>=0xff00&&cp<=0xff60)||(cp>=0xffe0&&cp<=0xffe6)||(cp>=0x1f300&&cp<=0x1f64f)||(cp>=0x1f680&&cp<=0x1f6ff)||(cp>=0x1f900&&cp<=0x1faff)||(cp>=0x20000&&cp<=0x3fffd))return 2;
  return 1;
}
const width=s=>{let n=0;for(const ch of String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g,''))n+=cellWidth(ch.codePointAt(0));return n;};
const pad=(s,n)=>s+' '.repeat(Math.max(0,n-width(s)));
function truncate(s,max) {
  if(width(s)<=max)return s;
  let out='',n=0;for(const ch of s){const w=cellWidth(ch.codePointAt(0));if(n+w>max-1)break;out+=ch;n+=w;}
  return out+'…';
}
function wrap(text,max) {
  const lines=[];let line='';
  for(let word of clean(text).split(/\s+/).filter(Boolean)) {
    while(width(word)>max) {
      let head='',n=0;for(const ch of word){const w=cellWidth(ch.codePointAt(0));if(n+w>max)break;head+=ch;n+=w;}
      if(line){lines.push(line);line='';}
      lines.push(head);word=word.slice(head.length);
    }
    if(!word)continue;
    if(!line)line=word;else if(width(line)+1+width(word)<=max)line+=' '+word;else{lines.push(line);line=word;}
  }
  if(line)lines.push(line);
  return lines.length?lines:[''];
}

const MONTHS='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const count=(n,one,many=one+'s')=>`${Number(n||0).toLocaleString('en-US')} ${n===1?one:many}`;
function when(iso,now=new Date()) {
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return clean(iso);
  const two=n=>String(n).padStart(2,'0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear()===now.getFullYear()?'':' '+d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}
function ago(iso,now=Date.now()) {
  const seconds=(now-Date.parse(iso))/1000;if(Number.isNaN(seconds))return '';
  if(seconds<45)return 'just now';
  let n=seconds/60;
  for(const [limit,unit] of [[60,'minute'],[24,'hour'],[30,'day'],[12,'month'],[Infinity,'year']]) {
    const r=Math.round(n);if(r<limit)return unit==='day'&&r===1?'yesterday':`${r} ${unit}${r===1?'':'s'} ago`;n/=limit;
  }
}
function bytes(n) {
  const units=['B','KiB','MiB','GiB','TiB'];let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i++;}
  return i?`${n.toFixed(n<10?1:0)} ${units[i]}`:`${n} B`;
}
const duration=ms=>ms<60000?`${(ms/1000).toFixed(1)}s`:`${Math.floor(ms/60000)}m ${String(Math.round(ms%60000/1000)).padStart(2,'0')}s`;
const scopeLabel=s=>clean(s).split('/').map(x=>x.slice(0,8)).join('/');
function shortName(label,max) {
  const s=clean(label),at=s.lastIndexOf('@');if(width(s)<=max)return s;
  return at>0&&width(s.slice(at))<=max-4?truncate(s.slice(0,at),max-width(s.slice(at)))+s.slice(at):truncate(s,max);
}
const BACKUP_STATUS={complete:['good','complete'],'rolled-back':['warn','rolled back'],prepared:['muted','unfinished']};
const backupStatus=b=>BACKUP_STATUS[b.status]||['muted',clean(b.status)];
const backupFacts=b=>`${count(b.scopes?.length||0,'folder')} · ${count(b.transcripts?.length||0,'conversation')}`;
const backupChoice=b=>({id:b.id,label:`${when(b.createdAt)} · ${ago(b.createdAt)}`,description:`${backupStatus(b)[1]} · ${backupFacts(b)} · ${clean(b.id)}`});

const SGR={bold:'1',accent:'38;5;173',muted:'38;5;245',rail:'38;5;241',good:'32',warn:'33',bad:'31'};
const G={top:'┌',bar:'│',end:'└',done:'◇',active:'◆',stop:'■',warn:'▲',pointer:'❯',check:'✔',cross:'✖',dot:'●',next:'›',spin:['◒','◐','◓','◑']};
const RECOMMENDED=/\s*\(Recommended\)$/i;
const SCOPED=/^([0-9a-f]{8}\/[0-9a-f]{8}): (.*)$/i;
const HINT='↑/↓ move · enter select · q cancel';

class UI {
  constructor({input=process.stdin,output=process.stdout,errorOutput=process.stderr,color=output.isTTY&&!process.env.NO_COLOR}={}) {
    this.input=input;this.output=output;this.errorOutput=errorOutput;this.interactive=!!input.isTTY;this.color=!!color;
    this.errorColor=this.color&&!!errorOutput?.isTTY;
    // live: lines can be redrawn in place; keys: single-key prompts in raw mode. Otherwise numbered line prompts.
    this.live=!!output.isTTY&&process.env.TERM!=='dumb';
    this.keys=this.live&&this.interactive&&typeof input.setRawMode==='function';
    this.queue=[];this.waiter=null;this.ended=false;this.closed=false;
    this.rail=false;this.gap=true;this.region=0;this.prompt=null;this.spinner=null;this.listening=false;this.names={};
    if(this.live){this.restoreCursor=()=>this.output.write('\x1b[?25h');process.once('exit',this.restoreCursor);}
    if(this.keys){this.onKey=(str,key)=>this.key(str,key||{});return;}
    this.rl=readline.createInterface({input,output,terminal:false});
    this.rl.on('line',line=>{if(this.waiter){const w=this.waiter;this.waiter=null;w.resolve(line);}else this.queue.push(line);});
    this.rl.on('close',()=>{this.ended=true;if(this.waiter){this.waiter.reject(new Cancelled());this.waiter=null;}});
    this.rl.on('SIGINT',()=>this.cancel());
  }
  // Display names for accounts, keyed by the first 8 characters of the account id.
  setNames(names){this.names=names||{};}
  scopeName(scope){const [account,org]=scope.split('/'),name=this.names[account.slice(0,8)];return name?`${shortName(name,32)} · ${org}`:scope;}
  paint(s,...names){return this.color&&names.length?`\x1b[${names.map(n=>SGR[n]).join(';')}m${s}\x1b[0m`:s;}
  // Output that is not a terminal (logs, pipes) is never hard-wrapped or truncated, so it stays greppable.
  get columns(){return this.live?Math.max(40,this.output.columns||80):Infinity;}
  get rows(){return Math.max(12,this.output.rows||24);}
  get measure(){return this.live?Math.min(this.columns-4,88):Infinity;}

  // Static output. A live spinner is lifted off, the line written, and the spinner redrawn below it.
  write(s){this.output.write(s);}
  out(line){const spinner=this.spinner;if(this.region)this.clear();this.write(line+'\n');this.gap=false;spinner?.render();}
  bar(s=''){const b=this.paint(G.bar,'rail');return s?`${b}  ${s}`:b;}
  line(s=''){this.out(this.rail?this.bar(s):s);}
  row(s=''){this.out(this.bar(s));this.gap=!s;}
  space(){if(this.rail&&!this.gap)this.row();}
  title(glyph,tone,text,meta='') {
    const room=Math.min(this.columns-1,80)-3,t=truncate(text,Math.max(12,room-(meta?width(meta)+2:0)));
    let s=`${this.paint(glyph,tone)}  ${this.paint(t,'bold')}`;
    if(meta)s+=' '.repeat(Math.max(2,room-width(t)-width(meta)))+this.paint(meta,'muted');
    return s;
  }
  intro(name,subtitle){if(this.rail)return;this.rail=true;this.out(`${this.paint(G.top,'rail')}  ${this.paint(name,'bold','accent')}${subtitle?'  '+this.paint(clean(subtitle),'muted'):''}`);}
  step(text,{glyph=G.done,tone='good',meta}={}){this.space();this.out(this.title(glyph,tone,clean(text),meta));}
  heading(s,meta){this.step(s,{meta});}
  info(s){for(const l of wrap(s,this.measure))this.row(this.paint(l,'muted'));}
  good(s){const [first,...rest]=wrap(s,this.measure-2);this.row(`${this.paint(G.check,'good')} ${first}`);for(const l of rest)this.row('  '+l);}
  warn(s){const [first,...rest]=wrap(s,this.measure);this.out(`${this.paint(G.warn,'warn')}  ${this.paint(first,'warn')}`);for(const l of rest)this.row(this.paint(l,'warn'));}
  fields(rows){const w=Math.max(...rows.map(([k])=>width(k)))+3;for(const [k,v] of rows)this.row(this.paint(pad(k,w),'muted')+v);}
  bullets(items){for(const item of items){const [first,...rest]=wrap(item,this.measure-2);this.row(`${this.paint(G.next,'accent')} ${first}`);for(const l of rest)this.row('  '+l);}}
  outro(text='',tone='good') {
    if(!this.rail){if(text)this.out(this.paint(clean(text),tone));return;}
    this.space();this.out(`${this.paint(G.end,'rail')}${text?'  '+this.paint(clean(text),tone):''}`);this.rail=false;
  }
  end(){if(this.rail)this.outro();}
  fail(error) {
    this.spinner?.stop();this.clear();
    const cancelled=error instanceof Cancelled,tone=cancelled?'warn':'bad';
    const paint=(s,name)=>this.errorColor?`\x1b[${SGR[name]}m${s}\x1b[0m`:s;
    const [first,...rest]=wrap(cancelled?error.message:'Stopped: '+clean(error?.message??error),this.measure-2);
    let s=this.rail?`${paint(G.end,'rail')}  `:'';
    if(this.rail)this.space();
    s+=paint(`${cancelled?G.stop:G.cross} ${first}`,tone)+'\n';
    for(const l of rest)s+=(this.rail?'     ':'  ')+paint(l,tone)+'\n';
    this.errorOutput.write(s);this.rail=false;
  }
  help(text) {
    String(text).replace(/\n+$/,'').split('\n').forEach((line,i)=>{
      const flag=/^(  )(\(no option\)|--\S+(?: [A-Z]+)*)(\s+)(.*)$/.exec(line);
      if(i===0||/^\S/.test(line))this.out(this.paint(line,'bold',...i===0?['accent']:[]));
      else if(flag)this.out(flag[1]+this.paint(flag[2],'accent')+flag[3]+flag[4]);
      else this.out(line);
    });
  }

  // Live region: the lines of an active prompt or spinner, redrawn in place.
  draw(lines){this.write((this.region?'\r'+(this.region>1?`\x1b[${this.region-1}A`:'')+'\x1b[J':'\x1b[?25l')+lines.join('\n'));this.region=lines.length;}
  clear(){if(!this.region)return;this.write('\r'+(this.region>1?`\x1b[${this.region-1}A`:'')+'\x1b[J\x1b[?25h');this.region=0;}
  commit(lines){this.draw(lines);this.write('\n\x1b[?25h');this.region=0;this.gap=false;}
  meter({current,total}){const size=16,filled=Math.max(0,Math.min(size,Math.round(current/total*size)));return this.paint('━'.repeat(filled),'accent')+this.paint('─'.repeat(size-filled),'rail')+'  '+this.paint(`${current}/${total}`,'muted');}
  async task(label,fn,{done,quiet=false}={}) {
    const started=Date.now();let text=clean(label),progress=null,frame=0,printed=0,shown=false,timer=null,delay=null;
    const render=()=>{if(this.prompt||this.closed)return;shown=true;this.draw([`${this.paint(G.spin[frame++%G.spin.length],'accent')}  ${truncate(text,this.columns-(progress?40:6))}${progress?'  '+this.meter(progress):''}`]);};
    const stop=()=>{clearInterval(timer);clearTimeout(delay);if(this.spinner===spinner)this.spinner=null;if(shown)this.clear();shown=false;};
    const spinner={render,stop};
    const handle={update:(next,p)=>{text=clean(next);progress=p&&p.total>0?p:null;if(!this.live&&!quiet&&Date.now()-printed>1500){printed=Date.now();this.row(this.paint(progress?`${text} ${progress.current}/${progress.total}`:text,'muted'));}}};
    if(this.live){
      this.spinner=spinner;if(!quiet)this.space();
      const begin=()=>{render();timer=setInterval(render,80);timer.unref?.();};
      if(quiet){delay=setTimeout(begin,300);delay.unref?.();}else begin();
    }else if(!quiet){this.space();this.out(this.title(G.spin[0],'accent',text+'…'));}
    try {
      const value=await fn(handle);stop();
      if(!quiet){const ms=Date.now()-started;this.out(this.title(G.done,'good',clean(done?done(value):label),ms>=1000?duration(ms):''));}
      return value;
    }catch(error){stop();if(!quiet)this.out(this.title(G.stop,error instanceof Cancelled?'warn':'bad',text));throw error;}
  }

  // Input. Raw-mode keys stay subscribed between prompts so stray presses are discarded, not replayed.
  ensureKeys(){if(this.listening)return;readline.emitKeypressEvents(this.input);this.input.setRawMode(true);this.input.on('keypress',this.onKey);this.input.resume();this.listening=true;}
  key(str,key){if(key.ctrl&&key.name==='c'){process.kill(process.pid,'SIGINT');return;}this.prompt?.key(str,key);}
  async read(prompt){
    if(!this.interactive) throw Error('Interactive confirmation is required. Run claude-x in a terminal; nothing was applied.');
    if(this.keys) {
      this.ensureKeys();this.write(prompt);
      return new Promise((resolve,reject)=>{let text='';const finish=settle=>{this.prompt=null;this.write('\n');settle();};this.prompt={
        key:(str,key)=>{if(key.name==='return'||key.name==='enter')finish(()=>resolve(text));else if(key.name==='backspace'){if(text){text=text.slice(0,-1);this.write('\b \b');}}else if(str&&!key.ctrl&&!key.meta&&!/[\x00-\x1f\x7f]/.test(str)){text+=str;this.write(str);}},
        cancel:()=>finish(()=>reject(new Cancelled()))};});
    }
    this.output.write(prompt);
    let line;
    if(this.queue.length)line=this.queue.shift();
    else if(this.ended)throw new Cancelled();
    else line=await new Promise((resolve,reject)=>{this.waiter={resolve,reject};});
    if(!this.live)this.write('\n');
    return line;
  }
  async choose(title,options,{defaultId,detail,settings,meta,compact=false,hint=HINT}={}) {
    const items=options.map(o=>{
      const raw=clean(o.label),text=raw.replace(RECOMMENDED,''),scoped=SCOPED.exec(text),prefix=scoped?this.scopeName(scoped[1]):'';
      return {id:o.id,prefix,text:scoped?scoped[2]:text,label:scoped?`${prefix}: ${scoped[2]}`:text,badge:clean(o.badge)||(RECOMMENDED.test(raw)?'recommended':''),description:clean(o.description)};
    });
    const head={title:clean(title),detail:clean(detail),settings:(settings||[]).map(s=>[clean(s.key),clean(s.summary)]),meta};
    const index=items.findIndex(o=>o.id===defaultId);
    if(this.keys)return this.select(head,items,index>=0?index:Math.max(0,items.findIndex(o=>o.badge==='recommended')),{compact,hint});
    return this.ask(head,items,index);
  }
  async resolve(conflict,{index,total}={}) {
    return this.choose(conflict.title,conflict.options,{detail:conflict.detail,settings:conflict.settings,meta:total?`decision ${index} of ${total}`:'',hint:HINT+' · nothing is applied yet'});
  }
  headerLines(head,glyph,tone) {
    const lines=[this.title(glyph,tone,head.title,head.meta)];
    if(head.detail)for(const l of wrap(head.detail,this.measure))lines.push(this.bar(this.paint(l,'muted')));
    if(head.settings.length){const w=Math.max(...head.settings.map(([k])=>width(k)))+2;for(const [k,v] of head.settings)lines.push(this.bar(`${this.paint(pad(k+':',w),'muted')} ${truncate(v,Math.max(12,this.columns-5-w))}`));}
    return lines;
  }
  badge(o){return o.badge?'  '+this.paint(o.badge,o.badge==='recommended'?'good':'muted'):'';}
  async ask(head,items,index) {
    this.space();for(const l of this.headerLines(head,G.active,'accent'))this.out(l);
    items.forEach((o,i)=>{this.row(`${i+1}. ${o.label}${o.badge?this.paint(` (${o.badge})`,o.badge==='recommended'?'good':'muted'):''}`);if(o.description)for(const l of wrap(o.description,this.measure-3))this.row('   '+this.paint(l,'muted'));});
    this.row('q. Cancel');
    const range=items.length===1?'1':`1-${items.length}`;
    while(true) {
      const answer=(await this.read(this.bar(`Choose ${range}${index>=0?`, Enter for ${index+1}`:''}, or q to cancel: `))).trim();
      if(answer.toLowerCase()==='q')throw new Cancelled();
      const n=answer===''?index+1:Number(answer);
      if(Number.isInteger(n)&&n>=1&&n<=items.length){this.row(this.paint(`${G.check} ${items[n-1].label}`,'muted'));return items[n-1].id;}
      this.warn('Choose one of the numbers above, or q to cancel.');
    }
  }
  optionLabel(o,active,room) {
    const prefix=o.prefix?truncate(o.prefix,Math.max(8,Math.floor(room/2)))+':':'',text=truncate(o.text,Math.max(8,room-(prefix?width(prefix)+1:0)));
    return (prefix?this.paint(prefix,'muted')+' ':'')+(active?this.paint(text,'bold'):text);
  }
  select(head,items,index,{compact,hint}) {
    this.ensureKeys();this.space();
    let header=this.headerLines(head,G.active,'accent');if(head.detail||head.settings.length)header.push(this.bar());
    const pinned=header.length>this.rows-7;
    if(pinned){for(const l of header)this.out(l);header=[];}
    let start=0;
    const notes=compact?items.map(o=>o.description?wrap(o.description,this.measure-2):[]):[];
    const noteRows=Math.max(0,...notes.map(n=>n.length));
    const lines=()=>{
      const blocks=items.map((o,i)=>{
        const active=i===index,room=Math.max(12,this.columns-8-width(this.badge(o)));
        const block=[this.bar(active?`${this.paint(G.pointer,'accent')} ${this.optionLabel(o,true,room)}${this.badge(o)}`:`  ${this.optionLabel(o,false,room)}${this.badge(o)}`)];
        if(!compact&&o.description)for(const l of wrap(o.description,this.measure-4))block.push(this.bar('    '+this.paint(l,'muted')));
        return block;
      });
      const heights=blocks.map(b=>b.length),total=heights.reduce((a,b)=>a+b,0);
      let room=this.rows-2-header.length-(noteRows?noteRows+1:0),first=0,last=items.length;
      const scrolling=total>room;
      if(scrolling) {
        room=Math.max(heights[index],room-2);
        if(index<start)start=index;
        const fit=s=>{let h=0,e=s;while(e<items.length&&h+heights[e]<=room){h+=heights[e];e++;}return e;};
        let end=fit(start);while(end<=index&&start<index){start++;end=fit(start);}
        first=start;last=Math.max(end,index+1);
      }
      const view=[...header];
      if(scrolling&&header.length>1)view.pop();
      if(scrolling)view.push(this.bar(first?this.paint(`  ↑ ${first} more`,'muted'):''));
      for(let i=first;i<last;i++)view.push(...blocks[i]);
      if(scrolling)view.push(this.bar(last<items.length?this.paint(`  ↓ ${items.length-last} more`,'muted'):''));
      if(noteRows){view.push(this.bar());for(let i=0;i<noteRows;i++)view.push(this.bar(notes[index][i]?this.paint(notes[index][i],'muted'):''));}
      view.push(`${this.paint(G.end,'accent')}  ${this.paint(truncate(hint,this.columns-4),'muted')}`);
      return view;
    };
    return new Promise((resolve,reject)=>{
      const render=()=>this.draw(lines());
      const finish=(glyph,tone,answer,settle)=>{
        this.prompt=null;this.output.removeListener?.('resize',render);
        this.commit([...pinned?[]:[this.title(glyph,tone,head.title,head.meta)],...answer?[this.bar(this.paint(truncate(answer,this.columns-4),'muted'))]:[]]);settle();
      };
      this.prompt={
        key:(str,key)=>{
          const n=items.length;
          if(key.name==='up'||key.name==='k'||(key.ctrl&&key.name==='p'))index=(index-1+n)%n;
          else if(key.name==='down'||key.name==='j'||key.name==='tab'||(key.ctrl&&key.name==='n'))index=(index+1)%n;
          else if(key.name==='home'||key.name==='pageup')index=0;
          else if(key.name==='end'||key.name==='pagedown')index=n-1;
          else if(/^[1-9]$/.test(str||'')&&Number(str)<=n)index=Number(str)-1;
          else if(key.name==='return'||key.name==='enter')return finish(G.done,'good',items[index].label,()=>resolve(items[index].id));
          else if(key.name==='escape'||(key.name==='q'&&!key.ctrl&&!key.meta))return this.prompt.cancel();
          else return;
          render();
        },
        cancel:()=>finish(G.stop,'warn','',()=>reject(new Cancelled()))
      };
      this.output.on?.('resize',render);render();
    });
  }
  async waitUntil(check,{title,hint,prompt,done}) {
    if(check())return;
    if(!this.keys){while(!check()){this.warn(title+'. '+hint);const answer=(await this.read(this.bar(prompt))).trim();if(answer.toLowerCase()==='q')throw new Cancelled();}return;}
    this.ensureKeys();this.space();
    return new Promise((resolve,reject)=>{
      let frame=0;
      const render=()=>this.draw([this.title(G.spin[frame++%G.spin.length],'warn',title),...wrap(hint,this.measure).map(l=>this.bar(this.paint(l,'muted'))),`${this.paint(G.end,'warn')}  ${this.paint('continues automatically · enter check now · q cancel','muted')}`]);
      const finish=(lines,settle)=>{clearInterval(spin);clearInterval(poll);this.prompt=null;this.commit(lines);settle();};
      const test=()=>{let ok;try{ok=check();}catch(e){return finish([this.title(G.stop,'bad',title)],()=>reject(e));}if(ok)finish([this.title(G.done,'good',done)],resolve);};
      const spin=setInterval(render,120),poll=setInterval(test,1000);
      this.prompt={
        key:(str,key)=>{if(key.name==='return'||key.name==='enter')test();else if(key.name==='escape'||key.name==='q')this.prompt.cancel();},
        cancel:()=>finish([this.title(G.stop,'warn',title)],()=>reject(new Cancelled()))
      };
      render();
    });
  }

  // Accounts fan into their organization folders, and every folder feeds one shared state:
  //   ○ 1f3a9c2e ──┬─ 7d41b0aa  192 sessions ─┐   ╭─ Shared ───────╮
  //              └─ 5c2e8f13  192 sessions ─┼──▶ │ 192 sessions   │
  //   ● 9b07d5e4 ──── 2a6f4c81  196 sessions ─┘   │ 9 groups       │
  // The filled dot is the signed-in account. A named account shows its name with the id beneath,
  // so it spans at least two rows. Narrow terminals get the box below the tree.
  accountMap({folders,hub,column,hint}) {
    const rail=x=>this.paint(x,'rail'),accounts=[];
    for(const f of folders){const [account='',org='']=clean(f.scope).split('/').map(x=>x.slice(0,8));let a=accounts.find(x=>x.id===account);if(!a)accounts.push(a={id:account,name:shortName(this.names[account]||'',26),current:false,folders:[]});a.current||=!!f.signedIn;a.folders.push({org,detail:clean(f.detail),tone:f.tone||'muted'});}
    const rows=accounts.flatMap(a=>{const k=a.folders.length;return Array.from({length:Math.max(k,a.name?2:1)},(_,j)=>({account:a,j,folder:a.folders[j],branch:j>=k?'    ':k===1?'────':!j?'──┬─':j<k-1?'  ├─':'  └─'}));});
    const dw=Math.max(0,...rows.map(r=>width(r.folder?.detail||''))),aw=2+Math.max(...accounts.map(a=>a.name?Math.max(width(a.name),width(a.id)+2):width(a.id)));
    const lines=hub.lines.map(([t,tone])=>[clean(t),tone]),title=clean(hub.title),iw=Math.max(width(title)+1,...lines.map(([t])=>width(t)));
    const box=[rail('╭─ ')+this.paint(title,'bold')+rail(' '+'─'.repeat(iw-width(title)-1)+'╮'),...lines.map(([t,tone])=>rail('│ ')+(tone?this.paint(pad(t,iw),tone):pad(t,iw))+rail(' │')),rail('╰'+'─'.repeat(iw+2)+'╯')];
    const who=r=>{const a=r.account;if(!r.j){const t=pad(`${a.current?G.dot:'○'} ${a.name||a.id}`,aw);return a.current?this.paint(t,'good','bold'):t;}return r.j===1&&a.name?this.paint(pad(`  (${a.id})`,aw),'muted'):' '.repeat(aw);};
    const tree=r=>`${who(r)} ${rail(r.branch)} `+(r.folder?`${pad(r.folder.org,8)}  ${this.paint(pad(r.folder.detail,dw),r.folder.tone)}`:' '.repeat(10+dw));
    const n=rows.length,fed=rows.flatMap((r,i)=>r.folder?[i]:[]),f0=fed[0],f1=fed.at(-1),mid=Math.min(f1,Math.max(f0,Math.floor((n-1)/2))),treeWidth=aw+1+4+1+8+2+dw;
    const join=i=>i<f0||i>f1?'   ':!rows[i].folder?'  '+(i===mid?'├':'│'):f0===f1?' ──':' ─'+(i===f0?(i===mid?'┬':'┐'):i===f1?(i===mid?'┴':'┘'):i===mid?'┼':'┤');
    const out=[],head=column&&this.paint(pad(pad('  account',aw+6)+pad('org',10)+column,treeWidth+7),'muted');
    if(treeWidth+8+iw+4<=this.columns-4) {
      const first=Math.min(0,mid-1);if(head&&first===0)out.push(head.trimEnd());
      for(let d=first;d<=Math.max(n-1,mid+lines.length);d++) {
        const left=d>=0&&d<n?tree(rows[d])+rail(join(d))+(d===mid?this.paint('──▶','accent')+' ':'    '):d<0&&head?head:' '.repeat(treeWidth+7);
        out.push((left+(box[d-mid+1]??'')).trimEnd());
      }
    }else{out.push(...head?[head.trimEnd()]:[],...rows.map(tree),'',...box);}
    for(const l of out)this.row(l);
    if(accounts.some(a=>a.current))this.row(this.paint(G.dot,'good')+this.paint(truncate(' current account (signed in)   ○ other local accounts',this.columns-5),'muted'));
    const unnamed=accounts.find(a=>!a.name);
    if(hint&&unnamed)this.row(this.paint(truncate(`Show an email instead of an ID: claude-x --name ${unnamed.id} you@example.com`,this.columns-4),'muted'));
  }
  // What a merge writes into one folder: session records and/or its sidebar (groups and sections).
  changeLabel(c,done) {
    const parts=[...c?.records?[count(c.records,'session')]:[],...c?.sidebar?['sidebar']:[]];
    if(!parts.length)return {detail:'no changes',tone:'muted'};
    return {detail:(done?G.check+' ':'')+parts.join(' + '),tone:done?'good':'accent'};
  }
  changeMap(plan,{account,done,title}) {
    const n=plan.conflicts.length;
    this.accountMap({
      column:done?'updated':'will update',folders:Object.entries(plan.scopeChanges).map(([scope,c])=>({scope,signedIn:!!account&&scope.split('/')[0]===account,...this.changeLabel(c,done)})),
      hub:{title,lines:[[count(plan.sessionCount,'session')],[count(plan.groupCount,'group')],...n&&!done?[[`${n} decision${n===1?'':'s'}`,'warn']]:[]]}});
  }

  // Screens.
  status(s) {
    const m=x=>this.paint(x,'muted');
    const rows=[['Claude Desktop',s.running?this.paint(G.dot+' running','warn')+m(' · quit it before merging'):this.paint(G.dot+' closed','good')]];
    rows.push(['Backups',`${s.backups.count} of ${s.backups.max} kept`+m(` · ${bytes(s.backups.bytes)}${s.backups.latest?' · latest '+ago(s.backups.latest):''}`)]);
    this.space();this.fields(rows);
    const hub=s.shared?[[count(s.shared.sessions,'session')],[count(s.shared.groups,'group')],[s.lastSync?'synced '+ago(s.lastSync):'not synced yet','muted']]:[['not synced yet','muted']];
    // Sessions created since the last sync exist in one folder only until the next merge copies them.
    const folders=s.folders.map(f=>({...f,detail:f.sessions==null?'':count(f.sessions,'session')+(f.fresh?` · ${f.fresh} new`:''),tone:f.fresh?'accent':'muted'}));
    this.space();this.accountMap({folders,hub:{title:'Shared',lines:hub},column:'sessions',hint:true});
    if(s.folders.some(f=>f.fresh))this.row(this.paint('New sessions were created after the last sync; the next merge copies them to every folder.','muted'));
    if(s.pending){this.space();this.warn('An interrupted sync needs recovery before the next merge. Choose Recover, or run claude-x --recover.');}
  }
  plan(plan,{title='Merge preview',verb='merge',preview=true,account}={}) {
    const n=plan.conflicts.length,m=x=>this.paint(x,'muted');
    this.step(title);
    const map=preview&&plan.scopeChanges;
    const rows=[
      ...map?[]:[['Accounts',`${count(plan.accountCount,'account')} · ${count(plan.scopeCount,'organization folder')}`]],
      ['Sessions',`${count(plan.sessionCount,'session')} after ${verb} · `+(plan.sessionWrites?this.paint(count(plan.sessionWrites,'record')+' to update','accent'):m('no record changes'))],
      ['Groups',`${count(plan.groupCount,'group')} after ${verb} · `+(plan.preferenceWrites?this.paint(count(plan.preferenceWrites,'sidebar record')+' to update','accent'):m('sidebar unchanged'))]
    ];
    if(plan.preservedBranches)rows.push(['Branches',count(plan.preservedBranches,'additional conversation branch','additional conversation branches')+' kept']);
    rows.push(['Decisions',n?this.paint(`${n} need${n===1?'s':''} your choice`,'warn'):this.paint('none needed','good')]);
    this.fields(rows);
    if(map){this.space();this.changeMap(plan,{account,title:'After '+verb});}
    if(!n||(!preview&&n===1&&this.interactive))return;
    const shown=preview?plan.conflicts:plan.conflicts.slice(0,8);
    this.space();
    for(const c of shown){this.row(`${this.paint(G.warn,'warn')} ${truncate(clean(c.title),this.columns-6)}`);if(preview&&c.detail)for(const l of wrap(c.detail,this.measure-2))this.row('  '+m(l));}
    if(shown.length<n)this.row(m(`  … and ${n-shown.length} more`));
  }
  backups(list,max=5) {
    this.step('Backups',{meta:`${list.length} of ${max} kept`});
    if(!list.length)return this.info('No snapshots yet. The first merge backs up current state before applying.');
    const stamps=list.map(b=>when(b.createdAt)),ages=list.map(b=>ago(b.createdAt)),sw=Math.max(...stamps.map(width)),aw=Math.max(...ages.map(width));
    list.forEach((b,i)=>{
      const [tone,name]=backupStatus(b);
      this.row(`${this.paint(G.dot,tone)} ${this.paint(pad(stamps[i],sw),'bold')}  ${this.paint(pad(ages[i],aw),'muted')}  ${this.paint(name,tone)} · ${backupFacts(b)}`);
      this.row('  '+this.paint(clean(b.id),'muted'));
    });
  }
  result({rows=[],notes=[],next=[],outro,plan,account,title}) {
    if(plan?.scopeChanges){this.space();this.changeMap(plan,{account,done:true,title});}
    if(rows.length){this.space();this.fields(rows.map(([k,v,meta])=>[k,clean(v)+(meta?this.paint(' · '+clean(meta),'muted'):'')]));}
    for(const note of notes)this.good(note);
    if(next.length){this.space();this.row(this.paint('Next','bold'));this.bullets(next);}
    this.outro(`${G.check} ${outro}`,'good');
  }
  cancel(){if(this.prompt)this.prompt.cancel();if(this.waiter){this.waiter.reject(new Cancelled());this.waiter=null;}this.close();}
  close() {
    if(this.closed)return;this.closed=true;
    this.spinner?.stop();this.clear();
    if(this.listening){this.input.removeListener('keypress',this.onKey);try{this.input.setRawMode(false);}catch{}this.input.pause();this.listening=false;}
    if(this.restoreCursor)process.removeListener('exit',this.restoreCursor);
    this.rl?.close();
  }
}
module.exports={UI,Cancelled,clean,summarize,count,when,ago,bytes,wrap,truncate,width,backupChoice};
