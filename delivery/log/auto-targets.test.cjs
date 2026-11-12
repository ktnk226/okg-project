const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js','daily-goals.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12'],[mon,tue,wed,thu]=dates;
function setup(total=40000,held=false){
 const p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};
 p.days=Object.fromEntries(dates.map(date=>[date,{mode:'amt',value:total/4}]));
 if(held)p.periodTargets={[mon]:total};return p;
}
const actual=(money,done=false,reward=0)=>({actualConfirmed:done,sets:[{u_cum:money,u_cnt_cum:Math.floor(money/400),u_que_cum:reward}]});
const view=(p,v={},today=mon)=>c.dailyGoalOutlook(v,{},p,mon,today);
const rows=(p,v,today)=>view(p,v,today).plan.rows;
const target=(p,v,today,date)=>rows(p,v,today).find(r=>r.date===date).target;
const remainingTargets=(p,v,today,after)=>dates.filter(d=>d>after).map(d=>target(p,v,today,d));
test('200-hit model: completed result is subtracted and divided automatically over remaining days',()=>{
 const p=setup(200),v={[mon]:actual(20,true)};
 assert.equal(view(p,v,mon).parts[0].deliveryGoal,200);
 assert.deepEqual(remainingTargets(p,v,mon,mon),[60,60,60]);
 v[tue]=actual(30,true);assert.deepEqual(remainingTargets(p,v,tue,tue),[75,75]);
 v[wed]=actual(40,true);assert.equal(target(p,v,wed,thu),110);
 assert.equal(view(p,v,wed).parts[0].deliveryGoal,200);
});
test('three completed 8000 days produce a 16000 Thursday without edit or rebalance calls',()=>{
 const p=setup(),v=Object.fromEntries(dates.slice(0,3).map(d=>[d,actual(8000)]));
 assert.equal(target(p,v,thu,thu),16000);assert.equal(view(p,v,thu).parts[0].deliveryGoal,40000);
 assert.equal(view(p,v,thu).parts[0].part.planGap,0);
});
test('above-target results lower remaining daily targets; negative targets never appear',()=>{
 const p=setup(),v={[mon]:actual(16000,true)};
 assert.deepEqual(remainingTargets(p,v,mon,mon),[8000,8000,8000]);
 v[mon]=actual(45000,true);assert.deepEqual(remainingTargets(p,v,mon,mon),[0,0,0]);
 assert.equal(view(p,v,mon).parts[0].deliveryGoal,40000);
});
test('unfinished today actual is not a completed day or subtracted twice',()=>{
 const p=setup(),v={[mon]:actual(8000),[tue]:actual(5000)};
 const r=rows(p,v,tue).find(r=>r.date===tue);
 assert.equal(r.target,10667);assert.equal(r.remaining,5667);
 assert.equal(target(p,v,tue,wed),10667);assert.equal(target(p,v,tue,thu),10666);
});
test('same-day confirmation updates the remaining days immediately, reopening restores the current day',()=>{
 const p=setup(),v={[mon]:actual(8000,false)};
 assert.equal(target(p,v,mon,tue),10000);
 v[mon].actualConfirmed=true;assert.deepEqual(remainingTargets(p,v,mon,mon),[10667,10667,10666]);
 v[mon].actualConfirmed=false;assert.equal(target(p,v,mon,mon),10000);assert.equal(target(p,v,mon,tue),10000);
});
test('day rollover and explicit completion give the same future allocation',()=>{
 const p=setup(),v={[mon]:actual(8000,true)};
 const atNight=remainingTargets(p,v,mon,mon);v[mon].actualConfirmed=false;
 assert.deepEqual(remainingTargets(p,v,tue,mon),atNight);
});
test('off and unplanned days do not receive allocation; held budget survives the reduced day count',()=>{
 const p=setup(40000,true),v={[mon]:actual(8000,true)};
 p.days[wed]={mode:'off',value:''};delete p.days[thu];
 assert.equal(target(p,v,mon,tue),32000);assert.equal(target(p,v,mon,wed),0);assert.equal(target(p,v,mon,thu),0);
 assert.equal(view(p,v,mon).parts[0].deliveryGoal,40000);
});
test('no remaining working day leaves the deficit visible and preserves all actuals',()=>{
 const p=setup(40000,true),v=Object.fromEntries(dates.map(d=>[d,actual(8000,true)]));
 const o=view(p,v,thu);assert.equal(o.parts[0].deliveryGoal,40000);assert.equal(o.parts[0].actualDelivery,32000);assert.equal(o.parts[0].part.planGap,8000);
});
test('read-time automatic targets never mutate the baseline plans or accounting records',()=>{
 const p=setup(),v={[mon]:actual(8000,true)};const before=JSON.stringify({p,v});
 for(let i=0;i<3;i++)view(p,v,mon);
 assert.equal(JSON.stringify({p,v}),before);
 const restored=c.pvalidate(JSON.parse(JSON.stringify(p)));assert.deepEqual(remainingTargets(restored,JSON.parse(JSON.stringify(v)),mon,mon),[10667,10667,10666]);
});
test('reconfirming an automatically adjusted future plan does not inflate the period budget',()=>{
 let p=setup(),v={[mon]:actual(8000,true)};
 assert.equal(target(p,v,mon,tue),10667);
 p=c.dailyGoalConfirm(v,{},p,tue,mon);assert.equal(view(p,v,mon).parts[0].deliveryGoal,40000);
 p=c.dailyGoalConfirm(v,{},p,wed,mon);assert.equal(view(p,v,mon).parts[0].deliveryGoal,40000);
 p=c.pvalidate(JSON.parse(JSON.stringify(p)));assert.equal(view(p,v,tue).parts[0].deliveryGoal,40000);
});
test('quest amounts and recorded rewards do not get subtracted from delivery targets twice',()=>{
 const p=setup(),v={[mon]:actual(8000,true,3000)};
 p.quests=[{id:'q',start:mon,end:thu,count:80,base:9000,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];
 const o=view(p,v,mon);assert.equal(o.parts[0].deliveryGoal,40000);assert.equal(o.parts[0].goal,49000);assert.equal(o.parts[0].actual,11000);assert.equal(o.parts[0].forecastRewards,6000);
 assert.deepEqual(remainingTargets(p,v,mon,mon),[10667,10667,10666]);
 assert.equal(o.plan.rows.find(r=>r.date===tue).salesTarget,12917);
 v['2026-11-08']=actual(0,true,6000);p.quests[0].links=[{date:'2026-11-08',amount:6000}];
 assert.equal(view(p,v,mon).parts[0].forecastRewards,0);assert.deepEqual(remainingTargets(p,v,mon,mon),[10667,10667,10666]);
});
test('late correction of a completed result updates all remaining daily targets automatically',()=>{
 const p=setup(),v={[mon]:actual(8000,true),[tue]:actual(8000,true)};
 assert.deepEqual(remainingTargets(p,v,tue,tue),[12000,12000]);
 v[mon]=actual(12000,true);assert.deepEqual(remainingTargets(p,v,tue,tue),[10000,10000]);
});
test('another company actual revenue reduces additional count requirements after auto allocation',()=>{
 const p=setup(),v=Object.fromEntries(dates.slice(0,3).map(d=>[d,actual(8000)]));v[thu]=actual(5000);
 const r=rows(p,v,thu).find(r=>r.date===thu);assert.equal(r.target,16000);assert.equal(r.remaining,11000);assert.equal(r.remainingU,0);assert.equal(r.remainingD,22);
});
