import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),T=require('../dist/company-text.js');
const source={id:'synthetic',raw:'粵語、視頻面試、輪班、績效獎金',code:'ZY-26-1117-01',title:'倉務員',language:'粵語',interview:'視頻面試',hours:'輪班',salary:'HKD16000+績效獎金',price:'3.8w',customFeeNote:'劳务，服务费管理费：3.8w全包\n以上内容仅供参考，具体信息以面试为准',humanReviewedAt:'2026-11-17T00:00:00Z',reviewConfirmation:'unchanged',matchProfile:{major:'logistics'},parsedSnapshot:'{"title":"倉務員"}'};
const p=T.plan([source]);assert.equal(p.count,1);const out=p.orders[0];assert.equal(out.language,'粤语');assert.equal(out.interview,'视频面试');assert.equal(out.hours,'轮班');assert.equal(out.salary,'HKD16000+绩效奖金');
for(const key of Object.keys(source).filter(k=>!T.fields.includes(k)))assert.deepEqual(out[key],source[key],key);
assert.equal(out.customFeeNote,source.customFeeNote);assert.deepEqual(T.plan(p.orders).changed,[]);assert.equal(source.title,'倉務員');
assert.equal(T.text('視頻面試地址為合成資料，電話不公開'),'视频面试地址为合成资料，电话不公开');
console.log('PASS: local company conversion, original/price/review preservation, immutable preview and idempotence');

require('../dist/order-parser.js');const P=globalThis.ZYOrderParser,raw='【職位】倉務員\n【雇主】合成物流公司\n【月薪】HKD16800\n【性別】男\n【語言】粵語\n【工作時間】輪班\n【面試】視頻面試\n【工作內容】整理貨物';
const parsed=P.analyze(raw,'ZY-26-1117-01',{explicitBoundary:true}).order,generated=T.convert(parsed);assert.equal(generated.raw,raw);assert(generated.language.includes('粤语'));assert(generated.hours.includes('轮班'));assert(generated.interview.includes('视频面试'));assert.equal(generated.recognitionAudit,parsed.recognitionAudit);

const M=require('../dist/matching.js');globalThis.ZYMatching=M;const fresh={title:'倉務員',workContent:'整理貨物'};fresh.matchProfile={version:2,by:'ai',sourceHash:M.sourceHash(fresh,'order'),major:'logistics',subcategory_id:'seed:warehouse',evidence:'倉務員'};const draft=T.draft(fresh);assert(M.profileFor(draft).valid);assert.equal(draft.matchProfile.evidence,'仓务员');assert.equal(fresh.matchProfile.evidence,'倉務員');assert.equal(T.convert(fresh).matchProfile,fresh.matchProfile);
