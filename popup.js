let data = { folders: [] };
let openFolder = null; // 记录当前展开的文件夹（null 表示全部收起）
const statusEl = document.getElementById('status');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'red' : 'green';
}

// 保存数据到插件存储（自动、永久、不占内存）
async function saveData() {
  await chrome.storage.local.set({ collectionData: data });
  render();
}

// 读取数据
async function loadData() {
  const result = await chrome.storage.local.get('collectionData');
  if (result.collectionData) {
    data = result.collectionData;
  } else {
    data = { folders: [] };
  }
  render();
}

// 导出到文件夹（手动点击）
document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    const fileHandle = await dirHandle.getFileHandle('collections.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    setStatus('已导出到文件夹');
  } catch (e) {
    setStatus('已取消导出', true);
  }
});

// 从文件夹导入（手动点击，换电脑用）
document.getElementById('importBtn').addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    const fileHandle = await dirHandle.getFileHandle('collections.json', { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (text) {
      data = JSON.parse(text);
      await saveData();
      setStatus('已从文件夹导入');
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
  if (!name) {
    setStatus('请输入文件夹名称', true);
    return;
  }
  data.folders.push({ name: name, items: [] });
  document.getElementById('folderName').value = '';
  await saveData();
  setStatus('文件夹已创建');
});

// 添加当前页面
document.getElementById('addCurrent').addEventListener('click', async () => {
  const folderIndex = document.getElementById('folderSelect').value;
  if (folderIndex === '') {
    setStatus('请先选择一个文件夹', true);
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  data.folders[folderIndex].items.push({
    title: tab.title,
    url: tab.url,
    note: ''
  });
  await saveData();
  setStatus('已添加当前页面');
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

    // ===== 文件夹标题栏（点击可展开/收起） =====
    const title = document.createElement('div');
    title.className = 'folder-title';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'folder-name';
    const arrow = (openFolder === fi) ? '▼' : '▶';
    titleSpan.textContent = arrow + ' 📁 ' + folder.name + ' (' + folder.items.length + ')';
    // 点击标题切换展开/收起
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
        await saveData();
      }
    };
    title.appendChild(delFolderBtn);
    div.appendChild(title);

    // ===== 只有展开的文件夹才显示里面的网页 =====
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
            await saveData();
          }
        };
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.textContent = '删除';
        delBtn.onclick = async () => {
          folder.items.splice(ii, 1);
          await saveData();
        };
        actions.appendChild(delBtn);

        itemDiv.appendChild(actions);
        div.appendChild(itemDiv);
      });
    }

    content.appendChild(div);
  });
}

// 启动时自动读取数据（无需任何点击）
loadData();
setStatus('数据已加载');
