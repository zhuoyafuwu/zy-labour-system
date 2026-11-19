import {matchingRequest,safeCode} from './service.ts';
import {readRpcResponse,rpcError,reportAIError} from '../_shared/ai-rpc.ts';
Deno.serve(async(req:Request)=>{
 const env=Deno.env,origin=req.headers.get('origin')||'',allowed=(env.get('ZY_ALLOWED_ORIGINS')||'').split(',').map((s:string)=>s.trim()).filter(Boolean),cors={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'},reply=(status:number,data:any)=>Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store'}});
 if(!allowed.includes(origin))return reply(403,{error:'网页来源未获授权'});if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});if(req.method!=='POST')return reply(405,{error:'方法不允许'});
 const base=env.get('SUPABASE_URL')||'',anon=env.get('SUPABASE_ANON_KEY')||'',service=env.get('SUPABASE_SERVICE_ROLE_KEY')||'',bearer=req.headers.get('authorization')||'';if(!/^Bearer \S+$/i.test(bearer))return reply(401,{error:'请先登录'});
 const rpc=async(name:string,body:any={},privileged=false)=>{const key=privileged?service:anon;try{const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:privileged?'Bearer '+key:bearer,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return await readRpcResponse(response,name)}catch(e){const code=safeCode(e);throw rpcError(code==='AI_RPC_RESPONSE_INVALID'?code:'AI_DATABASE_UNAVAILABLE',name)}};
 try{const member=await rpc('zy_session');if(!member?.user?.id)return reply(403,{error:'需要有效团队账号'});
  const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>8192)return reply(413,{error:'请求过大'});let body;try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{return reply(400,{error:'请求格式无效'})}
  if(!['profile','prepare','match'].includes(body.action)||Object.keys(body).some(k=>!['action','workerId','orderIds','force'].includes(k)))return reply(400,{error:'请求无效'});
  return reply(200,await matchingRequest({rpc,actor:member.user.id,body}));
 }catch(e){const code=reportAIError(e,'ai_matching_request');return reply(503,{status:'failed',error:'AI分析失败，当前为规则结果',code})}
});
