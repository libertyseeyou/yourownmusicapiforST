import { getRequestHeaders, saveSettingsDebounced, characters, this_chid, name1, name2, user_avatar, getThumbnailUrl } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXTENSION_ID = 'netease-personal-music-source';
const API_BASE = `/api/plugins/${EXTENSION_ID}`;
const DEFAULTS = {
    provider: 'netease',
    floatingLyricsEnabled: false,
    floatingLyricsFixedPosition: false,
    floatingLyricsPointerPassthrough: false,
    floatingLyricsPosition: 'center-top',
    floatingLyricsFontColor: '#ffffff',
    floatingLyricsGlowColor: '#000000',
    floatingLyricsGlowStrength: 12,
    floatingLyricsFontSize: 18,
    floatingLyricsFontFamily: 'global',
    floatingLyricsCustomFont: '',
    floatingLyricsFontUrl: '',
    floatingLyricsFontUrlEnabled: false,
    floatingLyricsX: null,
    floatingLyricsY: null,
    floatingLyricsScale: 1,
    floatingPlayerTheme: 'dark',
    floatingPlayerStyleMode: 'preset',
    floatingPlayerCustomCss: '',
    listeningStats: { userSeconds: 0, characters: {} },
};
const REQUEST_TIMEOUT_MS = 20000;
const TERMUX_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-termux.sh | bash';
const WINDOWS_INSTALL_COMMAND = "irm https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-windows.ps1 | iex";
const MACOS_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-macos.sh | bash';
const LINUX_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-linux.sh | bash';
const TERMUX_REMOVE_BACKEND_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/remove-backend-termux.sh | bash';
const WINDOWS_REMOVE_BACKEND_COMMAND = "irm https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/remove-backend-windows.ps1 | iex";
const MACOS_REMOVE_BACKEND_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/remove-backend-macos.sh | bash';
const LINUX_REMOVE_BACKEND_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/remove-backend-linux.sh | bash';
const state = {
    qrTimer: null,
    qrKey: '',
    qrProvider: '',
    originalFetch: window.fetch.bind(window),
    operationId: 0,
    backendReady: false,
    accountPlaylistsProvider: '',
    player: {
        audio: null,
        tracks: [],
        index: -1,
        mode: 'list',
        loading: false,
        requestId: 0,
        playlistName: '',
        cover: '',
        lyrics: [],
        lyricIndex: -1,
        lyricRequestId: 0,
        wasPlayingBeforeHidden: false,
        lastKnownTime: 0,
        lastKnownAt: 0,
        recoveryTimer: null,
        recoveryInProgress: false,
        recoveryAttempts: 0,
        lastRecoveryAt: 0,
        endedAt: 0,
        listenStatTime: null,
        listenStatPending: 0,
    },
};

const isTauriTavern = Boolean(globalThis.__TAURITAVERN__ || globalThis.__TAURI_INTERNALS__ || globalThis.__TAURI__);
let themeSampleTimer = null;
let themeSamplePending = false;
let scriptScanInProgress = false;

function yieldToWebView() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
        else setTimeout(resolve, 0);
    });
}

function settings() {
    extension_settings[EXTENSION_ID] ||= {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (extension_settings[EXTENSION_ID][key] === undefined) extension_settings[EXTENSION_ID][key] = value;
    }
    const config = extension_settings[EXTENSION_ID];
    if (config.floatingPlayerStyleMode === 'preset' && ['inherit', 'preset', 'custom'].includes(config.floatingLyricsStyleMode)) config.floatingPlayerStyleMode = config.floatingLyricsStyleMode;
    if (!config.floatingPlayerCustomCss && typeof config.floatingLyricsCustomCss === 'string') config.floatingPlayerCustomCss = config.floatingLyricsCustomCss;
    return config;
}

function compactPayload(value) {
    if (!value || typeof value !== 'object') return value;
    const copy = structuredClone(value);
    if (copy.account) copy.account = { id: copy.account.id, userName: copy.account.userName, status: copy.account.status };
    if (copy.profile) copy.profile = { userId: copy.profile.userId, nickname: copy.profile.nickname, vipType: copy.profile.vipType };
    if (copy.qrimg) copy.qrimg = `[data URL, ${String(copy.qrimg).length} chars]`;
    if (copy.key) copy.key = `${String(copy.key).slice(0, 8)}…`;
    return copy;
}

function appendFeedback(label, payload, ok = true) {
    const box = document.querySelector('#npms_feedback');
    if (!box) return;
    const line = document.createElement('div');
    line.className = `npms-feedback-entry ${ok ? 'is-ok' : 'is-error'}`;
    const time = new Date().toLocaleTimeString();
    let text;
    if (typeof payload === 'string') text = payload;
    else {
        try { text = JSON.stringify(compactPayload(payload), null, 2); }
        catch { text = String(payload); }
    }
    line.textContent = `[${time}] ${label}\n${text}`;
    box.prepend(line);
    while (box.children.length > 12) box.lastElementChild?.remove();
}

function setStatus(message, kind = '') {
    const node = document.querySelector('#npms_status');
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
}

function setBusy(buttonId, busy, busyText = '处理中…') {
    const button = document.querySelector(`#${buttonId}`);
    if (!button) return;
    if (busy) {
        button.dataset.originalText = button.textContent;
        button.textContent = busyText;
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = !state.backendReady && BACKEND_CONTROL_SELECTORS.includes(`#${buttonId}`);
    }
}

const BACKEND_CONTROL_SELECTORS = [
    '#npms_qr_start', '#npms_logout', '#npms_player_prev', '#npms_player_play', '#npms_player_next', '#npms_player_mode',
    '#npms_player_volume', '#npms_playlist_input', '#npms_playlist_load', '#npms_local_load', '#npms_cookie', '#npms_cookie_save',
    '#npms_local_dir', '#npms_dir_inspect', '#npms_dir_save', '#npms_rescan', '#npms_account_playlist', '#npms_account_playlist_load',
];

function setBackendAvailability(ready) {
    state.backendReady = Boolean(ready);
    for (const selector of BACKEND_CONTROL_SELECTORS) {
        const node = document.querySelector(selector);
        if (node) node.disabled = !state.backendReady;
    }
}

function ttHtmlFallbackError(status, contentType, preview) {
    const error = new Error('TauriTavern 未命中本插件后端路由，返回了页面 HTML。');
    error.payload = { tauriTavernFallback: true, httpStatus: status, contentType: contentType || 'unknown', preview: String(preview || '').slice(0, 180) };
    return error;
}

function backendUnavailableError(status = 404) {
    const error = new Error('后端尚未加载。请先展开“一键部署”，完成部署后重启 SillyTavern，再点“刷新状态”。');
    error.payload = { backendUnavailable: true, httpStatus: status };
    return error;
}

async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
        const headers = method === 'GET' || method === 'HEAD' ? {} : getRequestHeaders();
        const response = await state.originalFetch(`${API_BASE}${path}`, {
            credentials: 'same-origin',
            ...options,
            headers: { ...headers, ...(options.headers || {}) },
            signal: controller.signal,
        });
        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        const looksLikeTauriHtml = /text\/html/i.test(contentType) || /^\s*<!doctype html/i.test(text) || /<title>\s*TauriTavern\s*<\/title>/i.test(text);
        if (looksLikeTauriHtml) throw ttHtmlFallbackError(response.status, contentType, text.replace(/\s+/g, ' ').trim());
        let data;
        try { data = text ? JSON.parse(text) : {}; }
        catch { data = { error: response.ok ? (text || `HTTP ${response.status}`) : `HTTP ${response.status}` }; }
        if (!response.ok) {
            if (response.status === 404) throw backendUnavailableError(response.status);
            const error = new Error(data.error || data.message || `HTTP ${response.status}`);
            error.payload = { httpStatus: response.status, ...data };
            throw error;
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeoutError = new Error(`请求超过 ${(options.timeoutMs || REQUEST_TIMEOUT_MS) / 1000} 秒，已停止等待`);
            timeoutError.payload = { timeout: true, path };
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function currentProvider() { return settings().provider === 'qq' ? 'qq' : 'netease'; }
function providerLabel(provider = currentProvider()) { return provider === 'qq' ? 'QQ 音乐' : '网易云音乐'; }
function providerQuery() { return `provider=${encodeURIComponent(currentProvider())}`; }

function updateProviderUi() {
    const provider = currentProvider();
    document.querySelectorAll('[data-provider]').forEach(button => button.classList.toggle('is-active', button.dataset.provider === provider));
    const qrButton = document.querySelector('#npms_qr_start');
    if (qrButton) qrButton.textContent = `${providerLabel()}扫码登录`;
    const cookieLabel = document.querySelector('#npms_cookie_label');
    if (cookieLabel) cookieLabel.textContent = `${providerLabel()} Cookie（仅提交到本机后端）`;
    const cookieInput = document.querySelector('#npms_cookie');
    if (cookieInput) cookieInput.placeholder = provider === 'qq' ? 'uin=...; qqmusic_key=...; 或完整 QQ 音乐 Cookie' : 'MUSIC_U=... 或完整网易云 Cookie';
    const playlistInput = document.querySelector('#npms_playlist_input');
    if (playlistInput) playlistInput.placeholder = `${providerLabel()}：歌曲 歌手 / 单曲或歌单链接`;
}

async function switchProvider(provider) {
    provider = provider === 'qq' ? 'qq' : 'netease';
    if (provider === currentProvider()) return;
    stopQrPolling();
    const audio = state.player.audio;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    state.player.tracks = []; state.player.index = -1; state.player.playlistName = ''; state.player.requestId += 1;
    settings().provider = provider; saveSettingsDebounced(); updateProviderUi(); clearAccountPlaylists(); renderMiniPlayer();
    setStatus(`已切换到 ${providerLabel(provider)}；本地音乐仍可共用，正在检查登录状态……`);
    await refreshStatus();
}

function accountLabel(status) {
    if (status?.loggedIn) return `${providerLabel(status.provider)}已登录：${status.profile?.nickname || status.profile?.userId || '账号'}`;
    if (status?.hasCookie) return '已有 Cookie，但登录状态无效或已过期';
    return '尚未登录';
}

async function refreshStatus() {
    const operation = ++state.operationId;
    setBusy('npms_refresh', true, '连接中…');
    setStatus('正在检查酒馆后端接口……');
    try {
        const health = await api('/health', { timeoutMs: 8000 });
        setBackendAvailability(true);
        appendFeedback('后端健康检查通过', health, true);
        if (operation !== state.operationId) return;
        setStatus(`后端已连接，正在向${providerLabel()}验证登录状态……`);
        const auth = await api(`/auth/status?${providerQuery()}`, { timeoutMs: 15000 });
        appendFeedback('登录状态回传', auth, Boolean(auth.loggedIn));
        if (operation !== state.operationId) return;
        setStatus(`${accountLabel(auth)} · 后端 v${health.version} · 本地音乐 ${health.localTracks} 首`, auth.loggedIn ? 'ok' : 'warn');
        if (auth.loggedIn) await loadAccountPlaylists({ silent: true });
        else clearAccountPlaylists();
        const dir = document.querySelector('#npms_local_dir');
        if (dir && !dir.matches(':focus')) dir.value = health.localMusicDir || '';
        if (health.localTracks > 0 && state.player.tracks.length === 0) {
            await loadLocalPlayerTracks({ silent: true });
        }
    } catch (error) {
        if (error.payload?.tauriTavernFallback) {
            setBackendAvailability(false);
            appendFeedback('TT 路由未命中', '收到 TauriTavern 页面 HTML，而不是本插件后端 JSON。请打开“工具”页中的“TT 兼容说明”查看当前限制。', false);
            setStatus('检测到 TauriTavern，但本插件 Node 后端路由未接入。', 'warn');
        } else if (error.payload?.backendUnavailable) {
            setBackendAvailability(false);
            appendFeedback('后端尚未加载', '完成下方一键部署后，请重启 SillyTavern，再点击“刷新状态”。', false);
            setStatus('前端已安装；后端尚未加载。请完成一键部署并重启 SillyTavern。', 'warn');
        } else {
            appendFeedback('刷新状态失败', error.payload || error.message, false);
            setStatus(`刷新失败：${error.message}`, 'error');
        }
    } finally {
        setBusy('npms_refresh', false);
    }
}

function stopQrPolling() {
    if (state.qrTimer) clearInterval(state.qrTimer);
    state.qrTimer = null;
    state.qrKey = '';
    state.qrProvider = '';
    setBusy('npms_qr_start', false);
}

async function startQrLogin() {
    stopQrPolling();
    setBusy('npms_qr_start', true, '生成中…');
    setStatus(`已联系本机后端，正在向${providerLabel()}申请二维码……`);
    try {
        const data = await api('/auth/qr/start', { method: 'POST', body: JSON.stringify({ provider: currentProvider() }), timeoutMs: 20000 });
        appendFeedback('二维码接口回传', data, true);
        if (!data.key || (!data.qrimg && !data.qrurl)) {
            const error = new Error('二维码接口返回 JSON，但缺少二维码内容。');
            error.payload = { qrPayloadIncomplete: true, responseType: 'json', provider: currentProvider(), key: Boolean(data.key), qrimg: Boolean(data.qrimg), qrurl: Boolean(data.qrurl) };
            throw error;
        }
        state.qrKey = data.key;
        state.qrProvider = currentProvider();
        const box = document.querySelector('#npms_qr_box');
        const image = document.querySelector('#npms_qr_image');
        if (box) box.hidden = false;
        if (image) image.src = data.qrimg || data.qrurl;
        setStatus(data.message || `${providerLabel()}二维码已生成，请扫码`, 'ok');
        setBusy('npms_qr_start', false);
        state.qrTimer = setInterval(checkQrLogin, 1800);
    } catch (error) {
        if (error.payload?.tauriTavernFallback) {
            appendFeedback('TauriTavern 暂未适配', 'TT 当前只加载本插件前端，所需后端尚未适配；Cookie、二维码和在线曲库暂不可用。', false);
            setStatus('TauriTavern 后端暂未适配，二维码登录暂不可用。', 'error');
        } else {
            appendFeedback('二维码生成失败', error.payload || error.message, false);
            setStatus(`二维码生成失败：${error.message}`, 'error');
        }
        stopQrPolling();
    }
}

async function checkQrLogin() {
    if (!state.qrKey) return;
    try {
        const data = await api(`/auth/qr/check?provider=${encodeURIComponent(state.qrProvider || currentProvider())}&key=${encodeURIComponent(state.qrKey)}`, { timeoutMs: 10000 });
        const labels = { 800: '二维码已过期，请重新生成', 801: '二维码已展示，等待扫码', 802: '已扫码，请在手机上确认', 803: `${providerLabel(state.qrProvider)}确认登录成功` };
        const message = labels[data.code] || data.message || `扫码状态码：${data.code}`;
        setStatus(message, data.code === 803 ? 'ok' : data.code === 800 ? 'warn' : '');
        appendFeedback('扫码状态回传', data, data.code !== 800);
        if ([800, 803].includes(data.code)) {
            stopQrPolling();
            if (data.code === 803) setTimeout(refreshStatus, 300);
        }
    } catch (error) {
        appendFeedback('扫码状态检查失败', error.payload || error.message, false);
        setStatus(`扫码检查失败：${error.message}`, 'error');
        stopQrPolling();
    }
}

function listeningStats() {
    const config = settings();
    if (!config.listeningStats || typeof config.listeningStats !== 'object') config.listeningStats = { userSeconds: 0, characters: {} };
    if (!Number.isFinite(Number(config.listeningStats.userSeconds))) config.listeningStats.userSeconds = 0;
    if (!config.listeningStats.characters || typeof config.listeningStats.characters !== 'object') config.listeningStats.characters = {};
    return config.listeningStats;
}

function currentListeningCharacter() {
    const id = this_chid;
    const character = id !== undefined && characters?.[id] ? characters[id] : null;
    const name = String(character?.name || name2 || '').trim();
    if (!name || name === 'SillyTavern') return null;
    const key = character ? `character:${String(id)}` : `character:name:${name}`;
    let avatar = '';
    if (character?.avatar && character.avatar !== 'none') {
        try { avatar = getThumbnailUrl('avatar', character.avatar); } catch {}
    }
    return { key, name, avatar };
}

function currentListeningUser() {
    let avatar = '';
    try { avatar = getThumbnailUrl('persona', user_avatar); } catch {}
    return { name: String(name1 || 'user'), avatar };
}

function recordListeningProgress(force = false) {
    const audio = state.player.audio;
    if (!audio || (!force && audio.paused) || !Number.isFinite(audio.currentTime)) return;
    const current = audio.currentTime;
    if (state.player.listenStatTime === null || state.player.listenStatTime === undefined) {
        state.player.listenStatTime = current;
        return;
    }
    const delta = current - state.player.listenStatTime;
    state.player.listenStatTime = current;
    if (delta <= 0 || delta > 10) return;
    const stats = listeningStats();
    stats.userSeconds += delta;
    const character = currentListeningCharacter();
    if (character) {
        const item = stats.characters[character.key] ||= { name: character.name, avatar: character.avatar, seconds: 0 };
        item.name = character.name;
        if (character.avatar) item.avatar = character.avatar;
        item.seconds += delta;
    }
    state.player.listenStatPending += delta;
    if (state.player.listenStatPending >= 10) {
        state.player.listenStatPending = 0;
        saveSettingsDebounced();
        renderListeningStatsPanel();
    }
}

function formatListeningTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}小时${minutes}分`;
    if (minutes) return `${minutes}分${total % 60}秒`;
    return `${total % 60}秒`;
}

function renderListeningStatsPanel() {
    const panel = document.querySelector('#npms_listening_stats_panel');
    if (!panel) return;
    const stats = listeningStats();
    const user = currentListeningUser();
    const rows = [{ key: 'user', name: user.name, avatar: user.avatar, seconds: stats.userSeconds, isUser: true }, ...Object.entries(stats.characters).map(([key, value]) => ({ key, ...value }))].sort((a, b) => (b.isUser ? 1 : 0) - (a.isUser ? 1 : 0) || Number(b.seconds || 0) - Number(a.seconds || 0));
    panel.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'npms-listening-stats-heading'; heading.textContent = '听歌排行榜'; panel.append(heading);
    const list = document.createElement('div'); list.className = 'npms-listening-stats-list';
    rows.forEach((row, index) => {
        const item = document.createElement('div'); item.className = `npms-listening-stat-row${row.isUser ? ' is-user' : ''}`;
        const rank = document.createElement('b'); rank.className = 'npms-listening-rank'; rank.textContent = row.isUser ? '榜一' : String(index + 1); item.append(rank);
        const img = document.createElement('img'); img.className = 'npms-listening-avatar'; img.alt = ''; img.src = row.avatar || 'img/user-default.png'; img.onerror = () => { img.src = 'img/user-default.png'; }; item.append(img);
        const body = document.createElement('div'); body.className = 'npms-listening-stat-body';
        const name = document.createElement('span'); name.className = 'npms-listening-name'; name.textContent = row.isUser ? `${row.name} · user` : row.name; body.append(name);
        const time = document.createElement('small'); time.className = 'npms-listening-time'; time.textContent = formatListeningTime(row.seconds); body.append(time); item.append(body); list.append(item);
    });
    panel.append(list);
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'menu_button npms-listening-clear'; clear.textContent = '清空统计'; clear.addEventListener('click', () => { if (!window.confirm('清空全部听歌统计？')) return; settings().listeningStats = { userSeconds: 0, characters: {} }; saveSettingsDebounced(); renderListeningStatsPanel(); }); panel.append(clear);
}

function toggleListeningStatsPanel() {
    const panel = document.querySelector('#npms_listening_stats_panel');
    const button = document.querySelector('#npms_listening_stats_toggle');
    if (!panel || !button) return;
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) renderListeningStatsPanel();
}

function playerElements() {
    return {
        ticker: document.querySelector('#npms_player_ticker'),
        count: document.querySelector('#npms_player_count'),
        play: document.querySelector('#npms_player_play'),
        mode: document.querySelector('#npms_player_mode'),
        time: document.querySelector('#npms_player_time'),
        progress: document.querySelector('#npms_player_progress'),
        volume: document.querySelector('#npms_player_volume'),
        lyric: document.querySelector('#npms_player_lyric'),
    };
}

function currentPlayerTrack() {
    return state.player.index >= 0 ? state.player.tracks[state.player.index] : null;
}

function modeLabel() {
    return { list: '列表循环', one: '单曲循环', shuffle: '随机播放' }[state.player.mode] || '列表循环';
}

function renderMiniPlayer() {
    const ui = playerElements();
    const track = currentPlayerTrack();
    if (ui.ticker) {
        const artist = track ? (Array.isArray(track.artist) ? track.artist.join(' / ') : track.artist || '') : '';
        ui.ticker.textContent = track ? `${track.name}${artist ? ` - ${artist}` : ''}` : (state.player.tracks.length ? '歌单已载入，点击播放' : 'Loading...');
        resetPlayerMarquee();
    }
    if (ui.count) ui.count.textContent = state.player.tracks.length ? `${Math.max(0, state.player.index) + 1} / ${state.player.tracks.length}` : '0 / 0';
    if (ui.play) ui.play.textContent = state.player.audio && !state.player.audio.paused ? '||' : '>';
    if (ui.mode) {
        ui.mode.textContent = { list: 'SEQ', one: 'ONE', shuffle: 'RND' }[state.player.mode] || 'SEQ';
        ui.mode.title = `当前：${modeLabel()}。点击切换循环方式`;
    }
    if (ui.time && (!state.player.audio || !Number.isFinite(state.player.audio.duration))) ui.time.textContent = '0:00/0:00';
    if (ui.progress && (!state.player.audio || !Number.isFinite(state.player.audio.duration))) ui.progress.style.width = '0%';
    updateFloatingPlayerControls();
}

function resetPlayerMarquee() {
    const ticker = document.querySelector('#npms_player_ticker');
    const wrap = document.querySelector('#npms_player_title_wrap');
    if (!ticker || !wrap) return;
    ticker.classList.remove('is-scrolling');
    ticker.style.removeProperty('--npms-scroll-distance');
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const distance = Math.max(0, ticker.scrollWidth - wrap.clientWidth + 6);
        if (distance > 1) {
            ticker.style.setProperty('--npms-scroll-distance', `-${distance}px`);
            ticker.classList.add('is-scrolling');
        }
    }));
}

function sanitizeHexColor(value, fallback) {
    const text = String(value || '').trim();
    const match = text.match(/^#?([0-9a-f]{6})$/i);
    return match ? `#${match[1].toLowerCase()}` : fallback;
}

function floatingLyricsConfig() {
    const config = settings();
    const positions = new Set(['center-top']);
    const fontFamilies = new Set(['global', 'serif', 'sans-serif', 'monospace', 'custom', 'url']);
    return {
        enabled: Boolean(config.floatingLyricsEnabled),
        fixedPosition: Boolean(config.floatingLyricsFixedPosition),
        pointerPassthrough: Boolean(config.floatingLyricsPointerPassthrough),
        position: positions.has(config.floatingLyricsPosition) ? config.floatingLyricsPosition : 'center-top',
        fontColor: sanitizeHexColor(config.floatingLyricsFontColor, '#ffffff'),
        glowColor: sanitizeHexColor(config.floatingLyricsGlowColor, '#000000'),
        glowStrength: Math.max(0, Math.min(30, Number(config.floatingLyricsGlowStrength) || 0)),
        fontSize: Math.max(12, Math.min(32, Number(config.floatingLyricsFontSize) || 18)),
        fontFamily: fontFamilies.has(config.floatingLyricsFontFamily) ? config.floatingLyricsFontFamily : 'global',
        fontUrl: /^https?:\/\//i.test(String(config.floatingLyricsFontUrl || '').trim()) ? String(config.floatingLyricsFontUrl).trim().slice(0, 2048) : '',
        fontUrlEnabled: Boolean(config.floatingLyricsFontUrlEnabled),
        customFont: String(config.floatingLyricsCustomFont || '').replace(/[^\p{L}\p{N} _,'"-]/gu, '').trim().slice(0, 100),
        x: config.floatingLyricsX !== null && config.floatingLyricsX !== undefined && config.floatingLyricsX !== '' && Number.isFinite(Number(config.floatingLyricsX)) ? Number(config.floatingLyricsX) : null,
        y: config.floatingLyricsY !== null && config.floatingLyricsY !== undefined && config.floatingLyricsY !== '' && Number.isFinite(Number(config.floatingLyricsY)) ? Number(config.floatingLyricsY) : null,
        scale: Math.max(0.6, Math.min(2, Number(config.floatingLyricsScale) || 1)),
        playerTheme: ['dark', 'light', 'glass', 'glass-light', 'inherit', 'custom'].includes(config.floatingPlayerTheme) ? config.floatingPlayerTheme : 'dark',
        playerStyleMode: config.floatingPlayerTheme === 'inherit' ? 'inherit' : config.floatingPlayerTheme === 'custom' ? 'custom' : (['inherit', 'preset', 'custom'].includes(config.floatingPlayerStyleMode) ? config.floatingPlayerStyleMode : 'preset'),
        playerCustomCss: String(config.floatingPlayerCustomCss || '').slice(0, 12000),
    };
}

function floatingFontValue(config) {
    if (config.fontFamily === 'serif') return 'serif';
    if (config.fontFamily === 'sans-serif') return 'sans-serif';
    if (config.fontFamily === 'monospace') return 'monospace';
    if (config.fontFamily === 'url' && config.fontUrlEnabled && config.fontUrl) return 'NPMSUserFloatingFont';
    if (config.fontFamily === 'custom' && config.customFont) return config.customFont;
    return 'inherit';
}

let floatingFontLoadToken = 0;
let floatingFontLoadedUrl = '';
let floatingFontLoadingUrl = '';

async function loadFloatingFont(url) {
    if (!url || typeof FontFace === 'undefined') return false;
    if (url === floatingFontLoadedUrl || url === floatingFontLoadingUrl) return true;
    const token = ++floatingFontLoadToken;
    floatingFontLoadingUrl = url;
    try {
        const face = new FontFace('NPMSUserFloatingFont', `url("${url.replace(/"/g, '%22')}")`);
        await face.load();
        if (token !== floatingFontLoadToken) return false;
        document.fonts.add(face);
        floatingFontLoadedUrl = url;
        return true;
    } catch (error) {
        console.warn('[你自己的音乐源] floating font failed to load', error);
        return false;
    } finally {
        if (floatingFontLoadingUrl === url) floatingFontLoadingUrl = '';
    }
}

function scopeFloatingCss(value) {
    const source = String(value || '').replace(/@import[^;]+;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none').replace(/expression\s*\([^)]*\)/gi, '');
    return source.replace(/([^{}]+)\{/g, (whole, selector) => {
        const clean = selector.trim();
        if (!clean || clean.startsWith('@') || /^(from|to|[0-9]+%)$/i.test(clean)) return whole;
        return clean.split(',').map(item => `#npms_floating_lyrics .npms-floating-controls ${item.trim()}, #npms_floating_lyrics .npms-floating-playlist-panel ${item.trim()}`).join(', ') + ' {';
    });
}

function applyFloatingStyleCss() {
    let style = document.querySelector('#npms_floating_lyrics_custom_style');
    if (!style) { style = document.createElement('style'); style.id = 'npms_floating_lyrics_custom_style'; document.head.append(style); }
    const config = floatingLyricsConfig();
    style.textContent = config.playerStyleMode === 'custom' ? scopeFloatingCss(config.playerCustomCss) : '';
}

function readThemeStyle(element) {
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
    };
}

function findThemeSample(selectors) {
    for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node && node.getClientRects().length) return node;
    }
    return selectors.map(selector => document.querySelector(selector)).find(Boolean) || null;
}

function applyInheritedPlayerTheme(root) {
    if (floatingLyricsConfig().playerTheme !== 'inherit') return;
    const panelNode = findThemeSample(['#send_form', '#chat', '#top-bar', 'body']);
    const buttonNode = findThemeSample(['#send_but', '#extensionsMenuButton', '#options_button', 'button.menu_button', 'button']);
    const inputNode = findThemeSample(['#send_textarea', '#send_form textarea', 'textarea', 'input[type="text"]']);
    const panel = readThemeStyle(panelNode) || {};
    const button = readThemeStyle(buttonNode) || {};
    const input = readThemeStyle(inputNode) || {};
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const cssVar = name => rootStyle.getPropertyValue(name).trim() || bodyStyle.getPropertyValue(name).trim();
    const panelBackground = panel.backgroundColor && panel.backgroundColor !== 'rgba(0, 0, 0, 0)' ? panel.backgroundColor : cssVar('--SmartThemeBlurTintColor') || 'rgba(128,128,128,.22)';
    const buttonBackground = button.backgroundColor && button.backgroundColor !== 'rgba(0, 0, 0, 0)' ? button.backgroundColor : cssVar('--SmartThemeQuoteColor') || cssVar('--SmartThemeEmColor') || 'rgba(128,128,128,.28)';
    const color = button.color || panel.color || cssVar('--SmartThemeBodyColor') || bodyStyle.color || '#f0f0f0';
    const border = button.border && button.border !== '0px none rgb(0, 0, 0)' ? button.border : `1px solid ${cssVar('--SmartThemeBorderColor') || 'rgba(128,128,128,.45)'}`;
    const radius = button.borderRadius || cssVar('--SmartThemeBorderRadius') || '8px';
    const shadow = button.boxShadow && button.boxShadow !== 'none' ? button.boxShadow : (panel.boxShadow && panel.boxShadow !== 'none' ? panel.boxShadow : '0 4px 16px rgba(0,0,0,.16)');
    root.style.setProperty('--npms-inherit-panel-bg', panelBackground, 'important');
    root.style.setProperty('--npms-inherit-button-bg', buttonBackground, 'important');
    root.style.setProperty('--npms-inherit-color', color, 'important');
    root.style.setProperty('--npms-inherit-muted', input.color || color, 'important');
    root.style.setProperty('--npms-inherit-border', border, 'important');
    root.style.setProperty('--npms-inherit-radius', radius, 'important');
    root.style.setProperty('--npms-inherit-shadow', shadow, 'important');
    root.style.setProperty('--npms-inherit-font', button.fontFamily || panel.fontFamily || bodyStyle.fontFamily || 'inherit', 'important');
}

let floatingThemeObserver;
function observeFloatingThemeChanges() {
    if (floatingThemeObserver || typeof MutationObserver === 'undefined') return;
    floatingThemeObserver = new MutationObserver(() => {
        if (themeSamplePending) return;
        themeSamplePending = true;
        if (themeSampleTimer) return;
        themeSampleTimer = setTimeout(() => {
            themeSampleTimer = null;
            if (!themeSamplePending) return;
            themeSamplePending = false;
            const root = document.querySelector('#npms_floating_lyrics');
            if (root && floatingLyricsConfig().playerTheme === 'inherit') {
                applyInheritedPlayerTheme(root);
                applyFloatingStyleCss();
            }
        }, isTauriTavern ? 180 : 80);
    });
    floatingThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    floatingThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
}

function applyIsolatedFloatingStyles(root) {
    const config = floatingLyricsConfig();
    applyInheritedPlayerTheme(root);
    root.style.setProperty('isolation', 'isolate', 'important');
    root.style.setProperty('contain', 'layout style paint', 'important');
    root.style.setProperty('unicode-bidi', 'isolate', 'important');
    root.classList.toggle('is-fixed-position', config.fixedPosition);
    root.classList.toggle('is-pointer-passthrough', config.pointerPassthrough);
    const controls = root.querySelector('.npms-floating-controls');
    const playlist = root.querySelector('.npms-floating-playlist-panel');
    const lines = root.querySelector('.npms-floating-lines');
    const inherit = config.playerStyleMode === 'inherit';
    [controls, playlist].filter(Boolean).forEach(node => {
        node.style.setProperty('font-family', inherit ? 'inherit' : 'var(--npms-float-font, inherit)', 'important');
    });
    // Lyric appearance remains independent of the player/list style scheme.
    if (lines) {
        lines.style.setProperty('font-family', floatingFontValue(config), 'important');
        lines.style.setProperty('color', config.fontColor, 'important');
        lines.style.setProperty('filter', config.glowStrength > 0 ? `drop-shadow(0 0 3px ${config.glowColor}) drop-shadow(0 0 ${config.glowStrength}px ${config.glowColor})` : 'none', 'important');
        lines.querySelectorAll('.npms-floating-lyric-line').forEach(line => {
            line.style.setProperty('font-family', floatingFontValue(config), 'important');
            line.style.setProperty('color', config.fontColor, 'important');
            line.style.setProperty('text-shadow', 'none', 'important');
        });
    }
    applyFloatingStyleCss();
}

function exportFloatingStyleConfig() {
    const config = floatingLyricsConfig();
    const payload = { styleMode: config.playerTheme === 'inherit' ? 'inherit' : config.playerTheme === 'custom' ? 'custom' : 'preset', customCss: config.playerCustomCss, fontColor: config.fontColor, glowColor: config.glowColor, glowStrength: config.glowStrength, fontSize: config.fontSize, fontFamily: config.fontFamily, customFont: config.customFont, fontUrl: config.fontUrl, fontUrlEnabled: config.fontUrlEnabled, playerTheme: config.playerTheme };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'floating-lyrics-style.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importFloatingStyleConfig(event, root) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(String(reader.result || '{}')); const config = settings();
            if (['inherit', 'preset', 'custom'].includes(data.styleMode)) { config.floatingPlayerStyleMode = data.styleMode; if (data.styleMode === 'inherit' || data.styleMode === 'custom') config.floatingPlayerTheme = data.styleMode; }
            if (typeof data.customCss === 'string') config.floatingPlayerCustomCss = data.customCss.slice(0, 12000);
            if (typeof data.fontColor === 'string') config.floatingLyricsFontColor = sanitizeHexColor(data.fontColor, config.floatingLyricsFontColor || '#ffffff');
            if (typeof data.glowColor === 'string') config.floatingLyricsGlowColor = sanitizeHexColor(data.glowColor, config.floatingLyricsGlowColor || '#000000');
            if (Number.isFinite(Number(data.glowStrength))) config.floatingLyricsGlowStrength = Math.max(0, Math.min(30, Number(data.glowStrength)));
            if (Number.isFinite(Number(data.fontSize))) config.floatingLyricsFontSize = Math.max(12, Math.min(32, Number(data.fontSize)));
            if (typeof data.fontFamily === 'string') config.floatingLyricsFontFamily = data.fontFamily;
            if (typeof data.customFont === 'string') config.floatingLyricsCustomFont = data.customFont.slice(0, 100);
            if (typeof data.fontUrl === 'string') config.floatingLyricsFontUrl = data.fontUrl.slice(0, 2048);
            if (typeof data.fontUrlEnabled === 'boolean') config.floatingLyricsFontUrlEnabled = data.fontUrlEnabled;
            if (['dark', 'light', 'glass', 'glass-light', 'inherit', 'custom'].includes(data.playerTheme)) config.floatingPlayerTheme = data.playerTheme;
            saveSettingsDebounced(); syncFloatingLyricsControls(root);
        } catch (error) { console.warn('[你自己的音乐源] invalid floating style file', error); }
    };
    reader.readAsText(file);
}

function removeFloatingLyrics() {
    document.querySelector('#npms_floating_lyrics')?.remove();
}

function clampFloatingPosition(root, x, y) {
    const rect = root.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - Math.max(80, rect.width));
    const maxY = Math.max(0, window.innerHeight - Math.max(55, rect.height));
    return { x: Math.max(0, Math.min(maxX, x)), y: Math.max(0, Math.min(maxY, y)) };
}

function saveFloatingGeometry(root) {
    const rect = root.getBoundingClientRect();
    const config = settings();
    root.classList.add('is-free-position');
    config.floatingLyricsX = Math.round(rect.left);
    config.floatingLyricsY = Math.round(rect.top);
    saveSettingsDebounced();
}

function renderFloatingPlaylist(root) {
    const list = root.querySelector('.npms-floating-playlist');
    const summary = root.querySelector('.npms-floating-list-summary');
    if (!list || !summary) return;
    const tracks = state.player.tracks;
    summary.textContent = tracks.length ? `当前列表 · ${tracks.length} 首` : '当前列表为空';
    const fragment = document.createDocumentFragment();
    tracks.forEach((track, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `npms-floating-track${index === state.player.index ? ' is-current' : ''}`;
        button.dataset.trackIndex = String(index);
        const artist = Array.isArray(track.artist) ? track.artist.join(' / ') : track.artist || '';
        button.textContent = `${index + 1}. ${track.name}${artist ? ` - ${artist}` : ''}`;
        button.title = button.textContent;
        button.addEventListener('click', event => { event.stopPropagation(); void playPlayerIndex(index, true); });
        fragment.append(button);
    });
    list.replaceChildren(fragment);
    root.dataset.currentTrackIndex = String(state.player.index);
    list.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
}

function updateFloatingPlayerControls(root = document.querySelector('#npms_floating_lyrics')) {
    if (!root) return;
    const audio = state.player.audio;
    const duration = Number.isFinite(audio?.duration) ? audio.duration : 0;
    const current = audio?.currentTime || 0;
    const progress = root.querySelector('.npms-floating-progress');
    if (progress && !progress.matches(':active')) progress.value = String(duration ? current / duration * 1000 : 0);
    const currentTime = root.querySelector('.npms-floating-time-current');
    const totalTime = root.querySelector('.npms-floating-time-total');
    if (currentTime) currentTime.textContent = formatPlayerTime(current);
    if (totalTime) totalTime.textContent = formatPlayerTime(duration);
    const play = root.querySelector('.npms-floating-play');
    if (play) play.textContent = audio && !audio.paused ? 'Ⅱ' : '▶';
    const mode = root.querySelector('.npms-floating-mode');
    if (mode) mode.textContent = { list: '↝', one: '↻¹', shuffle: '⤨' }[state.player.mode] || '↝';
    const previousIndex = Number(root.dataset.currentTrackIndex);
    if (previousIndex !== state.player.index) {
        if (Number.isInteger(previousIndex)) root.querySelector(`.npms-floating-track[data-track-index="${previousIndex}"]`)?.classList.remove('is-current');
        const currentRow = root.querySelector(`.npms-floating-track[data-track-index="${state.player.index}"]`);
        currentRow?.classList.add('is-current');
        if (root.classList.contains('is-open')) currentRow?.scrollIntoView({ block: 'nearest' });
        root.dataset.currentTrackIndex = String(state.player.index);
    }
}

function bindFloatingPlayer(root) {
    if (root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';
    const lyrics = root.querySelector('.npms-floating-lyrics-display');
    const controls = root.querySelector('.npms-floating-controls');
    const playlistPanel = root.querySelector('.npms-floating-playlist-panel');
    root.querySelector('.npms-floating-list-toggle').addEventListener('click', event => {
        event.stopPropagation();
        playlistPanel.hidden = !playlistPanel.hidden;
        if (!playlistPanel.hidden) renderFloatingPlaylist(root);
    });
    let drag = null;
    lyrics.addEventListener('pointerdown', event => {
        if (event.button !== 0 || floatingLyricsConfig().fixedPosition) return;
        const rect = root.getBoundingClientRect();
        root.classList.remove('pos-center-top');
        root.classList.add('is-free-position');
        root.style.transformOrigin = 'top left';
        root.style.left = `${rect.left}px`; root.style.top = `${rect.top}px`;
        root.style.right = 'auto'; root.style.bottom = 'auto';
        drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
        lyrics.setPointerCapture(event.pointerId);
        root.classList.add('is-dragging');
    });
    lyrics.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        const point = clampFloatingPosition(root, drag.left + dx, drag.top + dy);
        root.style.left = `${point.x}px`; root.style.top = `${point.y}px`;
        root.style.right = 'auto'; root.style.bottom = 'auto';
    });
    const finishDrag = event => {
        if (!drag || drag.id !== event.pointerId) return;
        const moved = drag.moved;
        drag = null; root.classList.remove('is-dragging');
        try { lyrics.releasePointerCapture(event.pointerId); } catch {}
        saveFloatingGeometry(root);
        if (!moved) {
            root.classList.toggle('is-open');
            controls.hidden = !root.classList.contains('is-open');
            if (!controls.hidden) { playlistPanel.hidden = true; }
        }
    };
    lyrics.addEventListener('pointerup', finishDrag);
    lyrics.addEventListener('pointercancel', finishDrag);
    lyrics.addEventListener('click', event => {
        if (!floatingLyricsConfig().fixedPosition || floatingLyricsConfig().pointerPassthrough) return;
        event.stopPropagation();
        root.classList.toggle('is-open');
        controls.hidden = !root.classList.contains('is-open');
        if (!controls.hidden) playlistPanel.hidden = true;
    });
    root.querySelector('.npms-floating-prev').addEventListener('click', event => { event.stopPropagation(); void playPlayerOffset(-1, true); });
    root.querySelector('.npms-floating-play').addEventListener('click', event => { event.stopPropagation(); void toggleMiniPlayer(); });
    root.querySelector('.npms-floating-next').addEventListener('click', event => { event.stopPropagation(); void playPlayerOffset(1, true); });
    root.querySelector('.npms-floating-mode').addEventListener('click', event => { event.stopPropagation(); cyclePlayerMode(); updateFloatingPlayerControls(root); });
    root.querySelector('.npms-floating-progress').addEventListener('input', event => {
        event.stopPropagation(); const audio = state.player.audio;
        if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 1000 * audio.duration;
        updatePlayerProgress(); updateFloatingPlayerControls(root); renderCurrentLyric(true);
    });
    const resize = root.querySelector('.npms-floating-resize');
    let resizing = null;
    resize.addEventListener('pointerdown', event => {
        event.stopPropagation(); event.preventDefault();
        resizing = { id: event.pointerId, startX: event.clientX, startY: event.clientY, scale: floatingLyricsConfig().scale };
        resize.setPointerCapture(event.pointerId); root.classList.add('is-resizing');
    });
    resize.addEventListener('pointermove', event => {
        if (!resizing || resizing.id !== event.pointerId) return;
        const delta = ((event.clientX - resizing.startX) + (event.clientY - resizing.startY)) / 360;
        const scale = Math.max(0.6, Math.min(2, resizing.scale + delta));
        root.style.setProperty('--npms-float-scale', String(scale));
        settings().floatingLyricsScale = Number(scale.toFixed(2));
    });
    const finishResize = event => {
        if (!resizing || resizing.id !== event.pointerId) return;
        resizing = null; root.classList.remove('is-resizing'); saveSettingsDebounced(); saveFloatingGeometry(root);
        try { resize.releasePointerCapture(event.pointerId); } catch {}
    };
    resize.addEventListener('pointerup', finishResize);
    resize.addEventListener('pointercancel', finishResize);
}

function ensureFloatingLyrics() {
    const config = floatingLyricsConfig();
    if (!config.enabled) { removeFloatingLyrics(); return null; }
    let root = document.querySelector('#npms_floating_lyrics');
    if (!root) {
        root = document.createElement('div');
        root.id = 'npms_floating_lyrics';
        root.className = 'npms-floating-player';
        root.innerHTML = `<div class="npms-floating-lyrics-display"><div class="npms-floating-lines"></div></div><div class="npms-floating-controls" hidden><div class="npms-floating-progress-row"><span class="npms-floating-time-current">0:00</span><input class="npms-floating-progress" type="range" min="0" max="1000" value="0" aria-label="播放进度"><span class="npms-floating-time-total">0:00</span></div><div class="npms-floating-control-row"><button type="button" class="npms-floating-mode" title="播放顺序" aria-label="播放顺序">↝</button><button type="button" class="npms-floating-prev" title="上一首" aria-label="上一首">◀◀</button><button type="button" class="npms-floating-play" title="播放/暂停" aria-label="播放/暂停">▶</button><button type="button" class="npms-floating-next" title="下一首" aria-label="下一首">▶▶</button><button type="button" class="npms-floating-list-toggle" title="歌曲列表" aria-label="歌曲列表">☰</button></div><div class="npms-floating-playlist-panel" hidden><div class="npms-floating-list-summary">当前列表为空</div><div class="npms-floating-playlist"></div></div></div><button type="button" class="npms-floating-resize" title="" aria-label="调整大小"></button>`;
        document.body.append(root);
        bindFloatingPlayer(root);
    }
    root.style.setProperty('--npms-float-color', config.fontColor);
    root.style.setProperty('--npms-float-glow-color', config.glowColor);
    root.style.setProperty('--npms-float-glow', `${config.glowStrength}px`);
    root.style.setProperty('--npms-float-shadow', config.glowStrength > 0 ? `0 0 1px ${config.glowColor}` : 'none');
    applyIsolatedFloatingStyles(root);
    observeFloatingThemeChanges();
    root.style.setProperty('--npms-float-size', `${config.fontSize}px`);
    root.classList.toggle('theme-light', config.playerTheme === 'light');
    root.classList.toggle('theme-glass', config.playerTheme === 'glass');
    root.classList.toggle('theme-glass-light', config.playerTheme === 'glass-light');
    root.classList.toggle('theme-dark', config.playerTheme === 'dark');
    root.classList.toggle('theme-inherit', config.playerTheme === 'inherit');
    root.classList.toggle('theme-custom', config.playerTheme === 'custom');
    if (config.fontFamily === 'global') root.style.removeProperty('--npms-float-font');
    else root.style.setProperty('--npms-float-font', floatingFontValue(config));
    if (config.fontUrlEnabled && config.fontUrl) void loadFloatingFont(config.fontUrl);
    root.style.setProperty('--npms-float-scale', String(config.scale));
    const positionClasses = ['pos-center-top'];
    root.classList.remove(...positionClasses);
    if (config.x !== null && config.y !== null) {
        root.classList.add('is-free-position');
        const point = clampFloatingPosition(root, config.x, config.y);
        root.style.left = `${point.x}px`; root.style.top = `${point.y}px`; root.style.right = 'auto'; root.style.bottom = 'auto';
    } else {
        root.classList.remove('is-free-position');
        root.classList.add(`pos-${config.position}`);
        root.style.removeProperty('left'); root.style.removeProperty('top'); root.style.removeProperty('right'); root.style.removeProperty('bottom');
    }
    return root;
}

let floatingLyricResizeObserver = null;
let floatingLyricMeasureFrame = 0;

function measureFloatingLyricOverflow(root) {
    if (!root) return;
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.querySelectorAll('.npms-floating-lyric-line > span, .npms-floating-lyric-line > small').forEach(node => {
        node.classList.remove('is-overflowing');
        node.style.removeProperty('--npms-lyric-scroll-distance');
        node.style.removeProperty('--npms-lyric-scroll-duration');
        if (reducedMotion) return;
        const distance = Math.ceil(node.scrollWidth - node.clientWidth);
        if (distance <= 2) return;
        node.style.setProperty('--npms-lyric-scroll-distance', `${-distance}px`);
        node.style.setProperty('--npms-lyric-scroll-duration', `${Math.max(6, Math.min(18, 5 + distance / 28)).toFixed(2)}s`);
        node.classList.add('is-overflowing');
    });
}

function scheduleFloatingLyricOverflowMeasure(root) {
    if (!root) return;
    if (floatingLyricMeasureFrame) cancelAnimationFrame(floatingLyricMeasureFrame);
    floatingLyricMeasureFrame = requestAnimationFrame(() => {
        floatingLyricMeasureFrame = 0;
        measureFloatingLyricOverflow(root);
    });
}

function observeFloatingLyricSize(root) {
    if (!root || floatingLyricResizeObserver || typeof ResizeObserver === 'undefined') return;
    floatingLyricResizeObserver = new ResizeObserver(() => scheduleFloatingLyricOverflowMeasure(root));
    const display = root.querySelector('.npms-floating-lyrics-display');
    if (display) floatingLyricResizeObserver.observe(display);
}

function renderFloatingLyrics(index) {
    const root = ensureFloatingLyrics();
    if (!root) return;
    const track = currentPlayerTrack();
    if (!track) { root.hidden = true; return; }
    const lyrics = state.player.lyrics;
    const lines = root.querySelector('.npms-floating-lines');
    const makeLine = (line, className, includeTranslation = false) => {
        const node = document.createElement('div'); node.className = `npms-floating-lyric-line ${className}`;
        const primary = document.createElement('span'); primary.textContent = line?.text || ''; node.append(primary);
        if (includeTranslation && line?.translation) { const translation = document.createElement('small'); translation.textContent = line.translation; node.append(translation); }
        return node;
    };
    root.hidden = false;
    if (track.source === 'local' || index < 0 || !lyrics[index]) {
        lines.replaceChildren(makeLine({ text: '𝖘𝖔𝖒𝖊𝖙𝖍𝖎𝖓𝖌 𝖋𝖔𝖗 𝖓𝖔𝖙𝖍𝖎𝖓𝖌' }, 'is-current'));
    } else {
        lines.replaceChildren(makeLine(lyrics[index - 1], 'is-previous'), makeLine(lyrics[index], 'is-current', true), makeLine(lyrics[index + 1], 'is-next'));
    }
    applyIsolatedFloatingStyles(root);
    lines.classList.remove('is-advancing'); void lines.offsetWidth; lines.classList.add('is-advancing');
    observeFloatingLyricSize(root);
    scheduleFloatingLyricOverflowMeasure(root);
    updateFloatingPlayerControls(root);
}

function syncFloatingLyricsControls(root = document) {
    const config = floatingLyricsConfig();
    const values = {
        '#npms_floating_lyrics_enabled': ['checked', config.enabled],
        '#npms_floating_lyrics_fixed_position': ['checked', config.fixedPosition],
        '#npms_floating_lyrics_pointer_passthrough': ['checked', config.pointerPassthrough],
        '#npms_floating_lyrics_font_color': ['value', config.fontColor],
        '#npms_floating_lyrics_font_color_text': ['value', config.fontColor.slice(1)],
        '#npms_floating_lyrics_glow_color': ['value', config.glowColor],
        '#npms_floating_lyrics_glow_color_text': ['value', config.glowColor.slice(1)],
        '#npms_floating_lyrics_glow': ['value', String(config.glowStrength)],
        '#npms_floating_lyrics_font_size': ['value', String(config.fontSize)],
        '#npms_floating_lyrics_font_family': ['value', config.fontFamily],
        '#npms_floating_lyrics_custom_font': ['value', config.customFont],
        '#npms_floating_lyrics_font_url': ['value', config.fontUrl],
        '#npms_floating_lyrics_font_url_enabled': ['checked', config.fontUrlEnabled],
        '#npms_floating_player_theme': ['value', config.playerTheme],
        '#npms_floating_player_custom_css': ['value', config.playerCustomCss],
    };
    for (const [selector, [property, value]] of Object.entries(values)) { const node = root.querySelector(selector); if (node) node[property] = value; }
    root.querySelector('#npms_floating_lyrics_font_color_value')?.replaceChildren(document.createTextNode(config.fontColor));
    root.querySelector('#npms_floating_lyrics_glow_color_value')?.replaceChildren(document.createTextNode(config.glowColor));
    root.querySelector('#npms_floating_lyrics_glow_value')?.replaceChildren(document.createTextNode(`${config.glowStrength}px`));
    root.querySelector('#npms_floating_lyrics_font_size_value')?.replaceChildren(document.createTextNode(`${config.fontSize}px`));
    ensureFloatingLyrics(); renderFloatingLyrics(state.player.lyricIndex);
}

function saveFloatingLyricsControls(root) {
    const config = settings();
    config.floatingLyricsEnabled = Boolean(root.querySelector('#npms_floating_lyrics_enabled')?.checked);
    config.floatingLyricsFixedPosition = Boolean(root.querySelector('#npms_floating_lyrics_fixed_position')?.checked);
    config.floatingLyricsPointerPassthrough = Boolean(root.querySelector('#npms_floating_lyrics_pointer_passthrough')?.checked);
    config.floatingLyricsPosition = 'center-top';
    config.floatingLyricsFontColor = sanitizeHexColor(root.querySelector('#npms_floating_lyrics_font_color_text')?.value, '#ffffff');
    config.floatingLyricsGlowColor = sanitizeHexColor(root.querySelector('#npms_floating_lyrics_glow_color_text')?.value, '#000000');
    config.floatingLyricsGlowStrength = Number(root.querySelector('#npms_floating_lyrics_glow')?.value) || 0;
    config.floatingLyricsFontSize = Number(root.querySelector('#npms_floating_lyrics_font_size')?.value) || 18;
    config.floatingLyricsFontFamily = root.querySelector('#npms_floating_lyrics_font_family')?.value || 'global';
    const selectedTheme = root.querySelector('#npms_floating_player_theme')?.value;
    config.floatingPlayerTheme = ['dark', 'light', 'glass', 'glass-light', 'inherit', 'custom'].includes(selectedTheme) ? selectedTheme : 'dark';
    config.floatingPlayerStyleMode = selectedTheme === 'inherit' ? 'inherit' : selectedTheme === 'custom' ? 'custom' : 'preset';
    config.floatingPlayerCustomCss = String(root.querySelector('#npms_floating_player_custom_css')?.value || '').slice(0, 12000);
    const nextFontUrl = String(root.querySelector('#npms_floating_lyrics_font_url')?.value || '').trim().slice(0, 2048);
    if (nextFontUrl !== config.floatingLyricsFontUrl) floatingFontLoadedUrl = '';
    config.floatingLyricsFontUrl = nextFontUrl;
    config.floatingLyricsFontUrlEnabled = Boolean(root.querySelector('#npms_floating_lyrics_font_url_enabled')?.checked);
    if (config.floatingLyricsFontUrlEnabled && /^https?:\/\//i.test(config.floatingLyricsFontUrl)) void loadFloatingFont(config.floatingLyricsFontUrl);
    config.floatingLyricsCustomFont = String(root.querySelector('#npms_floating_lyrics_custom_font')?.value || '').replace(/[^\p{L}\p{N} _,'"-]/gu, '').slice(0, 100);
    saveSettingsDebounced(); syncFloatingLyricsControls(root);
}

function parseLrc(text) {
    return String(text || '').split(/\r?\n/).flatMap(line => {
        const matches = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
        const content = line.replace(/\[[^\]]+\]/g, '').trim();
        if (!content) return [];
        return matches.map(match => ({ time: Number(match[1]) * 60 + Number(match[2]) + Number(String(match[3] || '0').padEnd(3, '0')) / 1000, text: content }));
    }).sort((a, b) => a.time - b.time);
}

function mergeLyrics(primary, translated) {
    const translations = parseLrc(translated);
    return parseLrc(primary).map(line => {
        let nearest = null;
        for (const item of translations) {
            if (item.time > line.time + 0.35) break;
            if (Math.abs(item.time - line.time) <= 0.35) nearest = item;
        }
        return { ...line, translation: nearest?.text || '' };
    });
}

function renderCurrentLyric(force = false) {
    const audio = state.player.audio;
    const ui = playerElements();
    if (!ui.lyric) return;
    const lyrics = state.player.lyrics;
    let index = -1;
    const current = audio?.currentTime || 0;
    for (let i = lyrics.length - 1; i >= 0; i--) { if (current >= lyrics[i].time) { index = i; break; } }
    if (!force && index === state.player.lyricIndex) return;
    state.player.lyricIndex = index;
    const track = currentPlayerTrack();
    const fallback = track ? `${track.name} · ${(Array.isArray(track.artist) ? track.artist.join(' / ') : track.artist || '')}` : '歌词将在播放时显示';
    const makeLine = (text, className, translation = '') => {
        const node = document.createElement('div');
        node.className = className;
        const primary = document.createElement('span');
        primary.textContent = text || '';
        node.append(primary);
        if (translation) {
            const translated = document.createElement('small');
            translated.textContent = translation;
            node.append(translated);
        }
        return node;
    };
    if (index < 0) {
        ui.lyric.replaceChildren(makeLine(fallback, 'npms-lyric-line is-current'));
    } else {
        const previous = lyrics[index - 1];
        const currentLine = lyrics[index];
        const next = lyrics[index + 1];
        ui.lyric.replaceChildren(
            makeLine(previous?.text || '', 'npms-lyric-line is-previous'),
            makeLine(currentLine.text, 'npms-lyric-line is-current', currentLine.translation),
            makeLine(next?.text || '', 'npms-lyric-line is-next'),
        );
        ui.lyric.classList.remove('is-advancing');
        void ui.lyric.offsetWidth;
        ui.lyric.classList.add('is-advancing');
    }
    renderFloatingLyrics(index);
}

async function loadCurrentTrackLyrics(track) {
    const requestId = ++state.player.lyricRequestId;
    state.player.lyrics = []; state.player.lyricIndex = -1; renderCurrentLyric(true);
    if (!track || track.source === 'local') return;
    try {
        const provider = track.source === 'qq' ? 'qq' : 'netease';
        const data = await api(`/?types=lyric&provider=${provider}&id=${encodeURIComponent(track.id)}`, { timeoutMs: 20000 });
        if (requestId !== state.player.lyricRequestId) return;
        state.player.lyrics = mergeLyrics(data.lyric, data.tlyric);
        state.player.lyricIndex = -1; renderCurrentLyric(true);
    } catch { /* Lyrics are optional and must never block playback. */ }
}

function savePlaybackSnapshot() {
    const audio = state.player.audio;
    const track = currentPlayerTrack();
    if (!audio || !track) return;
    state.player.lastKnownTime = Number.isFinite(audio.currentTime) ? audio.currentTime : state.player.lastKnownTime;
    state.player.lastKnownAt = Date.now();
    state.player.wasPlayingBeforeHidden = !audio.paused && !audio.ended;
}

function scheduleAudioRecovery(reason = '音频流停滞') {
    const audio = state.player.audio;
    const track = currentPlayerTrack();
    if (!audio || !track || audio.paused || audio.ended || state.player.recoveryInProgress) return;
    const now = Date.now();
    if (now - state.player.lastRecoveryAt < 12000) return;
    if (state.player.recoveryAttempts >= 3) {
        appendFeedback('后台播放恢复已暂停', { reason, hint: '连续恢复失败，请回到页面后手动点击播放。' }, false);
        return;
    }
    if (state.player.recoveryTimer) return;
    state.player.recoveryTimer = setTimeout(() => {
        state.player.recoveryTimer = null;
        void recoverAudioStream(reason);
    }, document.visibilityState === 'visible' ? 900 : 2500);
}

async function recoverAudioStream(reason = '音频流停滞') {
    const audio = state.player.audio;
    const track = currentPlayerTrack();
    if (!audio || !track || audio.ended || state.player.recoveryInProgress) return;
    state.player.recoveryInProgress = true;
    state.player.recoveryAttempts += 1;
    state.player.lastRecoveryAt = Date.now();
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : state.player.lastKnownTime || 0;
    const shouldResume = !audio.paused || state.player.wasPlayingBeforeHidden;
    try {
        const url = await resolvePlayerTrackUrl(track);
        if (track !== currentPlayerTrack()) return;
        audio.src = url;
        audio.load();
        await new Promise((resolve, reject) => {
            const onReady = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error('重新加载音频失败')); };
            const cleanup = () => { audio.removeEventListener('loadedmetadata', onReady); audio.removeEventListener('error', onError); };
            audio.addEventListener('loadedmetadata', onReady, { once: true });
            audio.addEventListener('error', onError, { once: true });
            setTimeout(() => { cleanup(); reject(new Error('重新加载音频超时')); }, 12000);
        });
        if (Number.isFinite(audio.duration) && position > 0) audio.currentTime = Math.min(position, Math.max(0, audio.duration - .2));
        if (shouldResume && document.visibilityState !== 'hidden') await audio.play();
        appendFeedback('音频流已自动恢复', { reason, track: track.name, position: Math.round(position), attempt: state.player.recoveryAttempts }, true);
        state.player.recoveryAttempts = 0;
        setStatus(`已恢复播放：${track.name}`, 'ok');
    } catch (error) {
        appendFeedback('音频流恢复失败', { reason, attempt: state.player.recoveryAttempts, error: error.message }, false);
        if (state.player.recoveryAttempts < 3) scheduleAudioRecovery(reason);
    } finally {
        state.player.recoveryInProgress = false;
        renderMiniPlayer();
    }
}

function reconcileBackgroundPlayback() {
    const audio = state.player.audio;
    if (!audio) return;
    if (audio.ended && state.player.tracks.length && state.player.endedAt !== audio.currentTime) {
        state.player.endedAt = audio.currentTime;
        if (state.player.mode === 'one') {
            audio.currentTime = 0;
            void audio.play().catch(error => playerFailure('单曲重播失败', error));
        } else {
            void playPlayerOffset(1, true);
        }
        return;
    }
    if (!audio.paused && audio.readyState < 3) scheduleAudioRecovery('回到前台后检测到音频未推进');
    state.player.wasPlayingBeforeHidden = false;
}

function installBackgroundPlaybackHooks() {
    if (installBackgroundPlaybackHooks.done) return;
    installBackgroundPlaybackHooks.done = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') savePlaybackSnapshot();
        else { reconcileBackgroundPlayback();  }
    });
    window.addEventListener('pageshow', () => { reconcileBackgroundPlayback();  });
}

function ensureMiniAudio() {
    if (state.player.audio) return state.player.audio;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.volume = 0.6;
    installBackgroundPlaybackHooks();
    audio.addEventListener('play', () => { state.player.recoveryAttempts = 0;   renderMiniPlayer(); });
    audio.addEventListener('pause', () => { recordListeningProgress(true); savePlaybackSnapshot();  renderMiniPlayer(); });
    audio.addEventListener('loadedmetadata', updatePlayerProgress);
    audio.addEventListener('durationchange', updatePlayerProgress);
    audio.addEventListener('timeupdate', () => { recordListeningProgress(); state.player.lastKnownTime = audio.currentTime; state.player.lastKnownAt = Date.now(); updatePlayerProgress(); renderCurrentLyric(); });
    audio.addEventListener('progress', () => { state.player.recoveryAttempts = 0; });
    audio.addEventListener('canplay', () => { state.player.recoveryAttempts = 0;  });
    audio.addEventListener('waiting', () => scheduleAudioRecovery('音频缓冲等待'));
    audio.addEventListener('stalled', () => scheduleAudioRecovery('音频流停滞'));
    audio.addEventListener('suspend', () => { if (!audio.paused && !audio.ended) scheduleAudioRecovery('浏览器暂停读取音频流'); });
    audio.addEventListener('ended', () => {
        recordListeningProgress(true);
        state.player.listenStatTime = null;
        state.player.endedAt = audio.currentTime;
        if (state.player.mode === 'one') {
            audio.currentTime = 0;
            audio.play().catch(error => playerFailure('单曲重播失败', error));
        } else {
            playPlayerOffset(1, true);
        }
    });
    audio.addEventListener('error', () => {
        const code = audio.error?.code;
        if (!audio.paused && !audio.ended) scheduleAudioRecovery(code ? `浏览器媒体错误代码 ${code}` : '浏览器无法播放该音源');
        else playerFailure('音频播放错误', new Error(code ? `浏览器媒体错误代码 ${code}` : '浏览器无法播放该音源'));
    });
    state.player.audio = audio;
    return audio;
}

function formatPlayerTime(value) {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function updatePlayerProgress() {
    const audio = state.player.audio;
    const ui = playerElements();
    const current = audio?.currentTime || 0;
    const duration = Number.isFinite(audio?.duration) ? audio.duration : 0;
    if (ui.time) ui.time.textContent = `${formatPlayerTime(current)}/${formatPlayerTime(duration)}`;
    if (ui.progress) ui.progress.style.width = `${duration ? Math.min(100, current / duration * 100) : 0}%`;
    updateFloatingPlayerControls();
}

function seekMiniPlayerAt(track, clientX) {
    const audio = state.player.audio;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return false;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    updatePlayerProgress();
    renderCurrentLyric(true);
    return true;
}

function seekMiniPlayer(event) {
    seekMiniPlayerAt(event.currentTarget, event.clientX);
}

function setMiniPlayerVolume(event) {
    const audio = ensureMiniAudio();
    audio.volume = Math.max(0, Math.min(1, Number(event.target.value) / 100));
}

function playerFailure(label, error) {
    appendFeedback(label, error?.payload || error?.message || String(error), false);
    setStatus(`${label}：${error?.message || error}`, 'error');
    state.player.loading = false;
    renderMiniPlayer();
}

async function resolvePlayerTrackUrl(track) {
    const provider = track.source === 'qq' ? 'qq' : 'netease';
    const data = await api(`/?types=url&provider=${provider}&id=${encodeURIComponent(track.id)}&br=320`, { timeoutMs: 20000 });
    appendFeedback('简易播放器音源回传', { track: track.name, id: track.id, hasUrl: Boolean(data.url), source: track.source }, Boolean(data.url));
    if (!data.url) throw new Error(`没有取得《${track.name}》的可播放地址`);
    return new URL(data.url, location.origin).href;
}

async function playPlayerIndex(index, autoplay = true) {
    const tracks = state.player.tracks;
    if (!tracks.length) return setStatus('请先搜索歌曲、解析分享链接或载入本地音乐', 'warn');
    const normalized = ((index % tracks.length) + tracks.length) % tracks.length;
    state.player.index = normalized;
    const track = tracks[normalized];
    const requestId = ++state.player.requestId;
    state.player.loading = true;
    renderMiniPlayer();
    setStatus(`正在获取音源：${track.name} - ${(track.artist || []).join?.(' / ') || track.artist || ''}`);
    try {
        const url = await resolvePlayerTrackUrl(track);
        if (requestId !== state.player.requestId) return;
        const audio = ensureMiniAudio();
        void loadCurrentTrackLyrics(track);
        audio.src = url;
        audio.load();
        state.player.loading = false;
        renderMiniPlayer();
        state.player.recoveryAttempts = 0;
        if (autoplay) {
            await audio.play();
            setStatus(`正在播放：${track.name}`, 'ok');
        } else {
            setStatus(`已准备：${track.name}，点击播放开始`, 'ok');
        }
    } catch (error) {
        if (requestId === state.player.requestId) playerFailure('简易播放器取源失败', error);
    }
}

function nextPlayerIndex(offset) {
    if (!state.player.tracks.length) return -1;
    if (state.player.mode === 'shuffle' && state.player.tracks.length > 1) {
        let next;
        do { next = Math.floor(Math.random() * state.player.tracks.length); } while (next === state.player.index);
        return next;
    }
    return ((state.player.index < 0 ? 0 : state.player.index) + offset + state.player.tracks.length) % state.player.tracks.length;
}

function playPlayerOffset(offset, autoplay = true) {
    const next = nextPlayerIndex(offset);
    if (next < 0) return setStatus('请先搜索歌曲、解析分享链接或载入本地音乐', 'warn');
    return playPlayerIndex(next, autoplay);
}

async function toggleMiniPlayer() {
    const audio = ensureMiniAudio();
    if (!state.player.tracks.length) return setStatus('请先搜索歌曲、解析分享链接或载入本地音乐', 'warn');
    if (state.player.loading) return setStatus('正在获取音源，请稍候……');
    if (!audio.src) return playPlayerIndex(state.player.index >= 0 ? state.player.index : 0, true);
    if (audio.paused) {
        try { await audio.play(); setStatus(`继续播放：${currentPlayerTrack()?.name || ''}`, 'ok'); }
        catch (error) { playerFailure('恢复播放失败', error); }
    } else {
        audio.pause();
        setStatus(`已暂停：${currentPlayerTrack()?.name || ''}`);
    }
    renderMiniPlayer();
}

function cyclePlayerMode() {
    const modes = ['list', 'one', 'shuffle'];
    state.player.mode = modes[(modes.indexOf(state.player.mode) + 1) % modes.length];
    setStatus(`播放方式：${modeLabel()}`, 'ok');
    renderMiniPlayer();
}

function trackKey(track) { return `${track?.source || 'netease'}:${track?.id || ''}`; }
function uniqueTracks(tracks) {
    const seen = new Set();
    return (Array.isArray(tracks) ? tracks : []).filter(track => track?.id && track?.name && !seen.has(trackKey(track)) && seen.add(trackKey(track)));
}

function setPlayerTracks(tracks, { name = '', cover = '', feedbackLabel = '播放器列表已载入', mergeLocal = false, kind = 'network', preservePlayback = false } = {}) {
    let usable = uniqueTracks(tracks);
    if (!usable.length) throw new Error('没有找到可播放的歌曲');
    if (mergeLocal) {
        const kept = state.player.tracks.filter(track => kind === 'local' ? track.source !== 'local' : track.source === 'local');
        usable = kind === 'local' ? uniqueTracks([...kept, ...usable]) : uniqueTracks([...usable, ...kept]);
    }
    const audio = ensureMiniAudio();
    const currentKey = trackKey(currentPlayerTrack());
    if (!preservePlayback) { audio.pause(); audio.removeAttribute('src'); audio.load(); state.player.requestId += 1; }
    state.player.tracks = usable;
    state.player.index = preservePlayback ? Math.max(0, usable.findIndex(track => trackKey(track) === currentKey)) : 0;
    state.player.loading = false;
    state.player.playlistName = name; state.player.cover = cover;
    if (!preservePlayback) { state.player.lyrics = []; state.player.lyricIndex = -1; }
    renderMiniPlayer(); renderCurrentLyric(true);
    const floating = document.querySelector('#npms_floating_lyrics');
    if (floating && floating.classList.contains('is-open')) renderFloatingPlaylist(floating);
    appendFeedback(feedbackLabel, { name, trackCount: usable.length }, true);
    return usable.length;
}

async function loadLocalPlayerTracks({ silent = false } = {}) {
    setBusy('npms_local_load', true, '载入中…');
    try {
        const tracks = await api('/local/list', { timeoutMs: 15000 });
        const count = setPlayerTracks(tracks, { name: state.player.playlistName || 'LOCAL ARCHIVE · 本地收藏', feedbackLabel: '本地音乐已融合到播放器', mergeLocal: true, kind: 'local', preservePlayback: true });
        setStatus(`本地音乐已融合，当前列表共 ${count} 首`, 'ok');
    } catch (error) {
        appendFeedback('载入本地音乐失败', error.payload || error.message, false);
        if (!silent) setStatus(`载入本地音乐失败：${error.message}`, 'error');
    } finally { setBusy('npms_local_load', false); }
}

async function resolvePlayerInput() {
    const input = document.querySelector('#npms_playlist_input')?.value.trim() || '';
    if (!input) return setStatus('请输入“歌曲 歌手”，或粘贴单曲/歌单分享链接', 'warn');
    setBusy('npms_playlist_load', true, '匹配中…');
    setStatus(`正在用${providerLabel()}识别输入内容……`);
    try {
        const data = await api(`/input/resolve?provider=${encodeURIComponent(currentProvider())}&input=${encodeURIComponent(input)}`, { timeoutMs: 30000 });
        const tracks = Array.isArray(data.tracks) ? data.tracks.filter(track => track?.id && track?.name) : [];
        if (!tracks.length) throw new Error('歌单中没有可用歌曲');
        const label = data.kind === 'playlist' ? `歌单“${data.name}”` : `歌曲“${data.name}”`;
        const isPlaylist = data.kind === 'playlist';
        const count = setPlayerTracks(tracks, { name: data.name, cover: data.cover || '', feedbackLabel: '播放器输入识别回传', mergeLocal: isPlaylist, kind: 'network' });
        if (isPlaylist) void playPlayerIndex(0, true);
        const inputNode = document.querySelector('#npms_playlist_input');
        if (inputNode) inputNode.value = '';
        setStatus(`已匹配${label}${count > 1 ? `，共 ${count} 首` : ''}`, 'ok');
    } catch (error) {
        playerFailure('搜索或链接解析失败', error);
    } finally { setBusy('npms_playlist_load', false); }
}

function clearAccountPlaylists(message = '登录后自动显示账号歌单目录') {
    state.accountPlaylistsProvider = '';
    const select = document.querySelector('#npms_account_playlist');
    if (!select) return;
    select.replaceChildren(new Option(message, ''));
    select.disabled = true;
    const button = document.querySelector('#npms_account_playlist_load');
    if (button) button.disabled = true;
}

async function loadAccountPlaylists({ silent = false } = {}) {
    const provider = currentProvider();
    const select = document.querySelector('#npms_account_playlist');
    if (!select) return;
    try {
        select.disabled = true;
        select.replaceChildren(new Option('正在读取账号歌单目录…', ''));
        const data = await api(`/account/playlists?provider=${encodeURIComponent(provider)}`, { timeoutMs: 30000 });
        if (provider !== currentProvider()) return;
        const playlists = Array.isArray(data.playlists) ? data.playlists : [];
        const fragment = document.createDocumentFragment();
        fragment.append(new Option(playlists.length ? `请选择歌单（${playlists.length} 个）` : '账号中没有可用歌单', ''));
        for (const playlist of playlists) {
            const count = Number(playlist.trackCount) > 0 ? ` · ${playlist.trackCount} 首` : '';
            const collected = playlist.collected ? '收藏 · ' : '';
            fragment.append(new Option(`${collected}${playlist.name}${count}`, playlist.id));
        }
        select.replaceChildren(fragment);
        select.disabled = playlists.length === 0;
        state.accountPlaylistsProvider = provider;
        const button = document.querySelector('#npms_account_playlist_load');
        if (button) button.disabled = playlists.length === 0;
        if (!silent) setStatus(`已读取 ${playlists.length} 个${providerLabel()}账号歌单`, 'ok');
    } catch (error) {
        clearAccountPlaylists(`账号歌单读取失败：${error.message}`);
        if (!silent) playerFailure('账号歌单目录读取失败', error);
    }
}

async function loadSelectedAccountPlaylist() {
    const select = document.querySelector('#npms_account_playlist');
    const id = select?.value || '';
    if (!id) return setStatus('请先选择一个账号歌单', 'warn');
    const provider = currentProvider();
    const requestedLimit = Number(document.querySelector('#npms_account_playlist_limit')?.value) === 500 ? 500 : 300;
    setBusy('npms_account_playlist_load', true, '载入中…');
    try {
        const data = await api(`/account/playlist/${encodeURIComponent(id)}?provider=${encodeURIComponent(provider)}&limit=${requestedLimit}`, { timeoutMs: 45000 });
        const tracks = Array.isArray(data.tracks) ? data.tracks.slice(0, requestedLimit) : [];
        const count = setPlayerTracks(tracks, { name: data.name, cover: data.cover || '', feedbackLabel: '账号歌单已载入播放器', mergeLocal: true, kind: 'network' });
        void playPlayerIndex(0, true);
        const truncated = Number(data.trackCount) > count;
        setStatus(`已载入“${data.name}”${count} 首${truncated ? `（已按设置截取前 ${requestedLimit} 首）` : ''}`, 'ok');
        document.querySelector('[data-npms-tab="player"]')?.click();
    } catch (error) {
        playerFailure('账号歌单载入失败', error);
    } finally { setBusy('npms_account_playlist_load', false); }
}

async function saveCookie() {
    const input = document.querySelector('#npms_cookie');
    const cookie = input?.value.trim() || '';
    if (!cookie) return setStatus(`请先粘贴${providerLabel()} Cookie`, 'warn');
    setBusy('npms_cookie_save', true, '保存中…');
    setStatus('正在把 Cookie 提交给本机后端并验证……');
    try {
        const data = await api('/auth/cookie', { method: 'POST', body: JSON.stringify({ cookie, provider: currentProvider() }) });
        if (input) input.value = '';
        appendFeedback('Cookie 接口回传', data, Boolean(data.loggedIn));
        setStatus(data.message || accountLabel(data), data.loggedIn ? 'ok' : 'warn');
        if (data.loggedIn) await loadAccountPlaylists({ silent: true });
    } catch (error) {
        appendFeedback('Cookie 保存失败', error.payload || error.message, false);
        setStatus(`Cookie 保存失败：${error.message}`, 'error');
    } finally { setBusy('npms_cookie_save', false); }
}

async function logout() {
    setBusy('npms_logout', true, '清除中…');
    try {
        const data = await api('/auth/logout', { method: 'POST', body: JSON.stringify({ provider: currentProvider() }) });
        appendFeedback('清除登录回传', data, true);
        setStatus(`已清除${providerLabel()}登录 Cookie`, 'ok');
        clearAccountPlaylists();
    } catch (error) {
        appendFeedback('清除登录失败', error.payload || error.message, false);
        setStatus(`清除失败：${error.message}`, 'error');
    } finally { setBusy('npms_logout', false); }
}

async function rescan() {
    setBusy('npms_rescan', true, '扫描中…');
    try {
        const data = await api('/local/rescan', { method: 'POST', body: '{}' });
        appendFeedback('本地扫描回传', data, true);
        setStatus(`本地音乐扫描完成：${data.count} 首，正在载入播放器……`, 'ok');
        await loadLocalPlayerTracks({ silent: true });
    } catch (error) {
        appendFeedback('本地扫描失败', error.payload || error.message, false);
        setStatus(`扫描失败：${error.message}`, 'error');
    } finally { setBusy('npms_rescan', false); }
}

async function inspectLocalDir() {
    const localMusicDir = document.querySelector('#npms_local_dir')?.value.trim() || '';
    setBusy('npms_dir_inspect', true, '检测中…');
    setStatus('正在让音乐源后端检测目录……');
    try {
        const data = await api('/local/inspect', { method: 'POST', body: JSON.stringify({ localMusicDir }) });
        appendFeedback('本地目录检测回传', data, true);
        const sample = Array.isArray(data.samples) && data.samples.length ? `；示例：${data.samples.slice(0, 3).join('、')}` : '';
        setStatus(`目录可读取，共检测到 ${data.audioCount} 个音频文件${sample}`, data.audioCount ? 'ok' : 'warn');
    } catch (error) {
        appendFeedback('本地目录检测失败', error.payload || error.message, false);
        setStatus(`目录检测失败：${error.message}`, 'error');
    } finally { setBusy('npms_dir_inspect', false); }
}

async function copyText(text, successMessage) {
    try {
        await navigator.clipboard.writeText(text);
        setStatus(successMessage, 'ok');
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        setStatus(ok ? successMessage : '复制失败，请长按命令框手动复制', ok ? 'ok' : 'error');
    }
}

async function saveLocalDir() {
    const localMusicDir = document.querySelector('#npms_local_dir')?.value.trim() || '';
    setBusy('npms_dir_save', true, '保存中…');
    try {
        const data = await api('/config/local-dir', { method: 'POST', body: JSON.stringify({ localMusicDir }) });
        appendFeedback('目录设置回传', data, true);
        setStatus(`音乐目录已保存，扫描到 ${data.count} 首，正在载入播放器……`, 'ok');
        await loadLocalPlayerTracks({ silent: true });
    } catch (error) {
        appendFeedback('目录保存失败', error.payload || error.message, false);
        setStatus(`目录保存失败：${error.message}`, 'error');
    } finally { setBusy('npms_dir_save', false); }
}

function getTavernHelperScripts() {
    const scripts = extension_settings?.tavern_helper?.script?.scripts;
    return Array.isArray(scripts) ? scripts : null;
}

function analyzePlayerScript(script, index) {
    const content = String(script?.content || '');
    const rules = [
        {
            label: '旧本机接口 localhost/127.0.0.1:3001',
            test: /https?:\/\/(?:localhost|127\.0\.0\.1):3001\/?/gi,
            replace: value => value.replace(/https?:\/\/(?:localhost|127\.0\.0\.1):3001\/?/gi, `${API_BASE}/`),
        },
        {
            label: 'GDStudio 搜索/播放/歌词接口',
            test: /https?:\/\/music-api\.gdstudio\.xyz\/api\.php/gi,
            replace: value => value.replace(/https?:\/\/music-api\.gdstudio\.xyz\/api\.php/gi, `${API_BASE}/`),
        },
        {
            label: 'Meting 网易云歌单接口',
            test: /https?:\/\/api\.injahow\.cn\/meting\/\?server=netease&type=playlist&id=/gi,
            replace: value => value.replace(/https?:\/\/api\.injahow\.cn\/meting\/\?server=netease&type=playlist&id=/gi, `${API_BASE}/?types=playlist&provider=netease&id=`),
        },
        {
            label: 'GDStudio 多源列表（保留网易云与 QQ）',
            test: /(?:const|let|var)\s+sources\s*=\s*\[\s*['"]netease['"]\s*,\s*['"]kuwo['"]\s*,\s*['"]kugou['"]\s*,\s*['"]tencent['"]\s*\]\s*;?/gi,
            replace: value => value.replace(/((?:const|let|var)\s+sources\s*=\s*)\[\s*['"]netease['"]\s*,\s*['"]kuwo['"]\s*,\s*['"]kugou['"]\s*,\s*['"]tencent['"]\s*\](\s*;?)/gi, "$1['netease', 'tencent']$2"),
        },
        {
            label: '其他已知同参数兼容接口',
            test: /https?:\/\/(?:music-api\.lxhcool\.cn|api\.music\.imsyy\.top)\/api\.php/gi,
            replace: value => value.replace(/https?:\/\/(?:music-api\.lxhcool\.cn|api\.music\.imsyy\.top)\/api\.php/gi, `${API_BASE}/`),
        },
    ];
    const matches = rules.map(rule => {
        rule.test.lastIndex = 0;
        return { rule, count: (content.match(rule.test) || []).length };
    }).filter(item => item.count > 0);
    const playerScore = [
        /new\s+(?:ROOT\.)?Audio\s*\(/i,
        /\.src\s*=/i,
        /\bplaylist\b/i,
        /types=(?:search|url|lyric|playlist)/i,
        /\b(?:play|pause|next|prev)(?:Track|Audio)?\s*\(/i,
        /meting|music-api|song_url|lyric/i,
    ].reduce((score, pattern) => score + Number(pattern.test(content)), 0);
    if (playerScore < 2) return null;
    const endpointUrls = [...new Set((content.match(/https?:\/\/[^\s'"`<>\\]+/gi) || [])
        .filter(url => /music|meting|song|lyric|audio|api\.php/i.test(url))
        .map(url => url.replace(/[),;]+$/, '')))].slice(0, 12);
    if (!matches.length && !endpointUrls.length) return null;
    return {
        index,
        id: String(script.id || index),
        name: String(script.name || `未命名脚本 ${index + 1}`),
        enabled: script.enabled !== false,
        matches,
        endpointUrls,
        playerScore,
        total: matches.reduce((sum, item) => sum + item.count, 0),
        externalDependencies: [
            /music\.163\.com\/api\/playlist/i.test(content) ? '脚本仍保留网易云官方接口作为末级后备；本机歌单接口正常时不会触发' : '',
            /corsproxy\.io/i.test(content) ? '脚本含 CORS 代理后备逻辑；本机接口正常时不会触发' : '',
            /(?:source=|sources[^\n]{0,80})(?:kuwo|kugou)/i.test(content) ? '酷我/酷狗不映射；适配副本仅保留网易云与 QQ' : '',
        ].filter(Boolean),
    };
}

function renderScriptCandidates(candidates) {
    const root = document.querySelector('#npms_script_candidates');
    if (!root) return;
    if (!candidates.length) {
        root.innerHTML = '<span class="npms-muted">没有找到可安全自动替换的播放器脚本。只自动处理已确认参数兼容的本机接口与 GDStudio 型接口；无法确认的第三方源只提示，不擅自替换。</span>';
        return;
    }
    root.replaceChildren(...candidates.map(candidate => {
        const card = document.createElement('div');
        card.className = 'npms-script-card';
        const title = document.createElement('b');
        title.textContent = candidate.name;
        const meta = document.createElement('span');
        meta.className = 'npms-muted';
        meta.textContent = `${candidate.enabled ? '当前启用' : '当前停用'} · 播放器特征 ${candidate.playerScore} 项 · ${candidate.total ? `可安全替换 ${candidate.total} 处：${candidate.matches.map(item => `${item.label} ${item.count} 处`).join('；')}` : '发现音乐接口，但参数兼容性未知，只做提示'}${candidate.externalDependencies.length ? ` · 注意：${candidate.externalDependencies.join('；')}` : ''}`;
        const options = document.createElement('label');
        options.className = 'checkbox_label npms-horizontal-label';
        options.innerHTML = '<input type="checkbox" class="npms-disable-source" checked><span>创建副本后停用原脚本，避免出现两个播放器</span>';
        const button = document.createElement('button');
        button.className = 'menu_button';
        button.textContent = candidate.total ? '创建适配副本' : '仅提示，暂不可自动替换';
        button.disabled = candidate.total === 0;
        button.addEventListener('click', () => { void adaptPlayerScript(candidate, options.querySelector('input').checked, button); });
        if (candidate.endpointUrls.length) { const urls = document.createElement('code'); urls.className = 'npms-candidate-urls'; urls.textContent = candidate.endpointUrls.join('\n'); card.append(title, meta, urls, options, button); return card; }
        card.append(title, meta, options, button);
        return card;
    }));
}

async function scanPlayerScripts() {
    if (scriptScanInProgress) return;
    scriptScanInProgress = true;
    const button = document.querySelector('#npms_scan_scripts');
    if (button) { button.disabled = true; button.textContent = '扫描中…'; }
    try {
        const scripts = getTavernHelperScripts();
        if (!scripts) {
            setStatus('没有检测到酒馆助手脚本数据；请确认已安装并启用酒馆助手', 'warn');
            appendFeedback('扫描播放器脚本', 'extension_settings.tavern_helper.script.scripts 不存在', false);
            return;
        }
        const candidates = [];
        for (let index = 0; index < scripts.length; index += 1) {
            const candidate = analyzePlayerScript(scripts[index], index);
            if (candidate) candidates.push(candidate);
            if ((index + 1) % (isTauriTavern ? 2 : 8) === 0) await yieldToWebView();
        }
        renderScriptCandidates(candidates);
        appendFeedback('扫描播放器脚本完成', { scanned: scripts.length, candidates: candidates.map(item => ({ name: item.name, replacements: item.total })) }, true);
        setStatus(candidates.length ? `找到 ${candidates.length} 个可适配的播放器脚本，请逐项确认` : '没有找到可安全自动适配的播放器脚本', candidates.length ? 'ok' : 'warn');
    } catch (error) {
        renderScriptCandidates([]);
        appendFeedback('扫描播放器脚本失败', error?.message || String(error), false);
        setStatus(`扫描失败：${error?.message || error}`, 'error');
    } finally {
        scriptScanInProgress = false;
        if (button) { button.disabled = false; button.textContent = '扫描播放器脚本'; }
    }
}

function makeScriptId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `npms-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function adaptPlayerScript(candidate, disableSource, button) {
    const scripts = getTavernHelperScripts();
    const source = scripts?.[candidate.index];
    if (!source || String(source.id || candidate.index) !== candidate.id) {
        setStatus('脚本列表已变化，请重新扫描后再适配', 'warn');
        return;
    }
    const proposedName = `${candidate.name}－你自己的音乐源适配副本`;
    if (scripts.some(script => script.name === proposedName)) {
        setStatus(`已经存在同名适配副本：${proposedName}`, 'warn');
        return;
    }
    const summary = candidate.matches.map(item => `${item.rule.label} ${item.count} 处`).join('\n');
    const accepted = window.confirm(`将创建新脚本副本，不覆盖原脚本。\n\n原脚本：${candidate.name}\n新脚本：${proposedName}\n\n将替换：\n${summary}\n\n${disableSource ? '原脚本会被停用。' : '原脚本会保持当前状态。'}\n创建后需要刷新 SillyTavern 页面才会生效。`);
    if (!accepted) return;
    button.disabled = true;
    try {
        const clone = structuredClone(source);
        let content = String(clone.content || '');
        for (const item of candidate.matches) content = item.rule.replace(content);
        clone.id = makeScriptId();
        clone.name = proposedName;
        clone.content = content;
        clone.enabled = true;
        clone.info = `${String(clone.info || '').trim()}\n\n/** 由“你自己的音乐源”创建的适配副本；原脚本未被覆盖。 */`.trim();
        if (disableSource) source.enabled = false;
        scripts.push(clone);
        saveSettingsDebounced();
        appendFeedback('播放器脚本适配完成', { source: candidate.name, copy: proposedName, replacements: candidate.total, sourceDisabled: disableSource, newId: clone.id }, true);
        setStatus('适配副本已创建并保存，请刷新 SillyTavern 页面使其生效', 'ok');
        void scanPlayerScripts();
    } catch (error) {
        appendFeedback('播放器脚本适配失败', error.message || String(error), false);
        setStatus(`适配失败：${error.message || error}`, 'error');
        button.disabled = false;
    }
}

function panelHtml() {
 const api=API_BASE;
 return `<div id="netease_personal_music_source_settings" class="extension_container npms-panel"><div class="inline-drawer npms-shell">
 <div class="inline-drawer-toggle inline-drawer-header"><b>你自己的音乐源</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
 <div class="inline-drawer-content npms-paper"><nav class="npms-tabs" role="tablist"><button class="npms-tab is-active" data-npms-tab="home">主页</button><button class="npms-tab" data-npms-tab="player">播放器</button><button class="npms-tab" data-npms-tab="local">本地音乐</button><button class="npms-tab" data-npms-tab="deploy">部署</button><button class="npms-tab" data-npms-tab="tools">工具</button></nav>
 <section class="npms-page is-active" data-npms-page="home"><div class="npms-section-heading"><span>01</span><div><b>连接与账号</b><small>选择平台，并连接只属于你的曲库。</small></div></div><div id="npms_status" class="npms-status">等待检查后端</div><div class="npms-provider-switch"><button type="button" data-provider="netease" class="npms-provider-button"><span>网易云音乐</span><small>NETEASE</small></button><button type="button" data-provider="qq" class="npms-provider-button"><span>QQ 音乐</span><small>QQ MUSIC</small></button></div><div class="npms-actions npms-primary-actions"><button id="npms_refresh" class="menu_button">↻ 刷新状态</button><button id="npms_qr_start" class="menu_button">＋ 扫码登录</button><button id="npms_logout" class="menu_button">清除登录</button></div><div id="npms_qr_box" class="npms-qr" hidden><img id="npms_qr_image" alt="登录二维码"><button id="npms_qr_cancel" class="menu_button">取消扫码</button></div><details class="npms-detail-card npms-cookie-fold"><summary><b>Cookie 登录</b><span>可选</span></summary><div class="npms-detail-body"><div class="npms-field-card"><label id="npms_cookie_label" for="npms_cookie">平台 Cookie <small>仅提交到本机后端</small></label><textarea id="npms_cookie" rows="3" placeholder="在这里粘贴平台 Cookie"></textarea><button id="npms_cookie_save" class="menu_button">保存并验证 Cookie</button></div></div></details><p class="npms-privacy-note">账号凭据只保存在 SillyTavern 后端，不写入聊天、角色卡或前端设置。</p></section>
 <section class="npms-page" data-npms-page="player" hidden><div class="npms-section-heading"><span>02</span><div><b>播放器</b><small>搜索歌曲、解析分享链接，或播放本地曲目。</small></div></div><div class="npms-field-card npms-account-playlists"><label for="npms_account_playlist">账号歌单 <small>登录后自动读取目录；每个歌单最多载入 500 首</small></label><div class="npms-select-row"><select id="npms_account_playlist" disabled><option value="">登录后自动显示账号歌单目录</option></select><select id="npms_account_playlist_limit" aria-label="歌单载入数量"><option value="300" selected>前 300 首（推荐）</option><option value="500">前 500 首</option></select><button id="npms_account_playlist_load" class="menu_button" disabled>载入所选歌单</button></div></div><details class="npms-detail-card npms-floating-lyrics-settings"><summary><b>主页面悬浮歌词</b><span>默认关闭</span></summary><div class="npms-detail-body"><label class="npms-check-row"><input id="npms_floating_lyrics_enabled" type="checkbox"><span>在酒馆主页面显示同步歌词</span></label><label class="npms-check-row"><input id="npms_floating_lyrics_fixed_position" type="checkbox"><span>固定歌词位置（关闭拖动）</span></label><label class="npms-check-row"><input id="npms_floating_lyrics_pointer_passthrough" type="checkbox"><span>歌词点击穿透（不拦截下方界面）</span></label><button type="button" id="npms_floating_lyrics_reset_position" class="menu_button npms-position-reset">重置到顶部居中</button><div class="npms-floating-options"><label>字体颜色<div class="npms-color-control"><input id="npms_floating_lyrics_font_color_text" type="text" inputmode="text" maxlength="7" value="ffffff" aria-label="字体颜色六位编码"><input id="npms_floating_lyrics_font_color" type="color" value="#ffffff" aria-label="选择字体颜色"></div></label><label>晕染颜色<div class="npms-color-control"><input id="npms_floating_lyrics_glow_color_text" type="text" inputmode="text" maxlength="7" value="000000" aria-label="晕染颜色六位编码"><input id="npms_floating_lyrics_glow_color" type="color" value="#000000" aria-label="选择晕染颜色"></div></label><label>晕染强度 <output id="npms_floating_lyrics_glow_value">12px</output><input id="npms_floating_lyrics_glow" type="range" min="0" max="30" step="1" value="12"></label><label>字体大小 <output id="npms_floating_lyrics_font_size_value">18px</output><input id="npms_floating_lyrics_font_size" type="range" min="12" max="32" step="1" value="18"></label><div class="npms-player-style-tools"><label>播放栏 CSS<textarea id="npms_floating_player_custom_css" rows="4"></textarea></label><div class="npms-style-file-actions"><button type="button" id="npms_floating_lyrics_export" class="menu_button">导出方案</button><button type="button" id="npms_floating_lyrics_import_button" class="menu_button">导入方案</button><input id="npms_floating_lyrics_import" type="file" accept="application/json" hidden></div></div><label>播放栏配色<select id="npms_floating_player_theme"><option value="dark">灰黑底浅色字</option><option value="light">灰白底深色字</option><option value="glass">深色毛玻璃</option><option value="glass-light">浅色毛玻璃</option><option value="inherit">继承酒馆 CSS</option><option value="custom">自定义</option></select></label><label>字体<select id="npms_floating_lyrics_font_family"><option value="global">跟随酒馆全局</option><option value="serif">衬线</option><option value="sans-serif">无衬线</option><option value="monospace">等宽</option><option value="custom">本地字体</option><option value="url">网络字体</option></select></label><label>本地字体<input id="npms_floating_lyrics_custom_font" type="text"></label><label class="npms-font-url-field">网络字体地址<input id="npms_floating_lyrics_font_url" type="url" inputmode="url"></label><label class="npms-check-row npms-font-url-toggle"><input id="npms_floating_lyrics_font_url_enabled" type="checkbox"><span>启用网络字体</span></label></div></div></details><div class="npms-mini-player"><div class="npms-compact-main"><div id="npms_player_title_wrap" class="npms-player-title-wrap"><span id="npms_player_ticker" class="npms-player-ticker">Loading...</span></div><div id="npms_player_time" class="npms-player-time">0:00/0:00</div><div class="npms-player-controls"><button id="npms_player_prev" class="npms-player-key">&lt;&lt;</button><button id="npms_player_play" class="npms-player-key">&gt;</button><button id="npms_player_next" class="npms-player-key">&gt;&gt;</button><button id="npms_player_mode" class="npms-player-key">SEQ</button></div><label class="npms-volume"><b>VOL</b><input id="npms_player_volume" type="range" min="0" max="100" value="60"></label></div><div id="npms_player_progress_track" class="npms-progress-track"><div id="npms_player_progress" class="npms-progress-bar"></div></div><div class="npms-lyric-window"><div id="npms_player_lyric" class="npms-lyric-stack"><div class="npms-lyric-line is-current"><span>歌词将在播放时显示</span></div></div></div><div class="npms-playlist-loader"><input id="npms_playlist_input" type="text" placeholder="歌曲 歌手 / 单曲或歌单分享链接"><button id="npms_playlist_load" class="menu_button">搜索 / 解析</button><button id="npms_local_load" class="menu_button">本地音乐</button></div><div class="npms-player-foot"><span id="npms_player_count">0 / 0</span><span>SEQ · ONE · RND</span></div></div></section>
 <section class="npms-page" data-npms-page="local" hidden><div class="npms-section-heading"><span>03</span><div><b>本地音乐</b><small>连接运行酒馆的设备或服务器中的音乐目录。</small></div></div><div class="npms-field-card"><label for="npms_local_dir">音乐目录绝对路径</label><input id="npms_local_dir" type="text" placeholder="C:\\Users\\你\\Music、/Users/你/Music 或 /home/你/Music"><div class="npms-examples">Windows：<code>C:\Users\你\Music</code><br>macOS：<code>/Users/你/Music</code><br>Linux：<code>/home/你/Music</code><br>Termux：<code>/data/data/com.termux/files/home/storage/music</code></div><div class="npms-actions"><button id="npms_dir_inspect" class="menu_button">检测目录</button><button id="npms_dir_save" class="menu_button">保存并连接</button><button id="npms_rescan" class="menu_button">重新扫描</button></div></div><div class="npms-format-strip"><b>支持格式</b><span>MP3</span><span>FLAC</span><span>M4A</span><span>WAV</span><span>OGG</span><span>AAC</span><span>WEBM</span><span>OPUS</span></div><p class="npms-privacy-note">Docker 请填写容器内可见路径，并使用持久化卷。</p></section>
 <section class="npms-page" data-npms-page="deploy" hidden><div class="npms-section-heading"><span>04</span><div><b>后端管理</b><small>选择操作与 SillyTavern 实际运行的平台。</small></div></div><div class="npms-manage-tabs"><button class="npms-manage-tab is-active" data-manage-mode="install">安装 / 更新后端</button><button class="npms-manage-tab" data-manage-mode="remove">删除后端</button></div><div class="npms-deploy-grid">
<article class="npms-deploy-card"><header><b>Android</b><small>TERMUX</small></header><textarea id="npms_install_command_termux" data-install-command="${TERMUX_INSTALL_COMMAND}" data-remove-command="${TERMUX_REMOVE_BACKEND_COMMAND}" rows="3" readonly>${TERMUX_INSTALL_COMMAND}</textarea><button id="npms_copy_install_termux" class="menu_button">复制安装 / 更新命令</button></article>
<article class="npms-deploy-card"><header><b>Windows</b><small>POWERSHELL · BETA</small></header><textarea id="npms_install_command_windows" data-install-command="${WINDOWS_INSTALL_COMMAND}" data-remove-command="${WINDOWS_REMOVE_BACKEND_COMMAND}" rows="3" readonly>${WINDOWS_INSTALL_COMMAND}</textarea><button id="npms_copy_install_windows" class="menu_button">复制安装 / 更新命令</button></article>
<article class="npms-deploy-card"><header><b>macOS</b><small>TERMINAL</small></header><textarea id="npms_install_command_macos" data-install-command="${MACOS_INSTALL_COMMAND}" data-remove-command="${MACOS_REMOVE_BACKEND_COMMAND}" rows="3" readonly>${MACOS_INSTALL_COMMAND}</textarea><button id="npms_copy_install_macos" class="menu_button">复制安装 / 更新命令</button></article>
<article class="npms-deploy-card"><header><b>Linux</b><small>CLOUD · DOCKER</small></header><textarea id="npms_install_command_linux" data-install-command="${LINUX_INSTALL_COMMAND}" data-remove-command="${LINUX_REMOVE_BACKEND_COMMAND}" rows="3" readonly>${LINUX_INSTALL_COMMAND}</textarea><button id="npms_copy_install_linux" class="menu_button">复制安装 / 更新命令</button></article></div><ol class="npms-steps"><li>需要 Node.js 20+ 与 npm。</li><li>找不到酒馆时通过 <code>ST_DIR</code> 指定路径。</li><li>命令执行完成后，请自行重启 SillyTavern。</li></ol></section>

 <section class="npms-page" data-npms-page="tools" hidden><div class="npms-section-heading npms-tools-heading"><span>05</span><div><b>工具与记录</b><small>接口、播放器适配和后端回传。</small></div><button id="npms_listening_stats_toggle" class="npms-listening-stats-toggle" type="button" aria-label="听歌排行榜" aria-expanded="false">◌</button></div><details class="npms-detail-card"><summary><b>播放器接入接口</b><span>API</span></summary><div class="npms-detail-body"><div class="npms-api-list"><code>GET ${api}/?types=search&amp;name=歌名%20歌手</code><span>搜索</span><code>GET ${api}/?types=url&amp;id=歌曲ID</code><span>播放</span><code>GET ${api}/?types=lyric&amp;id=歌曲ID</code><span>歌词</span><code>GET ${api}/input/resolve?provider=qq|netease&amp;input=...</code><span>统一解析</span><code>GET ${api}/account/playlists?provider=netease|qq</code><span>账号歌单目录</span><code>GET ${api}/account/playlist/歌单ID?provider=...&amp;limit=300</code><span>按需载入，硬上限 500 首</span><code>GET ${api}/local/list</code><span>本地列表</span><code>GET ${api}/health</code><span>后端状态</span></div><button id="npms_copy_api" class="menu_button">复制接口基址</button></div></details><details class="npms-detail-card"><summary><b>适配现有酒馆助手播放器</b><span>ADAPTER</span></summary><div class="npms-detail-body"><p class="npms-help">只创建适配副本，永不覆盖原脚本。</p><button id="npms_scan_scripts" class="menu_button">扫描播放器脚本</button><div id="npms_script_candidates" class="npms-script-candidates"><span class="npms-muted">尚未扫描。</span></div></div></details><div id="npms_listening_stats_panel" class="npms-listening-stats-panel" hidden></div>
<details class="npms-detail-card npms-tt-backend-card"><summary><b>TT 兼容说明</b><span>暂未适配</span></summary><div class="npms-detail-body"><div class="npms-status" data-kind="warn">TauriTavern 后端暂未适配</div><p class="npms-help"><b>给 TauriTavern 用户：</b>本插件目前可以加载前端界面，但 TT 暂未提供本插件所需的后端运行环境。</p><p class="npms-help">因此以下功能暂不可用：</p><ul class="npms-steps npms-tt-steps"><li>网易云 / QQ 音乐 Cookie 登录</li><li>二维码登录</li><li>在线搜索、歌单、歌词和播放地址</li><li>本地音乐扫描与后端 Range 播放</li></ul><p class="npms-help">这不是你的安装问题。普通 SillyTavern 用户不受影响；后续完成 TT 原生后端适配后，再恢复这些功能。</p></div></details>
<details class="npms-detail-card" open><summary><b>后端回传与操作记录</b><span>LOG</span></summary><div class="npms-detail-body"><div id="npms_feedback" class="npms-feedback"></div></div></details></section>
 </div></div></div>`;
}
function bind() {
    const root = document.querySelector('#netease_personal_music_source_settings');
    if (!root) return;
    root.querySelectorAll('[data-npms-tab]').forEach(tab => tab.addEventListener('click', () => {
        const name = tab.dataset.npmsTab;
        root.querySelectorAll('[data-npms-tab]').forEach(item => {
            const active = item === tab;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-selected', String(active));
        });
        root.querySelectorAll('[data-npms-page]').forEach(page => {
            const active = page.dataset.npmsPage === name;
            page.classList.toggle('is-active', active);
            page.hidden = !active;
        });
        if (isTauriTavern) void yieldToWebView();
    }));
    root.querySelectorAll('[data-manage-mode]').forEach(tab => tab.addEventListener('click', () => {
        const mode = tab.dataset.manageMode;
        root.querySelectorAll('[data-manage-mode]').forEach(item => item.classList.toggle('is-active', item === tab));
        root.querySelectorAll('.npms-deploy-card').forEach(card => {
            const area = card.querySelector('textarea');
            const button = card.querySelector('.menu_button');
            if (area) area.value = mode === 'remove' ? area.dataset.removeCommand : area.dataset.installCommand;
            if (button) button.textContent = mode === 'remove' ? '复制删除后端命令' : '复制安装 / 更新命令';
        });
    }));
    root.querySelectorAll('[data-provider]').forEach(button => button.addEventListener('click', () => switchProvider(button.dataset.provider)));
    root.querySelector('#npms_listening_stats_toggle')?.addEventListener('click', toggleListeningStatsPanel);
    root.querySelector('#npms_refresh').addEventListener('click', refreshStatus);
    root.querySelector('#npms_qr_start').addEventListener('click', startQrLogin);
    root.querySelector('#npms_qr_cancel').addEventListener('click', () => { stopQrPolling(); root.querySelector('#npms_qr_box').hidden = true; setStatus('已取消扫码'); });
    root.querySelector('#npms_cookie_save').addEventListener('click', saveCookie);
    root.querySelector('#npms_account_playlist_load').addEventListener('click', loadSelectedAccountPlaylist);
    const floatingControls = ['#npms_floating_lyrics_enabled', '#npms_floating_lyrics_fixed_position', '#npms_floating_lyrics_pointer_passthrough', '#npms_floating_lyrics_glow', '#npms_floating_lyrics_font_size', '#npms_floating_player_style_mode', '#npms_floating_player_custom_css', '#npms_floating_player_theme', '#npms_floating_lyrics_font_family', '#npms_floating_lyrics_custom_font', '#npms_floating_lyrics_font_url', '#npms_floating_lyrics_font_url_enabled'];
    floatingControls.forEach(selector => root.querySelector(selector)?.addEventListener('input', () => saveFloatingLyricsControls(root)));
    root.querySelector('#npms_floating_lyrics_export')?.addEventListener('click', exportFloatingStyleConfig);
    root.querySelector('#npms_floating_lyrics_import_button')?.addEventListener('click', () => root.querySelector('#npms_floating_lyrics_import')?.click());
    root.querySelector('#npms_floating_lyrics_import')?.addEventListener('change', event => importFloatingStyleConfig(event, root));
    const bindColor = (textSelector, pickerSelector, fallback) => {
        const text = root.querySelector(textSelector); const picker = root.querySelector(pickerSelector);
        text?.addEventListener('input', () => {
            const color = sanitizeHexColor(text.value, '');
            text.classList.toggle('is-invalid', !color);
            if (color && picker) { picker.value = color; saveFloatingLyricsControls(root); }
        });
        picker?.addEventListener('input', () => { if (text) text.value = picker.value.slice(1); saveFloatingLyricsControls(root); });
        text?.addEventListener('blur', () => { const color = sanitizeHexColor(text.value, fallback); text.value = color.slice(1); text.classList.remove('is-invalid'); if (picker) picker.value = color; saveFloatingLyricsControls(root); });
    };
    bindColor('#npms_floating_lyrics_font_color_text', '#npms_floating_lyrics_font_color', '#ffffff');
    bindColor('#npms_floating_lyrics_glow_color_text', '#npms_floating_lyrics_glow_color', '#000000');
    root.querySelector('#npms_floating_lyrics_reset_position')?.addEventListener('click', () => {
        settings().floatingLyricsX = null; settings().floatingLyricsY = null; settings().floatingLyricsPosition = 'center-top'; saveSettingsDebounced();
        document.querySelector('#npms_floating_lyrics')?.remove(); renderFloatingLyrics(state.player.lyricIndex);
    });
    syncFloatingLyricsControls(root);
    root.querySelector('#npms_playlist_load').addEventListener('click', resolvePlayerInput);
    root.querySelector('#npms_local_load').addEventListener('click', () => loadLocalPlayerTracks());
    root.querySelector('#npms_playlist_input').addEventListener('keydown', event => { if (event.key === 'Enter') resolvePlayerInput(); });
    root.querySelector('#npms_player_prev').addEventListener('click', () => playPlayerOffset(-1, true));
    root.querySelector('#npms_player_play').addEventListener('click', toggleMiniPlayer);
    root.querySelector('#npms_player_next').addEventListener('click', () => playPlayerOffset(1, true));
    root.querySelector('#npms_player_mode').addEventListener('click', cyclePlayerMode);
    const progressTrack = root.querySelector('#npms_player_progress_track');
    let progressDrag = null;
    progressTrack.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        if (!seekMiniPlayerAt(progressTrack, event.clientX)) return;
        progressDrag = { id: event.pointerId, moved: false };
        progressTrack.setPointerCapture?.(event.pointerId);
        progressTrack.classList.add('is-dragging');
        event.preventDefault();
    });
    progressTrack.addEventListener('pointermove', event => {
        if (!progressDrag || progressDrag.id !== event.pointerId) return;
        if (Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0) > 1) progressDrag.moved = true;
        seekMiniPlayerAt(progressTrack, event.clientX);
        event.preventDefault();
    });
    const finishProgressDrag = event => {
        if (!progressDrag || progressDrag.id !== event.pointerId) return;
        const moved = progressDrag.moved;
        progressDrag = null;
        progressTrack.classList.remove('is-dragging');
        try { progressTrack.releasePointerCapture?.(event.pointerId); } catch {}
        if (moved) progressTrack.dataset.suppressClick = 'true';
    };
    progressTrack.addEventListener('pointerup', finishProgressDrag);
    progressTrack.addEventListener('pointercancel', finishProgressDrag);
    progressTrack.addEventListener('click', event => {
        if (progressTrack.dataset.suppressClick === 'true') {
            progressTrack.dataset.suppressClick = 'false';
            event.preventDefault();
            return;
        }
        seekMiniPlayer(event);
    });
    root.querySelector('#npms_player_volume').addEventListener('input', setMiniPlayerVolume);
    window.addEventListener('resize', () => { resetPlayerMarquee(); scheduleFloatingLyricOverflowMeasure(document.querySelector('#npms_floating_lyrics')); }, { passive: true });
    root.querySelector('#npms_logout').addEventListener('click', logout);
    root.querySelector('#npms_rescan').addEventListener('click', rescan);
    root.querySelector('#npms_dir_inspect').addEventListener('click', inspectLocalDir);
    root.querySelector('#npms_dir_save').addEventListener('click', saveLocalDir);
    root.querySelector('#npms_copy_install_termux').addEventListener('click', () => copyText(root.querySelector('#npms_install_command_termux').value, 'Termux 后端命令已复制'));
    root.querySelector('#npms_copy_install_windows').addEventListener('click', () => copyText(root.querySelector('#npms_install_command_windows').value, 'Windows 后端命令已复制'));
    root.querySelector('#npms_copy_install_macos').addEventListener('click', () => copyText(root.querySelector('#npms_install_command_macos').value, 'macOS 后端命令已复制'));
    root.querySelector('#npms_copy_install_linux').addEventListener('click', () => copyText(root.querySelector('#npms_install_command_linux').value, 'Linux 后端命令已复制'));
    root.querySelector('#npms_copy_api').addEventListener('click', () => copyText(API_BASE, '接口基址已复制'));
    root.querySelector('#npms_scan_scripts').addEventListener('click', scanPlayerScripts);
}

async function initializeExtensionPanel() {
    settings();
    if (document.querySelector('#netease_personal_music_source_settings')) return true;
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host) return false;
    host.insertAdjacentHTML('beforeend', panelHtml());
    bind();
    updateProviderUi();
    setBackendAvailability(false);
    renderMiniPlayer();
    void refreshStatus();
    return true;
}

async function initializeWhenAvailable() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await initializeExtensionPanel()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.warn('[你自己的音乐源] 找不到扩展设置容器，前端面板未挂载。');
}

// SillyTavern 安装扩展后会在当前页面动态载入模块，不会整页刷新。
// 模块执行时立即初始化，才能像其他扩展一样在安装成功后马上出现。
window.addEventListener('pagehide', removeFloatingLyrics, { once: true });

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void initializeWhenAvailable(), { once: true });
} else {
    void initializeWhenAvailable();
}

window.addEventListener('beforeunload', () => {
    savePlaybackSnapshot();
    stopQrPolling();
    if (state.player.audio) {
        state.player.audio.pause();
        state.player.audio.removeAttribute('src');
    }
});
