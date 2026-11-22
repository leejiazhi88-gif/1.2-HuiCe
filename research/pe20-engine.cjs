'use strict';
function simulatePe(rows, finalClose, lastSignal, endExclusive, cost, rule) {
  const days=(a,b)=>(Date.parse(a)-Date.parse(b))/86400000;
  const trades=[];
  let firstEligible=null, position=null, capital=1, fullSessions=0, eligibleSessions=0, lastProcessed=null;
  let peak=1, drawdown=0, previousDate;
  const week=date=>Math.floor((Date.parse(date)/86400000+3)/7);
  function closePeriod(mark,exit) {
    const duration=days(exit?exit.date:endExclusive,position.buy.date);
    const total=mark*(exit?1-cost:1)/(position.price*(1+cost))-1;
    trades.push({buy:position.buy,sell:exit,duration,sessions:position.sessions,total});
    capital*=1+total;
    position=null;
  }
  for(const [date,open,adjOpen,signal,pe,rank,signalClose,indexOpen,adjClose] of rows) {
    const value=rule.kind==='absolute'?pe:rank;
    const trend=rule.trend?.get(signal);
    const ready=rule.kind==='trend'?trend!=null:value!=null;
    const scheduled=rule.kind!=='trend'||(signal&&week(signal)<week(date)&&(!previousDate||week(previousDate)!==week(date)));
    if(firstEligible===null&&ready&&scheduled) firstEligible=date;
    if(firstEligible!==null) eligibleSessions++;
    if(ready&&scheduled&&signal!==lastProcessed){
      const shouldBuy=trend?trend.rank<=rule.buy&&signalClose>trend.average:value<=rule.buy;
      const shouldSell=trend?trend.rank>=rule.sell||signalClose<trend.average*0.97:value>=rule.sell;
      if(position?shouldSell:shouldBuy){
        const fill={signal,pe,rank:trend?.rank??rank,date,open,signalClose,indexOpen,...(trend?{average:trend.average}:{})};
        if(position) closePeriod(adjOpen,fill);
        else position={buy:fill,price:adjOpen,sessions:0};
      }
      lastProcessed=signal;
    }
    if(position){position.sessions++;fullSessions++;}
    const nav=position?capital*adjClose/(position.price*(1+cost)):capital;
    peak=Math.max(peak,nav);
    drawdown=Math.max(drawdown,1-nav/peak);
    previousDate=date;
  }
  const currentPosition=Boolean(position);
  const lastValue=rule.kind==='absolute'?lastSignal.pe:lastSignal.rank;
  const pending=rule.kind!=='trend'&&lastSignal.date!==lastProcessed&&lastValue!=null
    &&(currentPosition?lastValue>=rule.sell:lastValue<=rule.buy)?(currentPosition?'卖出':'买入'):null;
  if(position) closePeriod(finalClose,null);
  return {
    firstEligible,eligibleDays:firstEligible===null?0:days(endExclusive,firstEligible),
    eligibleSessions,fullSessions,duration:trades.reduce((sum,t)=>sum+t.duration,0),trades,currentPosition,pending,
    total:capital-1,hold:finalClose/(rows[0][2]*(1+cost))-1,drawdown,
    annual:capital**(365.25/Math.max(1,days(endExclusive,rows[0][0])))-1,
  };
}
module.exports=simulatePe;
