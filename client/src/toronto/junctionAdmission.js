// Frozen illustrative windows, not observed signals or verified road permissions.
export function junctionAdmission(input,{nodeId,incomingEdgeId,outgoingEdgeId,readySeconds,clearanceSeconds}){
 const p=structuredClone(input),fail=()=>{throw Error('Invalid illustrative junction admission');};
 if(p?.version!==1||p.basis!=='illustrative-reservation'||p.nodeId!==nodeId||p.incomingEdgeId!==incomingEdgeId||p.outgoingEdgeId!==outgoingEdgeId||p.maxCrossings!==1||p.realPermissions!=='unverified'||!Number.isFinite(readySeconds)||readySeconds<0||!Number.isFinite(clearanceSeconds)||clearanceSeconds<=0)fail();
 if(Object.keys(p).sort().join()!==['version','basis','nodeId','incomingEdgeId','outgoingEdgeId','maxCrossings','realPermissions','windows','interruptions'].sort().join())fail();
 for(const intervals of [p.windows,p.interruptions]){if(!Array.isArray(intervals)||intervals.length>100)fail();let end=-1;for(const a of intervals){if(!Array.isArray(a)||a.length!==2||!a.every(Number.isFinite)||a[0]<0||a[0]<end||a[1]<=a[0]||a[1]>172800)fail();end=a[1];}}
 let grant=null;
 for(const [start,end] of p.windows){let cursor=Math.max(start,readySeconds);for(const [a,b] of p.interruptions){if(b<=cursor||a>=end)continue;if(cursor+clearanceSeconds<=Math.min(a,end)){grant=cursor;break;}cursor=Math.max(cursor,b);if(cursor>=end)break;}if(grant!==null)break;if(cursor+clearanceSeconds<=end){grant=cursor;break;}}
 return {policy:structuredClone(p),grantSeconds:grant,clearSeconds:grant===null?null:grant+clearanceSeconds};
}
