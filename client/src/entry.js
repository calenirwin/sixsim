// One application entry; selecting data also selects its supported asset/assembly profile.
const city=new URLSearchParams(location.search).get('city') || 'nyc';
try {
  if(city==='nyc') await import('./main.js');
  else if(city==='toronto') await (await import('./toronto/runtime.js')).start();
  else throw new Error('Unsupported city profile');
} catch(e) {
  const loading=document.querySelector('#loading');loading.style.opacity='1';loading.style.display='flex';
  loading.querySelector('p').textContent=`Unable to load city: ${e.message}. Reload to retry.`;
  console.error(e);
}
