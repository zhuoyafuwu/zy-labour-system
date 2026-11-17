import assert from 'node:assert/strict';
let handler:any,requests=0;const secret='a'.repeat(64);
const env:any={SUPABASE_URL:'https://synthetic.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
(globalThis as any).Deno={env:{get:(key:string)=>env[key]},serve:(fn:any)=>handler=fn};
globalThis.fetch=async(url:any,options:any)=>{requests++;if(String(url).endsWith('zy_classification_worker_authorized'))return Response.json(JSON.parse(options.body).p_secret===secret);if(String(url).endsWith('zy_ai_pending_profiles'))return Response.json([]);assert(String(url).endsWith('zy_classification_task_claim'));assert.equal(options.headers.Authorization,'Bearer synthetic-service');return Response.json(null)};
await import('../supabase/functions/classification-worker/index.ts');
for(const auth of ['', 'Bearer synthetic-user-jwt','Bearer synthetic-service']){
 assert.equal((await handler(new Request('https://synthetic.example',{method:'POST',headers:{authorization:auth}}))).status,401);
}
assert.equal(requests,0);
assert.equal((await handler(new Request('https://synthetic.example',{headers:{authorization:'Bearer '+secret}}))).status,405);
assert.equal(requests,0);
const r=await handler(new Request('https://synthetic.example',{method:'POST',headers:{authorization:'Bearer '+secret}}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{processed:false});assert.equal(requests,3);
console.log('PASS: worker rejects browser/user/service credentials; scheduler-only POST and no model request without a task');
