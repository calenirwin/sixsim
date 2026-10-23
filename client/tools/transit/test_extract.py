import unittest,importlib.util,csv,io,zipfile,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('extract',Path(__file__).with_name('extract.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Tests(unittest.TestCase):
 def test_midnight(self):
  self.assertEqual(mod.seconds('25:47:00'),92820)
  for value in ['24:60:00','12:00','-1:00:00']: self.assertRaises(ValueError,mod.seconds,value)
 def test_calendar_exceptions(self):
  c=[dict(service_id='weekday',start_date='20261001',end_date='20261031',monday='1',tuesday='1',wednesday='1',thursday='1',friday='1',saturday='0',sunday='0')]
  e=[dict(service_id='weekday',date='20261022',exception_type='2'),dict(service_id='special',date='20261022',exception_type='1')]
  self.assertEqual(mod.services(c,e,'20261022'),{'special'})
  self.assertEqual(mod.services(c,[],'20261024'),set())
  self.assertEqual(mod.services([],e,'20261022'),{'special'})
 def test_csv_and_missing_shape(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'feed.zip'
   rows={'agency.txt':[dict(agency_id='a',agency_timezone='America/Toronto')],'routes.txt':[dict(route_id='r',agency_id='a',route_short_name='510',route_type='0')],'calendar_dates.txt':[dict(service_id='s',date='20261022',exception_type='1')],'trips.txt':[dict(trip_id='t',route_id='r',service_id='s',shape_id='missing',trip_headsign='Quoted, name')],'stops.txt':[dict(stop_id='1'),dict(stop_id='2')],'stop_times.txt':[dict(trip_id='t',stop_id=str(i),stop_sequence=str(i),arrival_time=t,departure_time=t) for i,t in [(1,'23:59:00'),(2,'24:03:00')]]}
   with zipfile.ZipFile(p,'w') as z:
    for n,rs in rows.items():
     f=io.StringIO(newline='');w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows(rs);z.writestr(n,f.getvalue())
   a=mod.extract(p,'20261022','510');self.assertEqual(a,mod.extract(p,'20261022','510'));self.assertEqual(a['missing_shapes'],['missing']);self.assertEqual(a['trips'][0]['trip_headsign'],'Quoted, name')
if __name__=='__main__':unittest.main()
