const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js','daily-goals.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12'],mon=dates[0],thu=dates[3];
function setup(){let p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};for(const d of dates){const r=c.dailyGoalPlan({}, {},p,d,mon).rows.find(r=>r.date===d);p=c.dailyEdit(p,r,'target',null,'10000');p=c.dailyGoalConfirm({}, {},p,d,mon);}return p;}
const actual=n=>({sets:[{u_cum:n,u_cnt_cum:Math.floor(n/400)}]});
const vault=()=>Object.fromEntries(dates.slice(0,3).map(d=>[d,actual(8000)]));
const view=(p,v=vault(),today=thu)=>c.dailyGoalOutlook(v,{},p,mon,today);
const edit=(p,date,value,v=vault(),today=thu)=>c.dailyPreservePeriodTargets(v,{},p,c.dailyEdit(p,view(p,v,today).plan.rows.find(r=>r.date===date),'target',null,String(value)),today);
test('remaining-day correction holds 40000: 24000 past + 16000 Thu, no duplicate shortfall',()=>{
 let p=setup(),v=vault(),original=JSON.stringify(v);p=edit(p,thu,16000,v);const o=view(p,v);assert.equal(o.parts[0].goal,40000);assert.equal(o.parts[0].part.plannedDelivery,40000);assert.equal(o.parts[0].part.planGap,0);assert.equal(o.parts[0].actual,24000);assert.equal(p.periodTargets[mon],40000);assert.equal(JSON.stringify(v),original);
 p=c.dailyGoalConfirm(v,{},p,thu,thu);assert.equal(view(p).parts[0].goal,40000);p=c.pvalidate(JSON.parse(JSON.stringify(p)));assert.equal(view(p).parts[0].part.planGap,0);
});
test('rebalance preserves history and budget, actual corrections recompute remaining without mutation',()=>{
 let p=setup(),v=vault();const history=JSON.stringify(p.confirmed);p=c.dailyRebalanceRemaining(v,{},p,mon,thu);assert.equal(view(p).plan.rows[3].target,16000);assert.equal(JSON.stringify(p.confirmed),history);assert.equal(view(p).parts[0].goal,40000);
 v[mon]=actual(9000);assert.equal(view(p,v).parts[0].part.remainingDeliveryBudget,15000);assert.equal(view(p,v).parts[0].part.planGap,-1000);p=c.dailyRebalanceRemaining(v,{},p,mon,thu);assert.equal(view(p,v).plan.rows[3].target,15000);
});
test('today actual is a floor, not subtracted from day-total target twice',()=>{
 let p=setup(),v=vault();v[thu]=actual(5000);p=c.dailyRebalanceRemaining(v,{},p,mon,thu);const r=view(p,v).plan.rows[3];assert.equal(r.target,16000);assert.equal(r.remaining,11000);assert.equal(view(p,v).parts[0].part.planGap,0);
});
test('excess past sales and day sales never create negative targets or hide excess',()=>{
 let p=setup(),v=Object.fromEntries(dates.slice(0,3).map(d=>[d,actual(15000)]));v[thu]=actual(5000);p=c.dailyRebalanceRemaining(v,{},p,mon,thu);assert.equal(view(p,v).parts[0].goal,40000);assert.equal(view(p,v).plan.rows[3].target,5000);assert.equal(view(p,v).parts[0].part.planGap,-10000);
});
test('holiday/deletion preserves budget; no receivers leaves visible shortfall without inventing plans',()=>{
 for(const remove of [p=>({...p,days:{...p.days,[thu]:{mode:'off',value:''}}}),p=>c.dailyGoalDelete(p,thu)]){
  let p=setup();p=c.dailyPreservePeriodTargets(vault(),{},p,remove(p),thu);assert.equal(view(p).parts[0].goal,40000);assert.equal(view(p).parts[0].part.planGap,16000);const snapshot=JSON.stringify(p);p=c.dailyRebalanceRemaining(vault(),{},p,mon,thu);assert.equal(JSON.stringify(p),snapshot);
 }
});
test('past plans can be corrected, actuals remain untouched and period goal remains held',()=>{
 let p=setup(),v=vault();p=edit(p,mon,8000,v);p=c.dailyGoalConfirm(v,{},p,mon,thu);assert.equal(view(p,v).parts[0].goal,40000);assert.equal(view(p,v).plan.rows[0].target,8000);assert.equal(v[mon].sets[0].u_cum,8000);
});
test('new plans still aggregate before period starts; old weekly goals are not revived',()=>{
 let p=setup();p=edit(p,thu,16000,{},mon);assert.equal(p.periodTargets,undefined);assert.equal(view(p,{},mon).parts[0].goal,46000);
 const g={[c.pgoalKey(mon,'week')]:999999};assert.equal(c.dailyGoalOutlook({},g,p,mon,mon).parts[0].goal,46000);
});
test('held targets validate strictly and roundtrip without changing old plan fields',()=>{
 for(const val of [-1,'40000',NaN,Infinity])assert.throws(()=>c.pvalidate({...setup(),periodTargets:{[mon]:val}}));
 assert.throws(()=>c.pvalidate({...setup(),periodTargets:{'2026-11-10':40000}}));
 let p=c.dailySetPeriodTarget(setup(),mon,45000);assert.equal(c.pvalidate(JSON.parse(JSON.stringify(p))).periodTargets[mon],45000);assert.equal(view(p).parts[0].goal,45000);
});
test('quest rewards stay separate; recorded and linked payments do not lower delivery budget twice',()=>{
 let p=setup(),v=vault();p.quests=[{id:'q',start:mon,end:thu,count:80,base:9000,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];
 v[mon].sets[0].u_que_cum=3000;p=c.dailyRebalanceRemaining(v,{},p,mon,thu);let o=view(p,v);assert.equal(o.parts[0].goal,49000);assert.equal(o.plan.rows[3].target,16000);assert.equal(o.parts[0].part.planGap,0);assert.equal(o.parts[0].actual,27000);assert.equal(o.parts[0].forecastRewards,6000);
 v['2026-11-08']={sets:[{u_que_cum:6000}]};p.quests[0].links=[{date:'2026-11-08',amount:6000}];o=view(p,v);assert.equal(o.plan.rows[3].target,16000);assert.equal(o.parts[0].forecastRewards,0);assert.equal(o.parts[0].goal,49000);
});
test('two remaining days get integer amounts once; subsequent rebalances and confirmation are stable',()=>{
 let p=setup(),v={[mon]:actual(8001),[dates[1]]:actual(8000)},today=dates[2];p=c.dailyRebalanceRemaining(v,{},p,mon,today);let o=view(p,v,today);assert.equal(o.plan.rows[2].target,12000);assert.equal(o.plan.rows[3].target,11999);assert.equal(o.parts[0].goal,40000);assert.equal(o.parts[0].part.planGap,0);
 const first=JSON.stringify(p);p=c.dailyRebalanceRemaining(v,{},p,mon,today);assert.equal(JSON.stringify(p),first);p=c.dailyGoalConfirm(v,{},p,dates[2],today);assert.equal(view(p,v,today).parts[0].goal,40000);
});
test('first plan entered midweek with only old actuals does not lock a zero or first-keystroke goal',()=>{
 let p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};const v={[mon]:actual(8000)};
 for(const n of [1,16,160,1600,16000])p=edit(p,thu,n,v);assert.equal(p.periodTargets,undefined);assert.equal(view(p,v).parts[0].goal,16000);
});
test('actuals on non-receiver days also reduce remaining budget',()=>{
 for(const remove of [p=>({...p,days:{...p.days,[dates[1]]:{mode:'off',value:''}}}),p=>c.dailyGoalDelete(p,dates[1])]){
 let p=setup(),v={[mon]:actual(8000),[dates[1]]:actual(5000)},today=dates[1];p=c.dailyPreservePeriodTargets(v,{},p,remove(p),today);p=c.dailyRebalanceRemaining(v,{},p,mon,today);const o=view(p,v,today);assert.equal(o.plan.rows[2].target,13500);assert.equal(o.plan.rows[3].target,13500);assert.equal(o.parts[0].part.planGap,0);
 }
});
test('typing a new past plan never freezes the first keystroke',()=>{
 let p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};const v={[mon]:actual(8000)};
 for(const n of [1,16,160,1600,16000])p=edit(p,mon,n,v);assert.equal(p.periodTargets,undefined);assert.equal(view(p,v).parts[0].goal,16000);
});
