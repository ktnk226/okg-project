// Read-only views of actuals, committed allocation budgets, and live plan landings.
// This module never writes records, goals, confirmations, or allocation snapshots.
function simulationQuestTarget(q) {return q.aim==='n'||q.status==='miss'?0:pn(q.count)+(q.aim==='extra'?10:0);}
function simulationQuota(q,rows) {return rows.filter(r=>r.date>=q.start&&r.date<=q.end).reduce((n,r)=>n+r.u,0);}
function simulationLanding(row,vault,today,applied) {
  const actual=pday(vault,row.date),usePlan=row.eligible;
  const remainingU=usePlan?Math.max(0,row.u-actual.u.cnt):0,remainingD=usePlan?Math.max(0,row.d-actual.d.cnt):0;
  const remainingDelivery=remainingU*row.conditions.u.price+remainingD*row.conditions.d.price;
  return {date:row.date,actualDelivery:actual.real,actualRewards:actual.que,actual:actual.total,remainingU,remainingD,remainingDelivery,total:actual.total+remainingDelivery,actualOnly:!usePlan,incompletePrices:remainingU>0&&!row.conditions.u.price||remainingD>0&&!row.conditions.d.price};
}
function simulationOutlook(vault,goals,p,date,today) {
  const plan=dailyPlan(vault,goals,p,date,today),committed=dailyPlan(vault,goals,p,date,today,false);
  const allocationVault=Object.fromEntries(Object.entries(vault).filter(([d])=>d<today));
  if(p.applied?.[today])allocationVault[today]=p.applied[today].record;
  const parts=plan.parts.map((part,index)=>{
    const basePart=committed.parts[index],basis=basePart.reflected||basePart;
    const active=basis.rows.filter(r=>r.eligible),fixed=active.filter(r=>r.confirmed);
    const quests=basis.w.quests.map(({q})=>({q,remaining:Math.max(0,simulationQuestTarget(q)-pprogress(allocationVault,q,today)),actualRemaining:Math.max(0,simulationQuestTarget(q)-pprogress(vault,q,today))}));
    const landings=part.rows.map(r=>simulationLanding(r,vault,today,!!p.applied?.[today]));
    const sum=k=>landings.reduce((n,r)=>n+r[k],0);
    const actual=sum('actual'),actualDelivery=sum('actualDelivery'),actualRewards=sum('actualRewards'),futureDelivery=sum('remainingDelivery'),forecastRewards=part.pendingRewards;
    const total=actual+futureDelivery+forecastRewards,goal=part.w.goal;
    const confirmedTarget=fixed.reduce((n,r)=>n+r.target,0),confirmedUber=fixed.reduce((n,r)=>n+r.u,0);
    const afterConfirmedDelivery=Math.max(0,basis.delivery-confirmedTarget);
    const afterConfirmedUber=quests.reduce((n,{q,remaining})=>n+Math.max(0,remaining-simulationQuota(q,fixed)),0);
    return {part,basePart,basis,active,fixed,quests,landings,goal,configuredGoal:part.configuredGoal,carried:part.carried,actual,actualDelivery,actualRewards,futureDelivery,forecastRewards,total,deliveryTotal:actualDelivery+futureDelivery,rewardTotal:actualRewards+forecastRewards,shortfall:Math.max(0,goal-total),excess:Math.max(0,total-goal),actualRemaining:Math.max(0,goal-actual),actualQuestRemaining:quests.reduce((n,q)=>n+q.actualRemaining,0),confirmedTarget,confirmedUber,afterConfirmedDelivery,afterConfirmedUber,incompletePrices:landings.some(r=>r.incompletePrices),allConfirmed:active.length>0&&active.every(r=>r.confirmed),unallocatedDelivery:basis.shortfall,unallocatedUber:basis.unallocatedUber};
  });
  const sum=k=>parts.reduce((n,r)=>n+r[k],0),goal=pgoal(goals,date,'week'),total=sum('total'),actual=sum('actual');
  const week={goal,total,actual,actualDelivery:sum('actualDelivery'),actualRewards:sum('actualRewards'),futureDelivery:sum('futureDelivery'),forecastRewards:sum('forecastRewards'),deliveryTotal:sum('deliveryTotal'),rewardTotal:sum('rewardTotal'),shortfall:Math.max(0,goal-total),excess:Math.max(0,total-goal),actualRemaining:Math.max(0,goal-actual),actualQuestRemaining:sum('actualQuestRemaining'),confirmedTarget:sum('confirmedTarget'),afterConfirmedDelivery:Math.max(0,goal-parts.reduce((n,r)=>n+r.basis.w.actual+r.basis.w.forecast+r.confirmedTarget,0)),afterConfirmedUber:sum('afterConfirmedUber'),incompletePrices:parts.some(r=>r.incompletePrices)};
  return {plan,committed,parts,week,today};
}
function simulationDayBudget(outlook,date) {
  const period=outlook.parts.find(x=>date>=x.part.w.start&&date<=x.part.w.end),row=period.part.rows.find(r=>r.date===date);
  const before=period.active.filter(r=>r.date<date),laterFixed=period.fixed.filter(r=>r.date>date),otherFixed=period.fixed.filter(r=>r.date!==date);
  const sourceActual=date===outlook.today&&!!outlook.plan.applied;
  const beforeTarget=before.reduce((n,r)=>n+r.target,0),beforeProvisional=before.filter(r=>!r.confirmed).reduce((n,r)=>n+r.target,0);
  const onwardDelivery=Math.max(0,period.basis.delivery-beforeTarget),laterConfirmedTarget=laterFixed.reduce((n,r)=>n+r.target,0);
  const unassignedDelivery=Math.max(0,onwardDelivery-laterConfirmedTarget),useRow=row.eligible&&!sourceActual;
  const afterDelivery=Math.max(0,unassignedDelivery-(useRow?row.target:0));
  let onwardUber=0,unassignedUber=0,afterUber=0;
  for(const {q,remaining} of period.quests){
    const onward=Math.max(0,remaining-simulationQuota(q,before));
    const unassigned=Math.max(0,onward-simulationQuota(q,laterFixed));
    const current=useRow&&date>=q.start&&date<=q.end?row.u:0;
    onwardUber+=onward;unassignedUber+=unassigned;afterUber+=Math.max(0,unassigned-current);
  }
  return {onwardDelivery,onwardUber,otherConfirmedTarget:otherFixed.reduce((n,r)=>n+r.target,0),otherConfirmedUber:otherFixed.reduce((n,r)=>n+r.u,0),laterConfirmedTarget,unassignedDelivery,unassignedUber,afterDelivery,afterUber,excess:Math.max(0,(useRow?row.target:0)-unassignedDelivery),remainingDays:period.active.filter(r=>r.date>date&&!r.confirmed).length,beforeTarget,beforeProvisional,sourceActual};
}
