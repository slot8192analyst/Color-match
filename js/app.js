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

// ========== 状態 ==========
let img = null;
let zoom = parseInt(zoomSlider.value, 10);
let COLORS = [];
let clickHistory = []; // {pixel:{r,g,b,x,y}, candidates:[...]}
let ownedSet = new Set(); // 所持色のキー (A/R/PN品番のいずれか優先, なければname)

// 色を一意識別するキーを作る
function colorKey(c) {
  return c.A || c.R || c.PN || c.name;
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

canvas.addEventListener('click', (e) => {
  if (!img) return;
  const p = getPixelAt(e.clientX, e.clientY);
  const top = findNearest(p.r, p.g, p.b, 3);
  clickHistory.unshift({ pixel: p, candidates: top });
  renderHistory();
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

// 履歴コピー・クリア
document.getElementById('exportHistoryBtn').addEventListener('click', exportHistory);
document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (clickHistory.length === 0) return;
  if (confirm('履歴をすべてクリアしますか?')) {
    clickHistory = [];
    renderHistory();
  }
});

// 所持色エクスポート・インポート・クリア
document.getElementById('exportOwnedBtn').addEventListener('click', exportOwned);
document.getElementById('importOwnedBtn').addEventListener('click', openImportModal);
document.getElementById('clearOwnedBtn').addEventListener('click', () => {
  if (ownedSet.size === 0) return;
  if (confirm('所持色をすべてクリアしますか?')) {
    ownedSet.clear();
    renderOwned();
    renderHistory(); // ★マーク更新
  }
});

// モーダル
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

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
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
      const isOwned = ownedSet.has(colorKey(c));
      const ownedMark = isOwned ? '★ ' : '';
      const btnLabel = isOwned ? '登録済' : '+追加';
      const btnClass = isOwned ? 'add-btn added' : 'add-btn';
      candHtml += `
        <div class="candidate ${isOwned ? 'owned' : ''}">
          <div class="csw" style="background:rgb(${c.rgb.join(',')})"></div>
          <div class="info">
            <b>${i + 1}位</b> ${ownedMark}${c.name} (距離${c.dist.toFixed(1)})<br>
            <span style="color:#555;">${codes} | RGB(${c.rgb.join(',')})</span>
          </div>
          <button class="${btnClass}" data-key="${colorKey(c)}" data-cand-idx="${i}" data-entry-idx="${idx}">${btnLabel}</button>
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

    // ×ボタン
    item.querySelector('.close-btn').addEventListener('click', () => {
      clickHistory.splice(idx, 1);
      renderHistory();
    });

    // +追加ボタン
    item.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('added')) return;
        const entryIdx = parseInt(btn.dataset.entryIdx, 10);
        const candIdx = parseInt(btn.dataset.candIdx, 10);
        const color = clickHistory[entryIdx].candidates[candIdx];
        addOwned(color);
      });
    });

    historyDiv.appendChild(item);
  });
}

// ========== 所持色管理 ==========
function addOwned(color) {
  const key = colorKey(color);
  if (ownedSet.has(key)) return;
  ownedSet.add(key);
  renderOwned();
  renderHistory();
  showToast(`「${color.name}」を所持色に追加しました`);
}

function removeOwned(key) {
  ownedSet.delete(key);
  renderOwned();
  renderHistory();
}

function renderOwned() {
  ownedCountEl.textContent = ownedSet.size;
  ownedListDiv.innerHTML = '';

  // ownedSetのキーに対応するCOLORSのエントリを引く
  const ownedColors = [];
  ownedSet.forEach(key => {
    const c = COLORS.find(c => colorKey(c) === key);
    if (c) ownedColors.push(c);
  });
  // 名前順でソート
  ownedColors.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  ownedColors.forEach(c => {
    const codes = [c.A, c.R, c.PN].filter(x => x).join(' / ');
    const item = document.createElement('div');
    item.className = 'owned-item';
    item.innerHTML = `
      <div class="csw" style="background:rgb(${c.rgb.join(',')})"></div>
      <div class="info">
        ${c.name}<br>
        <span style="color:#777;font-size:11px;">${codes}</span>
      </div>
      <button class="remove" data-key="${colorKey(c)}">削除</button>
    `;
    item.querySelector('.remove').addEventListener('click', () => {
      removeOwned(colorKey(c));
    });
    ownedListDiv.appendChild(item);
  });
}

// ========== エクスポート / インポート ==========
// クリック履歴をテキスト化
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
      const owned = ownedSet.has(colorKey(c)) ? ' ★所持' : '';
      lines.push(`  ${j + 1}位: ${c.name} [${codes}] RGB(${c.rgb.join(',')}) 距離${c.dist.toFixed(1)}${owned}`);
    });
    lines.push('');
  });
  copyToClipboard(lines.join('\n'), '履歴をクリップボードにコピーしました');
}

// 所持色エクスポート: シンプルなJSON+識別ヘッダ
function exportOwned() {
  if (ownedSet.size === 0) {
    showToast('所持色が登録されていません');
    return;
  }
  const data = {
    type: 'pixelpico-owned-colors',
    version: 1,
    count: ownedSet.size,
    keys: Array.from(ownedSet).sort()
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
    if (!Array.isArray(data.keys)) {
      throw new Error('keysが配列ではありません');
    }
    // 既存に追加する形でマージ (既存を消したい場合は事前にクリアしてもらう)
    let added = 0, unknown = 0;
    data.keys.forEach(k => {
      const found = COLORS.find(c => colorKey(c) === k);
      if (found) {
        if (!ownedSet.has(k)) {
          ownedSet.add(k);
          added++;
        }
      } else {
        unknown++;
      }
    });
    renderOwned();
    renderHistory();
    closeImportModal();
    showToast(`${added}色をインポートしました${unknown > 0 ? ` (未知の品番${unknown}件はスキップ)` : ''}`);
  } catch (e) {
    alert('インポートに失敗しました: ' + e.message);
  }
}

// ========== ユーティリティ ==========
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
