// js/rules.js

let currentType = 'userRules'; // 'userRules' or 'userWhitelist'
let allRules = [];
let filteredRules = [];

document.addEventListener('DOMContentLoaded', () => {
  // 1. 加载主题
  chrome.storage.local.get(['theme'], (i) => {
    const theme = i.theme || 'system';
    const doc = document.documentElement;
    if (theme === 'dark') doc.setAttribute('data-theme', 'dark');
    else if (theme === 'light') doc.setAttribute('data-theme', 'light');
  });

  // 2. 绑定 Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentType = tab.dataset.type;
      loadRules();
    });
  });

  // 3. 初始加载
  loadRules();
  
  // 4. 事件绑定
  document.getElementById('searchInput').addEventListener('input', (e) => filterRules(e.target.value));
  document.getElementById('addBtn').addEventListener('click', addRule);
  document.getElementById('addInput').addEventListener('keypress', (e) => { if(e.key === 'Enter') addRule(); });
  document.getElementById('exportBtn').addEventListener('click', exportRules);
  document.getElementById('clearBtn').addEventListener('click', clearRules);

  // 5. 拖拽导入
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', handleDrop);
});

function loadRules() {
  chrome.storage.local.get([currentType], (items) => {
    allRules = items[currentType] || [];
    // 默认倒序排列（新添加的在前面）
    allRules.reverse();
    filterRules(document.getElementById('searchInput').value);
  });
}

function filterRules(keyword) {
  const k = keyword.trim().toLowerCase();
  if (!k) {
    filteredRules = allRules;
  } else {
    filteredRules = allRules.filter(r => r.includes(k));
  }
  renderList();
}

function renderList() {
  const container = document.getElementById('ruleList');
  container.innerHTML = '';
  
  if (filteredRules.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }

  // 使用 DocumentFragment 优化性能
  const fragment = document.createDocumentFragment();
  
  filteredRules.forEach(rule => {
    const li = document.createElement('li');
    li.className = 'rule-item';
    li.innerHTML = `
      <span class="rule-domain">${rule}</span>
      <div class="rule-actions">
        <button class="icon-btn" title="删除">🗑️</button>
      </div>
    `;
    li.querySelector('button').onclick = () => deleteRule(rule);
    fragment.appendChild(li);
  });
  
  container.appendChild(fragment);
}

function addRule() {
  const input = document.getElementById('addInput');
  const val = input.value.trim().toLowerCase();
  if (!val) return;
  
  // 简单的重复检查
  // 注意：allRules 当前是倒序的，为了存储逻辑，我们需要读取原始数据或者在这里处理
  chrome.storage.local.get([currentType], (items) => {
    let list = items[currentType] || [];
    if (!list.includes(val)) {
      list.push(val);
      chrome.storage.local.set({ [currentType]: list }, () => {
        input.value = '';
        loadRules();
      });
    } else {
      alert("规则已存在");
    }
  });
}

function deleteRule(rule) {
  if (!confirm(`确定移除规则: ${rule}?`)) return;
  
  chrome.storage.local.get([currentType], (items) => {
    let list = items[currentType] || [];
    list = list.filter(r => r !== rule);
    chrome.storage.local.set({ [currentType]: list }, () => {
      loadRules();
    });
  });
}

function clearRules() {
  if (!confirm(`确定清空当前列表所有规则吗？此操作无法撤销。`)) return;
  chrome.storage.local.set({ [currentType]: [] }, () => {
    loadRules();
  });
}

function exportRules() {
  const blob = new Blob([JSON.stringify(allRules, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fastproxy_${currentType}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (Array.isArray(data)) {
        if (confirm(`发现 ${data.length} 条规则，确定导入到当前列表吗？`)) {
          chrome.storage.local.get([currentType], (items) => {
            const list = items[currentType] || [];
            const merged = [...new Set([...list, ...data])];
            chrome.storage.local.set({ [currentType]: merged }, () => {
              alert("导入成功！");
              loadRules();
            });
          });
        }
      } else {
        alert("文件格式错误，应为 JSON 字符串数组");
      }
    } catch(err) {
      alert("解析失败");
    }
  };
  reader.readAsText(file);
}