// Diagnostics are fixed codes and developer-controlled steps, never provider/SQL bodies.
const codes=new Set(['AI_DATABASE_UNAVAILABLE','AI_RPC_RESPONSE_INVALID','AI_DISABLED','AI_PROVIDER_THROTTLED','AI_PROVIDER_FAILED','AI_INCOMPLETE','AI_INVALID_JSON','AI_RESPONSE_TOO_LARGE','AI_INPUT_TOO_LARGE','INVALID_PROFILE','INVALID_EVIDENCE','INVALID_SKILL','INVALID_DIRECTION','INVALID_RESULTS','INVALID_RESULT','PII_OUTPUT']);
export function safeCode(error:any){return codes.has(error?.message)?error.message:['TimeoutError','AbortError'].includes(error?.name)?'AI_TIMEOUT':'AI_UNAVAILABLE'}
export function rpcError(code:string,step:string){return Object.assign(Error(code),{rpcStep:step})}
export function reportAIError(error:any,fallbackStep:string){
 const code=safeCode(error),candidate=error?.rpcStep||fallbackStep;
 const step=typeof candidate==='string'&&/^(?:zy_[a-z_]{1,80}|profile_(?:meter|model|validation)|match_(?:meter|model|validation)|ai_matching_request|classification_worker)$/.test(candidate)?candidate:'ai_matching_request';
 console.error(JSON.stringify({code,step}));return code;
}
export async function readRpcResponse(response:Response,step:string){
 if(!response.ok)throw rpcError('AI_DATABASE_UNAVAILABLE',step);
 // PostgREST uses 204 for SQL void. Some gateways return 200 with an empty body.
 if(response.status===204)return null;
 let text:string;
 try{text=await response.text()}catch{throw rpcError('AI_DATABASE_UNAVAILABLE',step)}
 if(!text.trim())return null;
 try{return JSON.parse(text)}catch{throw rpcError('AI_RPC_RESPONSE_INVALID',step)}
}
