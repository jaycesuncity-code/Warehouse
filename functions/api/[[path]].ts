import { access } from '../lib/auth';
import { load, persist, publicEvents, type Ctx } from '../lib/database';
import { ROUTES } from '../../src/shared/mock/router';
import { ENDPOINTS, roleAtLeast, type HttpMethod, type ApiEvent } from '../../src/shared/contract';
import { Tx } from '../../src/shared/mock/tx';
import { HttpError } from '../../src/shared/mock/errors';
const response=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const error=(status:number,code:string,message:string)=>response({error:code,message},status);
export async function onRequest(ctx:Ctx):Promise<Response>{
 const {request,env}=ctx;const url=new URL(request.url);
 if(!env.CF_ACCESS_TEAM_DOMAIN||!env.CF_ACCESS_AUD)return error(503,'not_configured','Configure the Cloudflare Access team domain and application audience.');
 const me=await access(ctx);if(!me)return error(401,'unauthorized','Verified Cloudflare Access JWT required.');
 if(url.pathname==='/api/me'&&request.method==='GET')return response(me);
 if(url.pathname==='/api/health'&&request.method==='GET')return response({ok:true,d1_bound:!!env['warehouse-db']});
 const db=env['warehouse-db'];if(!db)return error(503,'database_unavailable','The warehouse-db D1 binding is missing.');
 const route=ROUTES.find(r=>ENDPOINTS[r.name].method===request.method&&new RegExp('^'+ENDPOINTS[r.name].path.replace(/\./g,'\\.').replace(/:[a-z_]+/g,'[^/]+')+'/?$').test(url.pathname));
 if(!route)return error(404,'not_found','Unknown API route.');
 const spec=ENDPOINTS[route.name];
 if(!roleAtLeast(me.role,spec.role))return error(403,'forbidden','Your role cannot perform this operation.');
 const keys=[...spec.path.matchAll(/:([a-z_]+)/g)].map(m=>m[1]);
 const match=url.pathname.match(new RegExp('^'+spec.path.replace(/\./g,'\\.').replace(/:[a-z_]+/g,'([^/]+)')+'/?$'))!;
 let body:unknown; const params:Record<string,string>={};
 try{
  keys.forEach((k,i)=>{params[k]=decodeURIComponent(match[i+1]);});
  if(route.write){const raw=await request.text();if(raw.length>1_000_000)return error(413,'validation','Request is too large.');body=raw?JSON.parse(raw):{};if(!body||typeof body!=='object'||Array.isArray(body))return error(400,'validation','Expected a JSON object.');}
 }catch{return error(400,'validation','Invalid request.');}
 try{
  // Retry a concurrent transaction from fresh data. Versioned operations still reject stale versions.
  for(let attempt=0;attempt<3;attempt++){
   const state=await load(db);const tx=new Tx(state,me);
   const reply=route.handler({method:request.method as HttpMethod,params,query:url.searchParams,body,state:tx.state,tx,ctx:me,role:me.role});
   if(route.write){
    try{await persist(db,state,tx.state);}catch(e){if(String(e).includes('warehouse_meta.revision'))continue;throw e;}
   }
   if(route.name==='events')reply.body={items:publicEvents((reply.body as {items:ApiEvent[]}).items,me.role==='viewer')};
   if(reply.headers?.ETag===request.headers.get('If-None-Match'))return new Response(null,{status:304,headers:reply.headers});
   if(reply.headers?.['Content-Type']?.includes('text/csv'))return new Response(String(reply.body),{status:reply.status,headers:{...reply.headers,'Cache-Control':'no-store'}});
   return response(reply.body,reply.status,reply.headers);
  }
  return error(409,'version_conflict','The warehouse changed during this operation. Reload and retry.');
 }catch(e){
  if(e instanceof HttpError)return response(e.body,e.status);
  console.error('Warehouse API failed',e instanceof Error?e.message:'unknown');
  return error(503,'database_unavailable','Warehouse database unavailable or migrations missing.');
 }
}
