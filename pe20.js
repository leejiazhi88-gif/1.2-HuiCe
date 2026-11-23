'use strict';
(() => {
  const {assets,strategies,study,start,end,endExclusive,tuningFields}=window.PE10;
  const get=id=>document.getElementById(id);
  const controls=document.querySelector('.strategy-bar');
  new ResizeObserver(()=>{
    const height=controls.getBoundingClientRect().height;
    document.documentElement.style.scrollPaddingTop=Math.ceil(height+16)+'px';
  }).observe(controls);
  const moduleButtons=new Map([...document.querySelectorAll('.module-controls button')].map(b=>[b.getAttribute('aria-controls'),b]));
  function showPanel(id,open){
    const button=moduleButtons.get(id);
    if(!button) return;
    get(id).hidden=!open;
    button.setAttribute('aria-expanded',String(open));
    if(open) window.dispatchEvent(new CustomEvent('pe-panel-opened',{detail:id}));
  }
  for(const [id,button] of moduleButtons) button.addEventListener('click',()=>showPanel(id,get(id).hidden));
  window.addEventListener('pe-open-panel',e=>showPanel(e.detail,true));
  function followPanelHash(){
    const id=location.hash.slice(1);
    if(!moduleButtons.has(id)) return;
    showPanel(id,true);
    get(id).scrollIntoView();
  }
  window.addEventListener('hashchange',followPanelHash);
  const select=get('chartAsset');
  const range=get('chartRange');
  const strategySelect=get('strategySelect');
  strategySelect.innerHTML=strategies.map(s=>'<option value="'+s.id+'">'+s.name+'</option>').join('');
  let strategy=strategies[0], active=assets;
  const lookback=get('lookbackYears'), buySlider=get('buyPercent'), sellSlider=get('sellPercent');
  const sliders=[
    {input:lookback,field:'years',output:get('lookbackValue'),unit:' 年'},
    {input:buySlider,field:'buy',output:get('buyValue'),unit:'%'},
    {input:sellSlider,field:'sell',output:get('sellValue'),unit:'%'},
  ].map(slider=>({...slider,buttons:[...slider.input.parentElement.querySelectorAll('button')]}));
  const defaults={percentile:strategies[0].defaultConfig,absolute:strategies[1].defaultConfig};
  const macdStrategy=strategies.find(s=>s.id==='macd');
  const macdSelects={cadence:get('macdCadence'),method:get('macdMethod'),period:get('macdPeriod')};
  for(const [field,options] of Object.entries({cadence:macdStrategy.frequencies,method:macdStrategy.methods,period:Object.fromEntries(macdStrategy.periods.map(x=>[x,x]))})){
    macdSelects[field].innerHTML=Object.entries(options).map(([value,name])=>'<option value="'+value+'">'+name+'</option>').join('');
  }
  let macdSelection=macdStrategy.defaultIndex;
  let macdApplied={index:macdSelection,summary:macdStrategy.summary,results:macdStrategy.results};
  const settings=structuredClone(defaults);
  const applied={
    percentile:{config:defaults.percentile,assets},
    absolute:{config:defaults.absolute,assets:assets.map((a,i)=>({...a,...strategies[1].results[i]}))},
  };
  window.PE_TUNING={};
  const downloads=new Map();
  let request=0;
  const status=message=>{get('tuneStatus').textContent=message;};
  const equal=(a,b)=>a.years===b.years&&a.buy===b.buy&&a.sell===b.sell;
  function loadTuning(key){
    if(!downloads.has(key)){
      downloads.set(key,new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='tuning/'+key+'.js?v=6';
        script.onload=async()=>{
          script.remove();
          try{
            const bytes=Uint8Array.from(atob(window.PE_TUNING[key]),c=>c.charCodeAt(0));
            delete window.PE_TUNING[key];
            const data=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
            resolve(data);
          }catch(error){
            downloads.delete(key);
            reject(error);
          }
        };
        script.onerror=()=>{script.remove();downloads.delete(key);reject(new Error(key));};
        document.head.appendChild(script);
      }));
      if(downloads.size>4) downloads.delete(downloads.keys().next().value);
    }
    return downloads.get(key);
  }
  function showControls(){
    const config=settings[strategy.id];
    get('lookbackControl').hidden=!config;
    get('macdControl').hidden=strategy.id!=='macd';
    if(strategy.id==='macd'){
      const macdConfig=macdStrategy.options[macdSelection];
      for(const [field,input] of Object.entries(macdSelects)) input.value=macdConfig[field];
    }
    if(!config) return;
    const max=strategy.id==='absolute'?20:10;
    get('lookbackLabel').textContent=strategy.id==='absolute'?'PE 取样期':'PE 回看期';
    lookback.max=String(max);
    lookback.value=config.years;
    buySlider.value=config.buy;
    sellSlider.value=config.sell;
    showSliderValues(config);
  }
  function showSliderValues(config){
    for(const {input,field,output,unit,buttons} of sliders){
      const value=config[field];
      output.value=value+unit;
      input.setAttribute('aria-valuetext',output.value);
      const min=field==='sell'?config.buy+5:Number(input.min);
      const max=field==='buy'?config.sell-5:Number(input.max);
      buttons[0].disabled=value<=min;
      buttons[1].disabled=value>=max;
    }
  }
  function readSliders(changed){
    const config={years:Number(lookback.value),buy:Number(buySlider.value),sell:Number(sellSlider.value)};
    if(config.buy>=config.sell){
      if(changed===buySlider) config.buy=config.sell-5;
      else config.sell=config.buy+5;
    }
    return config;
  }
  function commitSliders(changed){
    settings[strategy.id]=readSliders(changed);
    showControls();
    applyTuning();
  }
  function showResults(){
    const selected=applied[strategy.id];
    const results=strategy.id==='macd'?macdApplied.results:strategy.results;
    active=selected?selected.assets:assets.map((a,i)=>({...a,...results[i]}));
    const config=selected?.config;
    const name=config?strategy.name+'（'+config.years+'年 '+config.buy+'% / '+config.sell+'%）'
      :strategy.id==='macd'?strategy.name+'（'+macdLabel()+'）':strategy.name;
    picked=0;
    window.dispatchEvent(new CustomEvent('pe-strategy-change',{detail:{assets:active,strategy:{id:strategy.id,name}}}));
    renderStudy();
    render();
  }
  function macdLabel(){
    const config=macdStrategy.options[macdApplied.index];
    return macdStrategy.frequencies[config.cadence]+' · '+config.period+' · '+macdStrategy.methods[config.method];
  }
  async function applyMacd(){
    const index=macdSelection, revision=++request;
    if(index===macdApplied.index){status('');return;}
    if(index===macdStrategy.defaultIndex){
      macdApplied={index,summary:macdStrategy.summary,results:macdStrategy.results};
      status('');
      showResults();
      return;
    }
    status('正在载入 MACD 回测结果…');
    try{
      const variants=await loadTuning('macd');
      if(revision!==request) return;
      const variant=variants[index];
      macdApplied={index,summary:variant.summary,results:variant.results,test:new Map(variant.test)};
      status('');
      showResults();
    }catch{
      if(revision!==request) return;
      macdSelection=macdApplied.index;
      showControls();
      status('载入失败，已保留上一次的 MACD 结果。请再选一次。');
    }
  }
  for(const input of Object.values(macdSelects)) input.addEventListener('change',()=>{
    macdSelection=macdStrategy.options.findIndex(config=>Object.entries(macdSelects).every(([field,element])=>config[field]===element.value));
    applyMacd();
  });
  async function applyTuning(){
    const mode=strategy.id, config=settings[mode], revision=++request;
    if(!config||equal(config,applied[mode].config)){status('');return;}
    status('正在载入回测结果…');
    try{
      const chunk=await loadTuning(mode+'-'+config.years);
      if(revision!==request) return;
      const buy=config.buy/5, sell=config.sell/5;
      const offset=buy*(41-buy)/2+sell-buy-1;
      const test=[];
      const next=assets.map((a,i)=>{
        const source=chunk[i];
        const [metrics,rounds,studyResult,pe]=source.variants[offset];
        test.push(studyResult?{annual:studyResult[0],drawdown:studyResult[1]}:null);
        const thresholds=pe?{buy:pe[0],sell:pe[1],start:source.sample[0],end:source.sample[1],observations:source.sample[2]}:undefined;
        return {...a,...Object.fromEntries(tuningFields.map((field,j)=>[field,metrics[j]])),
          trades:rounds.map(j=>source.trades[j]),lastSignal:source.lastSignal,thresholds};
      });
      applied[mode]={config,assets:next,test};
      status('');
      showResults();
    }catch{
      if(revision!==request) return;
      settings[mode]=applied[mode].config;
      showControls();
      status('载入失败，已保留上一次的结果。请再调一次。');
    }
  }
  for(const {input,field,buttons} of sliders){
    input.addEventListener('input',()=>showSliderValues(readSliders(input)));
    input.addEventListener('change',()=>commitSliders(input));
    buttons.forEach(button=>button.addEventListener('click',()=>{
      const value=readSliders(input)[field];
      input.value=value+Number(button.dataset.step)*Number(input.step);
      commitSliders(input);
    }));
  }
  const canvases=[get('pointsChart'),get('peChart'),get('rankChart'),get('closeRankChart')];
  const columns=[1,2,3,5];
  const fmt=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  select.innerHTML=assets.map((a,i)=>'<option value="'+i+'">'+a.name+' · '+a.code.split('.')[0]+'</option>').join('');
  const asset=()=>active[Number(select.value)];
  const markers=()=>asset().trades.flatMap((t,i)=>[
    {trade:t.buy,buy:true,round:i},...(t.sell?[{trade:t.sell,buy:false,round:i}]:[])
  ]);
  const tag=m=>m.buy?'买':'卖';
  const paint=m=>m.buy?'#79d8b0':'#f59a93';
  let picked=0;
  let begin=start, visible=[], cursor=0, frame;
  const hitPoints=[];
  const timeScale=[];
  function draw(canvas,plot){
    const metric=columns[plot];
    const ctx=canvas.getContext('2d'), a=asset(), sigs=markers();
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h) return;
    const dpr=window.devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
    const t0=Date.parse(begin),t1=Date.parse(endExclusive);
    const left=56,right=w-14,top=14,bottom=h-30;
    const x=d=>left+(Date.parse(d)-t0)/(t1-t0)*(right-left);
    timeScale[plot]=px=>t0+(px-left)/(right-left)*(t1-t0);
    const rankPlot=metric>=3;
    const values=visible.map(r=>r[metric]).filter(Number.isFinite);
    const markerValue=m=>metric===1?m.trade.signalClose:m.trade.pe;
    const plotted=sigs.map(markerValue).filter(Number.isFinite);
    const lo=rankPlot?0:Math.max(0,Math.min(...values,...plotted)*.91);
    const hi=rankPlot?1:Math.max(...values,...plotted)*1.12;
    const y=n=>bottom-(n-lo)/(hi-lo)*(bottom-top);
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    ctx.fillStyle='#293135';
    if(a.firstEligible>begin) ctx.fillRect(left,top,x(a.firstEligible)-left,bottom-top);
    ctx.fillStyle='#25443c';
    for(const t of a.trades) ctx.fillRect(x(t.buy.date),top,x(t.sell?.date||endExclusive)-x(t.buy.date),bottom-top);
    ctx.restore();
    ctx.font='11px system-ui';
    ctx.fillStyle='#a6baba';ctx.strokeStyle='#3b4c51';ctx.textAlign='right';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const n=lo+(hi-lo)*i/4, yy=y(n);
      ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
      ctx.fillText(rankPlot?Math.round(n*100)+'%':Math.round(n).toLocaleString('zh-CN'),left-7,yy+4);
    }
    if(metric===2&&a.thresholds){
      ctx.setLineDash([5,4]);
      for(const [value,color] of [[a.thresholds.buy,'#79d8b0'],[a.thresholds.sell,'#f59a93']]){
        if(value<lo||value>hi) continue;
        const yy=y(value);
        ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const startYear=Number(begin.slice(0,4));
    const endYear=Number(end.slice(0,4));
    const increment=Math.ceil((endYear-startYear+1)/(w<600?4:8));
    ctx.textAlign='center';
    for(let yr=startYear;yr<=endYear;yr+=increment) {
      const d=yr===startYear?begin:yr+'-01-01';
      ctx.fillText(String(yr),x(d),bottom+18);
    }
    const lineColor=['#f2c773','#8fc4d7','#bbabec','#e9b287'][plot];
    ctx.strokeStyle=lineColor;ctx.lineWidth=1.45;
    for(const partial of rankPlot?[true,false]:[false]){
      ctx.setLineDash(partial?[4,3]:[]);
      ctx.beginPath();
      let previous, penDown=false;
      for(const r of visible){
        if(previous&&Number.isFinite(r[metric])&&(!rankPlot||r[metric+1]===partial)){
          if(!penDown) ctx.moveTo(x(previous[0]),y(previous[metric]));
          ctx.lineTo(x(r[0]),y(r[metric]));
          penDown=true;
        } else penDown=false;
        previous=Number.isFinite(r[metric])?r:undefined;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const points=(rankPlot?[]:sigs).flatMap((m,i)=>{
      if(!Number.isFinite(markerValue(m))) return [];
      const px=x(m.trade.signal),py=y(markerValue(m));
      ctx.beginPath();
      if(m.buy) ctx.arc(px,py,5,0,2*Math.PI);
      else {ctx.moveTo(px,py-6);ctx.lineTo(px+6,py);ctx.lineTo(px,py+6);ctx.lineTo(px-6,py);ctx.closePath();}
      ctx.fillStyle=paint(m);ctx.fill();
      ctx.strokeStyle=i===picked?'#fff4d4':'#132125';ctx.lineWidth=i===picked?2.5:1;ctx.stroke();
      return [{px,py,index:i}];
    });
    hitPoints[plot]=points;
    const row=visible[cursor];
    if(!row) return;
    const xx=x(row[0]);
    ctx.strokeStyle='#becbcb';ctx.lineWidth=1;
    ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();ctx.setLineDash([]);
    if(Number.isFinite(row[metric])){
      ctx.fillStyle=lineColor;ctx.beginPath();ctx.arc(xx,y(row[metric]),3.6,0,2*Math.PI);ctx.fill();
    }
  }
  function renderCursor(){
    const [date,points,pe,rank,partial,closeRank,closePartial]=visible[cursor];
    const time=get('cursorDate');
    time.dateTime=date;time.textContent=date;
    get('cursorPoints').textContent=fmt.format(points)+' 点';
    get('cursorPe').textContent=pe===null?'暂无数据':fmt.format(pe)+' 倍';
    const rankText=(value,short)=>value===null?'样本不足':fmt.format(value*100)+'%'+(short?'（历史不足十年）':'');
    get('cursorRank').textContent=rankText(rank,partial);
    get('cursorCloseRank').textContent=rankText(closeRank,closePartial);
    canvases.forEach(draw);
  }
  function setCursor(i){
    if(i===cursor) return;
    cursor=i;
    renderCursor();
  }
  function moveCursor(canvas,px){
    if(!timeScale[canvas]) return;
    const time=timeScale[canvas](px);
    let start=0,end=visible.length-1;
    while(start<end){
      const mid=Math.floor((start+end)/2);
      if(Date.parse(visible[mid][0])<time) start=mid+1;
      else end=mid;
    }
    const earlier=start>0&&time-Date.parse(visible[start-1][0])<Date.parse(visible[start][0])-time;
    setCursor(earlier?start-1:start);
  }
  function renderMarkers(){
    const list=markers(), m=list[picked];
    get('markerChoices').innerHTML=list.map((s,i)=>'<button type="button" data-marker="'+i+'" aria-pressed="'+(i===picked)+'">'+tag(s)+' '+s.trade.signal+'</button>').join('');
    if(m){
      const t=m.trade;
      const key=asset().code.split('.')[0]+'-'+m.round;
      const context=t.average?' · '+strategy.lookback+' 年分位 '+fmt.format(t.rank*100)+'% · 均线 '+fmt.format(t.average)+' 点'
        :strategy.id==='percentile'?' · '+applied.percentile.config.years+' 年分位 '+fmt.format(t.rank*100)+'%'
        :t.detail?' · '+t.detail:'';
      get('markerInfo').innerHTML='<strong style="color:'+paint(m)+'">'+(m.buy?'买入':'卖出')+'信号 '+t.signal+'</strong> · 指数收盘 '+fmt.format(t.signalClose)+' 点 · PE '+(t.pe==null?'暂无':fmt.format(t.pe)+' 倍')+context+'<br>成交 '+t.date+' · 指数开盘 '+fmt.format(t.indexOpen)+' 点 · ETF 开盘 '+t.open.toFixed(3)+' 元 · <a href="#trades" data-trade="'+key+'">查看本轮明细</a>';
    } else {
      get('markerInfo').textContent='该 ETF 在可执行区间内没有成交记录。';
    }
  }
  function selectMarker(index){
    picked=index;
    renderMarkers();
    canvases.forEach(draw);
  }
  function render(){
    cancelAnimationFrame(frame);
    const a=asset(), firstSignal=markers()[0]?.trade.signal;
    const note=get('peHistoryNote');
    note.textContent=a.peHistoryNote||'';
    note.hidden=!a.peHistoryNote;
    const config=applied[strategy.id]?.config;
    get('strategySummary').textContent=strategy.id==='percentile'?'滚动 '+config.years+' 年 PE 分位 ≤'+config.buy+'% 满仓买入，≥'+config.sell+'% 清仓。'
      :strategy.id==='absolute'?'用近 '+config.years+' 年日度 PE 的第 '+config.buy+'、'+config.sell+' 百分位定倍数。低于或等于买入倍数时满仓，高于或等于卖出倍数时清仓。'
      :strategy.id==='macd'?macdApplied.summary:strategy.summary;
    const t=a.thresholds;
    get('strategyDetail').textContent=t?a.name+' · PE ≤ '+fmt.format(t.buy)+' 倍买入，≥ '+fmt.format(t.sell)+' 倍卖出。样本 '+t.start+' 至 '+t.end+'（'+t.observations+' 日）。固定阈值使用全样本，含回测时点之后的数据。'
      :strategy.id==='patient'?'按九只 ETF 全窗口平均年化，从 24 个候选中选出。'
      :strategy.id==='macd'?'DIF 为快 EMA 减慢 EMA，DEA 为 DIF 的 EMA。'
      :strategy.id==='percentile'?'分位每天按当时可得的历史重新计算。':'';
    const source=get('strategySource');
    source.hidden=!strategy.source;
    if(strategy.source){source.textContent=strategy.source[0];source.href=strategy.source[1];}
    begin=range.value==='active'&&a.firstEligible?(firstSignal<a.firstEligible?firstSignal:a.firstEligible):start;
    visible=a.weekly.filter(r=>r[0]>=begin);
    cursor=visible.length-1;
    renderMarkers();
    renderCursor();
  }
  select.addEventListener('change',()=>{picked=0;render();});
  strategySelect.addEventListener('change',()=>{
    strategy=strategies.find(s=>s.id===strategySelect.value);
    showControls();
    showResults();
    if(strategy.id==='macd') applyMacd();
    else applyTuning();
  });
  range.addEventListener('change',render);
  get('markerChoices').addEventListener('click',e=>{
    const btn=e.target.closest('button');
    if(!btn) return;
    selectMarker(Number(btn.dataset.marker));
    get('markerChoices').children[picked].focus({preventScroll:true});
  });
  get('markerInfo').addEventListener('click',e=>{
    const link=e.target.closest('[data-trade]');
    if(!link) return;
    e.preventDefault();
    const key=link.dataset.trade;
    const filter=get('filter');
    filter.value=key.split('-')[0];
    showPanel('trades',true);
    filter.dispatchEvent(new Event('change'));
    const row=get('trade-'+key);
    row.classList.add('trade-highlight');
    row.focus({preventScroll:true});
    row.scrollIntoView({block:'center'});
  });
  canvases.forEach((c,i)=>{
    c.addEventListener('pointermove',e=>{
      const x=e.offsetX;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>moveCursor(i,x));
    });
    c.addEventListener('pointerleave',e=>{
      if(e.pointerType==='touch') return;
      cancelAnimationFrame(frame);
      setCursor(visible.length-1);
    });
    c.addEventListener('keydown',e=>{
      if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight') return;
      e.preventDefault();
      setCursor(Math.min(visible.length-1,Math.max(0,cursor+(e.key==='ArrowLeft'?-1:1))));
    });
    c.addEventListener('click',e=>{
      moveCursor(i,e.offsetX);
      let closest=15,index=-1;
      hitPoints[i].forEach(p=>{
        const delta=Math.hypot(e.offsetX-p.px,e.offsetY-p.py);
        if(delta<closest){closest=delta;index=p.index;}
      });
      if(index>=0) selectMarker(index);
    });
    new ResizeObserver(()=>draw(c,i)).observe(c);
  });
  const percentage=x=>fmt.format(x*100)+'%';
  const studyCell=(r,winner)=>r?'<td'+(winner?' class="primary"':'')+'>'+percentage(r.annual)+' <span class="date-extra">回撤 '+percentage(r.drawdown)+'</span></td>':'<td>样本不足</td>';
  const shortLabel=s=>s.name.replace(/^策略(\d+)-/,'$1 · ');
  get('studyNote').textContent='各策略默认参数按九只 ETF 各自可交易期的年化收益取等权算术平均，从已测试组合中选出。'+study.testStart+' 至 '+study.end+' 为后段历史复核，属于参数选取已覆盖的行情。策略 2 在后段用 2020 年底前的数据固定 PE 阈值。';
  function renderStudy(){
    const rows=study.rows.map(r=>{
      const i=assets.findIndex(a=>a.code===r.code);
      return {...r,percentile:applied.percentile.test?applied.percentile.test[i]:r.percentile,
        absolute:applied.absolute.test?applied.absolute.test[i]:r.absolute,
        macd:macdApplied.test?.get(r.code)??r.macd};
    });
    const common=rows.filter(r=>r.absolute);
    const describe=mode=>{
      const c=applied[mode].config;
      return c.years+' 年 · '+c.buy+'% / '+c.sell+'%';
    };
    const averages=s=>common.reduce((n,r)=>n+r[s.id].annual,0)/common.length;
    const leader=common.length?[...strategies].sort((a,b)=>averages(b)-averages(a))[0]:null;
    const portfolios=strategies.map(s=>s.id==='macd'?macdApplied.results:applied[s.id]?.assets??s.results);
    get('studyResult').textContent=leader?'按当前参数，'+common.length+' 只可比 ETF 中，'+leader.name+'的平均年化最高（'+percentage(averages(leader))+'）。'
      :'当前参数下策略 2 的校准样本不足。下方逐指数结果仍可查看。';
    const summaries=strategies.map((s,j)=>{
      const mean=key=>common.length?percentage(common.reduce((n,r)=>n+r[s.id][key],0)/common.length):'—';
      const beats=common.filter(r=>r[s.id].annual>Math.max(r.percentile.annual,r.absolute.annual)).map(r=>r.name);
      const stages=portfolios[j];
      const fullWins=stages.filter((a,i)=>a.total>Math.max(applied.percentile.assets[i].total,applied.absolute.assets[i].total))
        .map(a=>assets.find(x=>x.code===a.code).name);
      const lowerDrawdowns=common.filter(r=>r[s.id].drawdown<Math.min(r.percentile.drawdown,r.absolute.drawdown)).length;
      const timing=study.checks[2].metrics[j];
      return '<tr><th scope="row">'+s.name+'</th><td>'+mean('annual')+'</td><td>'+mean('drawdown')+'</td><td>'+percentage(timing.annual)+'</td><td>'+
        (j>1?(beats.join('、')||'—'):'基准')+'</td><td>'+(j>1?(common.length?lowerDrawdowns+' / '+common.length:'—'):'基准')+'</td><td>'+(j>1?(fullWins.join('、')||'—'):'基准')+'</td></tr>';
    });
    get('strategyScores').innerHTML='<thead><tr><th scope="col">策略</th><th scope="col">后段平均年化</th><th scope="col">后段平均回撤</th><th scope="col">2021–2023 年化（默认）</th><th scope="col">后段年化超 1、2</th><th scope="col">后段回撤小于 1、2</th><th scope="col">全窗口累计超 1、2</th></tr></thead><tbody>'+summaries.join('')+'</tbody>';
    get('studyTable').innerHTML='<thead><tr><th scope="col">指数</th>'+strategies.map(s=>'<th scope="col">'+shortLabel(s)+(applied[s.id]?'<span class="date-extra">'+describe(s.id)+'</span>':s.id==='macd'?'<span class="date-extra">'+macdLabel()+'</span>':'')+'</th>').join('')+'<th scope="col">最高年化策略</th><th scope="col">买入持有年化</th></tr></thead><tbody>'+
      rows.map(r=>{
        const winner=[...strategies].filter(s=>r[s.id]).sort((a,b)=>r[b.id].annual-r[a.id].annual)[0];
        return '<tr><th scope="row">'+r.name+'</th>'+strategies.map(s=>studyCell(r[s.id],winner===s)).join('')+'<td>'+shortLabel(winner)+'</td><td>'+percentage(r.patient.holdAnnual)+'</td></tr>';
      }).join('')+'</tbody>';
    get('fullStudyTable').innerHTML='<thead><tr><th scope="col">指数</th>'+strategies.map(s=>'<th scope="col">'+shortLabel(s)+'</th>').join('')+'<th scope="col">最高累计策略</th></tr></thead><tbody>'+
      assets.map((a,i)=>{
        const totals=portfolios.map(items=>items[i].total);
        const winner=totals.indexOf(Math.max(...totals));
        return '<tr><th scope="row">'+a.name+'</th>'+totals.map((r,j)=>'<td'+(j===winner?' class="primary"':'')+'>'+percentage(r)+'</td>').join('')+
          '<td>'+shortLabel(strategies[winner])+'</td></tr>';
      }).join('')+'</tbody>';
  }
  const candidateRow=(name,c,i)=>'<tr'+(i===0?' class="primary"':'')+'><th scope="row">'+name+'</th><td>'+c.summary+'</td><td>'+percentage(c.score)+'</td></tr>';
  get('studyCandidates').innerHTML='<thead><tr><th scope="col">策略</th><th scope="col">规则</th><th scope="col">全窗口平均年化</th></tr></thead><tbody>'+
    strategies.slice(0,2).map(s=>{
      const c=s.defaultConfig;
      return candidateRow(s.name,{score:s.defaultScore,summary:c.years+' 年 / 买入 '+c.buy+'% / 卖出 '+c.sell+'%'},0);
    }).join('')+
    study.patientCandidates.map((c,i)=>candidateRow(strategies[2].name,{score:c.score,summary:'PE 回看 '+c.years+' 年 / 买入 '+percentage(c.buy)+' / '+c.length+' 日均线 / 极高分位 '+percentage(c.hardExit)},i)).join('')+
    study.lab.map((lab,i)=>lab.candidates.map((c,j)=>candidateRow('<a href="'+strategies[i+3].source[1]+'">'+strategies[i+3].name+'</a>',c,j)).join('')).join('')+
    study.macdCandidates.map((c,i)=>candidateRow('<a href="'+macdStrategy.source[1]+'">'+macdStrategy.name+'</a>',c,i)).join('')+'</tbody>';
  get('studyChecks').innerHTML='<thead><tr><th scope="col">区间</th><th scope="col">单边成本</th>'+
    strategies.map((_,i)=>'<th scope="col">策略 '+(i+1)+'</th>').join('')+'</tr></thead><tbody>'+
    study.checks.map(r=>'<tr><th scope="row">'+r.label+'<span class="date-extra">'+r.from+' 至 '+r.through+'</span></th><td>'+percentage(r.fee)+'</td>'+
      r.metrics.map(x=>'<td>'+percentage(x.annual)+'</td>').join('')+'</tr>').join('')+'</tbody>';
  showControls();
  showResults();
  followPanelHash();
})();
