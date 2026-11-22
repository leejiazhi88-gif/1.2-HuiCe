const fs = require('node:fs');
const assert = require('node:assert/strict');
const {gzipSync}=require('node:zlib');
const simulatePe = require('./pe20-engine.cjs');
const lab=require('./strategy-lab.cjs');
const longWindow = process.argv.includes('--20');
const start = longWindow ? '2006-11-21' : '2016-11-21';
const end = '2026-11-20';
const endExclusive = '2026-11-21';
const cost = 0.0005;
const absoluteResults=[];
const researchInputs=[];
const percentileRule={kind:'percentile',buy:0.2,sell:0.8};
const tuningFields=['firstEligible','eligibleDays','eligibleSessions','fullSessions','duration','total','annual','drawdown','currentPosition','pending'];
const days = (a,b) => (Date.parse(a)-Date.parse(b))/86400000;
const iso = date => date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
const files = fs.readdirSync('work');
const series = (key,code) => files.filter(f=>{
  const primary=key+'-'+code+'-';
  const extended='pe20-'+(key==='val'?'index_dailybasic':key)+'-'+code+'-';
  return f.endsWith('.json')&&(f.startsWith(primary)||(longWindow&&f.startsWith(extended)));
})
  .flatMap(f=>JSON.parse(fs.readFileSync('work/'+f,'utf8')))
  .sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
const assets = [
  ['上证50','000016.SH','510050.SH'],
  ['沪深300','000300.SH','510300.SH'],
  ['中证500','000905.SH','510500.SH'],
  ['中证1000','000852.SH','159845.SZ'],
  ['创业板指','399006.SZ','159915.SZ'],
  ['科创50','000688.SH','588000.SH'],
  ...(longWindow?[
    ['上证综指','000001.SH','510210.SH'],
    ['深证成指','399001.SZ','159903.SZ'],
    ['科创综指','000680.SH','589000.SH'],
  ]:[]),
];
function valuationRows(index){
  if(index!=='000680.SH') return series('val',index);
  const official=JSON.parse(fs.readFileSync('work/pe20-p6-star-official.json','utf8').replace(/^\uFEFF/,''));
  assert.equal(official.meta.tsCode,index);
  return official.rows.map(({date,pe})=>({trade_date:date.replaceAll('-',''),pe_ttm:pe}));
}
function quantile(sorted, fraction){
  const i=(sorted.length-1)*fraction;
  const left=Math.floor(i);
  return sorted[left]+(sorted[Math.ceil(i)]-sorted[left])*(i-left);
}
function rollingRank(history, years, minimum) {
  let left=0;
  return history.map((v,i)=>{
    const from=new Date(v.date+'T00:00:00Z');
    from.setUTCFullYear(from.getUTCFullYear()-years);
    const cutoff=from.toISOString().slice(0,10);
    while(history[left].date<cutoff) left++;
    const observations=i-left;
    let lower=0,tied=0;
    for(let j=left;j<i;j++){
      const previous=history[j].value;
      if(previous<v.value) lower++;
      if(previous===v.value) tied++;
    }
    return {rank:observations>=minimum?(lower+tied/2)/observations:null, partial:history[0].date>cutoff};
  });
}
function run([name,index,code]) {
  const factors = new Map(series('fund_adj',code).map(r=>[r.trade_date,r.adj_factor]));
  const quotes = series('fund_daily',code).filter(r=>r.open>0&&r.close>0&&iso(r.trade_date)>=start&&iso(r.trade_date)<=end).map(r=>{
    const factor=factors.get(r.trade_date);
    assert(factor>0,code+' '+r.trade_date);
    return {date:iso(r.trade_date),open:r.open,close:r.close,adjOpen:r.open*factor,adjClose:r.close*factor};
  });
  assert.equal(quotes.length,new Set(quotes.map(q=>q.date)).size);
  assert.equal(quotes.at(-1).date,end);
  const indexDays = new Map(series('index_daily',index).map(r=>[iso(r.trade_date),r]));
  const valuationByDay = new Map();
  for(const r of valuationRows(index).filter(r=>r.pe_ttm>0&&iso(r.trade_date)<=end)){
    const d=iso(r.trade_date);
    if(index==='000680.SH'&&!indexDays.has(d)) continue;
    assert(!valuationByDay.has(d)||valuationByDay.get(d).pe===r.pe_ttm,'Conflicting PE '+index+' '+d);
    valuationByDay.set(d,{date:d,pe:r.pe_ttm});
  }
  const valuations = [...valuationByDay.values()];
  assert.equal(valuations.length,new Set(valuations.map(q=>q.date)).size);
  const peHistory=valuations.map(({date,pe})=>({date,value:pe}));
  const ranks3=rollingRank(peHistory,3,240);
  const signals=valuations.map((v,i)=>({...v,rank:ranks3[i].rank}));
  const ranks10=longWindow?rollingRank(peHistory,10,240):[];
  const rankByDate=new Map(ranks10.map((r,i)=>[valuations[i].date,r]));
  const closes=[...indexDays].filter(([,row])=>row.close>0).map(([date,row])=>({date,value:row.close}));
  const closeRanks=rollingRank(closes,10,240);
  const closeRankByDate=new Map(closeRanks.map((r,i)=>[closes[i].date,r]));
  let cursor=-1;
  const rows=quotes.map(q=>{
    while(signals[cursor+1]?.date < q.date) cursor++;
    const signal=signals[cursor];
    return [q.date,q.open,q.adjOpen,signal?.date??null,signal?.pe??null,signal?.rank??null,
      indexDays.get(signal?.date)?.close,indexDays.get(q.date)?.open,q.adjClose];
  });
  const lastSignal=signals.at(-1);
  const last=quotes.at(-1);
  const result=simulatePe(rows,last.adjClose,lastSignal,endExclusive,cost,percentileRule);
  assert.equal(result.trades.reduce((sum,t)=>sum+t.sessions,0),result.fullSessions);
  assert(result.duration<=result.eligibleDays&&result.eligibleSessions<=quotes.length);
  if(longWindow){
    for(const row of rows) if(row[4]!==null) assert(row[6]>0&&row[7]>0,'Index point missing '+index+' '+row[0]);
    const sample=valuations.filter(v=>v.date>=start);
    const sorted=sample.map(v=>v.pe).sort((a,b)=>a-b);
    const buy=quantile(sorted,0.2),sell=quantile(sorted,0.8);
    assert(buy>0&&sell>buy);
    const thresholds={buy,sell,start:sample[0].date,end:sample.at(-1).date,observations:sample.length};
    const absolute=simulatePe(rows,last.adjClose,lastSignal,endExclusive,cost,{kind:'absolute',buy,sell});
    assert(absolute.duration<=absolute.eligibleDays&&absolute.eligibleSessions<=quotes.length);
    absoluteResults.push({code, thresholds, ...absolute});
    const withPriceSignal=(row,signal)=>{
      assert(signal?.value>0&&row[7]>0,'Index quote missing '+index+' '+row[0]);
      return [...row.slice(0,3),signal.date,valuationByDay.get(signal.date)?.pe??null,null,signal.value,...row.slice(7)];
    };
    let priceCursor=-1;
    const priceRows=rows.map(row=>{
      while(closes[priceCursor+1]?.date<row[0]) priceCursor++;
      return withPriceSignal(row,closes[priceCursor]);
    });
    const monthEnds=closes.filter((q,i)=>q.date.slice(0,7)!==closes[i+1]?.date.slice(0,7));
    let monthCursor=-1;
    const monthRows=rows.map(row=>{
      const currentMonth=row[0].slice(0,7);
      while(monthEnds[monthCursor+1]?.date.slice(0,7)<currentMonth) monthCursor++;
      return withPriceSignal(row,monthEnds[monthCursor]);
    });
    researchInputs.push({name,code,rows,priceRows,monthRows,lastSignal,peHistory,closes,ranks3,ranks10});
  }
  const weekly = new Map();
  for(const [date,row] of indexDays){
    if(date<start||date>end||!(row.close>0)) continue;
    const w=Math.floor((Date.parse(date)/86400000+3)/7);
    const percentile=rankByDate.get(date);
    const closePercentile=closeRankByDate.get(date);
    weekly.set(w,[date,Number(row.close.toFixed(2)),valuationByDay.get(date)?.pe??null,percentile?.rank??null,percentile?.partial??null,closePercentile?.rank??null,closePercentile?.partial??null]);
  }
  return {
    name,index,code, firstTrading:quotes[0].date,lastTrading:last.date,
    ...(index==='000680.SH'?{peHistoryNote:'科创综指采用项目 6 收录的中证指数官方滚动 PE，序列始于 '+valuations[0].date+'。'}:{}),
    availableDays:days(endExclusive,quotes[0].date),sessions:quotes.length,...result,lastSignal,weekly:[...weekly.values()]
  };
}
const result={start,end,endExclusive,cost,calendarDays:days(endExclusive,start),assets:assets.map(run)};
if(longWindow){
  const trainStart='2016-01-01', testStart='2021-08-02', trainEnd='2021-01-01';
  const lookbacks=Array.from({length:10},(_,i)=>i+1);
  const training=researchInputs.filter(a=>a.rows[0][0]<=trainStart);
  const evaluation=researchInputs.filter(a=>a.rows[0][0]<=testStart);
  for(const a of researchInputs){
    a.ranks=Object.fromEntries(lookbacks.map(years=>[
      years,years===3?a.ranks3:years===10?a.ranks10:rollingRank(a.peHistory,years,years===1?200:240)
    ]));
    a.averages=new Map([100,200].map(length=>{
      let sum=0;
      const average=new Map();
      a.closes.forEach((p,i)=>{
        sum+=p.value;
        if(i>=length) sum-=a.closes[i-length].value;
        if(i>=length-1) average.set(p.date,sum/length);
      });
      return [length,average];
    }));
  }
  function trendRule(a,c){
    const trend=new Map();
    const avg=a.averages.get(c.length);
    a.peHistory.forEach((p,i)=>{
      const rank=a.ranks[c.years][i].rank, average=avg.get(p.date);
      if(rank!=null&&average!=null) trend.set(p.date,{rank,average});
    });
    return {kind:'trend',buy:c.buy,sell:0.9,trend};
  }
  const rowsFor=(a,rule)=>rule.flags?(rule.cadence==='month'?a.monthRows:a.priceRows):a.rows;
  function evaluate(a,rule,from,until,fee=cost){
    const rows=rowsFor(a,rule).filter(r=>r[0]>=from&&r[0]<until);
    const m=simulatePe(rows,rows.at(-1)[8],a.lastSignal,until,fee,rule);
    return {annual:m.annual,drawdown:m.drawdown,holdAnnual:(1+m.hold)**(365.25/days(until,rows[0][0]))-1,
      exposure:m.fullSessions/rows.length,entries:m.trades.length};
  }
  function withLookback(a,years){
    if(years===3) return a;
    const byDate=new Map(a.peHistory.map((p,i)=>[p.date,a.ranks[years][i].rank]));
    const rows=a.rows.map(([date,open,adjOpen,signal,pe,,...prices])=>
      [date,open,adjOpen,signal,pe,byDate.get(signal)??null,...prices]);
    return {rows,lastSignal:{...a.lastSignal,rank:byDate.get(a.lastSignal.date)??null}};
  }
  const patientCandidates=[3,5,10].flatMap(years=>[0.20,0.35].flatMap(buy=>[100,200].flatMap(length=>
    [0.95,0.99].map(hardExit=>({years,buy,length,hardExit})))));
  const patientRule=(a,c)=>({...trendRule(a,c),kind:'patient',sell:0.8,hardExit:c.hardExit});
  for(const c of patientCandidates){
    c.score=training.reduce((sum,a)=>sum+evaluate(a,patientRule(a,c),trainStart,trainEnd).annual,0)/training.length;
  }
  patientCandidates.sort((a,b)=>b.score-a.score);
  const patient=patientCandidates[0];
  const prepared=new Map(researchInputs.map(a=>[a.code,lab.prepare(a)]));
  const selectedLab=lab.spec.map(spec=>{
    const candidates=spec.options.map(config=>{
      const rules=new Map(researchInputs.map(a=>[a.code,spec.rule(prepared.get(a.code),config)]));
      const score=training.reduce((sum,a)=>sum+evaluate(a,rules.get(a.code),trainStart,trainEnd).annual,0)/training.length;
      return {rules,score,summary:spec.summary(config)};
    }).sort((a,b)=>b.score-a.score);
    return {id:spec.id,name:spec.name,source:spec.source,...candidates[0],
      candidates:candidates.map(({score,summary})=>({score,summary}))};
  });
  const testAbsolute=a=>{
    const pe=a.peHistory.filter(p=>p.date>=start&&p.date<trainEnd).map(p=>p.value).sort((a,b)=>a-b);
    return pe.length>=240?{kind:'absolute',buy:quantile(pe,0.2),sell:quantile(pe,0.8)}:null;
  };
  result.strategies=[
    {id:'percentile',name:'策略1-PE分位',defaultLookback:3},
    {id:'absolute',name:'策略2-PE绝对值',summary:'各指数近二十年日度 PE 的第 20、80 百分位作固定倍数。PE ≤买入倍数时满仓，≥卖出倍数时清仓。',results:absoluteResults},
    {id:'patient',name:'策略3-低估买入、趋势卖出',lookback:patient.years,
      summary:'每周复核。滚动 '+patient.years+' 年 PE 分位 ≤'+Math.round(patient.buy*100)+'% 时满仓；分位 ≥80% 且收盘低于 '+patient.length+' 日均线时清仓，分位 ≥'+Math.round(patient.hardExit*100)+'% 时直接清仓。',
      results:researchInputs.map(a=>({code:a.code,...simulatePe(a.rows,a.rows.at(-1)[8],a.lastSignal,endExclusive,cost,patientRule(a,patient))}))},
    ...selectedLab.map(({id,name,source,summary,rules})=>({id,name,source,summary,
      results:researchInputs.map(a=>{
        const rule=rules.get(a.code), rows=rowsFor(a,rule);
        return {code:a.code,...simulatePe(rows,rows.at(-1)[8],a.lastSignal,endExclusive,cost,rule)};
      })})),
  ];
  result.study={trainStart,trainEnd,testStart,end,training:training.length,patientCandidates,patient,
    lab:selectedLab.map(({id,candidates})=>({id,candidates})),rows:evaluation.map(a=>{
    const fixed=testAbsolute(a);
    const absolute=fixed?evaluate(a,fixed,testStart,endExclusive):null;
    return {name:a.name,code:a.code,absolute,
      percentile:evaluate(a,percentileRule,testStart,endExclusive),
      patient:evaluate(a,patientRule(a,patient),testStart,endExclusive),
      ...Object.fromEntries(selectedLab.map(m=>[m.id,evaluate(a,m.rules.get(a.code),testStart,endExclusive)]))};
  })};
  const common=evaluation.filter(a=>testAbsolute(a));
  result.study.checks=[
    {label:'后段检验',from:testStart,until:endExclusive,fee:cost},
    {label:'后段检验，较高交易成本',from:testStart,until:endExclusive,fee:0.0015},
    {label:'后段前半',from:testStart,until:'2024-01-01',fee:cost},
    {label:'后段后半',from:'2024-01-01',until:endExclusive,fee:cost},
  ].map(({label,from,until,fee})=>{
    const rows=common.map(a=>[
      evaluate(a,percentileRule,from,until,fee),
      evaluate(a,testAbsolute(a),from,until,fee),
      evaluate(a,patientRule(a,patient),from,until,fee),
      ...selectedLab.map(m=>evaluate(a,m.rules.get(a.code),from,until,fee)),
    ]);
    return {label,from,through:new Date(Date.parse(until)-86400000).toISOString().slice(0,10),fee,count:rows.length,
      metrics:rows[0].map((_,i)=>Object.fromEntries(['annual','drawdown','exposure','entries'].map(key=>[
        key,rows.reduce((sum,r)=>sum+r[i][key],0)/rows.length
      ])))};
  });
  result.tuningFields=tuningFields;
  if(process.argv.includes('--tuning')){
    const dir='work/site/tuning';
    fs.mkdirSync(dir,{recursive:true});
    function sample(a,cutoff,years){
      const from=new Date(cutoff+'T00:00:00Z');
      from.setUTCFullYear(from.getUTCFullYear()-years);
      const floor=from.toISOString().slice(0,10);
      const sample=a.peHistory.filter(p=>p.date>=floor&&p.date>=start&&p.date<cutoff);
      return {
        start:sample[0]?.date,end:sample.at(-1)?.date,
        values:sample.map(p=>p.value).sort((x,y)=>x-y),
      };
    }
    for(const mode of ['percentile','absolute']) for(let years=1;years<=(mode==='percentile'?10:20);years++){
      const inputs=researchInputs.map(a=>{
        const {rows,lastSignal}=mode==='percentile'?withLookback(a,years):a;
        const heldout=rows.filter(r=>r[0]>=testStart);
        return {rows,lastSignal,heldout,fullSample:mode==='absolute'?sample(a,endExclusive,years):null,
          frozen:mode==='absolute'?sample(a,trainEnd,years):null,
          tradeIndex:new Map(),trades:[],variants:[]};
      });
      for(let buy=0;buy<100;buy+=5) for(let sell=buy+5;sell<=100;sell+=5){
        for(const input of inputs){
          const {rows,lastSignal,heldout,fullSample,frozen,tradeIndex,trades,variants}=input;
          const b=buy/100,s=sell/100;
          const rule=fullSample?{kind:mode,buy:quantile(fullSample.values,b),sell:quantile(fullSample.values,s)}
            :{kind:mode,buy:b,sell:s};
          const m=simulatePe(rows,rows.at(-1)[8],lastSignal,endExclusive,cost,rule);
          const rounds=m.trades.map(t=>{
            const key=JSON.stringify(t);
            if(!tradeIndex.has(key)){tradeIndex.set(key,trades.length);trades.push(t);}
            return tradeIndex.get(key);
          });
          let test=null;
          if(heldout.length&&(!frozen||frozen.values.length>=(years===1?200:240))){
            const heldoutRule=frozen?{kind:mode,buy:quantile(frozen.values,b),sell:quantile(frozen.values,s)}:rule;
            const metric=simulatePe(heldout,heldout.at(-1)[8],lastSignal,endExclusive,cost,heldoutRule);
            test=[metric.annual,metric.drawdown];
          }
          variants.push([tuningFields.map(k=>m[k]),rounds,test,fullSample?[rule.buy,rule.sell]:null]);
        }
      }
      const chunk=inputs.map(({lastSignal,fullSample,trades,variants})=>({
        lastSignal,trades,variants,sample:fullSample?[fullSample.start,fullSample.end,fullSample.values.length]:null,
      }));
      const packed=gzipSync(JSON.stringify(chunk),{level:9}).toString('base64');
      fs.writeFileSync(dir+'/'+mode+'-'+years+'.js','window.PE_TUNING["'+mode+'-'+years+'"]='+JSON.stringify(packed)+';\n');
    }
  }
}
const slug=longWindow?'pe20':'pe10';
fs.writeFileSync('work/site/'+slug+'-data.js','window.PE10 = '+JSON.stringify(result)+';\n');
fs.writeFileSync('work/'+slug+'.json',JSON.stringify(result,null,2));
for(const a of result.assets) console.log(a.name,a.firstTrading,a.firstEligible,a.duration,a.fullSessions,a.trades.map(t=>[t.buy.date,t.sell?.date,t.duration]),a.pending);
