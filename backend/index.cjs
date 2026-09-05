'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLUGIN_ID = 'netease-personal-music-source';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookie.txt');
const QQ_COOKIE_FILE = path.join(DATA_DIR, 'qq-cookie.txt');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_LOCAL_DIR = path.join(DATA_DIR, 'local-music');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.webm', '.opus']);
const MIME_TYPES = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.webm': 'audio/webm', '.opus': 'audio/ogg',
};

let ncmApi = null;
let qqSdk = null;
let qqServices = null;
let userCookie = '';
let qqCookie = '';
let localTracks = [];
let localTrackMap = new Map();
let config = {
  localMusicDir: DEFAULT_LOCAL_DIR,
  providers: {
    netease: { enabled: true },
    qq: { enabled: true, apiBase: '' },
    kugou: { enabled: false, apiBase: '' },
  },
};

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(DEFAULT_LOCAL_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* Android/shared filesystems may reject chmod. */ }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  }
}

function loadConfig() {
  ensureStorage();
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const candidate = typeof parsed.localMusicDir === 'string' ? parsed.localMusicDir.trim() : '';
    config.localMusicDir = candidate ? path.resolve(candidate) : DEFAULT_LOCAL_DIR;
    const providers = parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {};
    config.providers = {
      netease: { enabled: true },
      qq: { enabled: true, apiBase: String(providers.qq?.apiBase || '') },
      kugou: { enabled: false, apiBase: String(providers.kugou?.apiBase || '') },
    };
  } catch (error) {
    console.warn(`[${PLUGIN_ID}] Could not read config.json:`, error.message);
    config.localMusicDir = DEFAULT_LOCAL_DIR;
  }
}

function normalizeCookie(input) {
  let raw = String(input || '').trim();
  if (!raw) return '';
  try { raw = decodeURIComponent(raw); } catch { /* Already decoded. */ }
  raw = raw.replace(/[\r\n]/g, '').trim();
  if (!raw.includes('=')) return `MUSIC_U=${raw}`;
  const parts = raw.split(';').map(part => part.trim()).filter(Boolean);
  const musicU = parts.find(part => /^MUSIC_U=/i.test(part));
  if (!musicU && parts.length === 1 && !raw.startsWith('MUSIC_U=')) return `MUSIC_U=${raw}`;
  return parts.join('; ');
}

function loadCookie() {
  ensureStorage();
  try { userCookie = normalizeCookie(fs.readFileSync(COOKIE_FILE, 'utf8')); }
  catch { userCookie = ''; }
  return userCookie;
}

function saveCookie(cookie) {
  userCookie = normalizeCookie(cookie);
  if (!userCookie) {
    try { fs.rmSync(COOKIE_FILE, { force: true }); } catch { /* Ignore. */ }
    return;
  }
  fs.writeFileSync(COOKIE_FILE, `${userCookie}\n`, { mode: 0o600 });
  try { fs.chmodSync(COOKIE_FILE, 0o600); } catch { /* Ignore. */ }
}

function normalizeQqCookie(input) { return String(input || '').replace(/[\r\n]/g, '').trim(); }
function loadQqCookie() { ensureStorage(); try { qqCookie = normalizeQqCookie(fs.readFileSync(QQ_COOKIE_FILE, 'utf8')); } catch { qqCookie = ''; } return qqCookie; }
function saveQqCookie(cookie) {
  qqCookie = normalizeQqCookie(cookie);
  if (!qqCookie) { try { fs.rmSync(QQ_COOKIE_FILE, { force: true }); } catch {} return; }
  fs.writeFileSync(QQ_COOKIE_FILE, `${qqCookie}\n`, { mode: 0o600 });
  try { fs.chmodSync(QQ_COOKIE_FILE, 0o600); } catch {}
}
function normalizeProvider(value) { return String(value || 'netease').toLowerCase() === 'qq' ? 'qq' : 'netease'; }
function qqTrackId(songmid, mediaMid = '', albumMid = '') { return `qq:${songmid}:${mediaMid || ''}:${albumMid || ''}`; }
function parseQqTrackId(value) { const text=String(value||''); if(!text.startsWith('qq:')) return null; const [,songmid='',mediaMid='',albumMid='']=text.split(':'); return songmid?{songmid,mediaMid,albumMid}:null; }

function stableLocalId(relativePath) {
  return `local_${crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 20)}`;
}

function scanLocalMusic() {
  loadConfig();
  const root = config.localMusicDir;
  const tracks = [];
  if (!fs.existsSync(root)) {
    localTracks = [];
    localTrackMap = new Map();
    return localTracks;
  }
  try {
    if (!fs.statSync(root).isDirectory()) throw new Error('Configured local music path is not a directory');
  } catch (error) {
    console.warn(`[${PLUGIN_ID}] Local directory unavailable:`, error.message);
    localTracks = [];
    localTrackMap = new Map();
    return localTracks;
  }
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(absolutePath); continue; }
      if (!entry.isFile() || !AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const relativePath = path.relative(root, absolutePath);
      const nameNoExt = path.basename(entry.name, path.extname(entry.name));
      const match = nameNoExt.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      const name = (match?.[1] || nameNoExt).trim();
      const artist = (match?.[2] || '').trim();
      tracks.push({
        id: stableLocalId(relativePath), name, artist: artist ? [artist] : ['本地音乐'],
        album: '本地音乐', lyric_id: stableLocalId(relativePath), source: 'local',
        relativePath, absolutePath,
      });
    }
  };
  try { walk(root); } catch (error) { console.warn(`[${PLUGIN_ID}] Local scan failed:`, error.message); }
  tracks.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'));
  localTracks = tracks;
  localTrackMap = new Map(tracks.map(track => [track.id, track]));
  return tracks;
}

function inspectLocalDirectory(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) return { ok: false, exists: false, readable: false, isDirectory: false, error: '目录地址为空' };
  if (!path.isAbsolute(raw)) return { ok: false, exists: false, readable: false, isDirectory: false, path: raw, error: '必须填写运行 SillyTavern 的设备可读取的绝对路径' };
  const resolved = path.resolve(raw);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return { ok: false, exists: true, readable: false, isDirectory: false, path: resolved, error: '该地址不是文件夹' };
    const names = fs.readdirSync(resolved);
    let audioCount = 0;
    const samples = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          audioCount += 1;
          if (samples.length < 5) samples.push(path.relative(resolved, absolute));
        }
      }
    };
    walk(resolved);
    return { ok: true, exists: true, readable: true, isDirectory: true, path: resolved, entries: names.length, audioCount, samples };
  } catch (error) {
    return { ok: false, exists: fs.existsSync(resolved), readable: false, isDirectory: false, path: resolved, error: error.message };
  }
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[（）()【】\[\]]/g, '');
}

function searchLocal(keywords) {
  const kw = normalizeSearch(keywords);
  if (!kw) return [];
  return localTracks.map(track => {
    const name = normalizeSearch(track.name);
    const artist = normalizeSearch(track.artist.join(' '));
    let score = 0;
    if (name === kw) score += 1000;
    if (name.includes(kw) || kw.includes(name)) score += 500;
    if (artist && (artist.includes(kw) || kw.includes(artist))) score += 100;
    if (`${name}${artist}`.includes(kw) || kw.includes(`${name}${artist}`)) score += 300;
    return { track, score };
  }).filter(item => item.score >= 300).sort((a, b) => b.score - a.score).map(item => ({ ...item.track, _score: 1000 + item.score }));
}

function publicTrack(track) {
  const { absolutePath, relativePath, ...result } = track;
  return result;
}

function jsonError(response, status, message, details) {
  response.status(status).json({ ok: false, error: message, details: details || undefined });
}


function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(error => {
      console.error(`[${PLUGIN_ID}] ${request.method} ${request.originalUrl}:`, error?.body || error?.message || error);
      if (!response.headersSent) {
        const upstream = error?.body && typeof error.body === 'object' ? error.body : undefined;
        jsonError(response, Number(error?.status) >= 400 ? Number(error.status) : 502, error?.message || 'Upstream request failed', upstream);
      }
    });
  };
}

async function getLoginStatus(provider = 'netease') {
  provider = normalizeProvider(provider);
  if (provider === 'qq') {
    const uin = qqCookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/i)?.[1] || '';
    const hasKey = /(?:^|;\s*)(?:qqmusic_key|qm_keyst)=([^;]+)/i.test(qqCookie);
    return { provider, hasCookie: Boolean(qqCookie), loggedIn: Boolean(qqCookie && uin && hasKey), account: uin ? { id: uin } : null, profile: uin ? { userId: uin, nickname: `QQ ${uin}` } : null };
  }
  if (!userCookie) return { provider, hasCookie:false, loggedIn:false, account:null, profile:null };
  try { const result=await ncmApi.login_status({cookie:userCookie}); const body=result?.body||{}; const data=body.data||body; const account=data.account||null; const profile=data.profile||null; return {provider,hasCookie:true,loggedIn:Boolean(account||profile),account,profile,code:body.code}; }
  catch(error){ return {provider,hasCookie:true,loggedIn:false,account:null,profile:null,error:error.message}; }
}

function extractQrKey(result) {
  return result?.body?.data?.unikey || result?.body?.unikey || '';
}

function extractQrPayload(result) {
  return result?.body?.data || result?.body || {};
}

function extractPlaylistId(input) {
  const value = String(input || '').trim();
  if (/^\d+$/.test(value)) return value;
  try {
    const parsed = new URL(value);
    const queryId = parsed.searchParams.get('id');
    if (queryId && /^\d+$/.test(queryId)) return queryId;
    const pathMatch = parsed.pathname.match(/\/(?:playlist|discover\/toplist)\/(\d+)/i);
    if (pathMatch) return pathMatch[1];
  } catch { /* Fall through to text matching. */ }
  const textMatch = value.match(/(?:playlist\?id=|playlist\/|id=)(\d+)/i) || value.match(/\b(\d{5,})\b/);
  return textMatch ? textMatch[1] : '';
}

function extractFirstHttpUrl(input) {
  const match = String(input || '').match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[)）\]】,，。.!！?？]+$/, '') : '';
}

async function resolveKnownShareUrl(rawUrl, provider) {
  const parsed = new URL(rawUrl);
  const allowedStart = provider === 'qq'
    ? ['c6.y.qq.com', 'y.qq.com', 'i.y.qq.com']
    : ['163cn.tv', 'music.163.com', 'y.music.163.com', '网易云音乐.163.com'];
  if (!allowedStart.includes(parsed.hostname)) {
    const error = new Error(`不支持的${provider === 'qq' ? 'QQ 音乐' : '网易云'}分享域名：${parsed.hostname}`);
    error.status = 400;
    throw error;
  }
  const response = await fetch(parsed.href, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  const finalUrl = response.url || parsed.href;
  const final = new URL(finalUrl);
  const allowedFinal = provider === 'qq'
    ? ['y.qq.com', 'c6.y.qq.com', 'i.y.qq.com']
    : ['music.163.com', 'y.music.163.com', '163cn.tv'];
  if (!allowedFinal.includes(final.hostname)) {
    const error = new Error('分享链接跳转到了非预期域名'); error.status = 400; throw error;
  }
  return final;
}

function normalizeMatchText(value) {
  return String(value || '').toLowerCase().replace(/[《》“”"'‘’·•。！？!?，,、\s_-]+/g, '');
}

function scoreTrackMatch(track, query) {
  const target = normalizeMatchText(query);
  const name = normalizeMatchText(track.name);
  const artist = normalizeMatchText(Array.isArray(track.artist) ? track.artist.join(' ') : track.artist);
  let score = 0;
  if (name && target.includes(name)) score += 100 + Math.min(80, name.length * 4);
  if (artist && target.includes(artist)) score += 70 + Math.min(50, artist.length * 3);
  if (name && name === target) score += 120;
  if (target && name.includes(target)) score += 50;
  if (name && artist && (target.includes(`${artist}${name}`) || target.includes(`${name}${artist}`))) score += 90;
  if (track.source !== 'local') score += 2;
  return score;
}

async function searchProviderTracks(query, provider, limit = 10) {
  provider = normalizeProvider(provider);
  const local = searchLocal(query).map(publicTrack);
  let online = [];
  if (provider === 'qq') {
    const result = await qqSdk.search({ key: query, limit, page: 1 });
    online = (result?.body?.response?.data?.song?.list || []).map(x => ({
      id: qqTrackId(x.songmid, x.strMediaMid || x.media_mid || x.songmid, x.albummid || ''),
      name: x.songname || '', artist: (x.singer || []).map(a => a.name), album: x.albumname || '',
      lyric_id: x.songmid, source: 'qq', album_mid: x.albummid || '', songmid: x.songmid,
    }));
  } else {
    const result = await ncmApi.cloudsearch({ keywords: query, limit, offset: 0, type: 1, cookie: userCookie });
    online = (result?.body?.result?.songs || []).map(x => ({ id: x.id, name: x.name, artist: (x.ar || []).map(a => a.name), album: x.al?.name || '', lyric_id: x.id, source: 'netease' }));
  }
  return [...local, ...online];
}

async function resolveInput(input, provider = 'netease') {
  provider = normalizeProvider(provider);
  const raw = String(input || '').trim();
  if (!raw) { const e = new Error('输入内容为空'); e.status = 400; throw e; }
  const sharedUrl = extractFirstHttpUrl(raw);
  if (sharedUrl) {
    const final = await resolveKnownShareUrl(sharedUrl, provider);
    const href = final.href;
    const playlistId = final.searchParams.get('id') && /playlist/i.test(final.pathname + final.hash)
      ? final.searchParams.get('id')
      : (final.pathname.match(/\/(?:playlist|playlistDetail)\/(\d+)/i)?.[1] || '');
    if (playlistId) return { kind: 'playlist', ...(await getPlaylist(playlistId, provider)) };
    if (provider === 'qq') {
      const songmid = final.pathname.match(/\/songDetail\/([A-Za-z0-9]+)/i)?.[1] || final.searchParams.get('songmid') || '';
      if (!songmid) { const e = new Error('没有从 QQ 音乐分享链接中识别到单曲 ID'); e.status = 400; throw e; }
      const queryText = raw.replace(sharedUrl, '').replace(/@QQ音乐/gi, '').trim() || songmid;
      const tracks = await searchProviderTracks(queryText, 'qq', 20);
      const track = tracks.find(t => parseQqTrackId(t.id)?.songmid === songmid) || tracks.sort((a,b) => scoreTrackMatch(b, queryText) - scoreTrackMatch(a, queryText))[0];
      if (!track) { const e = new Error('QQ 音乐链接已识别，但没有取得歌曲资料'); e.status = 404; throw e; }
      return { ok: true, kind: 'track', provider, name: track.name, trackCount: 1, tracks: [track], resolvedUrl: href };
    }
    const songId = final.searchParams.get('id') || final.pathname.match(/\/song\/(\d+)/i)?.[1] || '';
    if (!/^\d+$/.test(songId)) { const e = new Error('没有从网易云分享链接中识别到单曲 ID'); e.status = 400; throw e; }
    const result = await ncmApi.song_detail({ ids: songId, cookie: userCookie });
    const song = result?.body?.songs?.[0];
    if (!song) { const e = new Error('网易云链接已识别，但没有取得歌曲资料'); e.status = 404; throw e; }
    const track = { id: song.id, name: song.name || '', artist: (song.ar || []).map(a => a.name), album: song.al?.name || '', lyric_id: song.id, source: 'netease' };
    return { ok: true, kind: 'track', provider, name: track.name, cover: song.al?.picUrl || '', trackCount: 1, tracks: [track], resolvedUrl: href };
  }
  if (/^\d{5,}$/.test(raw)) return { kind: 'playlist', ...(await getPlaylist(raw, provider)) };
  const tracks = await searchProviderTracks(raw, provider, 12);
  if (!tracks.length) { const e = new Error(`没有找到“${raw}”`); e.status = 404; throw e; }
  tracks.sort((a,b) => scoreTrackMatch(b, raw) - scoreTrackMatch(a, raw));
  const track = tracks[0];
  return { ok: true, kind: 'search', provider, name: track.name, trackCount: 1, tracks: [track], candidates: tracks.slice(0, 5) };
}

async function getPlaylist(input, provider = 'netease') {
  provider=normalizeProvider(provider); const id=extractPlaylistId(input);
  if(!id){const e=new Error(`无法识别${provider==='qq'?'QQ 音乐':'网易云'}歌单 ID`);e.status=400;throw e;}
  if(provider==='qq'){
    const result=await qqServices.songListDetail({method:'get',params:{disstid:id}}); const body=result?.body||{}; const pl=body?.response?.cdlist?.[0];
    if(!pl||!Array.isArray(pl.songlist)){const e=new Error(body.error||'QQ 音乐没有返回可用歌单');e.status=502;e.body=body;throw e;}
    return {ok:true,provider,id,name:pl.dissname||`QQ 歌单 ${id}`,cover:pl.logo||'',trackCount:pl.songnum||pl.songlist.length,tracks:pl.songlist.map(t=>({id:qqTrackId(t.mid,t.file?.media_mid||t.mid,t.album?.mid||''),name:t.name||t.title||'',artist:(t.singer||[]).map(a=>a.name).filter(Boolean),album:t.album?.name||'',lyric_id:t.mid,source:'qq',songmid:t.mid,media_mid:t.file?.media_mid||t.mid,album_mid:t.album?.mid||''}))};
  }
  const result=await ncmApi.playlist_detail({id,cookie:userCookie}); const body=result?.body||{}; const pl=body.playlist;
  if(!pl||!Array.isArray(pl.tracks)){const e=new Error(body.message||'网易云没有返回可用歌单');e.status=502;e.body=body;throw e;}
  return {ok:true,provider,id,name:pl.name||`歌单 ${id}`,cover:pl.coverImgUrl||'',trackCount:pl.trackCount||pl.tracks.length,tracks:pl.tracks.map(t=>({id:t.id,name:t.name||'',artist:(t.ar||[]).map(a=>a.name).filter(Boolean),album:t.al?.name||'',lyric_id:t.id,source:'netease'}))};
}

async function legacyHandler(request,response){
 const q=request.query||{}; const type=q.types; const provider=normalizeProvider(q.provider||q.source);
 if(!type)return response.json({status:'running',provider,logged_in:provider==='qq'?Boolean(qqCookie):Boolean(userCookie),local_tracks:localTracks.length});
 if(type==='search'){
  const keywords=String(q.name||''); const limit=Math.max(1,Math.min(50,Number(q.count)||5)); const local=searchLocal(keywords).map(publicTrack); let online=[];
  try{if(provider==='qq'){const r=await qqSdk.search({key:keywords,limit,page:Math.max(1,Number(q.pages)||1)});online=(r?.body?.response?.data?.song?.list||[]).map(x=>({id:qqTrackId(x.songmid,x.strMediaMid||x.media_mid||x.songmid,x.albummid||''),name:x.songname||'',artist:(x.singer||[]).map(a=>a.name),album:x.albumname||'',lyric_id:x.songmid,source:'qq',album_mid:x.albummid||''}));}else{const r=await ncmApi.cloudsearch({keywords,limit,offset:((Number(q.pages)||1)-1)*limit,type:1,cookie:userCookie});online=(r?.body?.result?.songs||[]).map(x=>({id:x.id,name:x.name,artist:(x.ar||[]).map(a=>a.name),album:x.al?.name||'',lyric_id:x.id,source:'netease'}));}}catch(e){console.warn(`[${PLUGIN_ID}] ${provider} search failed:`,e.message)}
  return response.json([...local,...online].slice(0,limit));
 }
 if(type==='url'){
  const id=String(q.id||''); if(id.startsWith('local_'))return response.json({url:localTrackMap.has(id)?`/api/plugins/${PLUGIN_ID}/audio/${encodeURIComponent(id)}`:''}); const qi=parseQqTrackId(id);
  if(provider==='qq'||qi){const t=qi||{songmid:id,mediaMid:String(q.media_mid||'')};const quality=Number(q.br)>=999?'flac':Number(q.br)>=320?'320':'128';const r=await qqSdk.getMusicPlay({songmid:t.songmid,mediaId:t.mediaMid,quality,cookie:qqCookie});const item=r?.body?.data?.playUrl?.[t.songmid]||{};return response.json({url:item.url||'',error:item.error||''});}
  const br=Number(q.br)||320;const r=await ncmApi.song_url({id,br:br<=320?br*1000:br,cookie:userCookie});return response.json({url:r?.body?.data?.[0]?.url||''});
 }
 if(type==='lyric'){
  const id=String(q.id||'');if(id.startsWith('local_'))return response.json({lyric:'',tlyric:''});const qi=parseQqTrackId(id);
  if(provider==='qq'||qi){const r=await qqSdk.getLyric({songmid:qi?.songmid||id,isFormat:false,cookie:qqCookie});const b=r?.body?.response||{};return response.json({lyric:b.lyric||'',tlyric:b.trans||''});}
  const r=await ncmApi.lyric({id,cookie:userCookie});return response.json({lyric:r?.body?.lrc?.lyric||'',tlyric:r?.body?.tlyric?.lyric||''});
 }
 if(type==='pic'){
  const id=String(q.id||'');if(!id||id.startsWith('local_'))return response.json({url:''});const qi=parseQqTrackId(id);if(provider==='qq'||qi){const mid=qi?.albumMid||String(q.album_mid||'');return response.json({url:mid?`https://y.qq.com/music/photo_new/T002R500x500M000${mid}.jpg`:''});}
  const r=await ncmApi.song_detail({ids:id,cookie:userCookie});const song=r?.body?.songs?.[0];return response.json({url:song?.al?.picUrl||song?.album?.picUrl||''});
 }
 if(type==='playlist'){const pl=await getPlaylist(q.id,provider);return response.json(pl.tracks.map(t=>({name:t.name,artist:t.artist.join(' / '),id:t.id,source:t.source})));}
 return jsonError(response,400,'Unknown request type');
}

function streamAudio(request, response) {
  const track = localTrackMap.get(String(request.params.id || ''));
  if (!track) return jsonError(response, 404, 'Local track not found');
  const root = path.resolve(config.localMusicDir);
  const filePath = path.resolve(track.absolutePath);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return jsonError(response, 403, 'Invalid local track path');
  let stat;
  try { stat = fs.statSync(filePath); } catch { return jsonError(response, 404, 'Local file is missing'); }
  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', mime);
  const range = request.headers.range;
  if (!range) {
    response.setHeader('Content-Length', stat.size);
    return fs.createReadStream(filePath).pipe(response);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return response.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= stat.size) {
    return response.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
  }
  response.status(206);
  response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  response.setHeader('Content-Length', end - start + 1);
  return fs.createReadStream(filePath, { start, end }).pipe(response);
}

async function init(router) {
  ncmApi = require('NeteaseCloudMusicApi');
  qqSdk = require('@sansenjian/qq-music-api/sdk');
  qqServices = require('@sansenjian/qq-music-api/services');
  loadConfig();
  loadCookie();
  loadQqCookie();
  scanLocalMusic();

  router.get('/', asyncRoute(legacyHandler));
  router.get('/health', async (_req, res) => res.json({
    ok: true, plugin: PLUGIN_ID, version: '1.3.1', providers: ['netease','qq'], hasCookie: Boolean(userCookie),
    localTracks: localTracks.length, localMusicDir: config.localMusicDir,
  }));
  router.get('/auth/status', asyncRoute(async (req, res) => res.json(await getLoginStatus(req.query.provider))));
  router.post('/auth/cookie', asyncRoute(async (req,res)=>{const provider=normalizeProvider(req.body?.provider);const cookie=provider==='qq'?normalizeQqCookie(req.body?.cookie):normalizeCookie(req.body?.cookie);if(!cookie)return jsonError(res,400,'Cookie is empty');provider==='qq'?saveQqCookie(cookie):saveCookie(cookie);const status=await getLoginStatus(provider);return res.json({ok:true,message:status.loggedIn?'Cookie 已保存并通过验证':'Cookie 已保存，但平台未确认登录状态',...status});}));
  router.post('/auth/logout', async (req,res)=>{const provider=normalizeProvider(req.body?.provider);provider==='qq'?saveQqCookie(''):saveCookie('');res.json({ok:true,provider});});
  router.post('/auth/qr/start', asyncRoute(async (req,res)=>{const provider=normalizeProvider(req.body?.provider);if(provider==='qq'){const r=await qqSdk.getQQLoginQr();const b=r?.body||{};if(!b.img||!b.qrsig||!b.ptqrtoken)return jsonError(res,502,'QQ 音乐没有返回完整二维码数据',b);const key=Buffer.from(JSON.stringify({ptqrtoken:b.ptqrtoken,qrsig:b.qrsig})).toString('base64url');return res.json({ok:true,provider,message:'QQ 音乐二维码已生成',key,qrimg:b.img,qrurl:''});}const kr=await ncmApi.login_qr_key({});const key=extractQrKey(kr);if(!key)return jsonError(res,502,'网易云没有返回二维码 key');const qr=extractQrPayload(await ncmApi.login_qr_create({key,qrimg:true}));return res.json({ok:true,provider,message:'网易云二维码已生成',key,qrurl:qr.qrurl||'',qrimg:qr.qrimg||''});}));
  router.get('/auth/qr/check', asyncRoute(async (req,res)=>{const provider=normalizeProvider(req.query.provider);const key=String(req.query.key||'');if(!key)return jsonError(res,400,'QR key is required');if(provider==='qq'){let state;try{state=JSON.parse(Buffer.from(key,'base64url').toString('utf8'));}catch{return jsonError(res,400,'Invalid QQ QR state')}const r=await qqSdk.checkQQLoginQr(state);const b=r?.body||{};if(b.isOk&&b.session?.cookie)saveQqCookie(b.session.cookie);return res.json({ok:true,provider,code:b.isOk?803:b.refresh?800:801,message:b.message||'',loggedIn:Boolean(b.isOk)});}const r=await ncmApi.login_qr_check({key});const b=r?.body||{};if(Number(b.code)===803&&b.cookie)saveCookie(b.cookie);return res.json({ok:true,provider,code:Number(b.code)||0,message:b.message||'',loggedIn:Number(b.code)===803});}));
  router.post('/auth/captcha/send', asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const countrycode = String(req.body?.countrycode || '86').trim();
    if (!/^\d{5,20}$/.test(phone) || !/^\d{1,5}$/.test(countrycode)) return jsonError(res, 400, 'Invalid phone or country code');
    const result = await ncmApi.captcha_sent({ phone, countrycode });
    res.json({ ok: Number(result?.body?.code) === 200, code: result?.body?.code, message: result?.body?.message || '', upstream: result?.body || null });
  }));
  router.post('/auth/captcha/login', asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const captcha = String(req.body?.captcha || '').trim();
    const countrycode = String(req.body?.countrycode || '86').trim();
    if (!/^\d{5,20}$/.test(phone) || !/^\d{4,10}$/.test(captcha)) return jsonError(res, 400, 'Invalid phone or captcha');
    const result = await ncmApi.login_cellphone({ phone, captcha, countrycode });
    if (result?.body?.cookie) saveCookie(result.body.cookie);
    res.json({ ok: Number(result?.body?.code) === 200, code: result?.body?.code, message: result?.body?.message || '', loggedIn: Number(result?.body?.code) === 200, upstream: result?.body || null });
  }));
  router.get('/input/resolve', asyncRoute(async (req, res) => res.json(await resolveInput(req.query.input, req.query.provider))));
  router.get('/playlist/resolve', asyncRoute(async (req, res) => res.json(await getPlaylist(req.query.input, req.query.provider))));
  router.get('/local/list', (_req, res) => res.json(localTracks.map(publicTrack)));
  router.post('/local/rescan', (_req, res) => { const tracks = scanLocalMusic(); res.json({ ok: true, count: tracks.length }); });
  router.post('/local/inspect', (req, res) => {
    const result = inspectLocalDirectory(req.body?.localMusicDir);
    res.status(result.ok ? 200 : 400).json(result);
  });
  router.post('/config/local-dir', (req, res) => {
    const inspection = inspectLocalDirectory(req.body?.localMusicDir);
    if (!inspection.ok) return res.status(400).json(inspection);
    config.localMusicDir = inspection.path;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ localMusicDir: config.localMusicDir, providers: config.providers }, null, 2) + '\n', { mode: 0o600 });
    const tracks = scanLocalMusic();
    res.json({ ok: true, message: '目录已连接并完成扫描', localMusicDir: config.localMusicDir, count: tracks.length, samples: inspection.samples });
  });
  router.get('/audio/:id', streamAudio);
  console.log(`[${PLUGIN_ID}] Loaded: ${localTracks.length} local track(s), cookie=${userCookie ? 'present' : 'absent'}.`);
}

async function exit() { localTrackMap.clear(); localTracks = []; }

module.exports = {
  info: { id: PLUGIN_ID, name: 'Your Own Music Source', description: 'A private, multi-provider-ready account-backed and local-file music source for SillyTavern.' },
  init,
  exit,
  _test: { normalizeCookie, stableLocalId, normalizeSearch, searchLocal, inspectLocalDirectory, extractPlaylistId, extractFirstHttpUrl, scoreTrackMatch },
};
