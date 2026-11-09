const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.DELILOG_TEST_URL||'http://127.0.0.1:8060/delivery/log/';
const mon='2026-11-02',tue='2026-11-03',wed='2026-11-04',thu='2026-11-05',fri='2026-11-06',sun='2026-11-08';
const yen=n=>n.toLocaleString()+'円';
async function verify(page,mobile){
  await page.clock.install({time:new Date('2026-11-02T03:00:00Z')});
  if(process.env.DELILOG_TEST_ASSETS){await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({path:path.join(process.env.DELILOG_TEST_ASSETS,r.request().url().includes('/react-dom/')?'react-dom.js':r.request().url().includes('/react/')?'react.js':'babel.js'),contentType:'text/javascript'}));await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));}
  await page.goto(url);await page.getByTestId('home-target').waitFor();
  await page.evaluate(({mon,thu,fri,sun})=>{
    const p=pdefault();p.calc={u:400,d:400,uph:3,company:'u',share:100};
    const q=(id,start,end,base)=>({id,start,end,count:90,base,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[]});
    p.quests=[q('front',mon,thu,9000),q('back',fri,sun,7001)];
    localStorage.setItem('delivery_log_planning_v15',JSON.stringify(p));localStorage.setItem('delivery_log_periodic_goals_v13',JSON.stringify(psetPart(psetPart({},mon,'front',300000),mon,'back',500000)));localStorage.setItem('delivery_log_vault_v13','{}');localStorage.setItem('delivery_log_current_date_v13',mon);
  },{mon,thu,fri,sun});await page.reload();await page.locator('.sim-open').click();
  const input=(date,key)=>page.getByRole('spinbutton',{name:date+' '+(key==='u'?'Uber':'出前館')+' 計画件数（空欄で自動）',exact:true});
  const part=back=>page.locator('.period-picker').getByRole('button',{name:back?/週後半/:/週前半/}).click();
  const day=date=>page.getByTestId('day-choice-'+date).click();
  const enter=async date=>{await day(date);await input(date,'u').fill('20');await input(date,'d').fill('10');};
  const totals=async(front,back)=>{assert.equal(await page.getByTestId('front-goal').innerText(),yen(front));assert.equal(await page.getByTestId('back-effective-goal').innerText(),yen(back));assert.equal(await page.getByTestId('week-goal').innerText(),yen(front+back));};
  const home=()=>page.getByRole('button',{name:'稼働へ →',exact:true}).click();
  await totals(0,0);assert.match(await page.getByTestId('quest-unallocated-front').innerText(),/未配分 9,000円/);assert.match(await page.getByTestId('quest-unallocated-back').innerText(),/未配分 7,001円/);
  // Entering Demaecan first must not silently create a manual Uber quota.
  await day(mon);await input(mon,'d').fill('10');assert.equal(await input(mon,'u').inputValue(),'0');await input(mon,'u').fill('20');
  await enter(tue);await enter(thu);await day(wed);await page.getByRole('combobox',{name:wed+'の稼働予定',exact:true}).selectOption('off');
  await part(true);await enter(fri);await enter(sun);await totals(45000,31001);
  await part(false);await day(mon);
  assert.equal(await page.getByTestId('day-uber-delivery').innerText(),'8,000円');assert.equal(await page.getByTestId('day-demaecan-delivery').innerText(),'4,000円');assert.equal(await page.getByTestId('day-quest-allocation').innerText(),'3,000円');assert.equal(await page.getByTestId('day-sales-target').innerText(),'15,000円');
  await input(mon,'d').fill('');assert.equal(await input(mon,'u').inputValue(),'20');
  await input(mon,'d').pressSequentially('1');assert.equal(await page.getByTestId('day-sales-target').innerText(),'11,400円');assert.equal(await page.getByTestId('editing-sales-target').innerText(),'11,400円');
  await input(mon,'d').pressSequentially('5');assert.equal(await page.getByTestId('day-demaecan-delivery').innerText(),'6,000円');assert.equal(await page.getByTestId('day-sales-target').innerText(),'17,000円');assert.equal(await input(mon,'u').inputValue(),'20');await totals(47000,31001);
  const dir=process.env.DELILOG_SCREENSHOTS||'/tmp/delilog-quest-allocation';fs.mkdirSync(dir,{recursive:true});
  assert.equal(await page.getByTestId('editing-sales-target').innerText(),'17,000円');
  await page.getByTestId('allocation-'+mon).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,(mobile?'iphone':'pc')+'-breakdown.png')});
  await page.getByTestId('confirm-plan').click();await totals(47000,31001);
  assert.equal(await page.evaluate(mon=>JSON.parse(localStorage.getItem('delivery_log_planning_v15')).confirmed[mon].target,mon),14000);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('delivery_log_vault_v13'))),{});
  await home();assert.equal(await page.getByTestId('home-sales-target').innerText(),'17,000円');assert.equal(await page.getByTestId('today-delivery-actual').innerText(),'0円');assert.equal(await page.getByTestId('today-at-achievement').innerText(),'3,000円');
  assert.match(await page.locator('.quest-actual-compare').innerText(),/見込み/);
  assert.equal(await page.locator('.quest-actual-compare').evaluate(el=>{const [a,b]=[...el.children].map(x=>x.getBoundingClientRect());return a.top===b.top&&b.left>=a.right;}),true);
  const uber=page.locator('.platform-block').filter({has:page.locator('.platform-title>span').getByText('Uber Eats',{exact:true})}).first();
  const demaecan=page.locator('.platform-block').filter({has:page.locator('.platform-title>span').getByText('出前館',{exact:true})}).first();
  await uber.locator('input').nth(0).fill('8000');await uber.locator('input').nth(1).fill('20');await demaecan.locator('input').nth(0).fill('4000');await demaecan.locator('input').nth(1).fill('10');
  assert.equal(await page.getByTestId('today-delivery-actual').innerText(),'12,000円');assert.equal(await page.getByTestId('today-at-achievement').innerText(),'15,000円');
  await uber.locator('input').nth(2).fill('1000');assert.equal(await page.getByTestId('today-at-achievement').innerText(),'15,000円');
  await page.locator('.sim-open').click();await totals(47000,31001);assert.equal(await page.getByTestId('week-actual').innerText(),'13,000円');
  const vaultBeforeStatus=await page.evaluate(()=>JSON.parse(localStorage.getItem('delivery_log_vault_v13')));
  await page.locator('.quest-settings>summary').click();const questCard=page.locator('.sim-quest').filter({has:page.getByTestId('quest-progress-front')});
  await questCard.getByRole('combobox',{name:'結果の確認',exact:true}).selectOption('base');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('delivery_log_vault_v13'))),vaultBeforeStatus);
  await home();assert.match(await page.locator('.quest-actual-compare').innerText(),/達成確認済み/);await uber.locator('input').nth(2).fill('9000');
  assert.equal(await page.getByTestId('today-at-achievement').innerText(),'15,000円');
  await page.locator('.quest-actual-compare').screenshot({path:path.join(dir,(mobile?'iphone':'pc')+'-recorded-comparison.png')});
  await page.locator('.sim-open').click();assert.equal(await page.getByTestId('week-actual').innerText(),'21,000円');await totals(47000,31001);
  const pending=await page.evaluate(mon=>{const p=JSON.parse(localStorage.getItem('delivery_log_planning_v15')),v=JSON.parse(localStorage.getItem('delivery_log_vault_v13'));return dailyGoalOutlook(v,{},p,mon,mon).parts[0].questPendingAllocation;},mon);assert.equal(pending,0);
  // A one-yen reward edit stays in the front period and does not write cash.
  const settings=page.locator('.quest-settings>summary');if(!await settings.evaluate(el=>el.parentElement.open))await settings.click();
  await questCard.getByRole('spinbutton',{name:'基本達成報酬（円）',exact:true}).fill('9001');await totals(47001,31001);
  await part(false);await day(mon);assert.equal(await page.getByTestId('day-quest-allocation').innerText(),'3,001円');assert.equal(await page.getByTestId('day-sales-target').innerText(),'17,001円');
  await part(true);await day(fri);await page.getByRole('combobox',{name:fri+'の稼働予定',exact:true}).selectOption('off');await totals(47001,19001);
  await part(false);await day(thu);await page.getByTestId('delete-daily-plan').click();await totals(35001,19001);
  await day(mon);assert.equal(await page.getByTestId('day-quest-allocation').innerText(),'4,501円');await page.getByTestId('delete-daily-plan').click();await day(tue);await page.getByTestId('delete-daily-plan').click();await totals(0,19001);
  assert.match(await page.getByTestId('quest-unallocated-front').innerText(),/未配分 9,001円/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // Backup/restore must preserve only entered cash and plan inputs, not copies of shares.
  await home();await page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'設定':'⚙️ 設定・同期',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'💾 iCloudへ完全保存',exact:true}).click();
  const backup=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));assert.equal(backup.version,16);assert.equal(backup.vault[mon].sets[0].u_que_cum,'9000');assert.equal(JSON.stringify(backup.planning).includes('questAllocation'),false);
  const restored=page.waitForEvent('dialog',d=>d.message().includes('バックアップから復元しました'));
  await page.locator('#settingsCloudLoad').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await restored;
  await page.reload();await page.locator('.sim-open').click();await totals(0,19001);assert.match(await page.getByTestId('quest-unallocated-front').innerText(),/9,001円/);assert.equal(await page.getByTestId('week-actual').innerText(),'21,000円');
}
(async()=>{
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
  try{for(const mobile of [false,true]){
    const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},timezoneId:'Asia/Tokyo',acceptDownloads:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept().catch(()=>{}));
    try{await verify(page,mobile);assert.deepEqual(errors,[]);console.log('PASS '+(mobile?'iPhone emulation':'PC')+': quest allocations, 15,000 -> 17,000 during typing, manual counts, part/week sums, one-yen remainder, off/deleted/empty days, partial/full recorded rewards without double counting, confirmation and v16 restore');}finally{await context.close();}
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
