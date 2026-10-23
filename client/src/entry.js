// One application entry; selecting data also selects its supported asset/assembly profile.
const publishedCity=import.meta.env.VITE_PUBLISHED_CITY || null;
const city=new URLSearchParams(location.search).get('city') || publishedCity || 'nyc';
try {
  if(publishedCity && city!==publishedCity)throw new Error('This deployment supports the Toronto profile only');
  if(city==='nyc') {
    document.querySelector('#loc span').textContent='New York City';
    document.querySelector('#loading p').textContent='Loading inherited NYC scene';
    document.querySelector('#help').innerHTML='Click to fly. WASD move, mouse look<br/>Shift rise, Ctrl descend, <b>Tab</b> first-person<br/>G graphics, T time, 1-6 teleport, R rain, H help';
    document.querySelector('#credits').textContent='Data: NYC Open Data and © OpenStreetMap contributors (ODbL). Vehicles and pedestrians: CARLA (CC BY 4.0). Full credits in ACKNOWLEDGEMENTS.md.';
    await import('./main.js');
  }
  else if(city==='toronto') await (await import('./toronto/runtime.js')).start();
  else throw new Error('Unsupported city profile');
} catch(e) {
  const loading=document.querySelector('#loading');loading.style.opacity='1';loading.style.display='flex';
  loading.querySelector('p').textContent=`Unable to load city: ${e.message}. Reload to retry.`;
  console.error(e);
}
