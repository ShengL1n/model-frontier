import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {familyKey} from './identity.mjs';
const SOURCES=['aa','vals','livebench'];
export const HISTORY_LIMIT=60;
const FIELDS=['name','configuration','rawId','score','costTask','priceInput','priceOutput','speed','latency','suites','estimated','deprecated','openWeights'];
const rowKey=r=>JSON.stringify([r.rawId??null,r.name,r.configuration]);
function normalizeRow(row){
 return Object.fromEntries(FIELDS.map(key=>[key,key==='suites'?Object.fromEntries(Object.entries(row.suites??{}).sort(([a],[b])=>a.localeCompare(b))):row[key]??null]));
}
export function historySnapshot(sources){
 return Object.fromEntries(SOURCES.filter(s=>Array.isArray(sources[s]?.rows)&&sources[s].rows.length).map(s=>[s,{fetchedAt:sources[s].fetchedAt??null,sourceDate:sources[s].sourceDate??null,rows:sources[s].rows.map(normalizeRow).sort((a,b)=>rowKey(a).localeCompare(rowKey(b)))}]));
}
function signature(sources){return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(sources).map(([s,r])=>[s,{sourceDate:r.sourceDate,rows:r.rows}])))).digest('hex');}
export function diffSnapshots(before,after){
 const items=[];
 for(const source of SOURCES){
  const oldRows=new Map((before[source]?.rows??[]).map(r=>[rowKey(r),r]));
  const newRows=new Map((after[source]?.rows??[]).map(r=>[rowKey(r),r]));
  for(const key of new Set([...oldRows.keys(),...newRows.keys()])){
   const old=oldRows.get(key)??null;const next=newRows.get(key)??null;
   const fields=FIELDS.filter(k=>JSON.stringify(old?.[k]??null)!==JSON.stringify(next?.[k]??null));
   if(!fields.length)continue;
   const row=next??old;
   items.push({id:JSON.stringify([source,key]),source,modelId:familyKey(row.name),name:row.name,type:!old?'added':!next?'removed':'updated',fields,before:old,after:next});
  }
 }
 return items;
}
const counts=items=>({added:items.filter(i=>i.type==='added').length,removed:items.filter(i=>i.type==='removed').length,updated:items.filter(i=>i.type==='updated').length});
const metadata=sources=>Object.fromEntries(Object.entries(sources).map(([s,r])=>[s,{fetchedAt:r.fetchedAt,sourceDate:r.sourceDate,count:r.rows.length}]));
export function createHistoryStore(directory,{limit=HISTORY_LIMIT,now=()=>new Date().toISOString()}={}){
 let history={schemaVersion:1,startedAt:null,records:[]};let error=null;let writable=true;
 const file=join(directory,'history.json');
 async function capture(sources){
  if(!writable)return false;
  const current=historySnapshot(sources);if(!Object.keys(current).length)return false;
  const hash=signature(current);const previous=history.records.at(-1);
  if(previous?.hash===hash){error=null;return false;}
  const at=now();const items=previous?diffSnapshots(previous.sources,current):[];
  const sourceChanges=SOURCES.filter(s=>(previous?.sources[s]?.sourceDate??null)!==(current[s]?.sourceDate??null));
  // 哈希变化但行与版本标签均无可观察差异（如字段顺序演化）时不归档，避免产生"0 条变化"的误导记录。
  if(previous&&!items.length&&!sourceChanges.length){error=null;return false;}
  const record={id:randomUUID(),at,kind:previous?'change':'baseline',hash,sources:current,items,sourceChanges};
  const next={...history,startedAt:history.startedAt??at,records:[...history.records,record].slice(-limit)};
  try{await mkdir(directory,{recursive:true});const temporary=file+'.tmp-'+process.pid;await writeFile(temporary,JSON.stringify(next));await rename(temporary,file);history=next;error=null;return true;}
  catch(e){error='历史归档失败：'+e.message;return false;}
 }
 async function load(sources){
  // 嵌套结构必须逐层校验（含 rows 的每个元素）：合法 JSON 但行损坏的文件同样视为无法识别，
  // 保留原文件并明确报错；否则 diffSnapshots 会在服务启动时抛错退出。
  const validSources=sources=>!!sources&&typeof sources==='object'&&!Array.isArray(sources)&&Object.values(sources).every(s=>s&&typeof s==='object'&&Array.isArray(s.rows)&&s.rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)));
  const validRecords=records=>Array.isArray(records)&&records.every(r=>r&&typeof r==='object'&&validSources(r.sources)&&Array.isArray(r.items));
  try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved?.schemaVersion!==1||!validRecords(saved.records))throw new Error('历史文件格式无法识别');history=saved;}
  catch(e){if(e.code!=='ENOENT'){error='无法读取历史文件，已保留原文件：'+e.message;writable=false;}}
  await capture(sources);return summary();
 }
 function brief(record,modelId){const items=modelId?record.items.filter(i=>i.modelId===modelId):record.items;return {id:record.id,at:record.at,kind:record.kind,counts:counts(items),sourceChanges:record.sourceChanges,sources:metadata(record.sources)};}
 function summary(){const latest=history.records.at(-1);return {schemaVersion:1,startedAt:history.startedAt,retainedFrom:history.records[0]?.at??null,recordCount:history.records.length,limit,lastRecordedAt:latest?.at??null,latest:latest?brief(latest):null,error};}
 function view({recordId,modelId}={}){
  const selected=(recordId?history.records.find(r=>r.id===recordId):history.records.at(-1))??null;
  const observations=selected&&modelId?Object.entries(selected.sources).flatMap(([source,s])=>s.rows.filter(r=>familyKey(r.name)===modelId).map((r,i)=>({...r,id:source+':'+i,source,fetchedAt:s.fetchedAt,sourceDate:s.sourceDate}))):[];
  return {...summary(),records:[...history.records].reverse().map(r=>brief(r,modelId)),selected:selected?{...brief(selected,modelId),items:modelId?selected.items.filter(i=>i.modelId===modelId):selected.items,observations}:null};
 }
 return {load,capture,summary,view};
}
