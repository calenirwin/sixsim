import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
for(const scenario of [false,true])test(`Toronto TCP/Python round trip (dwell scenario: ${scenario})`, { timeout: 30000 }, async () => {
  const server = spawn(process.execPath, ['--import','./tools/tests/helpers/offline-fetch.mjs','tools/core/serve.mjs','--city','toronto','--port','0'], { cwd:root, env:{...process.env,TORONTO_TRANSIT_SCENARIO:scenario?'tools/toronto/scenarios/510-stop-dwell.json':''}, stdio:['ignore','pipe','pipe'] });
  let output='', port;
  server.stdout.on('data', b => { output+=b; port=Number(output.match(/listening on 127.0.0.1:(\d+)/)?.[1]); });
  server.stderr.on('data',b=>{output+=b;});
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error(output));},10000);
      const poll=setInterval(()=>{if(output.includes('world ready')){clearInterval(poll);clearTimeout(timeout);resolve();}else if(server.exitCode!==null){clearInterval(poll);clearTimeout(timeout);reject(new Error(output));}},25);
    });
    assert.ok(port>0);
    const script=`
import valdrada
from valdrada.transport import ValdradaError
import json, subprocess
c=valdrada.Client(port=${port},timeout=5)
try:
 w=c.get_world()
 info=c.get_server_info()
 assert info['map']=='Toronto'
 assert info['geo_origin']=={'lat':43.65,'lon':-79.397}
 assert info['capabilities']=={'road_navigation':False,'pedestrians':False,'scheduled_transit':True}
 m=w.get_map()
 p=m.geolocation_to_location(43.65,-79.397,12)
 assert abs(p.x)<1e-6 and abs(p.y)<1e-6 and p.z==12
 q=m.transform_to_geolocation(p)
 assert q.latitude==43.65 and q.longitude==-79.397
 g=w.get_transit_graph()
 assert len(g['patterns'])==7 and len(g['edges'])==85
 d=w.get_transit_departures('122948020')
 expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {torontoWorld} from './core/sim/toronto.mjs'; const {world}=await torontoWorld(); console.log(JSON.stringify(world.transit.departures('122948020')));"],text=True))
 assert d==expected
 assert d['version']==2
 assert d['rows'][3]['baseline']['following']=={'tripId':'18005020','departure':29556}
 assert d['rows'][3]['selected']['following']==d['rows'][3]['baseline']['following']
 assert d['rows'][3]['selected']['followingGapSeconds']==${scenario?'660':'720'}
 f=w.get_transit_departures('18005020')
 assert f['rows'][3]['selected']['departure']==f['rows'][3]['baseline']['departure']==29556
 assert f['rows'][3]['selected']['gapSeconds']==d['rows'][3]['selected']['followingGapSeconds']
 assert d['rows'][3]['baseline']['gapSeconds']==720
 assert d['rows'][3]['selected']['gapSeconds']==${scenario?'780':'720'}
 try: w.get_transit_departures('missing')
 except ValdradaError: pass
 else: raise AssertionError('Unknown trip accepted')
 t=w.get_transit_state()
 assert not t['omissions']
 if ${scenario?'True':'False'}:
  assert t['scenario']['tripId']=='122948020' and t['scenario']['extraDwellSeconds']==60
  assert t['deviations'][3]['arrivalDelaySeconds']==0 and t['deviations'][3]['departureDelaySeconds']==60
  assert all(d['arrivalDelaySeconds']==60 for d in t['deviations'][4:])
 else: assert t['scenario'] is None and t['deviations']==[]
 assert sum(len(x['actorIds']) for k in ['nodes','edges'] for x in t['occupancy'][k])==10
 network=w.get_source_network()
 assert network['coordinates']=='EPSG:4326' and network['routing'] is False
 assert len(network['roads'])==1589 and len(network['stops'])==81
 assert t['provenance']['subset_sha256']=='6fbce770e767f802f088bd152974d32a4ed7ec319efc1fc5b9cdeed45b8a7f1f'
 assert t['basis']=='schedule-derived' and len(t['actors'])==10
 assert t['service_day']=='20261022' and t['service_seconds']==28800
 w.tick()
 assert abs(w.get_transit_state()['service_seconds']-28800.05)<1e-8
 assert w.get_snapshot().frame>=1
 assert w._call('map.get_spawn_points')==[]
 assert w._call('map.get_junctions')==[]
 for method in ['render.hello','map.waypoint_next','map.plan_walk_route']:
  try: w._call(method)
  except ValdradaError as e: assert 'unavailable' in str(e),str(e)
  else: raise AssertionError(method+' should fail explicitly')
 print('Python TCP Toronto round-trip passed')
finally: c.close()
`;
    const python=spawn('python3',['-c',script],{cwd:root,env:{...process.env,PYTHONPATH:root+'/PythonAPI',TORONTO_TRANSIT_SCENARIO:scenario?'tools/toronto/scenarios/510-stop-dwell.json':''},stdio:['ignore','pipe','pipe']});
    let result=''; python.stdout.on('data',b=>{result+=b;});python.stderr.on('data',b=>{result+=b;});
    const [code]=await once(python,'exit');assert.equal(code,0,result);
  } finally { server.kill('SIGTERM'); if(server.exitCode===null) await once(server,'exit'); }
});

test('session rejects an API origin that disagrees with its spatial tiles', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { torontoWorld } from './core/sim/toronto.mjs';
    import { createApiSession } from './core/api/session.mjs';
    const { world } = await torontoWorld();
    await assert.rejects(createApiSession({ world, geoOrigin: {lat:40.7831,lon:-73.9712} }), /origin does not match/);
    process.exit(0);
  `], { cwd: root, timeout: 10000, stdio: 'pipe' });
});
