export const NAMES={aa:'Artificial Analysis',vals:'Vals',livebench:'LiveBench'};
export const COSTS={composite:'综合相对成本（基准 1 倍）',aa:'AA 每次任务成本',vals:'Vals 每次测试成本',livebench:'LiveBench 每次任务成本'};
export const money=v=>!Number.isFinite(v)?'未披露':v<.01?`$${v.toPrecision(3)}`:v<1?`$${v.toFixed(3)}`:`$${v.toFixed(2)}`;
export function relativeCost(v){if(v==null)return '未披露';const ratio=v/100;return `${ratio<.01?Number(ratio.toPrecision(2)):Number(ratio.toFixed(2))} 倍`;}
export const costFormat=(v,source)=>source==='composite'?relativeCost(v):money(v);
export const formatTime=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'尚未获取';
