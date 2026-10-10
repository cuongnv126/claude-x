'use strict';
const readline = require('node:readline');

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
class UI {
  constructor({input=process.stdin,output=process.stdout,color=output.isTTY&&!process.env.NO_COLOR}={}) {
    this.input=input;this.output=output;this.interactive=!!input.isTTY;this.color=color;
    this.queue=[];this.waiter=null;this.ended=false;
    this.rl=readline.createInterface({input,output,terminal:false});
    this.rl.on('line',line=>{if(this.waiter){const w=this.waiter;this.waiter=null;w.resolve(line);}else this.queue.push(line);});
    this.rl.on('close',()=>{this.ended=true;if(this.waiter){this.waiter.reject(new Cancelled());this.waiter=null;}});
    this.rl.on('SIGINT',()=>this.cancel());
  }
  paint(s,code){return this.color?`\x1b[${code}m${s}\x1b[0m`:s;}
  line(s=''){this.output.write(s+'\n');}
  heading(s){this.line('\n'+this.paint(clean(s),'1;38;5;216'));}
  info(s){this.line(this.paint(clean(s),'38;5;245'));}
  good(s){this.line(this.paint(clean(s),'32'));}
  warn(s){this.line(this.paint(clean(s),'33'));}
  async read(prompt){
    if(!this.interactive) throw Error('Interactive confirmation is required. Run claude-x in a terminal; nothing was applied.');
    this.output.write(prompt);
    if(this.queue.length)return this.queue.shift();
    if(this.ended)throw new Cancelled();
    return new Promise((resolve,reject)=>{this.waiter={resolve,reject};});
  }
  async choose(title,options,{defaultId}={}) {
    this.heading(title);
    options.forEach((o,i)=>{this.line(`  ${i+1}. ${clean(o.label)}`);if(o.description)this.info('     '+clean(o.description));});
    this.line('  q. Cancel');
    while(true) {
      const answer=(await this.read(defaultId?'Choose [Enter for default]: ':'Choose a number: ')).trim();
      if(answer.toLowerCase()==='q')throw new Cancelled();
      if(answer===''&&defaultId)return defaultId;
      const n=Number(answer);if(Number.isInteger(n)&&n>=1&&n<=options.length)return options[n-1].id;
      this.warn('Choose one of the numbers above, or q to cancel.');
    }
  }
  async resolve(conflict) {
    this.heading(`Conflict: ${conflict.title}`);
    if(conflict.detail)this.info(conflict.detail);
    for(const setting of conflict.settings||[])this.line(`  ${clean(setting.key)}: ${clean(setting.summary)}`);
    return this.choose('Confirm how to resolve it',conflict.options);
  }
  plan(plan) {
    this.heading('Merge preview');
    this.line(`  Accounts: ${plan.accountCount}    Organization folders: ${plan.scopeCount}`);
    this.line(`  Sessions: ${plan.sessionCount}    Groups: ${plan.groupCount}`);
    this.line(`  Session records to update: ${plan.sessionWrites}    Sidebar records: ${plan.preferenceWrites}`);
    this.line(`  Conflicts requiring a choice: ${plan.conflicts.length}`);
    if(plan.preservedBranches)this.line(`  Additional conversation branches retained: ${plan.preservedBranches}`);
    for(const c of plan.conflicts)this.warn(`  • ${c.title}${c.detail?' — '+c.detail:''}`);
  }
  cancel(){if(this.waiter){this.waiter.reject(new Cancelled());this.waiter=null;}this.rl.close();}
  close(){this.rl.close();}
}
module.exports={UI,Cancelled,clean,summarize};
