// offline.js
const OfflineManager=(()=>{
  let idb=null;
  async function openDB(){if(idb)return idb;return new Promise((res,rej)=>{const req=indexedDB.open('gf-offline',1);req.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('sync_queue'))db.createObjectStore('sync_queue',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('cache_dati'))db.createObjectStore('cache_dati',{keyPath:'chiave'});};req.onsuccess=e=>{idb=e.target.result;res(idb);};req.onerror=e=>rej(e.target.error);});}
  async function idbGet(store,key){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).get(key);req.onsuccess=e=>res(e.target.result);req.onerror=e=>rej(e.target.error);});}
  async function idbPut(store,val){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(val);tx.oncomplete=res;tx.onerror=rej;});}
  async function idbGetAll(store){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).getAll();req.onsuccess=e=>res(e.target.result);req.onerror=e=>rej(e.target.error);});}
  async function idbDelete(store,key){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=res;tx.onerror=rej;});}
  let isOnline=navigator.onLine;const listeners=[];
  function onStatusChange(fn){listeners.push(fn);}
  function notifyListeners(online){isOnline=online;listeners.forEach(fn=>fn(online));updateBanner(online);}
  window.addEventListener('online',()=>{notifyListeners(true);syncQueue();});
  window.addEventListener('offline',()=>notifyListeners(false));
  setInterval(async()=>{try{const r=await fetch('/api/ping?'+Date.now(),{cache:'no-store'});if(!isOnline&&r.ok)notifyListeners(true);}catch{if(isOnline)notifyListeners(false);}},15000);
  function updateBanner(online){let b=document.getElementById('offline-banner');if(!b){b=document.createElement('div');b.id='offline-banner';b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;padding:.6rem 1rem;font-size:.85rem;font-weight:600;text-align:center;transition:transform .3s ease;display:flex;align-items:center;justify-content:center;gap:.5rem;font-family:DM Sans,sans-serif;';document.body.prepend(b);}if(online){b.style.background='#16a34a';b.style.color='#fff';b.innerHTML='✓ Connessione ripristinata — sincronizzazione in corso...';b.style.transform='translateY(0)';setTimeout(()=>{b.style.transform='translateY(-100%)';},3000);}else{b.style.background='#d97706';b.style.color='#fff';b.innerHTML='⚠ Modalità offline — dati dalla cache locale';b.style.transform='translateY(0)';}}
  async function cacheData(chiave,dati){await idbPut('cache_dati',{chiave,dati,ts:Date.now()});}
  async function getCachedData(chiave){const r=await idbGet('cache_dati',chiave);return r?r.dati:null;}
  async function queueRequest(method,url,body){await idbPut('sync_queue',{method,url,body:JSON.stringify(body),ts:Date.now()});}
  async function syncQueue(){const items=await idbGetAll('sync_queue');if(!items.length)return;let synced=0;for(const item of items){try{const resp=await fetch(item.url,{method:item.method,headers:{'Content-Type':'application/json'},body:item.body});if(resp.ok){await idbDelete('sync_queue',item.id);synced++;}}catch{}}if(synced>0){toast(`✓ ${synced} richiesta/e sincronizzata/e`,'success');window.dispatchEvent(new CustomEvent('gf:synced'));}const rem=await idbGetAll('sync_queue');updateQueueBadge(rem.length);}
  async function getQueueCount(){return(await idbGetAll('sync_queue')).length;}
  function updateQueueBadge(count){let b=document.getElementById('offline-queue-badge');if(count>0){if(!b){b=document.createElement('div');b.id='offline-queue-badge';b.style.cssText='position:fixed;bottom:1rem;right:1rem;z-index:9998;background:#d97706;color:#fff;padding:.5rem 1rem;border-radius:20px;font-size:.82rem;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.2);cursor:pointer;font-family:DM Sans,sans-serif;';b.onclick=()=>syncQueue();document.body.appendChild(b);}b.textContent=`⏳ ${count} in coda — Tocca per sincronizzare`;b.style.display='block';}else if(b){b.style.display='none';}}
  (async()=>{const c=await getQueueCount();updateQueueBadge(c);if(!navigator.onLine)updateBanner(false);})();
  if('serviceWorker'in navigator){navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='SYNC_OK'){toast('✓ Richiesta sincronizzata','success');window.dispatchEvent(new CustomEvent('gf:synced'));}});}
  return{isOnline:()=>isOnline,onStatusChange,cacheData,getCachedData,queueRequest,syncQueue,getQueueCount};
})();

if('serviceWorker'in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').then(reg=>{window.addEventListener('online',()=>{if(reg.sync)reg.sync.register('sync-richieste').catch(()=>{});});}).catch(()=>{});});}

const _apiGet=window.apiGet;
window.apiGet=async function(url){try{const data=await _apiGet(url);await OfflineManager.cacheData(url,data);return data;}catch(err){if(!OfflineManager.isOnline()){const cached=await OfflineManager.getCachedData(url);if(cached)return cached;}throw err;}};
const _apiPost=window.apiPost;
window.apiPost=async function(url,data){if(!OfflineManager.isOnline()){await OfflineManager.queueRequest('POST',url,data);return{success:true,queued:true,message:'Salvato offline'};}return _apiPost(url,data);};
