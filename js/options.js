// js/options.js - v7.3.4

const DEFAULT_GFWLIST_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';
const LATENCY_TEST_URL = 'https://www.google.com/generate_204';
const CONFIG_FILE_NAME = 'fastproxy_config.json';
const DAV_DIR_NAME = 'FastProxy';

let currentSection = 'server'; 
let currentRuleType = 'userRules'; 
let allData = {}; 
let editingServerId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  applyTheme(allData.theme || 'system');
  
  initNav();
  initServerModule();
  initRuleModule();
  initGfwModule();
  initSyncModule();
  initGeneralModule();
  
  renderAll();
});

async function loadAllData() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, (items) => {
      allData = items;
      resolve(items);
    });
  });
}

function renderAll() {
  renderServerList();
  if (currentSection === 'rules') renderRuleList();
  updateGfwStatus(allData.ruleCount, allData.lastUpdate);
  if (allData.lastSyncTime) updateSyncUI(allData.lastSyncTime);
  
  $('#gitToken').value = allData.gitToken || '';
  $('#davUrl').value = allData.davUrl || '';
  $('#davUser').value = allData.davUser || '';
  $('#davPass').value = allData.davPass || '';
  $('#syncProvider').value = allData.syncProvider || 'github';
  $('#autoSync').checked = allData.autoSync || false;
  switchSyncPanel();
}

function initNav() {
  $$('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.menu-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const target = item.dataset.target;
      $$('.section').forEach(sec => sec.classList.remove('active'));
      $(`#section-${target}`).classList.add('active');
      currentSection = target;
      if (target === 'rules') renderRuleList();
    });
  });
}

// --- 服务器模块 ---
function initServerModule() {
  $('#addServerBtn').onclick = () => openServerEdit(null);
  $('#cancelServerItemBtn').onclick = closeServerEdit;
  $('#saveServerItemBtn').onclick = saveServer;
  // 在测试逻辑前增加判断（可选）
chrome.proxy.settings.get({}, (config) => {
    if (config.value.mode === 'direct') {
        alert("注意：当前为直连模式，此测试仅代表本地网络连接 Google 的速度，不代表代理服务器速度。请先切换到代理模式。");
    }
    // ... 执行 fetch
});
  $('#testLatencyBtn').onclick = async () => {
    const resEl = $('#latencyResult');
    resEl.style.display = 'block';
    resEl.innerHTML = '<span style="color:var(--text-sub)">正在连接 Google 测试...</span>';
    $('#testLatencyBtn').disabled = true;
    
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      await fetch(LATENCY_TEST_URL, { mode: 'no-cors', cache: 'no-cache', signal: controller.signal });
      clearTimeout(timeoutId);
      const ms = Date.now() - start;
      let color = 'var(--success)';
      if (ms > 500) color = 'var(--warning)';
      if (ms > 1500) color = 'var(--danger)';
      resEl.innerHTML = `<span style="color:${color}">✅ 延迟: ${ms} ms</span>`;
    } catch (error) {
      resEl.innerHTML = `<span style="color:var(--danger)">❌ 连接失败或超时 (请检查代理)</span>`;
    } finally {
      $('#testLatencyBtn').disabled = false;
    }
  };
}

function renderServerList() {
  const container = $('#serverListContainer');
  container.innerHTML = '';
  const servers = allData.serverList || [];
  const activeId = allData.activeServerId;

  if (servers.length === 0) {
    const def = { id: 'default', name: 'Default', scheme: 'SOCKS5', host: '127.0.0.1', port: 10808 };
    allData.serverList = [def];
    allData.activeServerId = 'default';
    chrome.storage.local.set({ serverList: [def], activeServerId: 'default' });
    return renderServerList();
  }

  servers.forEach(srv => {
    const el = document.createElement('div');
    el.className = `server-item ${srv.id === activeId ? 'active' : ''}`;
    el.innerHTML = `
      <div>
        <div style="font-weight:bold; color:var(--primary)">${srv.name} ${srv.id === activeId ? ' (使用中)' : ''}</div>
        <div style="font-family:monospace; font-size:12px; color:var(--text-sub)">${srv.scheme}://${srv.host}:${srv.port}</div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost btn-sm btn-edit">✏️</button>
        <button class="btn btn-ghost btn-sm btn-del" style="color:var(--danger)">🗑️</button>
      </div>
    `;
    el.onclick = (e) => { if (!e.target.closest('button')) activateServer(srv.id); };
    el.querySelector('.btn-edit').onclick = () => openServerEdit(srv.id);
    el.querySelector('.btn-del').onclick = () => deleteServer(srv.id);
    container.appendChild(el);
  });
}

function activateServer(id) {
  if (allData.activeServerId === id) return;
  allData.activeServerId = id;
  chrome.storage.local.set({ activeServerId: id }, () => {
    renderServerList();
    showToast("已切换服务器");
  });
}

function openServerEdit(id) {
  editingServerId = id;
  $('#serverForm').style.display = 'block';
  $('#addServerBtn').style.display = 'none';
  if (id) {
    const srv = allData.serverList.find(s => s.id === id);
    $('#editName').value = srv.name;
    $('#editScheme').value = srv.scheme;
    $('#editHost').value = srv.host;
    $('#editPort').value = srv.port;
  } else {
    $('#editName').value = "新服务器";
    $('#editScheme').value = "SOCKS5";
    $('#editHost').value = "127.0.0.1";
    $('#editPort').value = "10808";
  }
}

function closeServerEdit() {
  $('#serverForm').style.display = 'none';
  $('#addServerBtn').style.display = 'inline-flex';
}

function saveServer() {
  const name = $('#editName').value.trim() || "未命名";
  let host = $('#editHost').value.trim().replace(/^https?:\/\//, '').replace(/^socks5?:\/\//, '');
  const port = parseInt($('#editPort').value) || 80;
  const scheme = $('#editScheme').value;
  const newSrv = { id: editingServerId || crypto.randomUUID(), name, scheme, host, port };
  let list = allData.serverList || [];
  
  if (editingServerId) {
    const idx = list.findIndex(s => s.id === editingServerId);
    if (idx !== -1) list[idx] = newSrv;
  } else {
    list.push(newSrv);
  }
  
  chrome.storage.local.set({ serverList: list }, async () => {
    await loadAllData(); 
    closeServerEdit();
    renderServerList();
    showToast("保存成功");
  });
}

function deleteServer(id) {
  if (!confirm("确定删除此服务器配置吗？")) return;
  let list = allData.serverList.filter(s => s.id !== id);
  if (list.length === 0) return alert("至少保留一个服务器");
  if (allData.activeServerId === id) allData.activeServerId = list[0].id;
  chrome.storage.local.set({ serverList: list, activeServerId: allData.activeServerId }, async () => {
    await loadAllData();
    renderServerList();
  });
}

// --- 规则模块 ---
function initRuleModule() {
  $('#ruleTypeSelect').onchange = (e) => { currentRuleType = e.target.value; renderRuleList(); };
  $('#ruleSearch').addEventListener('input', () => renderRuleList());
  $('#ruleAddBtn').onclick = addRuleFromInput;
  $('#ruleAddInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') addRuleFromInput(); });
  $('#ruleClearBtn').onclick = () => {
    if (confirm("确定清空当前列表所有规则吗？")) {
      const type = currentRuleType;
      chrome.storage.local.set({ [type]: [] }, async () => { await loadAllData(); renderRuleList(); });
    }
  };
  $('#ruleExportBtn').onclick = () => {
    const list = allData[currentRuleType] || [];
    const blob = new Blob([JSON.stringify(list, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fastproxy_${currentRuleType}.json`; a.click();
  };
  $('#ruleImportBtn').onclick = () => $('#ruleFile').click();
  $('#ruleFile').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (Array.isArray(data)) {
          const type = currentRuleType;
          const merged = [...new Set([...(allData[type]||[]), ...data])];
          chrome.storage.local.set({ [type]: merged }, async () => {
            await loadAllData(); renderRuleList(); showToast(`导入 ${data.length} 条规则`);
          });
        } else alert("JSON 格式错误");
      } catch(e) { alert("解析失败"); }
    };
    reader.readAsText(file); e.target.value = '';
  };
}

function renderRuleList() {
  const list = allData[currentRuleType] || [];
  const keyword = $('#ruleSearch').value.trim().toLowerCase();
  const filtered = list.filter(d => d.includes(keyword)).reverse();
  $('#currentRuleCount').textContent = list.length;
  const container = $('#ruleListContainer');
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const displayList = filtered.slice(0, 300);
  
  displayList.forEach(domain => {
    const div = document.createElement('div');
    div.className = 'rule-item';
    div.innerHTML = `
      <span class="domain-text" title="双击修改">${domain}</span>
      <div style="display:flex; align-items:center;">
        <span class="edit-hint" style="font-size:12px; color:#aaa; margin-right:10px; opacity:0; transition:0.2s;">双击修改</span>
        <button class="btn btn-ghost btn-sm btn-del" style="border:none; padding:2px 6px;">✕</button>
      </div>
    `;
    div.onmouseenter = () => div.querySelector('.edit-hint').style.opacity = '1';
    div.onmouseleave = () => div.querySelector('.edit-hint').style.opacity = '0';
    div.ondblclick = () => enableRuleEdit(div, domain);
    div.querySelector('.btn-del').onclick = (e) => { e.stopPropagation(); deleteRule(domain); };
    fragment.appendChild(div);
  });
  
  if (filtered.length > 300) {
    const more = document.createElement('div');
    more.style.padding = '10px'; more.style.textAlign = 'center'; more.style.color = '#999';
    more.textContent = `... 还有 ${filtered.length - 300} 条未显示，请搜索 ...`;
    fragment.appendChild(more);
  }
  if (filtered.length === 0) container.innerHTML = '<div style="padding:40px; text-align:center; color:#999">暂无规则</div>';
  else container.appendChild(fragment);
}

function enableRuleEdit(div, oldDomain) {
  const span = div.querySelector('.domain-text');
  div.ondblclick = null; 
  const input = document.createElement('input');
  input.type = 'text'; input.value = oldDomain; input.style.width = '300px'; input.style.fontFamily = 'monospace';
  span.replaceWith(input); input.focus();
  const save = () => {
    const newDomain = input.value.trim().toLowerCase();
    if (newDomain && newDomain !== oldDomain) {
      const type = currentRuleType;
      let list = allData[type] || [];
      if (list.includes(newDomain)) { alert("域名已存在"); renderRuleList(); }
      else {
        const idx = list.indexOf(oldDomain);
        if (idx !== -1) {
          list[idx] = newDomain;
          chrome.storage.local.set({ [type]: list }, async () => { await loadAllData(); renderRuleList(); showToast("已修改"); });
        }
      }
    } else renderRuleList();
  };
  input.onblur = save; input.onkeypress = (e) => { if(e.key==='Enter') input.blur(); };
}

function addRuleFromInput() {
  const input = $('#ruleAddInput');
  const val = input.value.trim().toLowerCase();
  if (!val) return;
  const type = currentRuleType;
  let list = allData[type] || [];
  if (!list.includes(val)) {
    list.push(val);
    chrome.storage.local.set({ [type]: list }, async () => { await loadAllData(); input.value = ''; renderRuleList(); showToast("添加成功"); });
  } else showToast("规则已存在");
}

function deleteRule(domain) {
  const type = currentRuleType;
  let list = allData[type] || [];
  list = list.filter(d => d !== domain);
  chrome.storage.local.set({ [type]: list }, async () => { await loadAllData(); renderRuleList(); });
}

// --- GFW ---
function initGfwModule() {
  $('#gfwSourceSelect').onchange = (e) => {
    const val = e.target.value;
    if (val === 'custom') $('#gfwUrlInput').style.display = 'block';
    else { $('#gfwUrlInput').style.display = 'none'; chrome.storage.local.set({ gfwlistUrl: val }); }
  };
  const savedUrl = allData.gfwlistUrl || DEFAULT_GFWLIST_URL;
  if (Array.from($('#gfwSourceSelect').options).some(o=>o.value===savedUrl)) $('#gfwSourceSelect').value = savedUrl;
  else { $('#gfwSourceSelect').value = 'custom'; $('#gfwUrlInput').style.display = 'block'; $('#gfwUrlInput').value = savedUrl; }
  updateGfwStatus(allData.ruleCount, allData.lastUpdate);
  $('#updateGfwBtn').onclick = async () => {
    let url = $('#gfwSourceSelect').value;
    if (url === 'custom') url = $('#gfwUrlInput').value.trim();
    if (!url) return alert("请输入 URL");
    $('#updateGfwBtn').textContent = "⏳..."; $('#updateGfwBtn').disabled = true;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("下载失败");
      const text = await res.text();
      const decoded = atob(text.replace(/\s/g, ''));
      const domains = decoded.split(/\r?\n/).filter(l => l && !l.startsWith('!') && !l.startsWith('[')).map(l => l.replace(/^\|\|/, '').replace(/^https?:\/\//, '').split('/')[0]).filter(d => d.includes('.'));
      const now = new Date().toLocaleString();
      chrome.storage.local.set({ gfwDomains: domains, ruleCount: domains.length, lastUpdate: now, gfwlistUrl: url }, async () => {
        await loadAllData(); updateGfwStatus(domains.length, now); showToast("GFWList 更新成功");
        $('#updateGfwBtn').textContent = "🔄 立即更新"; $('#updateGfwBtn').disabled = false;
      });
    } catch(e) { alert("更新失败: " + e.message); $('#updateGfwBtn').textContent = "❌ 失败"; $('#updateGfwBtn').disabled = false; }
  };
}
function updateGfwStatus(c, t) { $('#gfwStatus').textContent = c ? `✅ 已缓存 ${c} 条 (更新于 ${t})` : "⚠️ 未加载"; }

// --- 同步模块 ---
function initSyncModule() {
  $('#syncProvider').onchange = updateSyncPanel;
  $('#autoSync').onchange = () => chrome.storage.local.set({ autoSync: $('#autoSync').checked });
  $('#gitToken').onchange = () => chrome.storage.local.set({ gitToken: $('#gitToken').value });
  $('#davUrl').onchange = saveDav; $('#davUser').onchange = saveDav; $('#davPass').onchange = saveDav;
  
  $('#cloudUploadBtn').onclick = () => {
    showToast("后台上传中...");
    chrome.runtime.sendMessage({type: 'MANUAL_SYNC_UPLOAD'}, async (res) => {
       if (res && res.success) {
           await loadAllData();
           updateSyncUI(res.time);
           showToast("上传成功");
       } else showToast("上传失败: " + (res.error || "未知"));
    });
  };
  
  $('#cloudDownloadBtn').onclick = () => {
    if(!confirm("确定下载并覆盖本地吗？")) return;
    showToast("后台下载中...");
    chrome.runtime.sendMessage({type: 'MANUAL_SYNC_DOWNLOAD'}, async (res) => {
       if (res && res.success) {
           await loadAllData();
           renderAll();
           showToast("下载成功，配置已更新");
       } else showToast("下载失败: " + (res.error || "未知"));
    });
  };
}

function updateSyncUI(time) {
    const el = $('#syncStatusBadge');
    el.textContent = "上次: " + time;
    el.className = "status-badge synced";
}

function updateSyncPanel() {
  const mode = $('#syncProvider').value;
  $('#panelGithub').style.display = mode === 'github' ? 'block' : 'none';
  $('#panelWebdav').style.display = mode === 'webdav' ? 'block' : 'none';
  chrome.storage.local.set({ syncProvider: mode });
}
function saveDav() { chrome.storage.local.set({ davUrl: $('#davUrl').value, davUser: $('#davUser').value, davPass: $('#davPass').value }); }

function switchSyncPanel() { updateSyncPanel(); } // alias

// --- 通用 ---
function initGeneralModule() {
  $('#themeSelect').value = allData.theme || 'system';
  $('#themeSelect').onchange = (e) => { applyTheme(e.target.value); chrome.storage.local.set({ theme: e.target.value }); };
  $('#resetAppBtn').onclick = () => { if (confirm("⚠️ 危险：清空所有数据？")) chrome.storage.local.clear(() => chrome.runtime.reload()); };
}
function applyTheme(theme) {
  const doc = document.documentElement;
  if (theme === 'dark') doc.setAttribute('data-theme', 'dark');
  else if (theme === 'light') doc.setAttribute('data-theme', 'light');
  else doc.removeAttribute('data-theme');
}
function showToast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}