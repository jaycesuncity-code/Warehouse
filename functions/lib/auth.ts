import type { Ctx } from './database';
const norm=(s:string)=>s.trim().toLowerCase();
const list=(s?:string)=>new Set((s||'').split(/[,\s;]+/).map(norm).filter(Boolean));
function decode(segment:string):Uint8Array<ArrayBuffer>{
  return Uint8Array.from(atob(segment.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(segment.length/4)*4,'=')),c=>c.charCodeAt(0));
}
export async function access(ctx:Ctx):Promise<{email:string;name:string;role:'viewer'|'editor'|'admin'}|null>{
  const {env,request}=ctx,token=request.headers.get('Cf-Access-Jwt-Assertion')||'',parts=token.split('.');
  if(!env.CF_ACCESS_TEAM_DOMAIN||!env.CF_ACCESS_AUD||parts.length!==3)return null;
  let header:Record<string,unknown>,payload:Record<string,unknown>;
  try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));}catch{return null;}
  if(header.alg!=='RS256'||typeof header.kid!=='string'||typeof payload.email!=='string')return null;
  const host=env.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/+$/,'');
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host))return null;
  if(payload.iss!=='https://'+host&&payload.iss!=='https://'+host+'/')return null;
  const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  if(!aud.includes(env.CF_ACCESS_AUD)||typeof payload.exp!=='number'||payload.exp<=Date.now()/1000)return null;
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
