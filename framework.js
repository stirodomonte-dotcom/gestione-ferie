'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {sessions}=require('./database');
const MIME={'.html':'text/html;charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.woff2':'font/woff2'};

function parseCookies(req){
  const out={};
  (req.headers.cookie||'').split(';').forEach(function(c){
    const idx=c.indexOf('=');
    if(idx>0){const k=c.slice(0,idx).trim();const v=c.slice(idx+1).trim();try{out[k]=decodeURIComponent(v);}catch(e){out[k]=v;}}
  });
  return out;
}

function setCookie(res,name,value,opts){
  opts=opts||{};
  const p=[name+'='+encodeURIComponent(value)];
  if(opts.maxAge)p.push('Max-Age='+opts.maxAge);
  if(opts.httpOnly)p.push('HttpOnly');
  p.push('Path=/; SameSite=Lax');
  res.setHeader('Set-Cookie',p.join('; '));
}

async function loadSession(req,res){
  const cookies=parseCookies(req);
  let sid=cookies['sid'];
  let data=sid ? await sessions.get(sid) : null;
  if(!sid||!data){sid=crypto.randomBytes(24).toString('hex');data={};}
  req.session=data; req.sessionId=sid;
  req.saveSession=async function(){await sessions.set(sid,req.session);setCookie(res,'sid',sid,{maxAge:28800,httpOnly:true});};
  req.destroySession=async function(){await sessions.destroy(sid);setCookie(res,'sid','',{maxAge:0,httpOnly:true});};
}

function parseBody(req){
  return new Promise(function(resolve){
    let body='';
    req.on('data',function(c){body+=c;if(body.length>1e6)req.destroy();});
    req.on('end',function(){
      const ct=req.headers['content-type']||'';
      let result={};
      if(ct.includes('application/json')){
        try{result=JSON.parse(body);}catch(e){result={};}
      } else {
        try{
          body.split('&').forEach(function(pair){
            const idx=pair.indexOf('=');
            if(idx>-1){
              const k=decodeURIComponent(pair.slice(0,idx).replace(/\+/g,' '));
              const v=decodeURIComponent(pair.slice(idx+1).replace(/\+/g,' '));
              result[k]=v;
            }
          });
        }catch(e){result={};}
      }
      resolve(result);
    });
  });
}

function sendJSON(res,data,status){
  const s=status||200;
  const body=JSON.stringify(data);
  res.writeHead(s,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}

function sendFile(res,filePath){
  fs.readFile(filePath,function(err,data){
    if(err){res.writeHead(404);res.end('Not found');return;}
    const ext=path.extname(filePath);
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});
    res.end(data);
  });
}

function redirect(res,location){res.writeHead(302,{Location:location});res.end();}

class Router{
  constructor(){this.routes=[];}

  _add(method,pattern,handlers){
    const keys=[];
    const src='^'+pattern.replace(/:([^/]+)/g,function(full,k){keys.push(k);return'([^/]+);';})+' $';
    // Rimuovo il ; che avevo messo come separatore e costruisco regex corretta
    const rxSrc='^'+pattern.replace(/:([^/]+)/g,function(full,k){keys.push(k);return'([^/]+)';})+' $';
    // Pattern corretto senza caratteri strani
    const finalSrc='^'+pattern.replace(/:([^/]+)/g,'([^/]+')+')'+' $';
    // Usiamo un approccio semplice
    this.routes.push({method:method,pattern:pattern,keys:keys,handlers:handlers});
  }

  get(pattern){this._add('GET',pattern,Array.prototype.slice.call(arguments,1));}
  post(pattern){this._add('POST',pattern,Array.prototype.slice.call(arguments,1));}
  put(pattern){this._add('PUT',pattern,Array.prototype.slice.call(arguments,1));}
  delete(pattern){this._add('DELETE',pattern,Array.prototype.slice.call(arguments,1));}

  _match(pattern,urlPath){
    const keys=[];
    const regexStr='^'+pattern.replace(/:([^/]+)/g,function(m,k){keys.push(k);return'([^/]+)'})+'$';
    const rx=new RegExp(regexStr);
    const m=urlPath.match(rx);
    if(!m)return null;
    const params={};
    keys.forEach(function(k,i){params[k]=decodeURIComponent(m[i+1]);});
    return params;
  }

  async handle(req,res){
    const url=new URL(req.url,'http://'+req.headers.host);
    req.path=url.pathname;
    req.query=Object.fromEntries(url.searchParams);
    req.method=req.method.toUpperCase();
    req.body=['POST','PUT','PATCH'].includes(req.method) ? await parseBody(req) : {};
    await loadSession(req,res);
    const self=this;
    res.json=function(d,s){sendJSON(res,d,s);};
    res.redirect=function(l){redirect(res,l);};
    res.sendFile=function(p){sendFile(res,p);};
    res.error=function(msg,s){sendJSON(res,{error:msg},s||400);};

    if(req.method==='GET'){
      const sp=path.join(__dirname,'public',req.path==='/'?'':req.path);
      try{if(fs.existsSync(sp)&&fs.statSync(sp).isFile())return sendFile(res,sp);}catch(e){}
    }

    for(let i=0;i<this.routes.length;i++){
      const route=this.routes[i];
      if(route.method!==req.method)continue;
      const params=this._match(route.pattern,req.path);
      if(params===null)continue;
      req.params=params;
      let idx=0;
      const handlers=route.handlers;
      const next=async function(){const h=handlers[idx++];if(h)await h(req,res,next);};
      await next();
      return;
    }
    res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');
  }
}

module.exports={Router:Router,redirect:redirect,sendFile:sendFile,sendJSON:sendJSON};
