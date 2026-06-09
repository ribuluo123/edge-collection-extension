let data = { folders: [] };
let openFolder = null;
let dirHandle = null;
const statusEl = document.getElementById('status');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'red' : 'green';
}

// ========== IndexedDB：记住文件夹句柄 ==========
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('collectionDB', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveHandle(handle) {
  const db = await openDB();
  const tx = db.transaction('handles', 'readwrite');
  tx.objectStore('handles').put(handle, 'dir');
}
async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('dir');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

// ========== 确保有写入权限（没有就请求） ==========
// fromUserClick = true 时允许弹出权限请求窗口
async function ensurePermission(fromUserClick) {
  if (!dirHandle) return false;
  let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return true;
  if (fromUserClick) {
    perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  }
  return false;
}

// ========== 把数据写入文件夹 ==========
async function writeToFolder() {
  const fileHandle = await dirHandle.getFileHandle('collections.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// ========== 保存数据（存插件 + 自动导出文件夹） ==========
// 添加/编辑/删除时调用，fromUserClick=true 表示来自用户点击，可弹权限窗
async function saveData(fromUserClick) {
  // 1. 永久存入插件存储（绝不丢）
  await chrome.storage.local.set({ collectionData: data });

  // 2. 自动导出到文件夹
  if (dirHandle) {
    const ok = await ensurePermission(fromUserClick);
    if (ok) {
      try {
        await writeToFolder();
        setStatus('已保存并自动导出到文件夹 ✅');
      } catch (e) {
        setStatus('已保存到插件，但导出文件夹失败', true);
      }
    } else {
      setStatus('已保存到插件（文件夹未授权，未导出）', true);
    }
  } else {
    setStatus('已保存到插件（未绑定文件夹）');
  }
  render();
}

// 读取插件数据
async function loadData() {
  const result = await chrome.storage.local.get('collectionData');
  data = result.collectionData || { folders: [] };
  render();
}

// ========== 绑定文件夹 / 手动导出 ==========
document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    dirHandle = await window.showDirectoryPicker();
    await saveHandle(dirHandle);
    await writeToFolder();
    setStatus('已绑定文件夹，之后添加网页会自动导出 ✅');
  } catch (e) {
    setStatus('已取消', true);
  }
});

// ========== 从文件夹导入（带保护） ==========
document.getElementById('importBtn').addEventListener('click', async () => {
  if (data.folders.length > 0) {
    const ok = confirm(
      '导入会用文件夹的数据【覆盖】当前数据。\n\n' +
      '若你刚添加的内容还没导出，请先取消！\n\n确定覆盖吗？'
    );
    if (!ok) { setStatus('已取消导入'); return; }
  }
  try {
    dirHandle = await window.showDirectoryPicker();
    await saveHandle(dirHandle);
    const fileHandle = await dirHandle.getFileHandle('collections.json', { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (text) {
      data = JSON.parse(text);
      await chrome.storage.local.set({ collectionData: data });
      render();
      setStatus('已从文件夹导入并绑定 ✅');
    } else {
      setStatus('文件夹里数据为空', true);
    }
  } catch (e) {
    setStatus('导入失败：未找到数据文件', true);
  }
});

// 新建文件夹
document.getElementById('addFolder').addEventListener('click', async () => {
  const name = document.getElementById('folderName').value.trim();
  if (!name) { setStatus('请输入文件夹名称', true); return; }
  data.folders.push({ name: name, items: [] });
  document.getElementById('folderName').value = '';
  await saveData(true); // 用户点击，可弹权限
});

// 添加当前页面（核心：每次添加自动导出）
document.getElementById('addCurrent').addEventListener('click', async () => {
  const folderIndex = document.getElementById('folderSelect').value;
  if (folderIndex === '') { setStatus('请先选择一个文件夹', true); return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  data.folders[folderIndex].items.push({
    title: tab.title, url: tab.url, note: ''
  });
  await saveData(true); // 用户点击，权限失效时会自动弹窗请求
});

// 渲染界面
function render() {
  const select = document.getElementById('folderSelect');
  select.innerHTML = '<option value="">选择文件夹...</option>';
  data.folders.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = f.name;
    select.appendChild(opt);
  });

  const content = document.getElementById('content');
  content.innerHTML = '';
  data.folders.forEach((folder, fi) => {
    const div = document.createElement('div');
    div.className = 'folder';

    const title = document.createElement('div');
    title.className = 'folder-title';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'folder-name';
    titleSpan.textContent = (openFolder === fi ? '▼' : '▶') +
      ' 📁 ' + folder.name + ' (' + folder.items.length + ')';
    titleSpan.onclick = () => {
      openFolder = (openFolder === fi) ? null : fi;
      render();
    };
    title.appendChild(titleSpan);

    const delFolderBtn = document.createElement('button');
    delFolderBtn.textContent = '删除';
    delFolderBtn.onclick = async () => {
      if (confirm('确定删除整个文件夹？')) {
        data.folders.splice(fi, 1);
        if (openFolder === fi) openFolder = null;
        await saveData(true);
      }
    };
    title.appendChild(delFolderBtn);
    div.appendChild(title);

    if (openFolder === fi) {
      if (folder.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-tip';
        empty.textContent = '（此文件夹为空）';
        div.appendChild(empty);
      }
      folder.items.forEach((item, ii) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'item';

        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.textContent = item.title || item.url;
        itemDiv.appendChild(link);

        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = item.note ? ('📝 ' + item.note) : '（无备注）';
        itemDiv.appendChild(note);

        const actions = document.createElement('div');
        actions.className = 'item-actions';

        const editBtn = document.createElement('button');
        editBtn.textContent = '编辑备注';
        editBtn.onclick = async () => {
          const newNote = prompt('输入备注：', item.note || '');
          if (newNote !== null) {
            item.note = newNote;
            await saveData(true);
          }
        };
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.textContent = '删除';
        delBtn.onclick = async () => {
          folder.items.splice(ii, 1);
          await saveData(true);
        };
        actions.appendChild(delBtn);

        itemDiv.appendChild(actions);
        div.appendChild(itemDiv);
      });
    }
    content.appendChild(div);
  });
}

// ========== 启动 ==========
(async function init() {
  await loadData();
  dirHandle = await loadHandle();
  if (dirHandle) {
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      setStatus('数据已加载，文件夹已绑定，自动导出已开启 ✅');
    } else {
      setStatus('数据已加载。添加网页时会弹一次授权，点允许即可自动导出');
    }
  } else {
    setStatus('数据已加载（请先点导出绑定文件夹）');
  }
})();
