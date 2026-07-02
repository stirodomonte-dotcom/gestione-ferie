'use strict';
async function requireLogin(req,res,next){if(req.session&&req.session.user)return next();return res.redirect('/login');}
async function requireAdmin(req,res,next){if(req.session&&req.session.user&&req.session.user.ruolo==='admin')return next();return res.error('Accesso negato',403);}
function calcolaGiorniLavorativi(inizio,fine,festivita=[]){
  const festSet=new Set(festivita.map(f=>f.data));let count=0;
  const cur=new Date(inizio+'T00:00:00'),end=new Date(fine+'T00:00:00');
  while(cur<=end){const dow=cur.getDay(),ds=cur.toISOString().slice(0,10);if(dow!==0&&dow!==6&&!festSet.has(ds))count++;cur.setDate(cur.getDate()+1);}
  return count;
}
module.exports={requireLogin,requireAdmin,calcolaGiorniLavorativi};
