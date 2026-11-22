'use strict';
(() => {
  const {assets,strategies,study,start,end,endExclusive,tuningFields}=window.PE10;
  const get=id=>document.getElementById(id);
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
  const defaults={percentile:{years:strategies[0].defaultLookback,buy:20,sell:80},absolute:{years:20,buy:20,sell:80}};
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
    active=selected?selected.assets:assets.map((a,i)=>({...a,...strategy.results[i]}));
    const config=selected?.config;
    const name=config?strategy.name+'（'+config.years+'年 '+config.buy+'% / '+config.sell+'%）':strategy.name;
    picked=0;
    window.dispatchEvent(new CustomEvent('pe-strategy-change',{detail:{assets:active,strategy:{id:strategy.id,name}}}));
    renderStudy();
    render();
  }
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
    const lo=rankPlot?0:Math.max(0,Math.min(...values,...sigs.map(markerValue))*.91);
    const hi=rankPlot?1:Math.max(...values,...sigs.map(markerValue))*1.12;
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
    const points=(rankPlot?[]:sigs).map((m,i)=>{
      const px=x(m.trade.signal),py=y(markerValue(m));
      ctx.beginPath();
      if(m.buy) ctx.arc(px,py,5,0,2*Math.PI);
      else {ctx.moveTo(px,py-6);ctx.lineTo(px+6,py);ctx.lineTo(px,py+6);ctx.lineTo(px-6,py);ctx.closePath();}
      ctx.fillStyle=paint(m);ctx.fill();
      ctx.strokeStyle=i===picked?'#fff4d4':'#132125';ctx.lineWidth=i===picked?2.5:1;ctx.stroke();
      return {px,py};
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
      const context=t.average?' · '+(strategy.lookback??study.chosen.years)+' 年分位 '+fmt.format(t.rank*100)+'% · 均线 '+fmt.format(t.average)+' 点'
        :strategy.id==='percentile'?' · '+applied.percentile.config.years+' 年分位 '+fmt.format(t.rank*100)+'%':'';
      get('markerInfo').innerHTML='<strong style="color:'+paint(m)+'">'+(m.buy?'买入':'卖出')+'信号 '+t.signal+'</strong> · 指数收盘 '+fmt.format(t.signalClose)+' 点 · PE '+fmt.format(t.pe)+' 倍'+context+'<br>成交 '+t.date+' · 指数开盘 '+fmt.format(t.indexOpen)+' 点 · ETF 开盘 '+t.open.toFixed(3)+' 元 · <a href="#trades" data-trade="'+key+'">查看本轮明细</a>';
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
      :strategy.id==='absolute'?'用近 '+config.years+' 年日度 PE 的第 '+config.buy+'、'+config.sell+' 百分位定倍数。低于或等于买入倍数时满仓，高于或等于卖出倍数时清仓。':strategy.summary;
    const t=a.thresholds;
    get('strategyDetail').textContent=t?a.name+' · PE ≤ '+fmt.format(t.buy)+' 倍买入，≥ '+fmt.format(t.sell)+' 倍卖出。样本 '+t.start+' 至 '+t.end+'（'+t.observations+' 日）。固定阈值使用全样本，含回测时点之后的数据。'
      :strategy.id==='trend'?'训练期 2016–2020 年，按年化收益中位数选规则。'
      :strategy.id==='patient'?'训练期 2016–2020 年，从 24 个候选中按平均年化收益选规则。看下方后段和成本检验。'
      :'分位每天按当时可得的历史重新计算。';
    begin=range.value==='active'?(firstSignal<a.firstEligible?firstSignal:a.firstEligible):start;
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
    applyTuning();
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
      hitPoints[i].forEach((p,j)=>{
        const delta=Math.hypot(e.offsetX-p.px,e.offsetY-p.py);
        if(delta<closest){closest=delta;index=j;}
      });
      if(index>=0) selectMarker(index);
    });
    new ResizeObserver(()=>draw(c,i)).observe(c);
  });
  const percentage=x=>fmt.format(x*100)+'%';
  const studyCell=r=>r?'<td>'+percentage(r.annual)+' <span class="date-extra">回撤 '+percentage(r.drawdown)+'</span></td>':'<td>样本不足</td>';
  get('studyNote').textContent='策略 3、4 用 2016–2020 年已有的六只 ETF 选参数。下表检验 '+study.testStart+' 至 '+study.end+'，各策略从空仓起步，持有基准首日买入。策略 2 在这里用 2020 年底前的 PE 固定阈值。此后段已有历史回测记录，后续行情可继续跟踪。';
  function renderStudy(){
    const rows=study.rows.map(r=>{
      const i=assets.findIndex(a=>a.code===r.code);
      return {...r,percentile:applied.percentile.test?applied.percentile.test[i]:r.percentile,
        absolute:applied.absolute.test?applied.absolute.test[i]:r.absolute};
    });
    const lowerRisk=rows.filter(r=>r.trend.drawdown<r.percentile.drawdown).length;
    const higherReturn=rows.filter(r=>r.trend.annual>r.percentile.annual).length;
    const common=rows.filter(r=>r.absolute);
    const beatsBoth=common.filter(r=>r.patient.annual>Math.max(r.percentile.annual,r.absolute.annual)).length;
    const describe=mode=>{
      const c=applied[mode].config;
      return c.years+' 年 · '+c.buy+'% / '+c.sell+'%';
    };
    get('studyResult').textContent='对比当前策略 1，策略 3 的最大回撤更小有 '+lowerRisk+' / '+rows.length+' 只，年化收益更高有 '+higherReturn+' / '+rows.length+' 只。';
    get('patientResult').textContent='按当前参数，策略 4 在 '+common.length+' 只可比 ETF 中有 '+beatsBoth+' 只的年化同时超过策略 1、2。';
    get('studyTable').innerHTML='<thead><tr><th scope="col">指数</th><th scope="col">策略 1 年化 <span class="date-extra">'+describe('percentile')+'</span></th><th scope="col">策略 2 年化 <span class="date-extra">'+describe('absolute')+'</span></th><th scope="col">策略 3 年化</th><th scope="col">策略 4 年化</th><th scope="col">买入持有年化</th></tr></thead><tbody>'+
      rows.map(r=>'<tr><th scope="row">'+r.name+'</th>'+studyCell(r.percentile)+studyCell(r.absolute)+studyCell(r.trend)+studyCell(r.patient)+'<td>'+percentage(r.trend.holdAnnual)+'</td></tr>').join('')+'</tbody>';
  }
  get('candidateTable').innerHTML='<thead><tr><th scope="col">PE 观察期</th><th scope="col">买入分位上限</th><th scope="col">指数均线</th><th scope="col">训练年化中位数</th></tr></thead><tbody>'+
    study.candidates.map((c,i)=>'<tr'+(i===0?' class="primary"':'')+'><td>'+c.years+' 年</td><td>'+percentage(c.buy)+'</td><td>'+c.length+' 日</td><td>'+percentage(c.score)+'</td></tr>').join('')+'</tbody>';
  get('patientCandidates').innerHTML='<thead><tr><th scope="col">PE 观察期</th><th scope="col">买入分位上限</th><th scope="col">指数均线</th><th scope="col">无条件卖出分位</th><th scope="col">训练平均年化</th></tr></thead><tbody>'+
    study.patientCandidates.map((c,i)=>'<tr'+(i===0?' class="primary"':'')+'><td>'+c.years+' 年</td><td>'+percentage(c.buy)+'</td><td>'+c.length+' 日</td><td>'+percentage(c.hardExit)+'</td><td>'+percentage(c.score)+'</td></tr>').join('')+'</tbody>';
  get('patientChecks').innerHTML='<thead><tr><th scope="col">区间</th><th scope="col">单边成本</th><th scope="col">策略 1</th><th scope="col">策略 2</th><th scope="col">策略 3</th><th scope="col">策略 4</th></tr></thead><tbody>'+
    study.patientChecks.map(r=>'<tr><th scope="row">'+r.label+'<span class="date-extra">'+r.from+' 至 '+r.through+'</span></th><td>'+percentage(r.fee)+'</td>'+
      r.annual.map(x=>'<td>'+percentage(x)+'</td>').join('')+'</tr>').join('')+'</tbody>';
  showControls();
  showResults();
})();
