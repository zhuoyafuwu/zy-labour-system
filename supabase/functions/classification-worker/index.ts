import {runTaskStep} from './runner.ts';

Deno.serve(async(req:Request)=>{
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(bearer))return new Response(null,{status:401});
 if(req.method!=='POST')return new Response(null,{status:405});
 const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!base||!key)return new Response(null,{status:503});
 const rpc=async(name:string,data:unknown={})=>{
  const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('task-rpc');
  // finish returns void (JSON null).
  return await response.json();
 };
 try{
  if(!await rpc('zy_classification_worker_authorized',{p_secret:bearer.slice(7)}))return new Response(null,{status:401});
  return Response.json(await runTaskStep(rpc,base));
 }
 catch{return Response.json({error:'CLASSIFICATION_WORKER_RETRY'},{status:503})}
});
