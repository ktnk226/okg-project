const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const c=vm.createContext({});for(const f of ['simulation-core.js','daily-planning.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
test('entered actual releases later commitments and amounts, retaining today target, conditions, off days and stored data',()=>{
 const fri='2026-11-06',sat='2026-11-07',sun='2026-11-08';let p=c.pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};p.quests=[{id:'q',start:fri,end:sun,count:100,base:7010,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];const g=c.psetPart(c.psetPart({},fri,'front',0),fri,'back',51000);
 p.confirmed=Object.fromEntries([fri,sat,sun].map(d=>[d,{basis:'counts',target:14000,u:{count:35,price:400,uph:3.5},d:{count:0,price:500,uph:3.2},on:fri,seen:0}]));p.days[sun]={mode:'off',value:''};
 assert.equal(c.dailyPlan({},g,p,fri,fri).parts[1].rows[1].target,14000);
 const v={[fri]:{sets:[{u_cum:8000,u_cnt_cum:20,d_cnt_cum:100}]}},prior=JSON.stringify(v),stored=JSON.stringify(p),r=c.dailyPlan(v,g,p,fri,fri).parts[1];
 assert.equal(r.rows[0].target,14000);assert.equal(r.rows[1].quest,80);assert.equal(r.rows[1].target,35990);assert.equal(r.rows[1].conditions.u.uph,3.5);assert.equal(r.rows[1].locked,false);assert.equal(r.rows[2].u,0);
 assert.equal(JSON.stringify(v),prior);assert.equal(JSON.stringify(p),stored);assert.equal(JSON.stringify(c.pvalidate(JSON.parse(stored))),stored);
 // A plan confirmed on an earlier day never blocks later carry-over.
 const legacy=JSON.parse(stored);for(const d of [fri,sat,sun]){delete legacy.confirmed[d].on;delete legacy.confirmed[d].seen;}assert.equal(c.dailyPlan({},g,legacy,fri,fri).parts[1].rows[1].locked,false);
});
