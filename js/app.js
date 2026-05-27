'use strict';

// ========== DOM参照 ==========
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const magnifier = document.getElementById('magnifier');
const mctx = magnifier.getContext('2d');
const fileInput = document.getElementById('file');
const zoomSlider = document.getElementById('zoom');
const zoomVal = document.getElementById('zoomVal');
const hoverInfo = document.getElementById('hoverInfo');
const historyDiv = document.getElementById('history');
const ownedListDiv = document.getElementById('ownedList');
const ownedCountEl = document.getElementById('ownedCount');
const toastEl = document.getElementById('toast');
const registerModeCheckbox = document.getElementById('registerMode');
const modeBanner = document.getElementById('modeBanner');

// ========== 状態 ==========
let img = null;
let zoom = parseInt(zoomSlider.value, 10);
let COLORS = [];
let clickHistory = [];
// 所持色: [{type:'beads', key:'A05'}, {type:'rgb', rgb:[r,g,b]}, ...]
let ownedColors = [];

// ========== ユーティリティ ==========
function colorKey(c) {
  return c.A || c.R || c.PN || c.name;
}

// 所持色オブジェクトから一意IDを生成 (重複判定用)
function ownedId(owned) {
  if (owned.type === 'beads') return 'beads:' + owned.key;
  if (owned.type === 'rgb') return 'rgb:' + owned.rgb.join(',');
  return '';
}

// 指定色が所持済みかチェック (品番一致 or RGB完全一致)
function isOwned(color) {
  const key = colorKey(color);
  return ownedColors.some(o => {
    if (o.type === 'beads') return o.key === key;
    if (o.type === 'rgb') {
      return o.rgb[0] === color.rgb[0] && o.rgb[1] === color.rgb[1] && o.rgb[2] === color.rgb[2];
    }
    return false;
  });
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ========== カラーデータ読込 ==========
async function loadColors() {
  try {
    const res = await fetch('data/colors.json');
    if (!res.ok) throw new Error('colors.jsonの読み込みに失敗: ' + res.status);
    const data = await res.json();
    COLORS = data.colors;
    console.log(`カラーデータ ${COLORS.length} 色を読み込みました`);
  } catch (e) {
    alert('カラーデータの読み込みに失敗しました: ' + e.message);
    console.error(e);
  }
}

// ========== イベント ==========
zoomSlider.addEventListener('input', () => {
  zoom = parseInt(zoomSlider.value, 10);
  zoomVal.textContent = zoom;
  drawImage();
});

fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    img = new Image();
    img.onload = drawImage;
    img.src = ev.target.result;
  };
  reader.readAsDataURL(f);
});

// 登録モード切替
registerModeCheckbox.addEventListener('change', () => {
  if (registerModeCheckbox.checked) {
    document.body.classList.add('register-mode');
    modeBanner.style.display = 'block';
  } else {
    document.body.classList.remove('register-mode');
    modeBanner.style.display = 'none';
  }
});

canvas.addEventListener('click', (e) => {
  if (!img) return;
  const p = getPixelAt(e.clientX, e.clientY);

  if (registerModeCheckbox.checked) {
    // 登録モード: そのままRGBを所持色登録
    addOwnedRgb(p.r, p.g, p.b);
  } else {
    // 通常モード: マッチングして履歴に追加
    const top = findNearest(p.r, p.g, p.b, 3);
    clickHistory.unshift({ pixel: p, candidates: top });
    renderHistory();
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!img) return;
  const p = getPixelAt(e.clientX, e.clientY);
  hoverInfo.innerHTML = `位置(${p.x},${p.y}) RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}`;

  magnifier.style.display = 'inline-block';
  magnifier.width = 60;
  magnifier.height = 60;
  const srcX = Math.max(0, Math.min(img.width - 6, Math.floor(p.x / zoom) - 3));
  const srcY = Math.max(0, Math.min(img.height - 6, Math.floor(p.y / zoom) - 3));
  mctx.imageSmoothingEnabled = false;
  mctx.drawImage(img, srcX, srcY, 6, 6, 0, 0, 60, 60);
  mctx.strokeStyle = 'red';
  mctx.lineWidth = 1;
  mctx.strokeRect(25, 25, 10, 10);
});

canvas.addEventListener('mouseleave', () => {
  magnifier.style.display = 'none';
  hoverInfo.textContent = '';
});

document.getElementById('exportHistoryBtn').addEventListener('click', exportHistory);
document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (clickHistory.length === 0) return;
  if (confirm('履歴をすべてクリアしますか?')) {
    clickHistory = [];
    renderHistory();
  }
});

document.getElementById('exportOwnedBtn').addEventListener('click', exportOwned);
document.getElementById('importOwnedBtn').addEventListener('click', openImportModal);
document.getElementById('clearOwnedBtn').addEventListener('click', () => {
  if (ownedColors.length === 0) return;
  if (confirm('所持色をすべてクリアしますか?')) {
    ownedColors = [];
    renderOwned();
    renderHistory();
  }
});

document.getElementById('importCancelBtn').addEventListener('click', closeImportModal);
document.getElementById('importConfirmBtn').addEventListener('click', confirmImport);

// ========== 描画 ==========
function drawImage() {
  if (!img) return;
  canvas.width = img.width * zoom;
  canvas.height = img.height * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function getPixelAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor((clientX - rect.left) * scaleX);
  const y = Math.floor((clientY - rect.top) * scaleY);
  const data = ctx.getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3], x, y };
}

function findNearest(r, g, b, n = 3) {
  const list = COLORS.map(c => {
    const dr = c.rgb[0] - r;
    const dg = c.rgb[1] - g;
    const db = c.rgb[2] - b;
    return { ...c, dist: Math.sqrt(dr * dr + dg * dg + db * db) };
  });
  list.sort((a, b) => a.dist - b.dist);
  return list.slice(0, n);
}

// ========== クリック履歴の描画 ==========
function renderHistory() {
  historyDiv.innerHTML = '';
  clickHistory.forEach((entry, idx) => {
    const p = entry.pixel;
    const item = document.createElement('div');
    item.className = 'picked';

    let candHtml = '';
    entry.candidates.forEach((c, i) => {
      const codes = [c.A, c.R, c.PN].filter(x => x).join(' / ');
      const owned = isOwned(c);
      const ownedMark = owned ? '★ ' : '';
      const btnLabel = owned ? '登録済' : '+追加';
      const btnClass = owned ? 'add-btn added' : 'add-btn';
      candHtml += `
        <div class="candidate ${owned ? 'owned' : ''}">
          <div class="csw" style="background:rgb(${c.rgb.join(',')})"></div>
          <div class="info">
            <b>${i + 1}位</b> ${ownedMark}${c.name} (距離${c.dist.toFixed(1)})<br>
            <span style="color:#555;">${codes} | RGB(${c.rgb.join(',')})</span>
          </div>
          <button class="${btnClass}" data-cand-idx="${i}" data-entry-idx="${idx}">${btnLabel}</button>
        </div>`;
    });

    item.innerHTML = `
      <div class="swatch-wrap">
        <div class="swatch" style="background:rgb(${p.r},${p.g},${p.b})"></div>
        <div class="pos">(${p.x},${p.y})</div>
      </div>
      <div style="flex:1;">
        <div class="label">クリックした色: RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}</div>
        ${candHtml}
      </div>
      <button class="close-btn">×</button>
    `;

    item.querySelector('.close-btn').addEventListener('click', () => {
      clickHistory.splice(idx, 1);
      renderHistory();
    });

    item.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('added')) return;
        const entryIdx = parseInt(btn.dataset.entryIdx, 10);
        const candIdx = parseInt(btn.dataset.candIdx, 10);
        const color = clickHistory[entryIdx].candidates[candIdx];
        addOwnedBeads(color);
      });
    });

    historyDiv.appendChild(item);
  });
}

// ========== 所持色管理 ==========
// ピクセルピコのビーズ色を登録
function addOwnedBeads(color) {
  const newItem = { type: 'beads', key: colorKey(color) };
  const id = ownedId(newItem);
  if (ownedColors.some(o => ownedId(o) === id)) {
    showToast(`「${color.name}」は既に登録済みです`);
    return;
  }
  ownedColors.push(newItem);
  renderOwned();
  renderHistory();
  showToast(`「${color.name}」を所持色に追加しました`);
}

// RGBそのものを登録 (独自色用)
function addOwnedRgb(r, g, b) {
  const newItem = { type: 'rgb', rgb: [r, g, b] };
  const id = ownedId(newItem);
  if (ownedColors.some(o => ownedId(o) === id)) {
    showToast(`RGB(${r},${g},${b}) は既に登録済みです`);
    return;
  }
  ownedColors.push(newItem);
  renderOwned();
  renderHistory();
  showToast(`RGB(${r},${g},${b}) ${toHex(r, g, b)} を登録しました`);
}

function removeOwned(idStr) {
  ownedColors = ownedColors.filter(o => ownedId(o) !== idStr);
  renderOwned();
  renderHistory();
}

function renderOwned() {
  ownedCountEl.textContent = ownedColors.length;
  ownedListDiv.innerHTML = '';

  // 描画用にビューモデルへ変換
  const view = ownedColors.map(o => {
    if (o.type === 'beads') {
      const c = COLORS.find(c => colorKey(c) === o.key);
      if (!c) {
        return {
          id: ownedId(o),
          type: 'beads',
          name: `(不明:${o.key})`,
          codes: o.key,
          rgb: [200, 200, 200],
          sortKey: 'zzz' + o.key
        };
      }
      return {
        id: ownedId(o),
        type: 'beads',
        name: c.name,
        codes: [c.A, c.R, c.PN].filter(x => x).join(' / '),
        rgb: c.rgb,
        sortKey: c.name
      };
    } else {
      return {
        id: ownedId(o),
        type: 'rgb',
        name: `RGB(${o.rgb.join(',')})`,
        codes: toHex(o.rgb[0], o.rgb[1], o.rgb[2]),
        rgb: o.rgb,
        sortKey: 'zzz_rgb_' + o.rgb.join(',')
      };
    }
  });

  // 種別優先 → 名前順でソート (ビーズ → RGB登録の順)
  view.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'beads' ? -1 : 1;
    return a.sortKey.localeCompare(b.sortKey, 'ja');
  });

  view.forEach(v => {
    const item = document.createElement('div');
    item.className = 'owned-item';
    const badge = v.type === 'beads'
      ? '<span class="type-badge beads">ビーズ</span>'
      : '<span class="type-badge rgb">RGB</span>';
    item.innerHTML = `
      <div class="csw" style="background:rgb(${v.rgb.join(',')})"></div>
      <div class="info">
        ${badge}${v.name}<br>
        <span style="color:#777;font-size:11px;">${v.codes}</span>
      </div>
      <button class="remove">削除</button>
    `;
    item.querySelector('.remove').addEventListener('click', () => {
      removeOwned(v.id);
    });
    ownedListDiv.appendChild(item);
  });
}

// ========== エクスポート / インポート ==========
function exportHistory() {
  if (clickHistory.length === 0) {
    showToast('履歴が空です');
    return;
  }
  const lines = [];
  lines.push('# ピクセルピコ カラーマッチャー - クリック結果');
  lines.push(`# 件数: ${clickHistory.length}`);
  lines.push('');
  clickHistory.forEach((entry, i) => {
    const p = entry.pixel;
    lines.push(`[${i + 1}] 位置(${p.x},${p.y}) クリック色: RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}`);
    entry.candidates.forEach((c, j) => {
      const codes = [c.A, c.R, c.PN].filter(x => x).join(' / ');
      const owned = isOwned(c) ? ' ★所持' : '';
      lines.push(`  ${j + 1}位: ${c.name} [${codes}] RGB(${c.rgb.join(',')}) 距離${c.dist.toFixed(1)}${owned}`);
    });
    lines.push('');
  });
  copyToClipboard(lines.join('\n'), '履歴をクリップボードにコピーしました');
}

function exportOwned() {
  if (ownedColors.length === 0) {
    showToast('所持色が登録されていません');
    return;
  }
  const data = {
    type: 'pixelpico-owned-colors',
    version: 2,
    count: ownedColors.length,
    items: ownedColors
  };
  const text = JSON.stringify(data, null, 2);
  copyToClipboard(text, '所持色データをクリップボードにコピーしました');
}

function openImportModal() {
  document.getElementById('importText').value = '';
  document.getElementById('importModal').style.display = 'flex';
}

function closeImportModal() {
  document.getElementById('importModal').style.display = 'none';
}

function confirmImport() {
  const text = document.getElementById('importText').value.trim();
  if (!text) {
    showToast('テキストが空です');
    return;
  }
  try {
    const data = JSON.parse(text);
    if (data.type !== 'pixelpico-owned-colors') {
      throw new Error('形式が正しくありません(type不一致)');
    }

    let imported = [];

    // version 2形式: items配列
    if (Array.isArray(data.items)) {
      imported = data.items;
    }
    // version 1形式 (旧): keys配列 → beadsとして取り込み
    else if (Array.isArray(data.keys)) {
      imported = data.keys.map(k => ({ type: 'beads', key: k }));
    } else {
      throw new Error('items または keys が見つかりません');
    }

    let added = 0, dup = 0, invalid = 0;
    imported.forEach(item => {
      // バリデーション
      if (item.type === 'beads' && typeof item.key === 'string') {
        // OK
      } else if (item.type === 'rgb' && Array.isArray(item.rgb) && item.rgb.length === 3) {
        // OK
      } else {
        invalid++;
        return;
      }
      const id = ownedId(item);
      if (ownedColors.some(o => ownedId(o) === id)) {
        dup++;
      } else {
        ownedColors.push(item);
        added++;
      }
    });

    renderOwned();
    renderHistory();
    closeImportModal();
    let msg = `${added}色をインポートしました`;
    const notes = [];
    if (dup > 0) notes.push(`重複${dup}件`);
    if (invalid > 0) notes.push(`不正な形式${invalid}件`);
    if (notes.length > 0) msg += ` (${notes.join(', ')}をスキップ)`;
    showToast(msg);
  } catch (e) {
    alert('インポートに失敗しました: ' + e.message);
  }
}

// ========== クリップボード ==========
function copyToClipboard(text, successMsg) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => showToast(successMsg),
      () => fallbackCopy(text, successMsg)
    );
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg);
  } catch (e) {
    alert('コピーに失敗しました。手動でコピーしてください:\n\n' + text);
  }
  document.body.removeChild(ta);
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.display = 'none';
  }, 2200);
}

// ========== 初期化 ==========
loadColors();
