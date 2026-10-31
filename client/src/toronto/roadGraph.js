// Source topology experiment only; not a navigation or traffic model.
export function roadGraph(data){
 if(data?.version!==1||data.basis!=='directed-source-street-topology'||!Array.isArray(data.nodes)||data.nodes.length>100000||!Array.isArray(data.edges)||data.edges.length>100000)throw Error('Invalid source road graph');
 const nodes=new Map(),edges=new Map(),adj=new Map();for(const n of data.nodes){if(n.length!==3||!Number.isSafeInteger(n[0])||n[0]<=0||nodes.has(n[0])||!Number.isFinite(n[1])||Math.abs(n[1])>180||!Number.isFinite(n[2])||Math.abs(n[2])>90)throw Error('Invalid source intersection');nodes.set(n[0],[...n]);adj.set(n[0],[]);}
 for(const e of data.edges){const [id,a,b,dir,length]=e;if(e.length!==5||!Number.isSafeInteger(id)||id<=0||edges.has(id)||!nodes.has(a)||!nodes.has(b)||![-1,0,1].includes(dir)||!Number.isFinite(length)||length<=0||length>100000)throw Error('Invalid source road edge');edges.set(id,[...e]);const mm=Math.round(length*1000);if(mm<1)throw Error('Invalid source edge weight');if(dir!==-1)adj.get(a).push({id,to:b,mm});if(dir!==1)adj.get(b).push({id,to:a,mm});}
 for(const arcs of adj.values())arcs.sort((a,b)=>a.id-b.id||a.to-b.to);return {nodes,edges,adj};
}
export function sourceRoadPath(graph,from,to){
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||!graph.nodes.has(from)||!graph.nodes.has(to))throw Error('Unknown or invalid source intersection');
 const heap=[],less=(a,b)=>a[0]<b[0]||(a[0]===b[0]&&a[1]<b[1]);
 function push(v){let i=heap.length;heap.push(v);while(i){const p=(i-1)>>1;if(!less(v,heap[p]))break;heap[i]=heap[p];i=p;heap[i]=v;}}
 function pop(){const first=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&less(heap[c+1],heap[c]))c++;if(!less(heap[c],heap[i]))break;[heap[c],heap[i]]=[heap[i],heap[c]];i=c;}}return first;}
 const distances=new Map([[from,0]]),previous=new Map();push([0,from]);let expanded=0;
 while(heap.length){const [distance,node]=pop();if(distance!==distances.get(node))continue;expanded++;if(node===to)break;for(const arc of graph.adj.get(node)){const next=distance+arc.mm;if(next<(distances.get(arc.to)??Infinity)){distances.set(arc.to,next);previous.set(arc.to,{node,edge:arc.id});push([next,arc.to]);}}}
 const common={basis:'directed-source-street-topology',navigation_ready:false,traffic_interactions:false,geometry_included:false,from_intersection:from,to_intersection:to,expanded_nodes:expanded};
 if(!distances.has(to))return {...common,status:'unreachable',nodes:[],edges:[],distance_m:null};
 const nodes=[to],edges=[];let n=to;while(n!==from){const p=previous.get(n);edges.push({id:p.edge,from:p.node,to:n,length_m:graph.edges.get(p.edge)[4]});nodes.push(p.node);n=p.node;}nodes.reverse();edges.reverse();return {...common,status:'found',nodes:nodes.map(id=>[...graph.nodes.get(id)]),edges,distance_m:distances.get(to)/1000};
}
