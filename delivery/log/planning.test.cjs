const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const context = vm.createContext({
  pn: v => Math.max(0, Number(v) || 0),
  formatDateToParam: d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'),
  getYearWeekStr: () => '2026-W45',
  calcDuration: () => null,
});
vm.runInContext(html.slice(html.indexOf('function pdate('), html.indexOf('function Planner(')), context);
const date='2026-11-04';
const plan=()=>({...context.pdefault(),calc:{u:500,d:600,uph:3,company:'u',share:100}});
const quest=(overrides={})=>({id:'q',start:'2026-11-02',end:'2026-11-05',count:40,base:2000,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[],...overrides});
const log=(u,d=0)=>({sets:[{u_cnt_cum:u,d_cnt_cum:d,u_cum:u*500,d_cum:d*600}]});
const summarize=(p,goals={},vault={})=>context.psummary(vault,goals,p,date);
let p=plan();p.quests=[quest()];
let s=summarize(p,{['D-'+date]:{amt:5000,cnt:12}},{'2026-11-02':log(10)});
assert.equal(s.uberNeed,15);assert.equal(s.amountNeed,9);assert.equal(s.need,15);
assert.equal(s.countNeed,12);
// A higher daily count wins even when revenue and quest quotas are lower.
assert.equal(summarize(p,{['D-'+date]:{amt:5000,cnt:30}},{'2026-11-02':log(10)}).need,30);
// Today's recorded deliveries reduce both the count goal and Uber quest remainder.
s=summarize(p,{['D-'+date]:{cnt:40}},{'2026-11-02':log(10),[date]:log(5,20)});
assert.equal(s.countNeed,15);assert.equal(s.uberNeed,13);assert.equal(s.need,15);
// Other platforms never count toward an Uber quest.
s=summarize(p,{}, {[date]:log(0,35)});assert.equal(s.uberNeed,20);
// A mixed-platform ratio must supply enough Uber deliveries after integer rounding.
p.calc.company='both';p.calc.share=50;
s=summarize(p,{}, {'2026-11-02':log(10)});
assert.equal(s.need,29);assert.equal(context.pmix(p.calc,s.need).u,15);
assert.ok(context.pmix(p.calc,s.need-1).u<15);
p.calc.company='d';s=summarize(p);assert.equal(s.need,null);assert.match(s.reason,/Uberノルマ/);
p.calc.company='both';p.calc.share=0;assert.equal(summarize(p).need,null);
// Off days and an explicit finish-today scenario force the remaining quota onto today.
p=plan();p.quests=[quest()];p.days['2026-11-05']={mode:'off',value:''};
assert.equal(summarize(p).uberNeed,40);
p.days={};p.quests[0].finish='base';assert.equal(summarize(p).uberNeed,40);
p.quests=[quest({end:date})];assert.equal(summarize(p).uberNeed,40);
p.quests=[quest({aim:'extra'})];assert.equal(summarize(p).uberNeed,25);
p.quests=[quest({aim:'n'})];assert.equal(summarize(p).uberNeed,0);
p.quests=[quest({status:'miss'})];assert.equal(summarize(p).uberNeed,0);
p.quests=[quest({status:'base'})];assert.equal(summarize(p).uberNeed,0);
p.quests=[quest()];assert.equal(summarize(p,{}, {[date]:log(40)}).uberNeed,0);
p.days[date]={mode:'off',value:''};p.days['2026-11-05']={mode:'off',value:''};
s=summarize(p);assert.equal(s.uberNeed,0);assert.equal(s.quotas[0].unallocated,40);
// Count-only goals work without fares; a revenue goal with missing fares stays unresolved.
p=plan();p.calc.u='';s=summarize(p,{['D-'+date]:{cnt:20}});assert.equal(s.need,20);assert.equal(s.hasRequirements,true);
s=summarize(p,{['D-'+date]:{amt:10000}});assert.equal(s.need,null);
p=plan();p.days[date]={mode:'cnt',value:25};s=summarize(p,{['D-'+date]:{cnt:10}});assert.equal(s.countTarget,25);assert.equal(s.need,25);
// Raising today's progress or leaving the quest unselected must not introduce stale quotas.
p=plan();p.quests=[quest()];assert.equal(summarize(p).need,20);assert.equal(summarize(p,{}, {[date]:log(10)}).need,15);
p.quests[0].aim='n';assert.equal(summarize(p).need,0);
console.log('PASS: daily revenue/count and quest constraints, mixed-platform rounding, deadlines, off days, stages, progress, and missing fares');
