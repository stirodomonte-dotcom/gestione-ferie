// common.js
async function api(method,url,data=null){const opts={method,headers:{'Content-Type':'application/json'}};if(data)opts.body=JSON.stringify(data);const res=await fetch(url,opts);const json=await res.json();if(!res.ok)throw new Error(json.error||'Errore server');return json;}
const apiGet=url=>api('GET',url);
const apiPost=(url,d)=>api('POST',url,d);
const apiPut=(url,d)=>api('PUT',url,d);
const apiDel=url=>api('DELETE',url);
function fmtData(s){if(!s)return'-';const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
function fmtGiorni(n){const v=parseFloat(n)||0;return v===1?'1 giorno':`${v%1===0?v:v.toFixed(1)} giorni`;}
const mesi=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
function toast(msg,tipo='success'){const el=document.createElement('div');el.style.cssText=`position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;padding:.8rem 1.2rem;border-radius:10px;font-size:.9rem;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:350px;background:${tipo==='success'?'#16a34a':tipo==='error'?'#dc2626':'#d97706'};color:#fff;font-family:'DM Sans',sans-serif;`;el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3500);}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function closeAllModals(){document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('open'));}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))closeAllModals();});
function badgeStato(stato){const map={in_attesa:'attesa',approvata:'approvata',rifiutata:'rifiutata'};const labels={in_attesa:'⏳ In attesa',approvata:'✓ Approvata',rifiutata:'✗ Rifiutata'};return`<span class="badge badge-${map[stato]||'attesa'}">${labels[stato]||stato}</span>`;}
function badgeTipo(tipo){return tipo==='ferie'?'<span class="badge badge-ferie">🌴 Ferie</span>':'<span class="badge badge-permesso">⏰ Permesso</span>';}
function setActiveNav(page){document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));}
function showLoader(el,txt='Caricamento...'){el.innerHTML=`<div style="padding:2rem;text-align:center;color:var(--grigio)"><div class="spinner" style="border-color:rgba(0,0,0,.2);border-top-color:var(--blu);margin:0 auto .75rem"></div>${txt}</div>`;}
