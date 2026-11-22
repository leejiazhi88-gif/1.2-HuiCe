'use strict';

const sources={
  faber:['Faber 十月均线','https://mebfaber.com/timing-model/'],
  momentum:['Moskowitz、Ooi、Pedersen 时序动量','https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf'],
  turtle:['Curtis Faith 原版海龟交易规则','https://www.brookstradingcourse.com/wp-content/uploads/wpforo/attachments/12514/3508-CurtisFaith-WayoftheTurtle-1.pdf'],
  rsi:['Connors 与 Alvarez 的短周期 RSI 研究','https://cmtassociation.org/wp-content/uploads/2025/08/august-2009.pdf'],
  vol:['Moreira、Muir 波动管理','https://www.nber.org/system/files/working_papers/w22208/w22208.pdf'],
  value:['Asness、Moskowitz、Pedersen 价值与动量','https://w4.stern.nyu.edu/facdir/lpederse/papers/ValMomEverywhere.pdf'],
  combine:['等权组合预测','https://www.federalreserve.gov/Pubs/feds/2012/201249/201249pap.pdf'],
};
const pct=n=>(100*n).toFixed(2)+'%';
const points=n=>n.toFixed(2)+' 点';
const fmt=(label,n,unit)=>label+' '+(unit==='%'?pct(n):points(n));
const threshold=(values,p)=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const position=(sorted.length-1)*p;
  const i=Math.floor(position);
  return sorted[i]+(position-i)*(sorted[Math.ceil(position)]-sorted[i]);
};
function mean(prices,end,count){
  let sum=0;
  for(let i=end-count+1;i<=end;i++) sum+=prices[i].value;
  return sum/count;
}
function prepare(asset){
  const {closes,peHistory,ranks}=asset;
  const rank5=new Map(peHistory.map((p,i)=>[p.date,ranks[5][i].rank]));
  const rank10=new Map(peHistory.map((p,i)=>[p.date,ranks[10][i].rank]));
  const months=[];
  const daily=[];
  let gain=0,loss=0;
  const logReturn=[];
  for(const [i,q] of closes.entries()){
    if(i>0){
      const prev=closes[i-1].value;
      const move=q.value-prev;
      gain=(gain+Math.max(move,0))/(i===1?1:2);
      loss=(loss+Math.max(-move,0))/(i===1?1:2);
      logReturn.push(Math.log(q.value/prev));
    }
    const rsi=loss>0?100*gain/(gain+loss):gain>0?100:50;
    const sma200=i>=199?mean(closes,i,200):null;
    daily.push({q,rsi,sma200});
    if(q.date.slice(0,7)!==closes[i+1]?.date.slice(0,7)){
      const sample=logReturn.slice(-21);
      const m=sample.reduce((a,b)=>a+b,0)/sample.length;
      const vol=sample.length===21?Math.sqrt(sample.reduce((a,b)=>a+(b-m)**2,0)/20*252):null;
      months.push({...q,vol});
    }
  }
  return {daily,closes,months,rank5,rank10};
}
function monthRule(data,decide){
  const flags=new Map();
  data.months.forEach((q,i)=>{
    const flag=decide(q,i,data.months);
    if(flag) flags.set(q.date,flag);
  });
  return {cadence:'month',flags};
}
const direction=(on,detail)=>({buy:on,sell:!on,detail});
const momentum=(months,q,i,n)=>i<n?null:q.value/months[i-n].value-1;
const spec=[
  {id:'faber',name:'策略4-十月均线',source:sources.faber,options:[{}],
    summary:()=> '每月底收盘达到过去 10 个月的月末收盘均线就持有，低于均线转现金。',
    rule:a=>monthRule(a,(q,i,months)=>i<9?null:direction(q.value>=mean(months,i,10),fmt('十月均线',mean(months,i,10),'点')))},
  {id:'momentum',name:'策略5-时序动量',source:sources.momentum,options:[{months:12}],
    summary:c=>'每月底看过去 '+c.months+' 个月指数涨跌。上涨则持有，下跌或持平则转现金。',
    rule:(a,c)=>monthRule(a,(q,i,months)=>{
      const m=momentum(months,q,i,c.months);
      return m===null?null:direction(m>0,fmt(c.months+' 月涨跌',m,'%'));
    })},
  {id:'channel',name:'策略6-通道突破',source:sources.turtle,options:[{entry:55,exit:20},{entry:126,exit:63},{entry:252,exit:126}],
    summary:c=>'收盘突破此前 '+c.entry+' 日收盘最高值买入，跌破此前 '+c.exit+' 日收盘最低值卖出。按日复核，采用只做多的收盘价版本。',
    rule:(a,c)=>{
      const flags=new Map();
      for(let i=c.entry;i<a.closes.length;i++){
        const q=a.closes[i];
        const high=Math.max(...a.closes.slice(i-c.entry,i).map(x=>x.value));
        const low=Math.min(...a.closes.slice(i-c.exit,i).map(x=>x.value));
        flags.set(q.date,{buy:q.value>high,sell:q.value<low,detail:'通道上沿 '+points(high)+' / 下沿 '+points(low)});
      }
      return {flags};
    }},
  {id:'reversal',name:'策略7-RSI短线回撤',source:sources.rsi,options:[5,10].flatMap(rsi=>[5,10].map(exit=>({rsi,exit}))),
    summary:c=>'收盘高于 200 日均线时，RSI(2) ≤'+c.rsi+' 买入。收盘回到 '+c.exit+' 日均线上方卖出。按日复核。',
    rule:(a,c)=>{
      const flags=new Map();
      a.daily.forEach(({q,rsi,sma200},i)=>{
        if(sma200===null) return;
        const exit=mean(a.closes,i,c.exit);
        flags.set(q.date,{buy:q.value>sma200&&rsi<=c.rsi,sell:q.value>exit,
          detail:'RSI(2) '+rsi.toFixed(2)+' / '+c.exit+' 日均线 '+points(exit)});
      });
      return {flags};
    }},
  {id:'volatility',name:'策略8-波动过滤动量',source:sources.vol,options:[{cap:.75},{cap:.9}],
    summary:c=>'月末仅在过去 12 个月上涨、且近 21 日波动率不超过此前 12 个月末波动率的第 '+Math.round(c.cap*100)+' 百分位时持有。',
    rule:(a,c)=>monthRule(a,(q,i,months)=>{
      const m=momentum(months,q,i,12);
      const past=months.slice(Math.max(0,i-12),i).map(x=>x.vol).filter(Number.isFinite);
      if(m===null||q.vol===null||past.length!==12) return null;
      const ceiling=threshold(past,c.cap);
      return direction(m>0&&q.vol<=ceiling,'12 月涨跌 '+pct(m)+' / 波动率 '+pct(q.vol)+' / 波动上限 '+pct(ceiling));
    })},
  {id:'valueMomentum',name:'策略9-价值与动量交集',source:sources.value,options:[.35,.5,.65].flatMap(value=>[6,12].map(months=>({value,months}))),
    summary:c=>'月末滚动五年 PE 分位 ≤'+Math.round(c.value*100)+'% 且过去 '+c.months+' 个月上涨时买入。PE 分位 ≥85% 或同期跌幅超过 5% 时卖出。',
    rule:(a,c)=>monthRule(a,(q,i,months)=>{
      const m=momentum(months,q,i,c.months);
      const rank=a.rank5.get(q.date);
      if(m===null||rank==null) return null;
      return {buy:rank<=c.value&&m>0,sell:rank>=.85||m<-.05,detail:'五年 PE 分位 '+pct(rank)+' / '+c.months+' 月涨跌 '+pct(m)};
    })},
  {id:'ensemble',name:'策略10-三信号投票',source:sources.combine,options:[{exit:0},{exit:1}],
    summary:c=>'月末检查三票：十年 PE 分位 ≤50%、收盘在十月均线上、过去 12 个月上涨。至少两票买入，降至 '+c.exit+' 票或更少卖出。',
    rule:(a,c)=>monthRule(a,(q,i,months)=>{
      const m=momentum(months,q,i,12);
      const rank=a.rank10.get(q.date);
      if(m===null||rank==null) return null;
      const votes=Number(rank<=.5)+Number(q.value>=mean(months,i,10))+Number(m>0);
      return {buy:votes>=2,sell:votes<=c.exit,detail:'看多票数 '+votes+' / 3'};
    })},
];
module.exports={prepare,spec};
