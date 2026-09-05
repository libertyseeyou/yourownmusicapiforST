import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXTENSION_ID = 'netease-personal-music-source';
const API_BASE = `/api/plugins/${EXTENSION_ID}`;
const DEFAULTS = { provider: 'netease' };
const REQUEST_TIMEOUT_MS = 20000;
const TERMUX_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-termux.sh | bash';
const LINUX_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/libertyseeyou/yourownmusicapiforST/main/scripts/bootstrap-linux.sh | bash';
const state = {
    qrTimer: null,
    qrKey: '',
    qrProvider: '',
    originalFetch: window.fetch.bind(window),
    operationId: 0,
    backendReady: false,
    player: {
        audio: null,
        tracks: [],
        index: -1,
        mode: 'list',
        loading: false,
        requestId: 0,
        playlistName: '',
        cover: '',
    },
};

function settings() {
    extension_settings[EXTENSION_ID] ||= {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (extension_settings[EXTENSION_ID][key] === undefined) extension_settings[EXTENSION_ID][key] = value;
    }
    return extension_settings[EXTENSION_ID];
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
    '#npms_local_dir', '#npms_dir_inspect', '#npms_dir_save', '#npms_rescan',
];

function setBackendAvailability(ready) {
    state.backendReady = Boolean(ready);
    for (const selector of BACKEND_CONTROL_SELECTORS) {
        const node = document.querySelector(selector);
        if (node) node.disabled = !state.backendReady;
    }
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
    settings().provider = provider; saveSettingsDebounced(); updateProviderUi(); renderMiniPlayer();
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
        const dir = document.querySelector('#npms_local_dir');
        if (dir && !dir.matches(':focus')) dir.value = health.localMusicDir || '';
        if (health.localTracks > 0 && state.player.tracks.length === 0) {
            await loadLocalPlayerTracks({ silent: true });
        }
    } catch (error) {
        if (error.payload?.backendUnavailable) {
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
        if (!data.key || (!data.qrimg && !data.qrurl)) throw new Error('后端返回成功，但没有二维码内容');
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
        appendFeedback('二维码生成失败', error.payload || error.message, false);
        setStatus(`二维码生成失败：${error.message}`, 'error');
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

function playerElements() {
    return {
        ticker: document.querySelector('#npms_player_ticker'),
        count: document.querySelector('#npms_player_count'),
        play: document.querySelector('#npms_player_play'),
        mode: document.querySelector('#npms_player_mode'),
        time: document.querySelector('#npms_player_time'),
        progress: document.querySelector('#npms_player_progress'),
        volume: document.querySelector('#npms_player_volume'),
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

function ensureMiniAudio() {
    if (state.player.audio) return state.player.audio;
    const audio = new Audio();
    audio.preload = 'none';
    audio.volume = 0.6;
    audio.addEventListener('play', renderMiniPlayer);
    audio.addEventListener('pause', renderMiniPlayer);
    audio.addEventListener('loadedmetadata', updatePlayerProgress);
    audio.addEventListener('durationchange', updatePlayerProgress);
    audio.addEventListener('timeupdate', updatePlayerProgress);
    audio.addEventListener('ended', () => {
        if (state.player.mode === 'one') {
            audio.currentTime = 0;
            audio.play().catch(error => playerFailure('单曲重播失败', error));
        } else {
            playPlayerOffset(1, true);
        }
    });
    audio.addEventListener('error', () => {
        const code = audio.error?.code;
        playerFailure('音频播放错误', new Error(code ? `浏览器媒体错误代码 ${code}` : '浏览器无法播放该音源'));
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
}

function seekMiniPlayer(event) {
    const audio = state.player.audio;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    updatePlayerProgress();
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
    const data = await api(`/?types=url&provider=${encodeURIComponent(track.source === 'qq' ? 'qq' : currentProvider())}&id=${encodeURIComponent(track.id)}&br=320`, { timeoutMs: 20000 });
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
        audio.src = url;
        audio.load();
        state.player.loading = false;
        renderMiniPlayer();
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

function setPlayerTracks(tracks, { name = '', cover = '', feedbackLabel = '播放器列表已载入' } = {}) {
    const usable = Array.isArray(tracks) ? tracks.filter(track => track?.id && track?.name) : [];
    if (!usable.length) throw new Error('没有找到可播放的歌曲');
    const audio = ensureMiniAudio();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.player.requestId += 1;
    state.player.tracks = usable;
    state.player.index = 0;
    state.player.loading = false;
    state.player.playlistName = name;
    state.player.cover = cover;
    renderMiniPlayer();
    appendFeedback(feedbackLabel, { name, trackCount: usable.length, autoplay: false }, true);
    return usable.length;
}

async function loadLocalPlayerTracks({ silent = false } = {}) {
    setBusy('npms_local_load', true, '载入中…');
    try {
        const tracks = await api('/local/list', { timeoutMs: 15000 });
        const count = setPlayerTracks(tracks, { name: 'LOCAL ARCHIVE · 本地收藏', feedbackLabel: '本地音乐已载入简易播放器' });
        setStatus(`已把 ${count} 首本地音乐载入播放器`, 'ok');
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
        const count = setPlayerTracks(tracks, { name: data.name, cover: data.cover || '', feedbackLabel: '播放器输入识别回传' });
        const inputNode = document.querySelector('#npms_playlist_input');
        if (inputNode) inputNode.value = '';
        setStatus(`已匹配${label}${count > 1 ? `，共 ${count} 首` : ''}`, 'ok');
    } catch (error) {
        playerFailure('搜索或链接解析失败', error);
    } finally { setBusy('npms_playlist_load', false); }
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
            label: 'GDStudio 兼容接口',
            test: /https?:\/\/music-api\.gdstudio\.xyz\/api\.php/gi,
            replace: value => value.replace(/https?:\/\/music-api\.gdstudio\.xyz\/api\.php/gi, `${API_BASE}/`),
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
    };
}

function renderScriptCandidates(candidates) {
    const root = document.querySelector('#npms_script_candidates');
    if (!root) return;
    if (!candidates.length) {
        root.innerHTML = '<span class="npms-muted">没有找到可安全自动替换的播放器脚本。当前只自动处理已确认兼容的 localhost:3001 接口；无法确认参数格式的第三方接口不会擅自替换。</span>';
        return;
    }
    root.replaceChildren(...candidates.map(candidate => {
        const card = document.createElement('div');
        card.className = 'npms-script-card';
        const title = document.createElement('b');
        title.textContent = candidate.name;
        const meta = document.createElement('span');
        meta.className = 'npms-muted';
        meta.textContent = `${candidate.enabled ? '当前启用' : '当前停用'} · 播放器特征 ${candidate.playerScore} 项 · ${candidate.total ? `可安全替换 ${candidate.total} 处：${candidate.matches.map(item => `${item.label} ${item.count} 处`).join('；')}` : '发现音乐接口，但参数兼容性未知，只做提示'}`;
        const options = document.createElement('label');
        options.className = 'checkbox_label npms-horizontal-label';
        options.innerHTML = '<input type="checkbox" class="npms-disable-source" checked><span>创建副本后停用原脚本，避免出现两个播放器</span>';
        const button = document.createElement('button');
        button.className = 'menu_button';
        button.textContent = candidate.total ? '创建适配副本' : '仅提示，暂不可自动替换';
        button.disabled = candidate.total === 0;
        button.addEventListener('click', () => adaptPlayerScript(candidate, options.querySelector('input').checked, button));
        if (candidate.endpointUrls.length) { const urls = document.createElement('code'); urls.className = 'npms-candidate-urls'; urls.textContent = candidate.endpointUrls.join('\n'); card.append(title, meta, urls, options, button); return card; }
        card.append(title, meta, options, button);
        return card;
    }));
}

function scanPlayerScripts() {
    const scripts = getTavernHelperScripts();
    if (!scripts) {
        setStatus('没有检测到酒馆助手脚本数据；请确认已安装并启用酒馆助手', 'warn');
        appendFeedback('扫描播放器脚本', 'extension_settings.tavern_helper.script.scripts 不存在', false);
        return;
    }
    const candidates = scripts.map(analyzePlayerScript).filter(Boolean);
    renderScriptCandidates(candidates);
    appendFeedback('扫描播放器脚本完成', { scanned: scripts.length, candidates: candidates.map(item => ({ name: item.name, replacements: item.total })) }, true);
    setStatus(candidates.length ? `找到 ${candidates.length} 个可适配的播放器脚本，请逐项确认` : '没有找到可安全自动适配的播放器脚本', candidates.length ? 'ok' : 'warn');
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
        scanPlayerScripts();
    } catch (error) {
        appendFeedback('播放器脚本适配失败', error.message || String(error), false);
        setStatus(`适配失败：${error.message || error}`, 'error');
        button.disabled = false;
    }
}

function panelHtml() {
    const api = API_BASE;
    return `
    <div id="netease_personal_music_source_settings" class="extension_container npms-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>你自己的音乐源</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
          <div id="npms_status" class="npms-status">等待检查后端</div>
          <div class="npms-provider-switch" role="group" aria-label="切换音乐平台"><button type="button" data-provider="netease" class="npms-provider-button">网易云音乐</button><button type="button" data-provider="qq" class="npms-provider-button">QQ 音乐</button></div>
          <div class="npms-actions"><button id="npms_refresh" class="menu_button">刷新状态</button><button id="npms_qr_start" class="menu_button">扫码登录</button><button id="npms_logout" class="menu_button">清除登录</button></div>
          <div id="npms_qr_box" class="npms-qr" hidden><img id="npms_qr_image" alt="网易云登录二维码"><button id="npms_qr_cancel" class="menu_button">取消扫码</button></div>
          <div class="npms-mini-player" aria-label="简易音乐播放器">
            <div class="npms-compact-main">
              <div id="npms_player_title_wrap" class="npms-player-title-wrap"><span id="npms_player_ticker" class="npms-player-ticker">Loading...</span></div>
              <div id="npms_player_time" class="npms-player-time">0:00/0:00</div>
              <div class="npms-player-controls">
                <button id="npms_player_prev" class="npms-player-key" title="上一首">&lt;&lt;</button>
                <button id="npms_player_play" class="npms-player-key" title="播放或暂停">&gt;</button>
                <button id="npms_player_next" class="npms-player-key" title="下一首">&gt;&gt;</button>
                <button id="npms_player_mode" class="npms-player-key npms-player-key-mode" title="切换循环方式">SEQ</button>
              </div>
              <label class="npms-volume"><b>VOL</b><input id="npms_player_volume" type="range" min="0" max="100" value="60" aria-label="音量"></label>
            </div>
            <div id="npms_player_progress_track" class="npms-progress-track" title="点击跳转进度"><div id="npms_player_progress" class="npms-progress-bar"></div></div>
            <div class="npms-playlist-loader"><input id="npms_playlist_input" type="text" placeholder="歌曲 歌手 / 单曲或歌单分享链接"><button id="npms_playlist_load" class="menu_button">搜索 / 解析</button><button id="npms_local_load" class="menu_button">本地音乐</button></div>
            <small><span id="npms_player_count">0 / 0</span></small>
          </div>
          <hr>
          <label id="npms_cookie_label">平台 Cookie（仅提交到本机后端）</label>
          <textarea id="npms_cookie" rows="3" placeholder="平台 Cookie"></textarea>
          <button id="npms_cookie_save" class="menu_button">保存并验证 Cookie</button>

          <details open><summary><b>服务器 / 设备本地音乐目录</b></summary>
            <p class="npms-help">请填写运行 SillyTavern 的设备或服务器能够读取的音乐目录绝对路径，先检测，再保存连接。支持递归扫描 MP3、FLAC、M4A、WAV、OGG、AAC、WebM 与 Opus。</p>
            <input id="npms_local_dir" type="text" placeholder="例如 /home/user/Music 或 Termux 音乐目录的绝对路径">
            <div class="npms-examples">Termux：<code>/data/data/com.termux/files/home/storage/music</code>；Linux：<code>/home/user/Music</code> 或容器持久化卷内路径。</div>
            <div class="npms-actions"><button id="npms_dir_inspect" class="menu_button">检测目录内容</button><button id="npms_dir_save" class="menu_button">保存并连接</button><button id="npms_rescan" class="menu_button">重新扫描</button></div>
          </details>

          <details><summary><b>一键部署：Termux / Linux 云酒馆</b></summary>
            <p class="npms-help">请选择 SillyTavern 实际运行的平台。安装器会部署前后端、保留已有账号数据，并开启 Server Plugin。</p>
            <b>Android · Termux</b>
            <div class="npms-command-row"><textarea id="npms_install_command_termux" rows="3" readonly>${TERMUX_INSTALL_COMMAND}</textarea><button id="npms_copy_install_termux" class="menu_button">复制 Termux 命令</button></div>
            <b>Linux · 云服务器 / 面板服</b>
            <div class="npms-command-row"><textarea id="npms_install_command_linux" rows="3" readonly>${LINUX_INSTALL_COMMAND}</textarea><button id="npms_copy_install_linux" class="menu_button">复制 Linux 命令</button></div>
            <ol class="npms-steps">
              <li>需要 Node.js 20+、npm 与 git；请使用运行 SillyTavern 的同一用户安装，不建议使用 sudo。</li>
              <li>Linux 若无法自动找到酒馆，可设置 <code>ST_DIR=/实际/SillyTavern/路径</code>。</li>
              <li>Docker 用户须把插件数据与音乐目录放在持久化卷内，并填写容器内可见路径。</li>
              <li>安装完成后按原有方式重启 SillyTavern。</li>
            </ol>
          </details>

          <details><summary><b>播放器接入接口</b></summary>
            <p class="npms-help">接口与 SillyTavern 同源。播放器脚本可直接使用以下相对地址，无需写主机名或端口。</p>
            <div class="npms-api-list">
              <code>GET ${api}/?types=search&amp;name=歌名%20歌手&amp;count=5&amp;pages=1</code><span>搜索：返回歌曲数组，本地结果优先。</span>
              <code>GET ${api}/?types=url&amp;id=歌曲ID&amp;br=320</code><span>播放地址：返回 <code>{"url":"..."}</code>。</span>
              <code>GET ${api}/?types=lyric&amp;id=歌曲ID</code><span>歌词：返回 <code>lyric</code> 与 <code>tlyric</code>。</span>
              <code>GET ${api}/?types=pic&amp;id=歌曲ID</code><span>封面兼容接口：返回 <code>{"url":"..."}</code>。</span>
              <code>GET ${api}/?types=playlist&amp;id=歌单ID</code><span>兼容格式的网易云歌单曲目。</span>
              <code>GET ${api}/input/resolve?provider=qq|netease&amp;input=歌曲歌手或分享链接</code><span>统一识别：文字搜索、单曲短链、歌单链接或歌单 ID。</span>
              <code>GET ${api}/local/list</code><span>已扫描的本地曲目列表。</span>
              <code>GET ${api}/audio/:本地歌曲ID</code><span>本地音频流，支持 Range 拖动进度。</span>
              <code>GET ${api}/health</code><span>后端、目录和已启用音源状态。</span>
            </div>
            <button id="npms_copy_api" class="menu_button">复制接口基址</button>
          </details>


          <details><summary><b>适配现有酒馆助手播放器</b></summary>
            <p class="npms-help">扫描酒馆助手中的脚本，寻找写死的音乐/歌词接口。适配时永远创建副本，不覆盖原脚本；原脚本是否停用由你确认。</p>
            <div class="npms-actions"><button id="npms_scan_scripts" class="menu_button">扫描播放器脚本</button></div>
            <div id="npms_script_candidates" class="npms-script-candidates"><span class="npms-muted">尚未扫描。</span></div>
          </details>

          <details open><summary><b>后端回传与操作记录</b></summary><div id="npms_feedback" class="npms-feedback" aria-live="polite"></div></details>
          <small>这是面向单个 SillyTavern 用户的“你自己的音乐源”。账号凭据保存在后端，不写入聊天或前端设置。</small>
        </div>
      </div>
    </div>`;
}
function bind() {
    const root = document.querySelector('#netease_personal_music_source_settings');
    if (!root) return;
    root.querySelectorAll('[data-provider]').forEach(button => button.addEventListener('click', () => switchProvider(button.dataset.provider)));
    root.querySelector('#npms_refresh').addEventListener('click', refreshStatus);
    root.querySelector('#npms_qr_start').addEventListener('click', startQrLogin);
    root.querySelector('#npms_qr_cancel').addEventListener('click', () => { stopQrPolling(); root.querySelector('#npms_qr_box').hidden = true; setStatus('已取消扫码'); });
    root.querySelector('#npms_cookie_save').addEventListener('click', saveCookie);
    root.querySelector('#npms_playlist_load').addEventListener('click', resolvePlayerInput);
    root.querySelector('#npms_local_load').addEventListener('click', () => loadLocalPlayerTracks());
    root.querySelector('#npms_playlist_input').addEventListener('keydown', event => { if (event.key === 'Enter') resolvePlayerInput(); });
    root.querySelector('#npms_player_prev').addEventListener('click', () => playPlayerOffset(-1, true));
    root.querySelector('#npms_player_play').addEventListener('click', toggleMiniPlayer);
    root.querySelector('#npms_player_next').addEventListener('click', () => playPlayerOffset(1, true));
    root.querySelector('#npms_player_mode').addEventListener('click', cyclePlayerMode);
    root.querySelector('#npms_player_progress_track').addEventListener('click', seekMiniPlayer);
    root.querySelector('#npms_player_volume').addEventListener('input', setMiniPlayerVolume);
    window.addEventListener('resize', resetPlayerMarquee, { passive: true });
    root.querySelector('#npms_logout').addEventListener('click', logout);
    root.querySelector('#npms_rescan').addEventListener('click', rescan);
    root.querySelector('#npms_dir_inspect').addEventListener('click', inspectLocalDir);
    root.querySelector('#npms_dir_save').addEventListener('click', saveLocalDir);
    root.querySelector('#npms_copy_install_termux').addEventListener('click', () => copyText(TERMUX_INSTALL_COMMAND, 'Termux 部署命令已复制'));
    root.querySelector('#npms_copy_install_linux').addEventListener('click', () => copyText(LINUX_INSTALL_COMMAND, 'Linux 部署命令已复制'));
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
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void initializeWhenAvailable(), { once: true });
} else {
    void initializeWhenAvailable();
}

window.addEventListener('beforeunload', () => {
    stopQrPolling();
    if (state.player.audio) {
        state.player.audio.pause();
        state.player.audio.removeAttribute('src');
    }
});
