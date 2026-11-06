const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
test('confirmed 45,250 plus reward 7,010 stays 52,260 even with a persisted zero actual reflection',()=>{
 const date='2026-11-06';let p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};p.quests=[{id:'q',start:date,end:'2026-11-08',count:100,base:7010,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];let g=c.psetPart(c.psetPart({},date,'front',0),date,'back',51000);
 p.confirmed=Object.fromEntries([14000,14750,16500].map((target,i)=>[c.pdate(date,i),{basis:'counts',target,u:{count:25,price:target/25,uph:3.2},d:{count:0,price:500,uph:3.5}}]));
 for(const reflected of [false,true]){if(reflected)p={...p,applied:{[date]:{record:{sets:[]}}}};const o=c.simulationOutlook({},g,p,date,date);assert.equal(o.week.total,52260);assert.equal(o.week.excess,1260);assert.equal(o.parts[1].landings[0].remainingDelivery,14000);}
 const v={[date]:{sets:[{u_cum:2800,u_cnt_cum:5}]}};p={...p,applied:{[date]:{record:v[date]}}};assert.equal(c.simulationOutlook(v,g,p,date,date).week.total,52260);assert.equal(c.simulationOutlook(v,g,JSON.parse(JSON.stringify(p)),date,date).week.total,52260);
});
