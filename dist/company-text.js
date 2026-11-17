/* OpenCC 1.0.5, bundled locally: no network or model calls. */
(function(root){
 const OpenCC=root.OpenCC||(typeof require==='function'?require('./vendor/opencc-t2cn.js'):null);
 const converter=OpenCC.Converter({from:'tw',to:'cn'});
 const fields=['title','employer','salary','gender','age','language','hours','rest','workContent','requirements','notes','interview','customFeeNote'];
 const text=value=>converter(String(value));
 function convert(order){const copy={...order};for(const key of fields)if(typeof copy[key]==='string')copy[key]=text(copy[key]);return copy}
 function draft(order){const copy=convert(order),M=root.ZYMatching;if(M&&order.matchProfile&&M.profileFor(order,'order').valid){const profile={...order.matchProfile,evidence:text(order.matchProfile.evidence),sourceHash:M.sourceHash(copy,'order')};if(M.profileFor({...copy,matchProfile:profile},'order').valid)copy.matchProfile=profile;else delete copy.matchProfile}return copy}
 function plan(orders){const changed=[];const converted=orders.map(order=>{const next=convert(order),keys=fields.filter(k=>order[k]!==next[k]);if(keys.length)changed.push({id:order.id,fields:keys});return next});return {orders:converted,changed,count:changed.length}}
 root.ZYCompanyText={text,convert,draft,plan,fields};if(typeof module!=='undefined'&&module.exports)module.exports=root.ZYCompanyText;
})(globalThis);
