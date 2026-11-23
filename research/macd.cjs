'use strict';

const source=['Fidelity MACD 指标说明','https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/macd'];
const frequencies={day:'日线',week:'周线',month:'月线'};
const methods={signal:'DIF / DEA 金叉与死叉',zero:'DIF 上穿与下穿零轴',filtered:'零轴上金叉入场，死叉或下穿零轴离场'};
const periods=['6/13/5','12/26/9','19/39/9'];
const options=Object.keys(frequencies).flatMap(cadence=>Object.keys(methods).flatMap(method=>periods.map(period=>({cadence,method,period}))));
const week=date=>Math.floor((Date.parse(date)/86400000+3)/7);
function summary(config){
  return frequencies[config.cadence]+' MACD（'+config.period+'），'+methods[config.method]+'。收盘确认，下一可交易日开盘模拟成交。';
}
function ema(values,length){
  const output=Array(values.length).fill(null);
  if(values.length<length) return output;
  let value=values.slice(0,length).reduce((sum,x)=>sum+x,0)/length;
  output[length-1]=value;
  const weight=2/(length+1);
  for(let i=length;i<values.length;i++){
    value+=(values[i]-value)*weight;
    output[i]=value;
  }
  return output;
}
function rule(prices,config){
  const {cadence,method,period}=config;
  const key=cadence==='week'?week:q=>q.slice(0,7);
  const bars=cadence==='day'?prices:prices.filter((q,i)=>!prices[i+1]||key(q.date)!==key(prices[i+1].date));
  const [short,long,signal]=period.split('/').map(Number);
  const closes=bars.map(p=>p.value);
  const fast=ema(closes,short),slow=ema(closes,long);
  const dif=slow.slice(long-1).map((v,i)=>fast[i+long-1]-v);
  const dea=ema(dif,signal);
  const flags=new Map();
  for(let i=signal;i<dif.length;i++){
    const crossUp=dif[i]>dea[i]&&dif[i-1]<=dea[i-1];
    const crossDown=dif[i]<dea[i]&&dif[i-1]>=dea[i-1];
    const zeroUp=dif[i]>0&&dif[i-1]<=0;
    const zeroDown=dif[i]<0&&dif[i-1]>=0;
    const buy=method==='zero'?zeroUp:crossUp&&(method!=='filtered'||dif[i]>0);
    const sell=method==='zero'?zeroDown:crossDown||(method==='filtered'&&zeroDown);
    if(!buy&&!sell){
      flags.set(bars[i+long-1].date,{buy:false,sell:false});
      continue;
    }
    const event=buy?(method==='zero'?'上穿零轴':'金叉'):(method==='zero'||(method==='filtered'&&!crossDown)?'下穿零轴':'死叉');
    const detail=frequencies[cadence]+' '+event+' / DIF '+dif[i].toFixed(2)+' / DEA '+dea[i].toFixed(2);
    flags.set(bars[i+long-1].date,{buy,sell,detail});
  }
  return {flags,cadence};
}
module.exports={source,frequencies,methods,periods,options,summary,rule,week};
