# 宽基 ETF 价值投资回测

覆盖上证50、沪深300、中证500、中证1000、创业板指和科创50。研究快照截至 2026-11-20。网页提供共同区间、前后段、各自最长区间、两档交易成本、日频风险指标和月度净值曲线。

[纯 PE 十年回测](https://leejiazhi88-gif.github.io/1.2-HuiCe/pe10.html) 从 2016-11-21 至 2026-11-20 逐日计算。PE 分位不高于 20% 时一次满仓，不低于 80% 时全部退出。使用 `research/pe10.cjs` 生成页面数据。以上一页的 Tushare 文件为基础，上市较早的四只 ETF 增加 2016-11-18 至 2017-12-31 行情和复权因子（文件名起始年 2016），除科创50以外的指数增加 2013-10-01 至 2014-12-31 的估值预热段（文件名起始年 2013）。

[纯 PE 二十年图表](https://leejiazhi88-gif.github.io/1.2-HuiCe/pe20.html) 使用相同阈值，在 2006-11-21 至 2026-11-20 计算，覆盖九只 ETF。使用 `node research/pe10.cjs --20` 生成。补充输入包括此前 ETF 日线与复权因子、对应的历史指数 PE；以 `pe20-{接口名}-{TS代码}-{起始年}.json` 存入 `work/`。图表还读取全区间 `index_daily` 的 `trade_date,open,close`，输出周度曲线和信号、成交日点位。将[项目 6 的科创综指官方 PE](https://github.com/leejiazhi88-gif/6-Bili-xiaodeng/blob/main/work/star_official_history.json)保存为 `work/pe20-p6-star-official.json`。

二十年页面顶部可切换十一套策略。各策略从已测组合中，按九只 ETF 各自可交易历史的等权平均年化收益选默认。策略 2 固定倍数用日度 PE 的线性插值百分位，主图使用截止日可得样本，后段历史对比用 2020 年末前的数据固定阈值。成交与收益通用引擎位于 `research/pe20-engine.cjs`。

运行 `node research/pe10.cjs --20 --tuning` 可生成 `work/site/tuning/` 的调参结果。策略 1 回看期可选 1–10 年，策略 2 固定倍数的取样期可选 1–20 年。两个策略的买卖分位以 5 个百分点为一档。页面按需加载各年限的压缩结果。

策略 3 将均线用在高估卖出环节，并设一个极高分位直接退出。策略 4–10 分别是月线均线、时序动量、通道突破、RSI 短线回撤、波动过滤动量、价值与动量交集、三信号投票。规则和原始参考文献在 `research/strategy-lab.cjs`。策略 11 在 `research/macd.cjs` 实现，日／周／月频、金叉死叉／零轴／零轴过滤、三组 EMA 周期共 27 种组合，结果生成于 `work/site/tuning/macd.js`。后段对比使用 2021-08-02 至 2026-11-20，另有分段与提高交易成本的结果。默认参数的选取覆盖后段，因此后段用于历史复核。

## 数据与复现

页面提供模拟结果及口径。回测引擎位于 `research/build.cjs`。运行时，从工作目录下的 `work/` 读取以下 JSON，生成 `work/site/results.js`。原始行情请使用已授权的数据源获取。

- `fund_daily-{ETF TS代码}-{起始年}.json` 和 `fund_adj-{ETF TS代码}-{起始年}.json` 来自 Tushare 同名接口。按 2018–2020、2021–2023、2024–2026-11-20 分段。字段分别为 `trade_date,open,close,amount` 与 `trade_date,adj_factor`。
- `val-{指数 TS代码}-{起始年}.json` 来自 Tushare `index_dailybasic`。按 2015–2018、2019–2022、2023–2026-11-20 分段。字段为 `trade_date,pe_ttm,pb`。
- 项目 1 的 `work/{valuation_data,official_sentiment_events,retail_sentiment_data,national_team_etf_history,etf_flow_data}.json` 保存为 `work/p0-{文件名}.json`，估值用于宽口径背景，其余用于信号。文件快照可按仓库树 `6dd47c55fe92222df5c1e0e38819c5395ed8dd76` 查找。
- 项目 2 的 `outputs/market_modules_data.json` 保存为 `work/p1-market_modules_data.json`，用于个股市场温度。树 `b316b3e496291ad71efeaee3effe5eb3eac24f77`。
- 项目 2.2 的 `data-manifest.json` 保存为 `work/p2-data-manifest.json`，用于行业背景。树 `c8abe6265a33b7ad122224aa37991ed02b131f8a`。
- 项目 6 的 `work/{valuation_data,star_official_history,retail_index_metrics}.json` 保存为 `work/p3-{文件名}.json`，提供创业板周度 PB、两只成长指数换手率和科创50 PE 对照。树 `c112a9b6559fd5717db65d92668c7935108f5d70`。

建立 `work/site/` 后运行 `node research/build.cjs`。页面加载静态研究快照。
