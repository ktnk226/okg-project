const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js','daily-goals.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12'];
test('daily inputs remain authoritative: stale independent targets and completion flags cannot override unequal plans',()=>{
 const p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};
 dates.forEach((d,i)=>p.days[d]={mode:'amt',value:[8000,12000,16000,20000][i]});
 p.periodTargets={[dates[0]]:999999};
 const v={[dates[0]]:{actualConfirmed:true,sets:[{u_cum:5000,u_cnt_cum:12}]}};
 const before=JSON.stringify({p,v});const out=c.dailyGoalOutlook(v,{},p,dates[0],dates[1]);
 assert.deepEqual(Array.from(out.plan.rows.slice(0,4),r=>r.target),[8000,12000,16000,20000]);
 assert.equal(out.parts[0].deliveryGoal,56000);assert.equal(JSON.stringify({p,v}),before);
 p.days[dates[3]].value=22000;assert.equal(c.dailyGoalOutlook(v,{},p,dates[0],dates[1]).parts[0].deliveryGoal,58000);
 assert.equal(c.pvalidate(JSON.parse(JSON.stringify(p))).periodTargets[dates[0]],999999);
});
test('past daily plans can still be edited and confirmed without independent targets',()=>{
 const p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};p.days[dates[0]]={mode:'amt',value:8000};
 const next=c.dailyGoalConfirm({}, {},p,dates[0],dates[1]);
 assert.equal(next.confirmed[dates[0]].target,8000);assert.equal(next.periodTargets,undefined);
});
test('removed independent goal and equal distribution controls are absent',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 for(const marker of ['period-delivery-goal','rebalance-remaining','dailySetPeriodTarget','dailyPreservePeriodTargets'])assert.equal(html.includes(marker),false,marker);
 assert.match(html,/data-testid="confirm-day-actual"/);
});
