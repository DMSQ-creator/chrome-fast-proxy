// js/options.js - v5.8.0

const DEFAULT_GFWLIST_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';
const LATENCY_TEST_URL = 'https://www.google.com/generate_204';
const CONFIG_FILE_NAME = 'fastproxy_config.json';
const DAV_DIR_NAME = 'FastProxy';

const els = {
  host: document.getElementById('host'),
  port: document.getElementById('port'),
  scheme: document.getElementById('scheme'),
  saveServerBtn: document.getElementById('saveServerBtn'),
  testLatencyBtn: document.getElementById('testLatencyBtn'),
  latencyResult: document.getElementById('latencyResult'),
  
  autoSync: document.getElementById('autoSync'),
  syncInterval: document.getElementById('syncInterval'),

  syncProvider: document.getElementById('syncProvider'),
  panelGithub: document.getElementById('panelGithub'),
  panelWebdav: document.getElementById('panelWebdav'),
  syncStatus: document.getElementById('syncStatus'),
  cloudUploadBtn: document.getElementById('cloudUploadBtn'),
  cloudDownloadBtn: document.getElementById('cloudDownloadBtn'),

  gitToken: document.getElementById('gitToken'),
  davUrl: document.getElementById('davUrl'),
  davUser: document.getElementById('davUser'),
  davPass: document.getElementById('davPass'),

  updateGfwBtn: document.getElementById('updateGfwBtn'),
  gfwStatus: document.getElementById('gfwStatus'),
  gfwUrlInput: document.getElementById('gfwUrlInput'),
  resetUrlBtn: document.getElementById('resetUrlBtn'),

  manualInput: document.getElementById('manualInput'),
  addRuleBtn: document.getElementById('addRuleBtn'),
  tagsList: document.getElementById('tagsList'),
  userCount: document.getElementById('userCount'),

  whitelistInput: document.getElementById('whitelistInput'),
  addWhitelistBtn: document.getElementById('addWhitelistBtn'),
  whitelistTags: document.getElementById('whitelistTags'),
  whitelistCount: document.getElementById('whitelistCount'),

  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  toast: document.getElementById('toast')
};

let cachedUserRules = [];
let cachedUserWhitelist = [];
let cachedGfwDomains = [];

// 1. 初始化
document.addEventListener('DOMContentLoaded', () => {
  const keys = [
    'host', 'port', 'scheme', 'ruleCount', 'lastUpdate', 'userRules', 'userWhitelist', 
    'gfwDomains', 'gfwlistUrl', 
    'syncProvider', 'gitToken', 'davUrl', 'davUser', 'davPass',
    'autoSync', 'syncInterval',
    'lastSyncTime' // ✅ 新增：读取上次同步时间
  ];
  
  chrome.storage.local.get(keys, (items) => {
    els.host.value = items.host || "127.0.0.1";
    els.port.value = items.port || "7890";
    els.scheme.value = items.scheme || "SOCKS5";
    els.gfwUrlInput.value = items.gfwlistUrl || DEFAULT_GFWLIST_URL;
    
    els.autoSync.checked = items.autoSync || false;
    els.syncInterval.value = items.syncInterval || "1440"; // 默认每天

    if (items.syncProvider) els.syncProvider.value = items.syncProvider;
    if (items.gitToken) els.gitToken.value = items.gitToken;
    if (items.davUrl) els.davUrl.value = items.davUrl;
    if (items.davUser) els.davUser.value = items.davUser;
    if (items.davPass) els.davPass.value = items.davPass;
    
    // ✅ 关键：回显同步时间
    if (items.lastSyncTime) {
        updateSyncStatus(items.lastSyncTime, false); 
    }

    switchSyncPanel();

    cachedUserRules = items.userRules || [];
    cachedUserWhitelist = items.userWhitelist || [];
    cachedGfwDomains = items.gfwDomains || [];
    
    updateGfwUI(items.ruleCount, items.lastUpdate);
    renderProxyTags();
    renderWhitelistTags();
  });
});

// 2. 基础配置
els.saveServerBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    host: els.host.value,
    port: parseInt(els.port.value),
    scheme: els.scheme.value
  }, () => {
    showToast("服务器配置已保存");
    applyChanges();
  });
});

els.testLatencyBtn.addEventListener('click', async () => {
  els.latencyResult.innerHTML = "测试中...";
  els.latencyResult.style.color = "#666";
  els.testLatencyBtn.disabled = true;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); 
  const start = Date.now();
  try {
    await fetch(LATENCY_TEST_URL, { mode: 'no-cors', cache: 'no-cache', signal: controller.signal });
    clearTimeout(timeoutId);
    const ms = Date.now() - start;
    let color = "#4CAF50"; 
    if (ms > 500) color = "#FF9800"; 
    if (ms > 1500) color = "#F44336"; 
    els.latencyResult.innerHTML = `<span style="color:${color}">${ms} ms</span>`;
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 20) {
      els.latencyResult.innerHTML = `<span style="color:red">超时 (5s)</span>`;
      console.warn("Latency test: Request timed out.");
    } else {
      els.latencyResult.innerHTML = `<span style="color:red">连接失败</span>`;
      console.error(error);
    }
  } finally {
    els.testLatencyBtn.disabled = false;
  }
});

// 3. 自动同步
els.autoSync.addEventListener('change', () => {
  const isEnabled = els.autoSync.checked;
  chrome.storage.local.set({ autoSync: isEnabled });
  chrome.runtime.sendMessage({ type: 'UPDATE_ALARM', enabled: isEnabled });
  showToast(isEnabled ? "自动同步已开启" : "自动同步已关闭");
});

els.syncInterval.addEventListener('change', () => {
  const minutes = els.syncInterval.value;
  chrome.storage.local.set({ syncInterval: minutes });
  if (els.autoSync.checked) {
    chrome.runtime.sendMessage({ type: 'UPDATE_ALARM', enabled: true });
  }
});

// 4. 云端同步
els.syncProvider.addEventListener('change', switchSyncPanel);
function switchSyncPanel() {
  const mode = els.syncProvider.value;
  if (mode === 'github') {
    els.panelGithub.style.display = 'block';
    els.panelWebdav.style.display = 'none';
  } else {
    els.panelGithub.style.display = 'none';
    els.panelWebdav.style.display = 'block';
  }
  chrome.storage.local.set({ syncProvider: mode });
}

els.cloudUploadBtn.addEventListener('click', async () => {
  const mode = els.syncProvider.value;
  const exportData = await getExportData();
  if (mode === 'github') await handleGithubUpload(exportData);
  else await handleWebdavUpload(exportData);
});

els.cloudDownloadBtn.addEventListener('click', async () => {
  const mode = els.syncProvider.value;
  if (!confirm(`⚠️ 确定从 [${mode}] 下载配置并覆盖本地吗？`)) return;
  if (mode === 'github') await handleGithubDownload();
  else await handleWebdavDownload();
});

// GitHub Logic
async function handleGithubUpload(data) {
  const token = els.gitToken.value.trim();
  if (!token) return alert("请输入 GitHub Token");
  chrome.storage.local.set({ gitToken: token });

  setBtnLoading(els.cloudUploadBtn, true, "🔍 查找 Gist...");
  try {
    let gistId = await findGistId(token);
    const content = JSON.stringify(data, null, 2);
    const body = { description: "FastProxy Sync Data", public: false, files: { [CONFIG_FILE_NAME]: { content: content } } };

    if (gistId) {
      setBtnLoading(els.cloudUploadBtn, true, "⏳ 更新 Gist...");
      await githubRequest(`https://api.github.com/gists/${gistId}`, 'PATCH', token, body);
    } else {
      setBtnLoading(els.cloudUploadBtn, true, "⏳ 创建 Gist...");
      await githubRequest(`https://api.github.com/gists`, 'POST', token, body);
    }
    const now = new Date().toLocaleString();
    updateSyncStatus(now);
    showToast("✅ GitHub 同步成功");
  } catch (err) {
    console.error(err);
    alert("GitHub 同步失败: " + err.message);
  } finally {
    setBtnLoading(els.cloudUploadBtn, false, "☁️ 立即上传");
  }
}

async function handleGithubDownload() {
  const token = els.gitToken.value.trim();
  if (!token) return alert("请输入 GitHub Token");
  setBtnLoading(els.cloudDownloadBtn, true, "🔍 查找配置...");
  try {
    const gistId = await findGistId(token);
    if (!gistId) throw new Error("未找到配置文件");
    setBtnLoading(els.cloudDownloadBtn, true, "⬇️ 下载中...");
    const gist = await githubRequest(`https://api.github.com/gists/${gistId}`, 'GET', token);
    const file = gist.files[CONFIG_FILE_NAME];
    const res = await fetch(file.raw_url);
    const config = await res.json();
    await applyImportConfig(config);
    
    const now = new Date().toLocaleString();
    updateSyncStatus(now);
    showToast("✅ GitHub 下载成功");
  } catch (err) {
    console.error(err);
    alert("GitHub 下载失败: " + err.message);
  } finally {
    setBtnLoading(els.cloudDownloadBtn, false, "⬇️ 立即下载");
  }
}

async function findGistId(token) {
  const gists = await githubRequest('https://api.github.com/gists', 'GET', token);
  const target = gists.find(g => g.files && g.files[CONFIG_FILE_NAME]);
  return target ? target.id : null;
}
async function githubRequest(url, method, token, body = null) {
  const opts = { method, headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) { if (res.status === 401) throw new Error("Token 无效"); throw new Error(`Github ${res.status}`); }
  return res.json();
}

// WebDAV Logic
async function handleWebdavUpload(data) {
  const creds = saveDavCredentials();
  if (!creds.davUrl) return alert("请填写 WebDAV URL");
  setBtnLoading(els.cloudUploadBtn, true, "⏳ WebDAV 上传...");
  let root = creds.davUrl.endsWith('/') ? creds.davUrl : creds.davUrl + '/';
  const folder = root + DAV_DIR_NAME + '/';
  const target = folder + CONFIG_FILE_NAME;
  try {
    const mk = await fetch(folder, { method: 'MKCOL', headers: getDavHeaders(creds) });
    const res = await fetch(target, { method: 'PUT', headers: getDavHeaders(creds), body: JSON.stringify(data) });
    if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`HTTP ${res.status}`);
    
    const now = new Date().toLocaleString();
    updateSyncStatus(now);
    showToast("✅ WebDAV 同步成功");
  } catch (err) {
    console.error(err);
    alert("WebDAV 失败: " + err.message);
  } finally {
    setBtnLoading(els.cloudUploadBtn, false, "☁️ 立即上传");
  }
}

async function handleWebdavDownload() {
  const creds = saveDavCredentials();
  if (!creds.davUrl) return alert("请填写 WebDAV URL");
  setBtnLoading(els.cloudDownloadBtn, true, "⬇️ WebDAV 下载...");
  let root = creds.davUrl.endsWith('/') ? creds.davUrl : creds.davUrl + '/';
  const target = root + DAV_DIR_NAME + '/' + CONFIG_FILE_NAME;
  try {
    const res = await fetch(target, { method: 'GET', headers: getDavHeaders(creds) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = await res.json();
    await applyImportConfig(config);

    const now = new Date().toLocaleString();
    updateSyncStatus(now);
    showToast("✅ WebDAV 下载成功");
  } catch (err) {
    console.error(err);
    alert("WebDAV 失败: " + err.message);
  } finally {
    setBtnLoading(els.cloudDownloadBtn, false, "⬇️ 立即下载");
  }
}

function saveDavCredentials() {
  const data = { davUrl: els.davUrl.value.trim(), davUser: els.davUser.value.trim(), davPass: els.davPass.value.trim() };
  chrome.storage.local.set(data);
  return data;
}
function getDavHeaders(creds) { return { 'Authorization': 'Basic ' + btoa(creds.davUser + ':' + creds.davPass), 'Content-Type': 'application/json' }; }

// Helpers
function getExportData() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, (items) => {
      resolve({
        timestamp: Date.now(),
        version: "5.8.0",
        config: {
          host: items.host, port: items.port, scheme: items.scheme,
          gfwlistUrl: items.gfwlistUrl, userRules: items.userRules || [], userWhitelist: items.userWhitelist || []
        }
      });
    });
  });
}
function applyImportConfig(data) {
  return new Promise((resolve, reject) => {
    if (data && data.config) {
      const c = data.config;
      const updates = {};
      if (c.host) updates.host = c.host;
      if (c.port) updates.port = c.port;
      if (c.scheme) updates.scheme = c.scheme;
      if (c.gfwlistUrl) updates.gfwlistUrl = c.gfwlistUrl;
      if (c.userRules) updates.userRules = c.userRules;
      if (c.userWhitelist) updates.userWhitelist = c.userWhitelist;
      
      chrome.storage.local.set(updates, () => {
        setTimeout(() => location.reload(), 800);
        resolve();
      });
    } else {
      reject(new Error("无效配置"));
    }
  });
}

// ✅ 状态更新逻辑 (存入 storage)
function updateSyncStatus(timeStr, shouldSave = true) {
  els.syncStatus.textContent = "上次同步: " + timeStr;
  els.syncStatus.style.color = "#2E7D32"; // 绿色
  if (shouldSave) {
    chrome.storage.local.set({ lastSyncTime: timeStr });
  }
}

function setBtnLoading(btn, isLoading, text) { btn.disabled = isLoading; btn.textContent = text; }

// 5. GFWList & Rules (保持不变)
els.resetUrlBtn.addEventListener('click', () => { els.gfwUrlInput.value = DEFAULT_GFWLIST_URL; showToast("已重置"); });
els.updateGfwBtn.addEventListener('click', async () => {
  const targetUrl = els.gfwUrlInput.value.trim() || DEFAULT_GFWLIST_URL;
  els.updateGfwBtn.textContent = "⏳ 下载中..."; els.updateGfwBtn.disabled = true;
  try {
    const response = await fetch(targetUrl); if (!response.ok) throw new Error("Failed");
    const text = await response.text();
    const decoded = atob(text.replace(/\s/g, ''));
    const domains = parseGFWListToDomains(decoded);
    const now = new Date().toLocaleString();
    cachedGfwDomains = domains;
    chrome.storage.local.set({ gfwDomains: domains, ruleCount: domains.length, lastUpdate: now, gfwlistUrl: targetUrl }, () => {
      updateGfwUI(domains.length, now); showToast(`成功更新 ${domains.length} 条`); applyChanges();
      els.updateGfwBtn.textContent = "🔄 立即更新"; els.updateGfwBtn.disabled = false;
    });
  } catch (err) { alert("更新失败"); els.updateGfwBtn.textContent = "❌ 失败"; els.updateGfwBtn.disabled = false; }
});

function renderProxyTags() {
  els.tagsList.innerHTML = ""; els.userCount.textContent = cachedUserRules.length;
  [...cachedUserRules].reverse().forEach(domain => {
    const tag = createTag(domain, false, () => { cachedUserRules = cachedUserRules.filter(d => d !== domain); saveRules(); });
    els.tagsList.appendChild(tag);
  });
}
function renderWhitelistTags() {
  els.whitelistTags.innerHTML = ""; els.whitelistCount.textContent = cachedUserWhitelist.length;
  [...cachedUserWhitelist].reverse().forEach(domain => {
    const tag = createTag(domain, true, () => { cachedUserWhitelist = cachedUserWhitelist.filter(d => d !== domain); saveRules(); });
    els.whitelistTags.appendChild(tag);
  });
}
els.addRuleBtn.addEventListener('click', () => { addDomain(els.manualInput, cachedUserRules, null, saveRules); });
els.manualInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') els.addRuleBtn.click(); });
els.addWhitelistBtn.addEventListener('click', () => { addDomain(els.whitelistInput, cachedUserWhitelist, null, saveRules); });
els.whitelistInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') els.addWhitelistBtn.click(); });

els.exportBtn.addEventListener('click', async () => {
  const data = await getExportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `fastproxy_backup.json`; a.click();
  showToast("配置已导出");
});
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (event) => { try { await applyImportConfig(JSON.parse(event.target.result)); alert("导入成功"); } catch (err) { alert("Fail: " + err.message); } };
  reader.readAsText(file); e.target.value = '';
});

function createTag(text, isDirect, onRemove) {
  const div = document.createElement('div'); div.className = isDirect ? 'tag direct' : 'tag';
  div.innerHTML = `<span>${text}</span> <i>×</i>`; div.querySelector('i').addEventListener('click', onRemove); return div;
}
function addDomain(inputEl, list, preCheck, saveCb) {
  let val = inputEl.value.trim(); if (!val) return;
  try { if (val.includes('://')) val = new URL(val).hostname; } catch(e){}
  if (list.includes(val)) return showToast("已存在");
  list.push(val); inputEl.value = ""; saveCb();
}
function saveRules() { chrome.storage.local.set({ userRules: cachedUserRules, userWhitelist: cachedUserWhitelist }, () => { renderProxyTags(); renderWhitelistTags(); applyChanges(); }); }
function applyChanges() {
  chrome.storage.local.get(['host', 'port', 'scheme'], (items) => {
    const host = items.host || '127.0.0.1'; const port = items.port || 7890; const scheme = items.scheme || 'SOCKS5';
    const proxyDomains = [...new Set([...cachedUserRules, ...cachedGfwDomains])]; const directDomains = [...new Set(cachedUserWhitelist)];
    let proxyType = (scheme.toUpperCase() === 'HTTP') ? "PROXY" : "SOCKS5";
    const proxyStr = `${proxyType} ${host}:${port}; SOCKS ${host}:${port}; DIRECT`;
    const pacScriptStr = `var proxy="${proxyStr}";var direct="DIRECT";var proxyDomains=${JSON.stringify(proxyDomains)};var directDomains=${JSON.stringify(directDomains)};var proxyMap={};var directMap={};for(var i=0;i<proxyDomains.length;i++){proxyMap[proxyDomains[i]]=1}for(var i=0;i<directDomains.length;i++){directMap[directDomains[i]]=1}function FindProxyForURL(url,host){if(checkMap(host,directMap))return direct;if(checkMap(host,proxyMap))return proxy;return direct}function checkMap(host,map){if(map.hasOwnProperty(host))return true;var pos=host.indexOf('.');while(pos!==-1){var suffix=host.substring(pos+1);if(map.hasOwnProperty(suffix))return true;pos=host.indexOf('.',pos+1)}return false}`;
    chrome.storage.local.set({ pacScriptData: pacScriptStr });
    chrome.proxy.settings.get({}, (details) => { if (details.value.mode === 'pac_script') chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScriptStr } }, scope: 'regular' }); });
  });
}
function updateGfwUI(count, time) { if (count) els.gfwStatus.innerHTML = `<span style="color:green">✅ ${count}条 (${time})</span>`; else els.gfwStatus.innerHTML = `<span style="color:red">⚠️ 未加载</span>`; }
function parseGFWListToDomains(content) { const lines = content.split(/\r?\n/); const domainSet = new Set(); const asciiRegex = /^[\w\-\.]+$/; lines.forEach(line => { if (!line || line.startsWith('!') || line.startsWith('[')) return; let d = line; if (d.startsWith('||')) d = d.substring(2); else if (d.startsWith('|')) return; d = d.replace(/^https?:\/\//, ''); const slash = d.indexOf('/'); if (slash > 0) d = d.substring(0, slash); if (d.includes('*') || (d.startsWith('/') && d.endsWith('/'))) return; if (d.includes('.') && !d.includes('%') && asciiRegex.test(d)) domainSet.add(d); }); ['google.com', 'youtube.com', 'github.com', 'openai.com'].forEach(d => domainSet.add(d)); return Array.from(domainSet); }
function showToast(msg) { els.toast.textContent = msg; els.toast.className = "show"; setTimeout(() => { els.toast.className = els.toast.className.replace("show", ""); }, 3000); }