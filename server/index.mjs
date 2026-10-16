import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,extname,resolve,sep} from 'node:path';
import {loadState,view,refreshAll,progress,refreshDue,setRefreshHours,historyView} from './store.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));const PORT=Number(process.env.PORT||4317);const dev=process.argv.includes('--dev');
await loadState();
const vite=dev?await (await import('vite')).createServer({root:ROOT,server:{middlewareMode:true},appType:'spa'}):null;
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   // Local writes only, no remote browser origins or cross-site form requests.
   if(req.method!=='GET'&&req.headers.origin&&!['http://localhost:'+PORT,'http://127.0.0.1:'+PORT].includes(req.headers.origin))return json(res,403,{error:'仅允许本地网页操作'});
   if(req.method==='GET'&&url.pathname==='/api/data')return json(res,200,view());
   if(req.method==='GET'&&url.pathname==='/api/history')return json(res,200,historyView({recordId:url.searchParams.get('record')||undefined,modelId:url.searchParams.get('model')||undefined}));
   if(req.method==='GET'&&url.pathname==='/api/status')return json(res,200,{progress});
   if(req.method==='POST'&&url.pathname==='/api/refresh'){refreshAll().catch(e=>console.error(e.message));return json(res,202,{progress});}
   if(req.method==='PUT'&&url.pathname==='/api/settings'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return json(res,413,{error:'请求过大'});}
    return json(res,200,await setRefreshHours(JSON.parse(body).refreshHours));
   }
   return json(res,404,{error:'接口不存在'});
  }
  if(vite)return vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});
  const dist=join(ROOT,'dist');let path=resolve(dist,'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(dist+sep)&&path!==dist){res.statusCode=403;return res.end();}
  if(!extname(path))path=join(dist,'index.html');
  let data;try{await stat(path);data=await readFile(path);}catch{res.statusCode=404;return res.end('请先运行 npm run build，再执行 npm start。');}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
  res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);
 }catch(e){json(res,400,{error:e.message});}
});
server.listen(PORT,'127.0.0.1',()=>{console.log(`Model Frontier → http://localhost:${PORT}`);if(refreshDue())refreshAll().catch(e=>console.error(e.message));});
const timer=setInterval(()=>{if(!progress.running&&refreshDue())refreshAll().catch(e=>console.error(e.message));},60000);timer.unref();
async function close(){clearInterval(timer);server.close();await vite?.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
