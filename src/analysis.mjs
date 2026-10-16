export const PRESETS={
 capability:{label:'能力优先',weights:{aa:40,vals:35,livebench:25}},
 equal:{label:'三榜等权',weights:{aa:100/3,vals:100/3,livebench:100/3}},
 objective:{label:'任务实践优先',weights:{aa:25,vals:40,livebench:35}},
 broad:{label:'广覆盖双榜',weights:{aa:60,vals:0,livebench:40}},
};
// Drop retired source weights, including preferences saved by earlier versions.
export function migratePreferences(saved={}){
 if(!saved||typeof saved!=='object')saved={};
 const preset=Object.hasOwn(PRESETS,saved.preset)?saved.preset:saved.preset==='custom'?'custom':'capability';
 let weights=preset==='custom'?Object.fromEntries(Object.keys(PRESETS.capability.weights).map(s=>[s,Number.isFinite(saved.weights?.[s])?Math.max(0,Math.min(100,saved.weights[s])):0])):{...PRESETS[preset].weights};
 const enabled=Object.values(weights).filter(v=>v>0).length;
 if(!enabled)return {...saved,preset:'capability',weights:{...PRESETS.capability.weights},minSources:2};
 return {...saved,preset,weights,minSources:Math.max(1,Math.min(Number.isInteger(saved.minSources)?saved.minSources:2,enabled))};
}
export function percentile(score,pool){if(pool.length===1)return 50;const less=pool.filter(v=>v<score).length;const equal=pool.filter(v=>v===score).length;return 100*(less+(equal-1)/2)/(pool.length-1);}
export function pareto(rows){return rows.filter(r=>!rows.some(o=>o.id!==r.id&&o.cost<=r.cost&&o.composite>=r.composite&&(o.cost<r.cost||o.composite>r.composite)));}
// 被支配区锚点：最便宜的前沿点同时也是前沿上综合分最高的点，其右下方整个矩形内的模型都被它
// 「以更低成本达到更高综合分」支配。返回 null 表示当前可见模型中没有前沿点，不画区域。
export function dominatedAnchor(rows){
 const front=rows.filter(r=>r.frontier&&Number.isFinite(r.cost)&&Number.isFinite(r.composite));
 return front.length?[...front].sort((a,b)=>a.cost-b.cost||b.composite-a.composite)[0]:null;
}
export const COST_SOURCES=['aa','vals','livebench'];
function median(values){const a=[...values].sort((a,b)=>a-b);const mid=Math.floor(a.length/2);return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;}
export function combinedCostProfile(models,includeEstimated=false,costSources=COST_SOURCES){
 const eligible=costSources.length<2?[]:models.filter(m=>costSources.every(s=>{const r=m.representatives[s];return Number.isFinite(r?.costTask)&&r.costTask>0&&(includeEstimated||!r.estimated);}));
 return {count:eligible.length,sources:costSources,medians:Object.fromEntries(COST_SOURCES.map(s=>[s,eligible.length&&costSources.includes(s)?median(eligible.map(m=>m.representatives[s].costTask)):null]))};
}
export function combinedCost(model,profile,includeEstimated=false,minSources=3){
 const components=COST_SOURCES.map(source=>{const r=model.representatives[source];const cost=r?.costTask;const baseline=profile.medians[source];return {source,cost,baseline,ratio:cost>0&&baseline>0?cost/baseline:null,estimated:!!r?.estimated};});
 const available=components.filter(c=>Number.isFinite(c.ratio)&&c.ratio>0&&(includeEstimated||!c.estimated));
 if(available.length<minSources)return {value:null,components,coverage:available.length};
 return {value:100*Math.exp(available.reduce((sum,c)=>sum+Math.log(c.ratio),0)/available.length),components,coverage:available.length};
}
export function analyze(models,weights,{costSource='composite',minSources=2,includeEstimated=false,costMinSources=2,costSources=COST_SOURCES}={}) {
 const profile=combinedCostProfile(models,includeEstimated,costSources);
 const sources=Object.keys(weights).filter(s=>weights[s]>0);const required=Math.min(minSources,sources.length);
 const eligible=models.filter(m=>sources.filter(s=>{const r=m.representatives[s];return Number.isFinite(r?.score)&&(includeEstimated||!r.estimated);}).length>=required);
 const pool=Object.fromEntries(sources.map(s=>[s,eligible.map(m=>m.representatives[s]).filter(r=>Number.isFinite(r?.score)&&(includeEstimated||!r.estimated)).map(r=>r.score)]));
 const rows=models.map(m=>{
  const available=sources.filter(s=>{const r=m.representatives[s];return Number.isFinite(r?.score)&&(includeEstimated||!r.estimated);});
  const valid=sources.length>0&&available.length>=required;let composite=null;const percentiles={};
  if(valid){for(const s of available)percentiles[s]=percentile(m.representatives[s].score,pool[s]);const weight=available.reduce((t,s)=>t+weights[s],0);composite=available.reduce((t,s)=>t+percentiles[s]*weights[s],0)/weight;}
  const costRecord=m.representatives[costSource];const combined=combinedCost(m,profile,includeEstimated,costMinSources);const cost=costSource==='composite'?combined.value:costRecord?.costTask;
  const reason=!sources.length?'至少启用一个榜单':!valid?`需要 ${required} 个有效榜单，目前 ${available.length} 个`:!Number.isFinite(cost)?(costSource==='composite'?`综合成本至少需要 ${costMinSources} 个来源的有效成本`:'所选来源未披露任务成本'):cost<=0?'成本为 0 或低于源站精度，未放入对数图':null;
  return {...m,composite,costCoverage:combined.coverage,percentiles,available,complete:available.length===sources.length,cost:Number.isFinite(cost)?cost:null,costUnit:costSource==='composite'?'相对成本指数':'USD / task',costComponents:combined.components,plottable:!reason,reason,frontier:false,openFrontier:false};
 });
 const plotted=rows.filter(r=>r.plottable);const front=new Set(pareto(plotted).map(r=>r.id));const openFront=new Set(pareto(plotted.filter(r=>r.openWeights===true)).map(r=>r.id));
 for(const r of rows){r.frontier=front.has(r.id);r.openFrontier=openFront.has(r.id);}
 for(const r of rows){r.dominatedBy=plotted.filter(o=>o.frontier&&o.id!==r.id&&o.cost<=r.cost&&o.composite>=r.composite&&(o.cost<r.cost||o.composite>r.composite)).map(o=>o.name);}
 return {rows,sources,required,cohort:eligible.length,plotted:plotted.length,costProfile:profile};
}
export function comparePresets(models,options){return Object.entries(PRESETS).filter(([k])=>k!=='broad').map(([key,p])=>({key,label:p.label,...analyze(models,p.weights,{...options,minSources:Object.values(p.weights).filter(v=>v>0).length})}));}

// 覆盖口径敏感性：直接对照「全部启用榜单的严格比较」与「至少 X 榜探索」两种口径的结果差异。
// 名次变化来自样本与权重再分配，不代表模型能力变化；只启用一个榜单时没有口径之分。
function compositeRanks(rows){
 // 与 rankedModels 同口径：每个有效综合分的行都有名次，并列取相同名次。
 const sorted=rows.filter(r=>Number.isFinite(r.composite)).sort((a,b)=>b.composite-a.composite||a.name.localeCompare(b.name));
 const ranks=new Map();let last=null,rank=0;
 for(const [i,r] of sorted.entries()){if(last!==r.composite){last=r.composite;rank=i+1;}ranks.set(r.id,rank);}
 return ranks;
}
const frontierLabel=r=>r?.frontier?'全球前沿':r?.openFrontier?'开放权重前沿':'未入前沿';
export function scopeComparison(models,weights,{minSources=2,...options}={}){
 const sources=Object.keys(weights).filter(s=>weights[s]>0);
 if(sources.length<2)return null;
 const strictMin=sources.length;
 // 无论当前处于哪种口径，都同时给出两种结果：探索口径取「用户当前门槛」与「严格减一」中较小者。
 const exploreMin=Math.min(Math.max(1,Math.round(minSources)),strictMin-1);
 const strict=analyze(models,weights,{...options,minSources:strictMin});
 const explore=analyze(models,weights,{...options,minSources:exploreMin});
 const strictRanks=compositeRanks(strict.rows),exploreRanks=compositeRanks(explore.rows);
 const strictById=new Map(strict.rows.map(r=>[r.id,r])),exploreById=new Map(explore.rows.map(r=>[r.id,r]));
 const nameOf=id=>exploreById.get(id)?.name??id;
 const shifts=[];
 for(const [id,strictRank] of strictRanks){
  const exploreRank=exploreRanks.get(id);
  if(exploreRank!=null&&exploreRank!==strictRank)shifts.push({id,name:nameOf(id),strictRank,exploreRank,shift:strictRank-exploreRank});
 }
 shifts.sort((a,b)=>Math.abs(b.shift)-Math.abs(a.shift)||a.name.localeCompare(b.name));
 const onlyExploration=explore.rows.filter(r=>Number.isFinite(r.composite)&&!strictRanks.has(r.id)).map(r=>({id:r.id,name:r.name,exploreRank:exploreRanks.get(r.id)})).sort((a,b)=>a.exploreRank-b.exploreRank);
 const frontierChanges=[];
 for(const r of explore.rows){
  const before=frontierLabel(strictById.get(r.id)),after=frontierLabel(r);
  if(before!==after)frontierChanges.push({id:r.id,name:r.name,strict:before,explore:after});
 }
 return {strictMin,exploreMin,strictCohort:strict.cohort,exploreCohort:explore.cohort,shiftCount:shifts.length,shifts:shifts.slice(0,10),onlyExplorationCount:onlyExploration.length,onlyExploration:onlyExploration.slice(0,10),frontierChanges};
}
// 导出附带数据时间与计算口径，便于日后复核同一结论；新列固定追加在表头末尾，meta 缺省时值留空。
// 缓存文件是本地可编辑的，时间戳可能是任意字符串：解析失败留空，不让导出按钮抛异常。
const isoTime=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toISOString():'';};
export function csvExport(rows,meta={}){const header=['模型','厂商','开放权重','覆盖榜数','综合分','成本来源数','成本值','成本单位','全球前沿','开放权重前沿','未入图原因','AA','Vals','LiveBench','AA配置','Vals配置','LiveBench配置','数据时间','评分口径'];
 const scope=typeof meta.scope==='string'?meta.scope:'';
 const dataTime=isoTime(meta.lastRefresh);
 const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\ufeff'+[header,...rows.map(r=>[r.name,r.creator,r.openWeights===true?'是':r.openWeights===false?'否':'未确认',r.available.length,r.composite?.toFixed(4),r.costCoverage,r.costUnit==='相对成本指数'&&r.cost!=null?r.cost/100:r.cost,r.costUnit==='相对成本指数'?'基准倍数':r.costUnit,r.frontier?'是':'否',r.openFrontier?'是':'否',r.reason,...['aa','vals','livebench'].map(s=>r.representatives[s]?.score),...['aa','vals','livebench'].map(s=>r.representatives[s]?.configuration),dataTime,scope])].map(r=>r.map(safe).join(',')).join('\r\n');}

// Reproduce one source on its own full source population; no common-cohort restriction.
export function sourceAudit(models,modelId,source){
 const target=models.find(m=>m.id===modelId);if(!target)return null;
 const candidates=models.flatMap(m=>(m.records[source]??[]).filter(r=>Number.isFinite(r.score)&&!r.estimated&&!r.deprecated).map((r,i)=>{
  let cost=r.costTask;let basis='每次任务 USD';
  if(source==='livebench'){cost=r.costSuccess;basis='每次成功任务 USD';}
  return {...r,id:m.id+':'+i,modelId:m.id,composite:r.score,cost,basis};
 })).filter(r=>Number.isFinite(r.cost)&&r.cost>0);
 const targets=candidates.filter(r=>r.modelId===modelId);
 const frontIds=new Set(pareto(candidates).map(r=>r.id));
 const preferred=targets.sort((a,b)=>b.score-a.score)[0];
 if(!preferred)return {source,available:false,reason:'源站缺少有效分数或可用成本'};
 const dominates=candidates.filter(o=>o.modelId!==modelId&&o.cost<=preferred.cost&&o.score>=preferred.score&&(o.cost<preferred.cost||o.score>preferred.score)).sort((a,b)=>b.score-a.score);
 return {source,available:true,name:preferred.name,score:preferred.score,cost:preferred.cost,basis:preferred.basis,frontier:frontIds.has(preferred.id),anyVariantOnFrontier:targets.some(r=>frontIds.has(r.id)),dominatedBy:[...new Set(dominates.map(r=>r.name))].slice(0,4),population:candidates.length};
}
export function frontierStability(models,{includeEstimated=false}={}){
 const profile=combinedCostProfile(models,includeEstimated);
 // Fix the same sample across all scenarios so absence never counts as failure.
 const cohort=models.filter(m=>Object.keys(PRESETS.equal.weights).every(s=>{const r=m.representatives[s];return Number.isFinite(r?.score)&&(includeEstimated||!r.estimated);})&&combinedCost(m,profile,includeEstimated).value!==null);
 const records=new Map(cohort.map(m=>[m.id,{id:m.id,name:m.name,openWeights:m.openWeights,globalCount:0,openCount:0,scenarios:[]}]));
 for(const key of ['capability','equal','objective'])for(const costSource of ['composite','aa','vals','livebench']){
  const a=analyze(cohort,PRESETS[key].weights,{costSource,minSources:3,includeEstimated,costMinSources:3});
  for(const r of a.rows){const record=records.get(r.id);record.globalCount+=Number(r.frontier);record.openCount+=Number(r.openFrontier);record.scenarios.push({preset:key,costSource,global:r.frontier,open:r.openFrontier});}
 }
 return {cohort:cohort.length,scenarioCount:12,rows:[...records.values()].map(r=>({...r,globalIndex:r.globalCount/12*100,openIndex:r.openWeights===true?r.openCount/12*100:null})).sort((a,b)=>(b.openIndex??-1)-(a.openIndex??-1)||b.globalIndex-a.globalIndex)};
}
