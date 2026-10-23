"""Bounded, streaming GTFS selection; standard library only. No network access."""
import argparse,csv,datetime,hashlib,io,json,zipfile
from pathlib import Path

def seconds(value):
    parts=value.split(':')
    if len(parts)!=3 or not all(p.isdigit() for p in parts): raise ValueError('Invalid GTFS time: '+value)
    h,m,s=map(int,parts)
    if m>=60 or s>=60: raise ValueError('Invalid GTFS time: '+value)
    return h*3600+m*60+s

def services(calendar,exceptions,day):
    weekday=datetime.datetime.strptime(day,'%Y%m%d').strftime('%A').lower()
    active={r['service_id'] for r in calendar if r['start_date']<=day<=r['end_date'] and r[weekday]=='1'}
    for r in exceptions:
        if r['date']==day:
            if r['exception_type']=='1': active.add(r['service_id'])
            elif r['exception_type']=='2': active.discard(r['service_id'])
            else: raise ValueError('Invalid calendar exception')
    return active

def extract(archive,day,route):
    with zipfile.ZipFile(archive) as z:
        if sum(i.file_size for i in z.infolist())>600_000_000: raise ValueError('Uncompressed archive budget exceeded')
        def rows(name):
            if name not in z.namelist(): return iter(())
            return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig',newline=''))
        calendar=list(rows('calendar.txt')); exceptions=list(rows('calendar_dates.txt'))
        active=services(calendar,exceptions,day)
        routes=[r for r in rows('routes.txt') if r['route_short_name']==route and r['route_type']=='0']
        if len(routes)!=1: raise ValueError('Expected one streetcar route')
        agency=[r for r in rows('agency.txt') if r['agency_id']==routes[0]['agency_id']]
        if len(agency)!=1 or agency[0]['agency_timezone']!='America/Toronto': raise ValueError('Unexpected timezone')
        trips=[r for r in rows('trips.txt') if r['route_id']==routes[0]['route_id'] and r['service_id'] in active]
        ids={r['trip_id'] for r in trips}
        if not ids or len(ids)!=len(trips): raise ValueError('No trips or duplicate trip IDs')
        times=[r for r in rows('stop_times.txt') if r['trip_id'] in ids]
        stop_ids={r['stop_id'] for r in times}
        all_stops={r['stop_id']:r for r in rows('stops.txt')}
        pending=list(stop_ids)
        while pending:
            sid=pending.pop()
            if sid not in all_stops: raise ValueError('Missing stop or parent station: '+sid)
            parent=all_stops[sid].get('parent_station','')
            if parent and parent not in stop_ids: stop_ids.add(parent);pending.append(parent)
        stops=[all_stops[sid] for sid in sorted(stop_ids)]
        shape_ids={r.get('shape_id','') for r in trips}
        shapes=[r for r in rows('shapes.txt') if r['shape_id'] in shape_ids]
        used={r['service_id'] for r in trips}
        result=dict(version=1,service_day=day,timezone='America/Toronto',coordinates='EPSG:4326',agency=agency,routes=routes,trips=sorted(trips,key=lambda r:r['trip_id']),stops=sorted(stops,key=lambda r:r['stop_id']),stop_times=sorted(times,key=lambda r:(r['trip_id'],int(r['stop_sequence']))),shapes=sorted(shapes,key=lambda r:(r['shape_id'],int(r['shape_pt_sequence']))),calendar=[r for r in calendar if r['service_id'] in used],calendar_dates=exceptions,feed_info=list(rows('feed_info.txt')))
        groups={t:[] for t in ids}
        for r in result['stop_times']: groups[r['trip_id']].append(r)
        for t,rs in groups.items():
            if len(rs)<2: raise ValueError('Trip lacks two stops: '+t)
            prev=-1; seq=-1
            for row in rs:
                a,b=seconds(row['arrival_time']),seconds(row['departure_time']); n=int(row['stop_sequence'])
                if not prev<=a<=b or n<=seq: raise ValueError('Nonmonotonic times/sequence: '+t)
                prev=b;seq=n
        result['missing_shapes']=sorted(shape_ids-{r['shape_id'] for r in shapes})
        return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('--day',default='20261022');p.add_argument('--route',default='510');p.add_argument('--output',default='client/fixtures/transit/510-20261022.json');a=p.parse_args()
    result=extract(a.archive,a.day,a.route)
    result['source_sha256']=hashlib.sha256(Path(a.archive).read_bytes()).hexdigest()
    Path(a.output).write_text(json.dumps(result,sort_keys=True,separators=(',',':'))+'\n')
    print({k:len(result[k]) for k in ['routes','trips','stops','stop_times','shapes']},'missing shapes',result['missing_shapes'])
