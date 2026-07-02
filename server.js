'use strict';
const http=require('http');
const {Router}=require('./framework');
const registerRoutes=require('./routes');

const PORT=process.env.PORT||3000;
const router=new Router();
registerRoutes(router);

const server=http.createServer(async(req,res)=>{
  try{await router.handle(req,res);}
  catch(err){console.error('[ERRORE]',err);if(!res.headersSent){res.writeHead(500,{'Content-Type':'text/plain'});res.end('Errore interno');}}
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   GESTIONE FERIE & PERMESSI — Attivo!            ║');
  if(process.env.TURSO_URL){
    console.log(`║   Online — porta ${PORT}                            ║`);
  } else {
    const os=require('os'),nets=os.networkInterfaces();let ip='localhost';
    for(const iface of Object.values(nets))for(const n of iface)if(n.family==='IPv4'&&!n.internal){ip=n.address;break;}
    console.log(`║   Locale:  http://localhost:${PORT}                 ║`);
    console.log(`║   Rete:    http://${ip}:${PORT}               ║`);
  }
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║   Admin: username=admin  password=Admin2024!     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
