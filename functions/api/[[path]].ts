/* Pages Functions: D1-backed catalog, intentionally fail-closed without verified Access JWT. */
interface Stmt {
  bind(...args: unknown[]): Stmt;
  first<T>(): Promise<T|null>;
  all<T>(): Promise<{results:T[]}>;
}
interface D1 {
  prepare(query:string):Stmt;
  batch(stmts:Stmt[]):Promise<unknown[]>;
}
type Env = {'warehouse-db'?:D1;CF_ACCESS_TEAM_DOMAIN?:string;CF_ACCESS_AUD?:string;WAREHOUSE_EDITORS?:string;WAREHOUSE_ADMINS?:string};
type Ctx = {request:Request;env:Env};
type Row = {part_id:string;part_code:string;part_name:string;active:number;version:number};
const chars='23456789abcdefghjkmnpqrstuvwxyz', idPattern=/^prt-[2-9a-hj-km-np-z]{8}$/;
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const error=(status:number,code:string,message:string)=>response({error:code,message},status);
const norm=(s:string)=>s.trim().toLowerCase();
const list=(s?:string)=>new Set((s||'').split(/[,\s;]+/).map(norm).filter(Boolean));
function mint(prefix:'prt'|'evt'):string{
  let body='';const data=new Uint8Array(32);
  while(body.length<8){crypto.getRandomValues(data);for(const byte of data)if(byte<248&&body.length<8)body+=chars[byte%31];}
  return prefix+'-'+body;
}
function decode(segment:string):Uint8Array{
  return Uint8Array.from(atob(segment.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(segment.length/4)*4,'=')),c=>c.charCodeAt(0));
}
async function access(ctx:Ctx):Promise<{email:string;name:string;role:'viewer'|'editor'|'admin'}|null>{
  const {env,request}=ctx,token=request.headers.get('Cf-Access-Jwt-Assertion')||'',parts=token.split('.');
  if(!env.CF_ACCESS_TEAM_DOMAIN||!env.CF_ACCESS_AUD||parts.length!==3)return null;
  let header:Record<string,unknown>,payload:Record<string,unknown>;
  try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));}catch{return null;}
  if(header.alg!=='RS256'||typeof header.kid!=='string'||typeof payload.email!=='string')return null;
  const host=env.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/+$/,'');
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host))return null;
  if(payload.iss!=='https://'+host&&payload.iss!=='https://'+host+'/')return null;
  const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  if(!aud.includes(env.CF_ACCESS_AUD)||typeof payload.exp!=='number'||payload.exp<Date.now()/1000)return null;
  if(typeof payload.nbf==='number'&&payload.nbf>Date.now()/1000)return null;
  try{
    const res=await fetch('https://'+host+'/cdn-cgi/access/certs');
    if(!res.ok)return null;
    const keys=await res.json() as {keys?:Array<JsonWebKey&{kid?:string}>};
    const jwk=keys.keys?.find(k=>k.kid===header.kid);if(!jwk)return null;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
    if(!valid)return null;
  }catch{return null;}
  const email=norm(payload.email);
  return {email,name:typeof payload.name==='string'?payload.name:email,role:list(env.WAREHOUSE_ADMINS).has(email)?'admin':list(env.WAREHOUSE_EDITORS).has(email)?'editor':'viewer'};
}
const view=(r:Row)=>({part_id:r.part_id,part_code:r.part_code,part_name:r.part_name,active:!!r.active,version:r.version,
 category:null,description:'',department:null,unit:'each',cost:null,sale_price:null,reorder_point:null,
 width_in:null,height_in:null,depth_in:null,weight_lb:null,aliases:[],par_total:0,on_hand_total:0,locations:[]});
export async function onRequest(ctx:Ctx):Promise<Response>{
  const {request,env}=ctx,path=new URL(request.url).pathname.replace(/^\/api\/?/,'');
  if(path==='health'&&request.method==='GET')return response({ok:true,d1_bound:!!env['warehouse-db'],access_configured:!!(env.CF_ACCESS_TEAM_DOMAIN&&env.CF_ACCESS_AUD)});
  if(!env.CF_ACCESS_TEAM_DOMAIN||!env.CF_ACCESS_AUD)return error(503,'not_configured','Cloudflare Access team domain and application audience required.');
  const me=await access(ctx);if(!me)return error(401,'unauthorized','Verified Cloudflare Access JWT required.');
  if(path==='me'&&request.method==='GET')return response(me);
  const db=env['warehouse-db'];if(!db)return error(503,'database_unavailable','The warehouse-db D1 binding is missing.');
  try{
    if(path==='parts'&&request.method==='GET'){
      const url=new URL(request.url),q=norm(url.searchParams.get('q')||'');
      const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||25));
      const offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
      const clause='active=1'+(q?' AND (lower(part_code) LIKE ? OR lower(part_name) LIKE ?)':'');
      const args=q?['%'+q+'%','%'+q+'%']:[];
      const data=await db.prepare('SELECT * FROM parts WHERE '+clause+' ORDER BY part_name LIMIT ? OFFSET ?').bind(...args,limit,offset).all<Row>();
      const count=await db.prepare('SELECT count(*) AS total FROM parts WHERE '+clause).bind(...args).first<{total:number}>();
      // Catalog-only schema starts with all parts unassigned, without inventing stock.
      return response({items:data.results.map(view),total:count?.total??0,limit,offset});
    }
    if(path.startsWith('parts/')&&request.method==='GET'){
      const id=decodeURIComponent(path.slice(6));
      if(!idPattern.test(id))return error(404,'not_found','Part not found.');
      const row=await db.prepare('SELECT * FROM parts WHERE part_id=? AND active=1').bind(id).first<Row>();
      return row?response(view(row)):error(404,'not_found','Part not found.');
    }
    if(path==='parts/register'&&request.method==='POST'){
      if(me.role==='viewer')return error(403,'forbidden','Editor role required.');
      let body:unknown;try{body=await request.json();}catch{return error(400,'validation','Invalid JSON.');}
      const rows=(body as {rows?:unknown})?.rows;
      if(!Array.isArray(rows)||rows.length===0||rows.length>500)return error(400,'validation','Submit 1-500 rows.');
      const results:Array<{index:number;status:'new'|'reused'|'conflict';part_id:string|null;message?:string}>=[];
      let event_id:string|null=null;
      for(let index=0;index<rows.length;index++){
        const r=rows[index] as Record<string,unknown>|null;
        const code=typeof r?.part_code==='string'?r.part_code.trim():'';
        const name=typeof r?.part_name==='string'?r.part_name.trim():'';
        if(!code||!name||code.length>150||name.length>500){
          results.push({index,status:'conflict',part_id:null,message:'SKU and part name required (150/500 character limits).'});continue;
        }
        const found=await db.prepare('SELECT * FROM parts WHERE part_code=? COLLATE NOCASE').bind(code).first<Row>();
        if(found){
          results.push(found.active&&norm(found.part_name)===norm(name)?
            {index,status:'reused',part_id:found.part_id}:
            {index,status:'conflict',part_id:found.part_id,message:'SKU belongs to a different or inactive part.'});continue;
        }
        const id=mint('prt'),ev=mint('evt'),now=new Date().toISOString();
        try{
          await db.batch([
            db.prepare('INSERT INTO parts(part_id,part_code,part_name,active,version,created_at,updated_at) VALUES (?,?,?,1,1,?,?)').bind(id,code,name,now,now),
            db.prepare('INSERT INTO part_audit(event_id,part_id,event_type,actor_email,recorded_at) VALUES (?,?,?,?,?)').bind(ev,id,'register',me.email,now)
          ]);
          results.push({index,status:'new',part_id:id});event_id=ev;
        }catch{
          const winner=await db.prepare('SELECT * FROM parts WHERE part_code=? COLLATE NOCASE').bind(code).first<Row>();
          results.push(winner&&winner.active&&norm(winner.part_name)===norm(name)?
            {index,status:'reused',part_id:winner.part_id}:
            {index,status:'conflict',part_id:winner?.part_id??null,message:'Database rejected registration.'});
        }
      }
      return response({results,event_id});
    }
    return error(404,'not_found','Unsupported API route.');
  }catch(e){
    console.error('Warehouse D1 error',e);
    return error(503,'database_unavailable','The warehouse database schema has not been initialized or is unavailable.');
  }
}
