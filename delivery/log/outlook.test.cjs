const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({localStorage:{getItem:()=>null}});for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const fri='2026-11-06',sat='2026-11-07',sun='2026-11-08';
const goals=()=>c.psetPart(c.psetPart({},fri,'front',30000),fri,'back',50000);
const entry=(money,u=0,reward=0)=>({sets:[{u_cum:money,u_cnt_cum:u,u_que_cum:reward}]});
const plan=()=>({...c.pdefault(),calc:{u:400,d:500,uph:3.2,company:'u',share:100},quests:[{id:'q',start:fri,end:sun,count:100,base:10000,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}]});
const vault=()=>({'2026-11-05':entry(25000,20)});
function commit(p,date,u,d=0,v=vault()){
 let r=c.dailyPlan(v,goals(),p,fri,fri).rows.find(r=>r.date===date);p=c.dailyEdit(p,r,'u','count',u);r=c.dailyPlan(v,goals(),p,fri,fri).rows.find(r=>r.date===date);p=c.dailyEdit(p,r,'d','count',d);return c.dailyConfirm(v,goals(),p,date,fri);
}
const full=()=>commit(commit(commit(plan(),fri,20),sat,35),sun,45);
const out=(p=full(),v=vault(),today=fri)=>c.simulationOutlook(v,goals(),p,fri,today);
test('front/back/whole week landings and differences include carry once, with separate delivery and reward totals',()=>{
 const o=out(),front=o.parts[0],back=o.parts[1];assert.equal(front.total,25000);assert.equal(front.goal,30000);assert.equal(back.goal,55000);assert.equal(back.carried,5000);assert.equal(back.deliveryTotal,40000);assert.equal(back.rewardTotal,10000);assert.equal(back.total,50000);assert.equal(back.shortfall,5000);
 assert.equal(o.week.goal,80000);assert.equal(o.week.total,75000);assert.equal(o.week.shortfall,5000);assert.equal(o.week.afterConfirmedDelivery,5000);
});
test('ongoing day landing adds actual delivery to remaining company counts, rather than the full plan again',()=>{
 const v=vault();v[fri]={sets:[{u_cum:2500,u_cnt_cum:5,d_cum:1200,d_cnt_cum:2}]};const b=out(full(),v).parts[1],r=b.landings[0];assert.equal(r.actualDelivery,3700);assert.equal(r.remainingU,15);assert.equal(r.remainingD,0);assert.equal(r.remainingDelivery,6000);assert.equal(r.total,9700);assert.equal(b.total,51700);assert.equal(b.actualQuestRemaining,95);
});
test('reflected ongoing day retains remaining plan; rollover uses saved actual only',()=>{
 const v=vault();v[fri]={sets:[{u_cum:2500,u_cnt_cum:5,d_cum:1200,d_cnt_cum:2}]};let p=c.dailyApply(v,full(),fri);const o=out(p,v),b=o.parts[1];assert.equal(b.total,61200);assert.equal(b.landings[0].remainingDelivery,6000);assert.equal(b.afterConfirmedDelivery,41300);assert.equal(b.afterConfirmedUber,95);
 assert.equal(JSON.stringify(out(c.dailyApply(v,p,fri),v)),JSON.stringify(o));assert.equal(out(p,v,sat).parts[1].total,55200);
 v[fri].sets[0].u_cum=3000;v[fri].sets[0].u_cnt_cum=6;const updated=out(p,v).parts[1];assert.equal(updated.total,61300);assert.equal(updated.actualQuestRemaining,94);assert.equal(updated.afterConfirmedUber,95);
});
test('recorded and pending quest rewards partition the same budget without double counting',()=>{
 const p=full(),v=vault();v[fri]=entry(2500,5,4000);let b=out(p,v).parts[1];assert.equal(b.actualRewards,4000);assert.equal(b.forecastRewards,6000);assert.equal(b.rewardTotal,10000);const total=b.total;
 v[fri]=entry(2500,5,10000);b=out(p,v).parts[1];assert.equal(b.actualRewards,10000);assert.equal(b.forecastRewards,0);assert.equal(b.total,total);
});
test('100 Uber, confirm 20 then 35 -> next day budgets 80 then 45; Demaecan never reduces quest',()=>{
 let p=commit(plan(),fri,20,100),o=out(p),b=c.simulationDayBudget(o,sat);assert.equal(b.onwardUber,80);assert.equal(b.unassignedUber,80);assert.equal(b.otherConfirmedUber,20);
 p=commit(p,sat,35);o=out(p);b=c.simulationDayBudget(o,sun);assert.equal(b.onwardUber,45);assert.equal(b.unassignedUber,45);assert.equal(b.otherConfirmedUber,55);
});
test('daily money budget and immediate draft preview preserve other confirmations and avoid subtracting current twice',()=>{
 let p=commit(plan(),fri,20),o=out(p),b=c.simulationDayBudget(o,sat);assert.equal(b.onwardDelivery,37000);assert.equal(b.unassignedDelivery,37000);
 let r=o.plan.rows.find(r=>r.date===sat);p=c.dailyEdit(p,r,'u','count',35);r=c.dailyPlan(vault(),goals(),p,fri,fri).rows.find(r=>r.date===sat);p=c.dailyEdit(p,r,'d','count',0);o=out(p);b=c.simulationDayBudget(o,sat);assert.equal(b.afterDelivery,23000);assert.equal(b.afterUber,45);assert.equal(o.parts[1].total,50500);
 p=c.dailyConfirm(vault(),goals(),p,sat,fri);b=c.simulationDayBudget(out(p),sat);assert.equal(b.unassignedDelivery,37000);assert.equal(b.afterDelivery,23000);assert.equal(b.unassignedUber,80);assert.equal(b.afterUber,45);
});
test('later confirmed dates reserve their own budgets while editing or reconfirming an earlier day',()=>{
 const p=commit(commit(plan(),sun,30),fri,20),o=out(p),b=c.simulationDayBudget(o,sat);assert.equal(b.otherConfirmedUber,50);assert.equal(b.onwardUber,80);assert.equal(b.unassignedUber,50);assert.equal(b.laterConfirmedTarget,12000);assert.equal(b.unassignedDelivery,25000);
});
test('applied current day budget displays actual source and never subtracts its draft/confirmation again',()=>{
 const v=vault();v[fri]=entry(4000,10);const p=c.dailyApply(v,commit(plan(),fri,20),fri),o=out(p,v),b=c.simulationDayBudget(o,fri);assert.equal(b.sourceActual,true);assert.equal(b.afterDelivery,b.unassignedDelivery);assert.equal(b.afterUber,90);assert.equal(b.unassignedUber,90);
});
test('holidays, final day, all confirmed and over-target plans have bounded, explicit outlooks',()=>{
 let p=full();p.days[sat]={mode:'off',value:''};let o=out(p),b=o.parts[1];assert.equal(b.total,36000);assert.equal(b.allConfirmed,true);assert.equal(b.afterConfirmedUber,35);assert.equal(b.unallocatedUber,35);
 p=commit(plan(),fri,150);o=out(p);assert.equal(o.parts[1].excess,15000);assert.equal(o.week.excess,15000);assert.equal(c.simulationDayBudget(o,fri).afterDelivery,0);
 const v=vault();v[fri]=entry(8000,20);v[sat]=entry(14000,35);o=out(full(),v,sun);assert.equal(o.parts[1].total,50000);assert.equal(o.parts[1].actualQuestRemaining,45);assert.equal(c.simulationDayBudget(o,sun).remainingDays,0);
});
test('signed actuals, legacy week goal, missing fare and read-only JSON round-trip remain intact',()=>{
 const v=vault();v['2026-11-04']=entry(-1000);const p=plan(),g=goals(),before=JSON.stringify({p,g,v});const o=c.simulationOutlook(v,g,p,fri,fri);assert.equal(o.parts[0].actualDelivery,24000);assert.equal(JSON.stringify({p,g,v}),before);assert.equal(JSON.stringify(c.simulationOutlook(v,g,JSON.parse(JSON.stringify(p)),fri,fri)),JSON.stringify(o));
 const legacy=c.psetGoal({},fri,'week',30000),plain=c.pdefault();plain.calc.d=500;let l=c.simulationOutlook({},legacy,plain,fri,fri);assert.equal(l.parts.length,1);assert.equal(l.week.total,30000);plain.quests=plan().quests;plain.calc.u='';l=c.simulationOutlook({},legacy,plain,fri,fri);assert.equal(l.week.incompletePrices,true);
});
test('final cumulative rewards and cross-day links are claimed once across front and back forecasts',()=>{
 const p=full();p.quests.unshift({id:'front',start:'2026-11-02',end:'2026-11-05',count:40,base:2000,extra:0,adjust:0,aim:'base',finish:'n',status:'base',links:[{date:fri,amount:1000}]});const v=vault();v[fri]={sets:[{u_que_cum:1000},{u_que_cum:1500}]};
 const o=out(p,v);assert.equal(o.parts[0].forecastRewards,1000);assert.equal(o.parts[1].forecastRewards,9500);assert.equal(o.week.actualRewards,1500);assert.equal(o.week.forecastRewards,10500);assert.equal(o.week.rewardTotal,12000);assert.equal(o.week.total,77000);
});
