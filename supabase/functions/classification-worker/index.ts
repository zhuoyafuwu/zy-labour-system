import {runTaskStep} from './runner.ts';
import {readRpcResponse,rpcError,safeCode,reportAIError} from '../_shared/ai-rpc.ts';

Deno.serve(async(req:Request)=>{
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(bearer))return new Response(null,{status:401});
 if(req.method!=='POST')return new Response(null,{status:405});
 const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!base||!key)return new Response(null,{status:503});
 const rpc=async(name:string,data:unknown={})=>{
  try{const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
   return await readRpcResponse(response,name);
  }catch(e){const code=safeCode(e),error=rpcError(code==='AI_RPC_RESPONSE_INVALID'?code:'AI_DATABASE_UNAVAILABLE',name);reportAIError(error,'classification_worker');throw error}
 };
 try{
  if(!await rpc('zy_classification_worker_authorized',{p_secret:bearer.slice(7)}))return new Response(null,{status:401});
  return Response.json(await runTaskStep(rpc,base));
 }
 catch(e){const code=reportAIError(e,'classification_worker');return Response.json({error:'CLASSIFICATION_WORKER_RETRY',code},{status:503})}
});
