// 保持既有选择规则：实测、在用配置优先；随后比较总分和同配置成本。
export function selectRepresentative(rows){
 return [...rows].sort((a,b)=>Number(!!a.estimated)-Number(!!b.estimated)||Number(!!a.deprecated)-Number(!!b.deprecated)||(b.score??-Infinity)-(a.score??-Infinity)||(a.costTask??Infinity)-(b.costTask??Infinity))[0];
}
