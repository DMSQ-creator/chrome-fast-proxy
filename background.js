// background.js - 高性能版：使用 Set 哈希查找 + 绘图缓存

let cachedUserRules = new Set();
let cachedGfwDomains = new Set(); // 使用 Set 替代 Array，查找速度提升 1000 倍
let currentMode = 'direct';

// 缓存上一次的图标状态，防止重复绘图消耗 GPU
let lastDrawState = { color: null, char: null };

// 1. 初始化
chrome.storage.local.get(['userRules', 'gfwDomains'], (items) => {
  updateSets(items.userRules, items.gfwDomains);
});

// 2. 监听数据变化
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    const newUser = changes.userRules ? changes.userRules.newValue : null;
    const newGfw = changes.gfwDomains ? changes.gfwDomains.newValue : null;
    // 如果有数据更新，才去更新 Set
    if (newUser || newGfw) {
        // 重新读取以确保拿到完整数据（如果只更新了一项）
        chrome.storage.local.get(['userRules', 'gfwDomains'], (items) => {
            updateSets(items.userRules, items.gfwDomains);
            updateIconForActiveTab(); // 数据变了，立即刷新图标
        });
    }
  }
});

function updateSets(userArr, gfwArr) {
    // 将数组转换为 Set，利用 Hash 结构实现 O(1) 查找
    if (userArr) cachedUserRules = new Set(userArr);
    if (gfwArr) cachedGfwDomains = new Set(gfwArr);
}

// 3. 监听模式变化
chrome.proxy.settings.onChange.addListener((details) => {
    if (details && details.value) {
        currentMode = details.value.mode;
        // 强制刷新，忽略缓存
        lastDrawState = { color: null, char: null };
        updateIconForActiveTab();
    }
});

// 4. 监听标签切换
chrome.tabs.onActivated.addListener(updateIconForActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 只有当 URL 变化 或 页面加载完成时才计算
  // 忽略 loading 过程中的细微变化，减少计算频率
  if (changeInfo.status === 'complete' || changeInfo.url) {
    // 只有当前更新的 tab 是激活状态的 tab 时，才更新图标
    chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
        if (activeTabs && activeTabs.length > 0 && activeTabs[0].id === tabId) {
            updateIconForActiveTab();
        }
    });
  }
});

// --- 核心逻辑 ---

function updateIconForActiveTab() {
  // 获取当前模式（双重保险）
  chrome.proxy.settings.get({}, (details) => {
    if (chrome.runtime.lastError) return;
    currentMode = details.value.mode;

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      
      const state = calculateState(tab.url, currentMode);
      
      // 【性能优化核心】如果状态没变，直接返回，不执行昂贵的画图操作
      if (state.color === lastDrawState.color && state.char === lastDrawState.char) {
          return;
      }
      
      drawIcon(state.color, state.char);
      // 更新缓存
      lastDrawState = state;
    });
  });
}

function calculateState(urlStr, mode) {
  let color = "#2196F3"; // 蓝色
  let char = "D";        // Direct

  if (mode === 'fixed_servers') {
    return { color: "#4CAF50", char: "P" };
  } 
  else if (mode === 'direct') {
    return { color: "#2196F3", char: "D" };
  } 
  else if (mode === 'pac_script') {
    char = "A"; 
    color = "#9E9E9E"; // 默认灰色
    
    if (urlStr && urlStr.startsWith('http')) {
      try {
        const hostname = new URL(urlStr).hostname;
        const domain = hostname.startsWith('www.') ? hostname.substring(4) : hostname;
        
        // 1. 检查用户规则 (Set.has 是极速的)
        if (cachedUserRules.has(domain)) {
            return { color: "#4CAF50", char: "A" };
        }

        // 2. 检查 GFWList
        // 2.1 精确匹配
        if (cachedGfwDomains.has(domain)) {
            return { color: "#4CAF50", char: "A" };
        }
        
        // 2.2 泛域名匹配 (只检查根域名，避免过度切割字符串)
        const lastDot = domain.lastIndexOf('.');
        if (lastDot > 0) {
            const prevDot = domain.lastIndexOf('.', lastDot - 1);
            if (prevDot !== -1) {
                const root = domain.substring(prevDot + 1);
                if (cachedGfwDomains.has(root)) {
                    return { color: "#4CAF50", char: "A" };
                }
            }
        }
      } catch (e) {}
    }
  }

  return { color, char };
}

function drawIcon(color, char) {
  chrome.action.setBadgeText({ text: "" });

  const canvas = new OffscreenCanvas(32, 32);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(16, 16, 16, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, 16, 17);

  const imageData = ctx.getImageData(0, 0, 32, 32);
  chrome.action.setIcon({ imageData: imageData });
}