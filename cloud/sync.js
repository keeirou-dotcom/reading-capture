const element = id => document.getElementById(id);
const status = message => { element('cloudStatus').textContent = message; };
const prefix = 'reading-cloud-v1:';
const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
const encoder = new TextEncoder();
let settings;
let token = null, expiry = 0, refreshing, activeBook;
let busyCloud = false;
function saveDraft() {
  if (!activeBook) return;
  localStorage.setItem(prefix+'fields:'+activeBook,JSON.stringify({page:element('readPage').value,note:element('readNote').value,images:element('includeImages').checked}));
}
function restoreDraft() {
  const id=currentBook()?.id;
  if(id===activeBook)return;
  saveDraft();activeBook=id;
  let d={};try{d=JSON.parse(localStorage.getItem(prefix+'fields:'+id)||'{}');}catch{}
  element('readPage').value=d.page||'';
  element('readNote').value=d.note||'';
  element('includeImages').checked=d.images===true;
}
function loadSession(){
  let d=null;try{d=JSON.parse(localStorage.getItem(prefix+'session')||'null');}catch{}
  token=d?.access_token||null;expiry=d?.expiry||0;return d;
}
function setSession(d){
  if(!d.access_token||!d.refresh_token||!Number.isFinite(Number(d.expires_in)))throw Error('認証情報が不完全です。');
  localStorage.setItem(prefix+'session',JSON.stringify({access_token:d.access_token,refresh_token:d.refresh_token,expiry:Date.now()+Number(d.expires_in)*1000}));
  sessionStorage.removeItem(prefix+'token');loadSession();
}
function clearSession(){localStorage.removeItem(prefix+'session');sessionStorage.removeItem(prefix+'token');loadSession();}
async function ensureSession(){
  if(refreshing)return refreshing;
  const d=loadSession();
  if(d&&expiry>Date.now()+60000)return;
  if(!d)throw Error('初回のGoogle認証をしてください。入力内容は保持されます。');
  const refresh=async()=>{
    const current=loadSession();
    if(current&&expiry>Date.now()+60000)return;
    if(!current)throw Error('Googleで再認証してください。');
    const {url,publishableKey}=await config();
    const r=await fetch(url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',redirect:'error',cache:'no-store',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token})});
    if(!r.ok){
      if(r.status===400||r.status===401){if(loadSession()?.refresh_token===current.refresh_token)clearSession();throw Error('認証が失効しました。Googleで再認証してください。入力内容は保持されます。');}
      throw Error('認証更新に失敗しました。再試行してください。');
    }
    setSession(await r.json());
  };
  refreshing=(navigator.locks?navigator.locks.request(prefix+'refresh',refresh):refresh()).finally(()=>{refreshing=null;});
  return refreshing;
}
const callback = new URL(location.pathname, location.origin).href;

async function config() {
  if (!settings) {
    const local = await (await fetch(new URL('./config.json', import.meta.url), {cache:'no-store'})).json();
    if (local.publicConfig) {
      const response = await fetch(local.publicConfig, {cache:'no-store',redirect:'error',credentials:'omit'});
      if (!response.ok) throw Error('クラウド接続設定を取得できません。');
      const published = await response.json();
      if (published.url !== local.url || !published.publishableKey?.startsWith('sb_publishable_')) {
        throw Error('クラウド接続設定を確認してください。');
      }
      settings = published;
    } else settings = local;
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(settings.url) || !settings.publishableKey) {
    throw Error('この配布先のクラウド接続は準備中です。');
  }
  return settings;
}
async function request(path, init, allowed = []) {
  if (!path.startsWith('/auth/v1/token')) await ensureSession();
  const {url, publishableKey} = await config();
  const response = await fetch(url + path, {...init, redirect:'error', cache:'no-store', headers:{
    apikey:publishableKey, ...(token ? {Authorization:'Bearer ' + token} : {}), ...init.headers
  }});
  if (!response.ok && !allowed.includes(response.status)) {
    throw Error(response.status === 401 || response.status === 403 ?
      '本人認証と読書用の利用許可を確認してください。' : '通信に失敗しました（HTTP ' + response.status + '）。同じ内容で再試行できます。');
  }
  return response;
}
async function login() {
  restoreDraft();saveDraft();
  const {url} = await config();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(prefix + 'pkce', verifier);
  const target = new URL('/auth/v1/authorize', url);
  target.search = new URLSearchParams({provider:'google', redirect_to:callback,
    code_challenge_method:'s256', code_challenge:base64url(await digest(encoder.encode(verifier)))});
  location.assign(target);
}
async function finishLogin() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const verifier = sessionStorage.getItem(prefix + 'pkce');
  if (!code || !verifier) return;
  url.searchParams.delete('code');
  history.replaceState(null, '', url);
  sessionStorage.removeItem(prefix + 'pkce');
  const response = await request('/auth/v1/token?grant_type=pkce', {method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({auth_code:code, code_verifier:verifier})});
  setSession(await response.json());
  status('本人認証が完了しました。');
}
async function sync() {
  const started=performance.now();
  await config();
  restoreDraft();saveDraft();
  await ensureSession();
  const authMs=performance.now()-started;
  const book = currentBook();
  if (!book) throw Error('本ライブラリーから本を選んでください。');
  const raw = element('readPage').value;
  const page = raw ? Number(raw) : null;
  if (!element('readPage').validity.valid || (raw && !Number.isSafeInteger(page))) throw Error('ページ番号を確認してください。');
  const note = element('readNote').value.trim();
  const captured = photos.map(photo => photo.blob);
  const withImages = element('includeImages').checked;
  if (!captured.length && !note && !page) throw Error('ページ、メモ、撮影画像のいずれかが必要です。');
  const hashStarted=performance.now();
  const hashes = [];
  for (const blob of captured) {
    if (withImages && (blob.type !== 'image/jpeg' || blob.size > 8*1024*1024)) throw Error('画像保存はJPEG・1枚8 MiBまでです。');
    hashes.push(hex(await digest(await blob.arrayBuffer())));
  }
  const payload = {book_id:book.id, title:book.name, last_page:page, note, capture_count:captured.length,
    image_hashes:withImages ? hashes : []};
  const draftKey = prefix + 'draft:' + book.id;
  let draft = localStorage.getItem(draftKey);
  if (!draft) { draft = crypto.randomUUID(); localStorage.setItem(draftKey, draft); }
  const id = hex(await digest(encoder.encode(JSON.stringify([draft,payload,hashes]))));
  // Identical snapshots are idempotent, even after reload or an interrupted request.
  const hashMs=performance.now()-hashStarted;
  const uploadStarted=performance.now();
  let skipped=0, sent=0;
  if (withImages) {
    let completed=0;
    const upload=async(blob,i)=>{
      const filename=hashes[i]+'.jpg';
      // Server-confirmed existence only; never trust a local upload flag.
      const info=await request('/storage/v1/object/info/reading-captures/'+filename,{method:'GET'},[400,404,405]);
      if(info.ok){skipped++;status('画像確認中 '+(++completed)+' / '+captured.length+' 枚（再送省略 '+skipped+'）');return;}
      const path = '/storage/v1/object/reading-captures/' + filename;
      const response = await request(path,{method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:blob},[400,409]);
      if (!response.ok) {
        const failure = await response.json();
        if (failure.error !== 'Duplicate' && failure.code !== 'Duplicate' && failure.message !== 'The resource already exists') throw Error('画像を登録できませんでした。再試行できます。');
      }
      if(response.ok)sent++;else skipped++;
      status('画像同期中 '+(++completed)+' / '+captured.length+' 枚（再送省略 '+skipped+'）');
    };
    for(let i=0;i<captured.length;i+=3){
      const results=await Promise.allSettled(captured.slice(i,i+3).map((blob,j)=>upload(blob,i+j)));
      const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    }
  }
  const uploadMs=performance.now()-uploadStarted;
  const recordStarted=performance.now();
  await request('/rest/v1/reading_entries?on_conflict=id',{method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},
    body:JSON.stringify({id,...payload})});
  status('「' + book.name + '」の読書記録を同期しました。撮影 ' + captured.length + ' 枚、画像保存 ' + payload.image_hashes.length + ' 枚。所要 '+((performance.now()-started)/1000).toFixed(1)+' 秒。画像送信 '+sent+' 枚、再送省略 '+skipped+' 枚。内訳：認証・設定 '+(authMs/1000).toFixed(1)+'秒、画像識別 '+(hashMs/1000).toFixed(1)+'秒、画像確認・送信 '+(uploadMs/1000).toFixed(1)+'秒、記録登録 '+((performance.now()-recordStarted)/1000).toFixed(1)+'秒。');
}
function bind(id, action) {
  element(id).onclick = async () => {
    if(busyCloud)return;
    busyCloud=true;element(id).disabled = true;
    try { await action(); } catch (error) {status(error.message);}
    finally {busyCloud=false;element(id).disabled = false; element('cloudLogout').hidden = !token;}
  };
}
bind('newReading', async () => {
  const book = currentBook();
  if (!book) throw Error('本を選択してください。');
  localStorage.setItem(prefix+'draft:'+book.id, crypto.randomUUID());
  element('readPage').value = '';
  element('readNote').value = '';
  element('includeImages').checked = false;
  saveDraft();
  status('新しいセッションです。現在の撮影セットを確認してください。');
});
bind('cloudLogin', login);
bind('cloudSync', sync);
bind('cloudLogout', async () => {
  try { await request('/auth/v1/logout?scope=local', {method:'POST'}); }
  finally {clearSession();}
  status('ログアウトしました。');
});
restoreDraft();
for(const id of ['readPage','readNote','includeImages'])element(id).addEventListener('input',saveDraft);
element('bookSelect').addEventListener('change',restoreDraft);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveDraft();});
loadSession();
busyCloud=true;
finishLogin().then(async()=>{if(token){await ensureSession();status('本人認証済みです。');}}).catch(error=>status(error.message)).finally(()=>{busyCloud=false;element('cloudLogout').hidden=!token;});
