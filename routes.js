'use strict';
const {db,hashPassword,verifyPassword}=require('./database');
const {requireLogin,requireAdmin,calcolaGiorniLavorativi}=require('./middleware');

module.exports=function registerRoutes(router){

  router.get('/api/ping',(req,res)=>res.json({ok:true,ts:Date.now()}));
  router.get('/login',(req,res)=>{if(req.session&&req.session.user)return res.redirect('/dashboard');res.sendFile(__dirname+'/public/login.html');});
  router.post('/login',async(req,res)=>{
    const{username,password}=req.body;
    if(!username||!password)return res.redirect('/login?e=Inserire+credenziali');
    const u=await db.get("SELECT * FROM dipendenti WHERE username=? AND attivo=1",username.trim());
    if(!u||!verifyPassword(password,u.password_hash))return res.redirect('/login?e=Credenziali+non+valide');
    req.session.user={id:u.id,nome:u.nome,cognome:u.cognome,username:u.username,ruolo:u.ruolo,reparto:u.reparto};
    await req.saveSession();res.redirect('/dashboard');
  });
  router.get('/logout',async(req,res)=>{await req.destroySession();res.redirect('/login');});
  router.get('/',(req,res)=>res.redirect(req.session&&req.session.user?'/dashboard':'/login'));
  router.get('/dashboard',requireLogin,(req,res)=>res.sendFile(__dirname+'/public/dashboard.html'));
  router.get('/admin',requireLogin,requireAdmin,(req,res)=>res.sendFile(__dirname+'/public/admin.html'));

  router.get('/api/me',requireLogin,async(req,res)=>{
    const anno=String(new Date().getFullYear());
    const u=await db.get("SELECT * FROM dipendenti WHERE id=?",req.session.user.id);
    const stats=await db.all(`SELECT tipo, SUM(CASE WHEN stato='approvata' THEN giorni ELSE 0 END) as appr, SUM(CASE WHEN stato='in_attesa' THEN giorni ELSE 0 END) as att FROM richieste WHERE dipendente_id=? AND substr(data_inizio,1,4)=? GROUP BY tipo`,req.session.user.id,anno);
    const f=stats.find(s=>s.tipo==='ferie')||{appr:0,att:0};
    const p=stats.find(s=>s.tipo==='permesso')||{appr:0,att:0};
    res.json({...req.session.user,giorni_ferie:u.giorni_ferie,giorni_permesso:u.giorni_permesso,ferie_usate:f.appr,ferie_attesa:f.att,ferie_rimanenti:u.giorni_ferie-f.appr-f.att,permesso_usati:p.appr,permesso_attesa:p.att,permesso_rimanenti:u.giorni_permesso-p.appr-p.att});
  });

  router.get('/api/richieste',requireLogin,async(req,res)=>{
    res.json(await db.all(`SELECT r.*, d.nome||' '||d.cognome as dipendente_nome FROM richieste r JOIN dipendenti d ON d.id=r.dipendente_id WHERE r.dipendente_id=? ORDER BY r.created_at DESC`,req.session.user.id));
  });

  router.get('/api/calcola-giorni',requireLogin,async(req,res)=>{
    const{inizio,fine}=req.query;if(!inizio||!fine)return res.json({giorni:0});
    const feste=await db.all("SELECT data FROM festivita WHERE data BETWEEN ? AND ?",inizio,fine);
    res.json({giorni:calcolaGiorniLavorativi(inizio,fine,feste)});
  });

  router.get('/api/calendario',requireLogin,async(req,res)=>{
    const{start,end}=req.query;if(!start||!end)return res.json([]);
    const feste=await db.all("SELECT * FROM festivita WHERE data BETWEEN ? AND ?",start,end);
    const richieste=await db.all(`SELECT r.*,d.nome||' '||d.cognome as dname FROM richieste r JOIN dipendenti d ON d.id=r.dipendente_id WHERE r.stato='approvata' AND r.data_inizio<=? AND r.data_fine>=?`,end,start);
    const ev=feste.map(f=>({id:'f'+f.id,title:'🎉 '+f.nome,start:f.data,color:'#e74c3c',tipo:'festivita'}));
    richieste.forEach(r=>{const mine=r.dipendente_id===req.session.user.id;const color=mine?(r.tipo==='ferie'?'#27ae60':'#2980b9'):(r.tipo==='ferie'?'#95a5a6':'#bdc3c7');const fine2=new Date(r.data_fine);fine2.setDate(fine2.getDate()+1);ev.push({id:r.id,title:mine?`${r.tipo==='ferie'?'🌴':'⏰'} ${r.tipo} (TU)`:`${r.tipo==='ferie'?'🌴':'⏰'} ${r.dname}`,start:r.data_inizio,end:fine2.toISOString().slice(0,10),color,isMine:mine,tipo:r.tipo,stato:r.stato});});
    res.json(ev);
  });

  router.post('/api/richieste',requireLogin,async(req,res)=>{
    const{tipo,data_inizio,data_fine,ore_permesso,note}=req.body;
    if(!tipo||!data_inizio||!data_fine)return res.error('Dati mancanti');
    if(data_fine<data_inizio)return res.error('Data fine < data inizio');
    const feste=await db.all("SELECT data FROM festivita WHERE data BETWEEN ? AND ?",data_inizio,data_fine);
    const giorni=(tipo==='permesso'&&ore_permesso)?parseFloat(ore_permesso)/8:calcolaGiorniLavorativi(data_inizio,data_fine,feste);
    if(giorni<=0)return res.error('Nessun giorno lavorativo nel periodo');
    const sovrapp=await db.get(`SELECT id FROM richieste WHERE dipendente_id=? AND stato!='rifiutata' AND data_inizio<=? AND data_fine>=?`,req.session.user.id,data_fine,data_inizio);
    if(sovrapp)return res.error('Hai già una richiesta per questo periodo');
    const anno=data_inizio.slice(0,4);
    const u=await db.get("SELECT * FROM dipendenti WHERE id=?",req.session.user.id);
    const st=await db.get(`SELECT SUM(CASE WHEN stato='approvata' THEN giorni ELSE 0 END) as a, SUM(CASE WHEN stato='in_attesa' THEN giorni ELSE 0 END) as w FROM richieste WHERE dipendente_id=? AND tipo=? AND substr(data_inizio,1,4)=?`,req.session.user.id,tipo,anno);
    const max=tipo==='ferie'?u.giorni_ferie:u.giorni_permesso;
    const disp=max-(st.a||0)-(st.w||0);
    if(giorni>disp)return res.error(`Giorni insufficienti. Disponibili: ${disp.toFixed(1)}, richiesti: ${giorni.toFixed(1)}`);
    const r=await db.run(`INSERT INTO richieste(dipendente_id,tipo,data_inizio,data_fine,giorni,ore_permesso,note_dipendente) VALUES(?,?,?,?,?,?,?)`,req.session.user.id,tipo,data_inizio,data_fine,giorni,ore_permesso||null,note||null);
    res.json({success:true,id:r.lastInsertRowid,giorni});
  });

  router.delete('/api/richieste/:id',requireLogin,async(req,res)=>{
    const r=await db.get("SELECT * FROM richieste WHERE id=?",req.params.id);
    if(!r||r.dipendente_id!==req.session.user.id)return res.error('Non autorizzato',403);
    if(r.stato!=='in_attesa')return res.error('Puoi eliminare solo richieste in attesa');
    await db.run("DELETE FROM richieste WHERE id=?",req.params.id);res.json({success:true});
  });

  router.post('/api/cambio-password',requireLogin,async(req,res)=>{
    const{vecchia,nuova,conferma}=req.body;
    if(nuova!==conferma)return res.error('Le password non coincidono');
    if((nuova||'').length<6)return res.error('Password troppo corta');
    const u=await db.get("SELECT * FROM dipendenti WHERE id=?",req.session.user.id);
    if(!verifyPassword(vecchia,u.password_hash))return res.error('Password attuale non corretta');
    await db.run("UPDATE dipendenti SET password_hash=? WHERE id=?",hashPassword(nuova),u.id);res.json({success:true});
  });

  // ADMIN
  router.get('/api/admin/dipendenti',requireLogin,requireAdmin,async(req,res)=>res.json(await db.all("SELECT * FROM dipendenti ORDER BY cognome,nome")));

  router.post('/api/admin/dipendenti',requireLogin,requireAdmin,async(req,res)=>{
    const{nome,cognome,email,username,password,ruolo,reparto,giorni_ferie,giorni_permesso,data_assunzione}=req.body;
    if(!nome||!cognome||!email||!username||!password)return res.error('Campi obbligatori mancanti');
    try{const r=await db.run(`INSERT INTO dipendenti(nome,cognome,email,username,password_hash,ruolo,reparto,giorni_ferie,giorni_permesso,data_assunzione) VALUES(?,?,?,?,?,?,?,?,?,?)`,nome,cognome,email,username,hashPassword(password),ruolo||'dipendente',reparto||null,parseInt(giorni_ferie)||26,parseInt(giorni_permesso)||8,data_assunzione||null);res.json({success:true,id:r.lastInsertRowid});}
    catch(e){res.error(e.message.includes('UNIQUE')?'Username o email già esistente':e.message);}
  });

  router.put('/api/admin/dipendenti/:id',requireLogin,requireAdmin,async(req,res)=>{
    const{nome,cognome,email,reparto,giorni_ferie,giorni_permesso,ruolo,attivo}=req.body;
    await db.run(`UPDATE dipendenti SET nome=?,cognome=?,email=?,reparto=?,giorni_ferie=?,giorni_permesso=?,ruolo=?,attivo=? WHERE id=?`,nome,cognome,email,reparto||null,parseInt(giorni_ferie)||26,parseInt(giorni_permesso)||8,ruolo||'dipendente',attivo?1:0,req.params.id);res.json({success:true});
  });

  router.post('/api/admin/dipendenti/:id/reset-password',requireLogin,requireAdmin,async(req,res)=>{
    const{nuova_password}=req.body;if(!nuova_password||nuova_password.length<6)return res.error('Password troppo corta');
    await db.run("UPDATE dipendenti SET password_hash=? WHERE id=?",hashPassword(nuova_password),req.params.id);res.json({success:true});
  });

  router.get('/api/admin/richieste',requireLogin,requireAdmin,async(req,res)=>{
    const{stato,tipo}=req.query;let sql=`SELECT r.*,d.nome||' '||d.cognome as dipendente_nome,d.reparto FROM richieste r JOIN dipendenti d ON d.id=r.dipendente_id WHERE 1=1`;const p=[];
    if(stato){sql+=' AND r.stato=?';p.push(stato);}if(tipo){sql+=' AND r.tipo=?';p.push(tipo);}
    sql+=' ORDER BY r.created_at DESC';res.json(await db.all(sql,...p));
  });

  router.put('/api/admin/richieste/:id',requireLogin,requireAdmin,async(req,res)=>{
    const{stato,note_admin}=req.body;if(!['approvata','rifiutata','in_attesa'].includes(stato))return res.error('Stato non valido');
    await db.run(`UPDATE richieste SET stato=?,note_admin=?,approvato_da=?,updated_at=datetime('now','localtime') WHERE id=?`,stato,note_admin||null,req.session.user.id,req.params.id);res.json({success:true});
  });

  router.get('/api/admin/calendario',requireLogin,requireAdmin,async(req,res)=>{
    const{start,end}=req.query;if(!start||!end)return res.json([]);
    const feste=await db.all("SELECT * FROM festivita WHERE data BETWEEN ? AND ?",start,end);
    const richieste=await db.all(`SELECT r.*,d.nome||' '||d.cognome as dname FROM richieste r JOIN dipendenti d ON d.id=r.dipendente_id WHERE r.data_inizio<=? AND r.data_fine>=? ORDER BY r.data_inizio`,end,start);
    const colori={approvata:{ferie:'#27ae60',permesso:'#2980b9'},in_attesa:{ferie:'#f39c12',permesso:'#e67e22'},rifiutata:{ferie:'#c0392b',permesso:'#e74c3c'}};
    const ev=feste.map(f=>({id:'f'+f.id,title:'🎉 '+f.nome,start:f.data,color:'#e74c3c',tipo:'festivita'}));
    richieste.forEach(r=>{const fine2=new Date(r.data_fine);fine2.setDate(fine2.getDate()+1);ev.push({id:r.id,title:`${r.tipo==='ferie'?'🌴':'⏰'} ${r.dname}`,start:r.data_inizio,end:fine2.toISOString().slice(0,10),color:(colori[r.stato]||{})[r.tipo]||'#95a5a6',stato:r.stato,tipo:r.tipo,giorni:r.giorni});});
    res.json(ev);
  });

  router.get('/api/admin/report/mensile',requireLogin,requireAdmin,async(req,res)=>{
    const{anno,mese}=req.query;if(!anno||!mese)return res.error('Anno e mese richiesti');
    const mm=mese.padStart(2,'0');const dips=await db.all("SELECT * FROM dipendenti WHERE attivo=1 ORDER BY cognome,nome");
    const result=await Promise.all(dips.map(async d=>{
      const mr=await db.all(`SELECT tipo,SUM(giorni) as tot FROM richieste WHERE dipendente_id=? AND stato='approvata' AND substr(data_inizio,1,7)=? GROUP BY tipo`,d.id,`${anno}-${mm}`);
      const ar=await db.all(`SELECT tipo,SUM(giorni) as tot FROM richieste WHERE dipendente_id=? AND stato='approvata' AND substr(data_inizio,1,4)=? GROUP BY tipo`,d.id,anno);
      const fm=(mr.find(r=>r.tipo==='ferie')||{tot:0}).tot||0,pm=(mr.find(r=>r.tipo==='permesso')||{tot:0}).tot||0;
      const fa=(ar.find(r=>r.tipo==='ferie')||{tot:0}).tot||0,pa=(ar.find(r=>r.tipo==='permesso')||{tot:0}).tot||0;
      return{id:d.id,nome:d.nome,cognome:d.cognome,reparto:d.reparto||'-',giorni_ferie_spettanti:d.giorni_ferie,giorni_permesso_spettanti:d.giorni_permesso,ferie_mese:fm,permesso_mese:pm,ferie_anno:fa,permesso_anno:pa,ferie_residue:d.giorni_ferie-fa,permesso_residuo:d.giorni_permesso-pa};
    }));
    res.json({anno,mese:mm,dipendenti:result});
  });

  router.get('/api/admin/report/annuale',requireLogin,requireAdmin,async(req,res)=>{
    const{anno}=req.query;if(!anno)return res.error('Anno richiesto');
    const dips=await db.all("SELECT * FROM dipendenti WHERE attivo=1 ORDER BY cognome,nome");
    const mesi=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    const result=await Promise.all(dips.map(async d=>{
      const rows=await db.all(`SELECT tipo,substr(data_inizio,6,2) as m,SUM(giorni) as tot FROM richieste WHERE dipendente_id=? AND stato='approvata' AND substr(data_inizio,1,4)=? GROUP BY tipo,m`,d.id,anno);
      const fp=Array(12).fill(0),pp=Array(12).fill(0);let tf=0,tp=0;
      rows.forEach(r=>{const i=parseInt(r.m)-1;if(r.tipo==='ferie'){fp[i]+=r.tot||0;tf+=r.tot||0;}else{pp[i]+=r.tot||0;tp+=r.tot||0;}});
      return{id:d.id,nome:d.nome,cognome:d.cognome,reparto:d.reparto||'-',giorni_ferie_spettanti:d.giorni_ferie,giorni_permesso_spettanti:d.giorni_permesso,ferie_per_mese:fp,permesso_per_mese:pp,totale_ferie:tf,totale_permesso:tp,ferie_residue:d.giorni_ferie-tf,permesso_residuo:d.giorni_permesso-tp};
    }));
    res.json({anno,mesi,dipendenti:result});
  });

  router.get('/api/admin/festivita',requireLogin,requireAdmin,async(req,res)=>{
    const anno=req.query.anno||new Date().getFullYear();
    res.json(await db.all("SELECT * FROM festivita WHERE data LIKE ? ORDER BY data",`${anno}%`));
  });
  router.post('/api/admin/festivita',requireLogin,requireAdmin,async(req,res)=>{
    const{data,nome}=req.body;
    try{await db.run("INSERT INTO festivita(data,nome) VALUES(?,?)",data,nome);res.json({success:true});}
    catch(e){res.error('Data già presente');}
  });
  router.delete('/api/admin/festivita/:id',requireLogin,requireAdmin,async(req,res)=>{
    await db.run("DELETE FROM festivita WHERE id=?",req.params.id);res.json({success:true});
  });
};
