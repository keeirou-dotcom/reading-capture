const element = id => document.getElementById(id);
const status = message => { element('cloudStatus').textContent = message; };
const prefix = 'reading-cloud-v1:';
const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
const encoder = new TextEncoder();
let settings;
let token = sessionStorage.getItem(prefix + 'token');
const callback = new URL(location.pathname, location.origin).href;

async function config() {
  if (!settings) settings = await (await fetch(new URL('./config.json', import.meta.url), {cache:'no-store'})).json();
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(settings.url) || !settings.publishableKey) {
    throw Error('この配布先のクラウド接続は準備中です。');
  }
  return settings;
}
async function request(path, init, allowed = []) {
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
  token = (await response.json()).access_token;
  if (!token) throw Error('ログインを完了できませんでした。');
  sessionStorage.setItem(prefix + 'token', token);
  status('本人認証が完了しました。');
}
async function sync() {
  await config();
  if (!token) throw Error('先にGoogleで本人認証してください。');
  const book = currentBook();
  if (!book) throw Error('本ライブラリーから本を選んでください。');
  const raw = element('readPage').value;
  const page = raw ? Number(raw) : null;
  if (!element('readPage').validity.valid || (raw && !Number.isSafeInteger(page))) throw Error('ページ番号を確認してください。');
  const note = element('readNote').value.trim();
  const captured = photos.map(photo => photo.blob);
  const withImages = element('includeImages').checked;
  if (!captured.length && !note && !page) throw Error('ページ、メモ、撮影画像のいずれかが必要です。');
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
  if (withImages) {
    for (const [i, blob] of captured.entries()) {
      const path = '/storage/v1/object/reading-captures/' + hashes[i] + '.jpg';
      const response = await request(path,{method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:blob},[400,409]);
      if (!response.ok) {
        const failure = await response.json();
        if (failure.error !== 'Duplicate' && failure.code !== 'Duplicate' && failure.message !== 'The resource already exists') throw Error('画像を登録できませんでした。再試行できます。');
      }
    }
  }
  await request('/rest/v1/reading_entries?on_conflict=id',{method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},
    body:JSON.stringify({id,...payload})});
  status('「' + book.name + '」の読書記録を同期しました。撮影 ' + captured.length + ' 枚、画像保存 ' + payload.image_hashes.length + ' 枚。');
}
function bind(id, action) {
  element(id).onclick = async () => {
    element(id).disabled = true;
    try { await action(); } catch (error) {status(error.message);}
    finally {element(id).disabled = false; element('cloudLogout').hidden = !token;}
  };
}
bind('newReading', async () => {
  const book = currentBook();
  if (!book) throw Error('本を選択してください。');
  localStorage.setItem(prefix+'draft:'+book.id, crypto.randomUUID());
  element('readPage').value = '';
  element('readNote').value = '';
  element('includeImages').checked = false;
  status('新しいセッションです。現在の撮影セットを確認してください。');
});
bind('cloudLogin', login);
bind('cloudSync', sync);
bind('cloudLogout', async () => {
  try { await request('/auth/v1/logout?scope=local', {method:'POST'}); }
  finally {token = null; sessionStorage.removeItem(prefix+'token');}
  status('ログアウトしました。');
});
finishLogin().catch(error => status(error.message)).finally(() => {element('cloudLogout').hidden = !token;});
