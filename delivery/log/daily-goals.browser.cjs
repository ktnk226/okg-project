const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.DELILOG_TEST_URL||'http://127.0.0.1:8060/delivery/log/';
const mon='2026-11-02',tue='2026-11-03',fri='2026-11-06',sun='2026-11-08';
const yen=n=>n.toLocaleString()+'円';
async function verify(page,mobile,oldGoal){
  await page.evaluate(({mon,oldGoal})=>{
    localStorage.clear();const p=pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};
    const g=oldGoal?psetPart(psetPart({},mon,'front',300000),mon,'back',500000):{};
    g['M-2026-11']={amt:400000};g['Y-2026']={amt:5000000};
    localStorage.setItem('delivery_log_planning_v15',JSON.stringify(p));localStorage.setItem('delivery_log_periodic_goals_v13',JSON.stringify(g));localStorage.setItem('delivery_log_current_date_v13',mon);
    localStorage.setItem('delivery_log_vault_v13',JSON.stringify({[mon]:{sets:[{u_cum:6000,u_cnt_cum:15}]}}));
  },{mon,oldGoal});
  await page.reload();await page.locator('.sim-open').click();
  const goalsBefore=await page.evaluate(()=>localStorage.getItem('delivery_log_periodic_goals_v13'));
  const totals=async(front,back)=>{
    assert.equal(await page.locator('input[data-testid="front-goal"], input[data-testid="back-goal"]').count(),0);
    assert.equal(await page.getByTestId('outlook-front').locator('.money-list dd').first().innerText(),yen(front));
    assert.equal(await page.getByTestId('back-effective-goal').innerText(),yen(back));assert.equal(await page.getByTestId('week-goal').innerText(),yen(front+back));
  };
  const input=(date,key,field='計画件数（空欄で自動）')=>page.getByRole('spinbutton',{name:date+' '+(key==='u'?'Uber':'出前館')+' '+field,exact:true});
  const day=date=>page.getByTestId('day-choice-'+date).click();
  const part=back=>page.locator('.period-picker').getByRole('button',{name:back?/週後半/:/週前半/}).click();
  const amount=async(date,value)=>{
    const editor=page.getByTestId('allocation-'+date),summary=editor.locator('summary').filter({hasText:'金額を指定して件数を逆算'});
    if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();
    await page.getByRole('spinbutton',{name:date+'の目標金額',exact:true}).fill(value);
  };
  await totals(0,0);assert.equal(await page.getByText('週の売上目標を設定',{exact:true}).count(),0);
  await day(mon);await input(mon,'u').fill('20');await totals(8000,0);assert.equal(await page.getByTestId('day-target').innerText(),'8,000円');
  await input(mon,'d').fill('10');await totals(13000,0);
  assert.equal(await page.getByTestId('front-landing').innerText(),yen(13000));
  await page.getByRole('button',{name:'稼働へ →',exact:true}).click();
  await page.getByTestId('confirm-day-actual').click();
  await page.locator('.sim-open').click();
  assert.equal(await page.getByTestId('front-landing').innerText(),yen(6000));
  await totals(13000,0);await day(mon);
  await input(mon,'u','通常単価（円）').fill('450');await totals(14000,0);
  await day(tue);await amount(tue,'1001');await totals(15001,0);assert.equal(await page.getByTestId('day-target').innerText(),'1,001円');
  await part(true);await day(fri);await input(fri,'u').fill('10');await input(fri,'d').fill('4');await totals(15001,6000);
  await input(fri,'d','通常単価（円）').fill('600');await totals(15001,6400);
  await part(false);await day(mon);await input(mon,'u').fill('10');await totals(10501,6400);
  const dir=process.env.DELILOG_SCREENSHOTS||'/tmp/delilog-daily-goals';fs.mkdirSync(dir,{recursive:true});
  await page.getByTestId('outlook-week').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,(mobile?'iphone':'pc')+'-'+(oldGoal?'old-goal':'no-goal')+'.png')});
  await page.getByTestId('delete-daily-plan').click();await totals(1001,6400);
  await day(tue);await page.getByTestId('delete-daily-plan').click();await totals(0,6400);
  await part(true);await day(fri);await amount(fri,'7001');await totals(0,7001);
  await page.getByTestId('confirm-plan').click();await totals(0,7001);
  await day(sun);await amount(sun,'2000');await page.getByTestId('confirm-plan').click();
  await amount(sun,'3000');await totals(0,10001);
  assert.equal(await page.getByTestId('back-landing').innerText(),yen(10001));
  await page.getByTestId('delete-daily-plan').click();await totals(0,7001);
  await page.reload();await page.locator('.sim-open').click();await totals(0,7001);
  await page.getByRole('button',{name:'次の期間',exact:true}).click();await totals(0,0);
  await page.getByRole('button',{name:'前の期間',exact:true}).click();await totals(0,7001);
  assert.equal(await page.evaluate(()=>localStorage.getItem('delivery_log_periodic_goals_v13')),goalsBefore);
  // Exercise v16 backup/restore after both draft deletion and confirmation.
  await page.getByRole('button',{name:'稼働へ →',exact:true}).click();
  await page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'設定':'⚙️ 設定・同期',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'💾 iCloudへ完全保存',exact:true}).click();
  const backup=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));assert.equal(backup.version,16);
  assert.equal(backup.vault[mon].actualConfirmed,true);
  await page.reload();await page.locator('.sim-open').click();await part(true);await day(fri);await page.getByTestId('delete-daily-plan').click();await totals(0,0);
  await page.getByRole('button',{name:'稼働へ →',exact:true}).click();
  await page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'設定':'⚙️ 設定・同期',exact:true}).click();
  const restored=page.waitForEvent('dialog',d=>d.message().includes('バックアップから復元しました'));
  await page.locator('#settingsCloudLoad').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await restored;
  await page.reload();await page.locator('.sim-open').click();await totals(0,7001);
  assert.equal(await page.evaluate(()=>localStorage.getItem('delivery_log_periodic_goals_v13')),goalsBefore);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
(async()=>{
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
  try{for(const mobile of [false,true]){
    const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},timezoneId:'Asia/Tokyo',acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept().catch(()=>{}));
    await page.clock.install({time:new Date('2026-11-02T03:00:00Z')});
    if(process.env.DELILOG_TEST_ASSETS){await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({path:path.join(process.env.DELILOG_TEST_ASSETS,r.request().url().includes('/react-dom/')?'react-dom.js':r.request().url().includes('/react/')?'react.js':'babel.js'),contentType:'text/javascript'}));await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));}
    try{
      await page.goto(url);await page.getByTestId('home-target').waitFor();
      for(const oldGoal of [false,true]){await verify(page,mobile,oldGoal);console.log('PASS '+(mobile?'iPhone emulation':'PC')+' '+(oldGoal?'saved old week goal':'no week goal')+': daily/part/week goals, count/fare/money edits, deletions, confirmation, week switching, reload, v16 restore');}
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
