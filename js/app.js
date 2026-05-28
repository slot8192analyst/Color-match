'use strict';

// ========== DOM参照 ==========
const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const magnifier = document.getElementById('magnifier');
const mctx = magnifier.getContext('2d');
const minimap = document.getElementById('minimap');
const minimapCanvas = document.getElementById('minimapCanvas');
const mmctx = minimapCanvas.getContext('2d');
const minimapMarker = document.getElementById('minimapMarker');
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
const pickBtn = document.getElementById('pickBtn');
const pickInfo = document.getElementById('pickInfo');

// ========== 状態 ==========
let img = null;
let zoom = parseInt(zoomSlider.value, 10);
let COLORS = [];
let clickHistory = [];
let ownedColors = [];

// 画像のオフセット (viewport左上を原点としたcanvas位置)
let offsetX = 0;
let offsetY = 0;

// ドラッグ状態
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetStartX = 0;
let dragOffsetStartY = 0;
let dragMoved = false;

// ========== localStorage キー ==========
const LS_OWNED = 'pixelpico-owned-colors-v2';
const LS_HISTORY = 'pixelpico-click-history-v1';

// ========== ユーティリティ ==========
function colorKey(c) {
  return c.A || c.R || c.PN || c.name;
}

function ownedId(owned) {
  if (owned.type === 'beads') return 'beads:' + owned.key;
  if (owned.type === 'rgb') return 'rgb:' + owned.rgb.join(',');
  return '';
}

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

function colorDist(rgb1, rgb2) {
  const dr = rgb1[0] - rgb2[0];
  const dg = rgb1[1] - rgb2[1];
  const db = rgb1[2] - rgb2[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// 所持色をビューモデル(RGB+表示情報)に変換 (距離計算用)
function ownedToView(o) {
  if (o.type === 'beads') {
    const c = COLORS.find(c => colorKey(c) === o.key);
    if (!c) return null;
    return {
      type: 'beads',
      key: o.key,
      name: c.name,
      codes: [c.A, c.R, c.PN].filter(x => x).join(' / '),
      rgb: c.rgb
    };
  } else {
    return {
      type: 'rgb',
      name: `RGB(${o.rgb.join(',')}) ${toHex(o.rgb[0], o.rgb[1], o.rgb[2])}`,
      codes: toHex(o.rgb[0], o.rgb[1], o.rgb[2]),
      rgb: o.rgb
    };
  }
}

// ========== カラーデータ読込 ==========
async function loadColors() {
  try {
    const res = await fetch('data/colors.json');
    if (!res.ok) throw new Error('colors.jsonの読み込みに失敗: ' + res.status);
    const data = await res.json();
    COLORS = data.colors;
    console.log(`カラーデータ ${COLORS.length} 色を読み込みました`);
    // データ読込完了後に永続化データを復元 (所持色表示にCOLORS参照が必要)
    loadFromStorage();
    renderOwned();
    renderHistory();
  } catch (e) {
    alert('カラーデータの読み込みに失敗しました: ' + e.message);
    console.error(e);
  }
}

// ========== localStorage 入出力 ==========
function saveOwned() {
  try {
    localStorage.setItem(LS_OWNED, JSON.stringify(ownedColors));
  } catch (e) {
    console.warn('所持色の保存失敗', e);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(clickHistory));
  } catch (e) {
    console.warn('履歴の保存失敗', e);
  }
}

function loadFromStorage() {
  try {
    const oRaw = localStorage.getItem(LS_OWNED);
    if (oRaw) {
      const arr = JSON.parse(oRaw);
      if (Array.isArray(arr)) ownedColors = arr;
    }
  } catch (e) { console.warn(e); }
  try {
    const hRaw = localStorage.getItem(LS_HISTORY);
    if (hRaw) {
      const arr = JSON.parse(hRaw);
      if (Array.isArray(arr)) clickHistory = arr;
    }
  } catch (e) { console.warn(e); }
}

// ========== ズーム ==========
zoomSlider.addEventListener('input', () => {
  const newZoom = parseInt(zoomSlider.value, 10);
  if (!img) {
    zoom = newZoom;
    zoomVal.textContent = zoom;
    return;
  }
  // 照準位置の画像座標を維持するようにオフセットを調整
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const cx = vw / 2;
  const cy = vh / 2;
  const imgX = (cx - offsetX) / zoom;
  const imgY = (cy - offsetY) / zoom;
  zoom = newZoom;
  zoomVal.textContent = zoom;
  offsetX = cx - imgX * zoom;
  offsetY = cy - imgY * zoom;
  drawImage();
});

// ========== ファイル読込 ==========
fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    img = new Image();
    img.onload = () => {
      // 画像中央が照準位置に来るように初期化
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      offsetX = vw / 2 - (img.width * zoom) / 2;
      offsetY = vh / 2 - (img.height * zoom) / 2;
      drawImage();
      drawMinimap();
      minimap.classList.add('visible');
      // 新しい画像を読み込んだら履歴をクリア
      if (clickHistory.length > 0) {
        clickHistory = [];
        saveHistory();
        renderHistory();
        showToast('新しい画像を読み込んだため履歴をクリアしました');
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(f);
});

// ========== 登録モード ==========
registerModeCheckbox.addEventListener('change', () => {
  if (registerModeCheckbox.checked) {
    document.body.classList.add('register-mode');
    modeBanner.style.display = 'block';
    pickBtn.textContent = '🎨 この位置のRGBを登録';
  } else {
    document.body.classList.remove('register-mode');
    modeBanner.style.display = 'none';
    pickBtn.textContent = '🎯 この位置の色を取得';
  }
});

// ========== ドラッグ(pan)操作 ==========
viewport.addEventListener('pointerdown', (e) => {
  if (!img) return;
  dragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOffsetStartX = offsetX;
  dragOffsetStartY = offsetY;
  viewport.setPointerCapture(e.pointerId);
});

viewport.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
  offsetX = dragOffsetStartX + dx;
  offsetY = dragOffsetStartY + dy;
  drawImage();
  updateMinimapMarker();
});

viewport.addEventListener('pointerup', (e) => {
  if (dragging) {
    dragging = false;
    try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
  }
});

// ========== 照準周辺の拡大鏡 ==========
function updateReticleMagnifier() {
  if (!img) {
    hoverInfo.textContent = '';
    return;
  }
  const p = getPixelAtReticle();
  if (!p) {
    mctx.clearRect(0, 0, magnifier.width, magnifier.height);
    hoverInfo.innerHTML = '<span style="color:#9a7a52;">照準が画像範囲外</span>';
    return;
  }
  hoverInfo.innerHTML = `照準位置(${p.x},${p.y})<br>RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}`;
  magnifier.width = 72;
  magnifier.height = 72;
  // 9x9ピクセル分を拡大表示 (中央が照準位置)
  const half = 4;
  const srcX = p.x - half;
  const srcY = p.y - half;
  mctx.imageSmoothingEnabled = false;
  mctx.fillStyle = '#fff';
  mctx.fillRect(0, 0, 72, 72);
  const sx = Math.max(0, srcX);
  const sy = Math.max(0, srcY);
  const ex = Math.min(img.width, srcX + 9);
  const ey = Math.min(img.height, srcY + 9);
  if (ex > sx && ey > sy) {
    const dx = (sx - srcX) * 8;
    const dy = (sy - srcY) * 8;
    mctx.drawImage(img, sx, sy, ex - sx, ey - sy, dx, dy, (ex - sx) * 8, (ey - sy) * 8);
  }
  // 中央セル(照準位置)を強調
  mctx.strokeStyle = '#d35400';
  mctx.lineWidth = 2;
  mctx.strokeRect(32, 32, 8, 8);
}

// ========== ピクセル取得 ==========
// viewport上のクライアント座標から画像ピクセルを取得
function getPixelAtClient(clientX, clientY) {
  if (!img) return null;
  const rect = viewport.getBoundingClientRect();
  const vx = clientX - rect.left;
  const vy = clientY - rect.top;
  const ix = Math.floor((vx - offsetX) / zoom);
  const iy = Math.floor((vy - offsetY) / zoom);
  if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return null;
  const data = ctx.getImageData(ix * zoom, iy * zoom, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3], x: ix, y: iy };
}

// 照準(viewport中央)のピクセル取得
function getPixelAtReticle() {
  if (!img) return null;
  const rect = viewport.getBoundingClientRect();
  return getPixelAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// ========== 取得ボタン ==========
pickBtn.addEventListener('click', () => {
  if (!img) {
    showToast('先に画像を読み込んでください');
    return;
  }
  const p = getPixelAtReticle();
  if (!p) {
    showToast('照準が画像範囲外です');
    return;
  }
  if (registerModeCheckbox.checked) {
    addOwnedRgb(p.r, p.g, p.b);
  } else {
    const top = findNearest(p.r, p.g, p.b, 3);
    const ownedNearest = findNearestOwned(p.r, p.g, p.b);
    clickHistory.unshift({
      pixel: p,
      candidates: top,
      ownedNearest: ownedNearest
    });
    saveHistory();
    renderHistory();
  }
});

// ========== 描画 ==========
function drawImage() {
  if (!img) return;
  canvas.width = img.width * zoom;
  canvas.height = img.height * zoom;
  canvas.style.left = offsetX + 'px';
  canvas.style.top = offsetY + 'px';
  canvas.style.width = (img.width * zoom) + 'px';
  canvas.style.height = (img.height * zoom) + 'px';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  updateMinimapMarker();
  updatePickInfo();
  updateReticleMagnifier();
}

function updatePickInfo() {
  if (!img) { pickInfo.textContent = ''; return; }
  const p = getPixelAtReticle();
  if (!p) {
    pickInfo.textContent = '照準: 画像範囲外';
    return;
  }
  pickInfo.innerHTML = `照準位置(${p.x},${p.y}) <span style="display:inline-block;width:12px;height:12px;background:rgb(${p.r},${p.g},${p.b});border:1px solid #8a6a42;vertical-align:middle;border-radius:2px;"></span> RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}`;
}

// ========== ミニマップ ==========
function drawMinimap() {
  if (!img) return;
  const maxW = 120;
  const maxH = 120;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const finalScale = Math.max(scale, Math.min(maxW / img.width, maxH / img.height));
  minimapCanvas.width = Math.max(1, Math.round(img.width * finalScale));
  minimapCanvas.height = Math.max(1, Math.round(img.height * finalScale));
  mmctx.imageSmoothingEnabled = false;
  mmctx.drawImage(img, 0, 0, minimapCanvas.width, minimapCanvas.height);
  updateMinimapMarker();
}

function updateMinimapMarker() {
  if (!img) return;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const imgLeft = Math.max(0, -offsetX / zoom);
  const imgTop = Math.max(0, -offsetY / zoom);
  const imgRight = Math.min(img.width, (vw - offsetX) / zoom);
  const imgBottom = Math.min(img.height, (vh - offsetY) / zoom);
  const mmW = minimapCanvas.clientWidth;
  const mmH = minimapCanvas.clientHeight;
  const sx = mmW / img.width;
  const sy = mmH / img.height;
  const left = imgLeft * sx;
  const top = imgTop * sy;
  const width = Math.max(2, (imgRight - imgLeft) * sx);
  const height = Math.max(2, (imgBottom - imgTop) * sy);
  minimapMarker.style.left = left + 'px';
  minimapMarker.style.top = top + 'px';
  minimapMarker.style.width = width + 'px';
  minimapMarker.style.height = height + 'px';
  updatePickInfo();
}

// ========== 色マッチング ==========
function findNearest(r, g, b, n = 3) {
  const list = COLORS.map(c => ({ ...c, dist: colorDist(c.rgb, [r, g, b]) }));
  list.sort((a, b) => a.dist - b.dist);
  return list.slice(0, n);
}

function findNearestOwned(r, g, b) {
  if (ownedColors.length === 0) return null;
  const list = ownedColors
    .map(o => ownedToView(o))
    .filter(v => v !== null)
    .map(v => ({ ...v, dist: colorDist(v.rgb, [r, g, b]) }));
  if (list.length === 0) return null;
  list.sort((a, b) => a.dist - b.dist);
  return list[0];
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
            <span style="color:#8a6a42;">${codes} | RGB(${c.rgb.join(',')})</span>
          </div>
          <button class="${btnClass}" data-cand-idx="${i}" data-entry-idx="${idx}">${btnLabel}</button>
        </div>`;
    });

    // 所持色セクション (再計算: 履歴保存後にownedColorsが変わっている可能性に対応)
    let ownedHtml = '';
    const ownedNearest = findNearestOwned(p.r, p.g, p.b);
    if (ownedNearest) {
      const beadsTop = entry.candidates[0];
      const beadsTopOwned = isOwned(beadsTop);
      // ビーズ全色1位が所持済みなら所持色セクションは省略
      if (!beadsTopOwned) {
        const isBestMatch = ownedNearest.dist <= beadsTop.dist;
        const badge = ownedNearest.type === 'beads'
          ? '<span class="type-badge beads">ビーズ</span>'
          : '<span class="type-badge rgb">RGB</span>';
        const sectionClass = isBestMatch ? 'owned-section best-match' : 'owned-section';
        const title = isBestMatch
          ? `所持色の中で最も近い色 <span class="best-match-badge">✨ 手持ちがベストマッチ</span>`
          : `所持色の中で最も近い色`;
        ownedHtml = `
          <div class="${sectionClass}">
            <div class="section-title">${title}</div>
            <div class="candidate">
              <div class="csw" style="background:rgb(${ownedNearest.rgb.join(',')})"></div>
              <div class="info">
                ${badge}${ownedNearest.name} (距離${ownedNearest.dist.toFixed(1)})<br>
                <span style="color:#8a6a42;">${ownedNearest.codes} | RGB(${ownedNearest.rgb.join(',')})</span>
              </div>
            </div>
          </div>`;
      }
    }

    item.innerHTML = `
      <div class="swatch-wrap">
        <div class="swatch" style="background:rgb(${p.r},${p.g},${p.b})"></div>
        <div class="pos">(${p.x},${p.y})</div>
      </div>
      <div style="flex:1;">
        <div class="label">取得した色: RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}</div>
        ${candHtml}
        ${ownedHtml}
      </div>
      <button class="close-btn">×</button>
    `;

    item.querySelector('.close-btn').addEventListener('click', () => {
      clickHistory.splice(idx, 1);
      saveHistory();
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
function addOwnedBeads(color) {
  const newItem = { type: 'beads', key: colorKey(color) };
  const id = ownedId(newItem);
  if (ownedColors.some(o => ownedId(o) === id)) {
    showToast(`「${color.name}」は既に登録済みです`);
    return;
  }
  ownedColors.push(newItem);
  saveOwned();
  renderOwned();
  renderHistory();
  showToast(`「${color.name}」を所持色に追加しました`);
}

function addOwnedRgb(r, g, b) {
  const newItem = { type: 'rgb', rgb: [r, g, b] };
  const id = ownedId(newItem);
  if (ownedColors.some(o => ownedId(o) === id)) {
    showToast(`RGB(${r},${g},${b}) は既に登録済みです`);
    return;
  }
  ownedColors.push(newItem);
  saveOwned();
  renderOwned();
  renderHistory();
  showToast(`RGB(${r},${g},${b}) ${toHex(r, g, b)} を登録しました`);
}

function removeOwned(idStr) {
  ownedColors = ownedColors.filter(o => ownedId(o) !== idStr);
  saveOwned();
  renderOwned();
  renderHistory();
}

function renderOwned() {
  ownedCountEl.textContent = ownedColors.length;
  ownedListDiv.innerHTML = '';

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
        <span style="color:#9a7a52;font-size:11px;">${v.codes}</span>
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
document.getElementById('exportHistoryBtn').addEventListener('click', exportHistory);
document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (clickHistory.length === 0) return;
  if (confirm('履歴をすべてクリアしますか?')) {
    clickHistory = [];
    saveHistory();
    renderHistory();
  }
});
document.getElementById('exportOwnedBtn').addEventListener('click', exportOwned);
document.getElementById('importOwnedBtn').addEventListener('click', openImportModal);
document.getElementById('clearOwnedBtn').addEventListener('click', () => {
  if (ownedColors.length === 0) return;
  if (confirm('所持色をすべてクリアしますか?')) {
    ownedColors = [];
    saveOwned();
    renderOwned();
    renderHistory();
  }
});
document.getElementById('importCancelBtn').addEventListener('click', closeImportModal);
document.getElementById('importConfirmBtn').addEventListener('click', confirmImport);

function exportHistory() {
  if (clickHistory.length === 0) {
    showToast('履歴が空です');
    return;
  }
  const lines = [];
  lines.push('# ピクセルピコ カラーマッチャー - 取得結果');
  lines.push(`# 件数: ${clickHistory.length}`);
  lines.push('');
  clickHistory.forEach((entry, i) => {
    const p = entry.pixel;
    lines.push(`[${i + 1}] 位置(${p.x},${p.y}) 取得色: RGB(${p.r},${p.g},${p.b}) ${toHex(p.r, p.g, p.b)}`);
    entry.candidates.forEach((c, j) => {
      const codes = [c.A, c.R, c.PN].filter(x => x).join(' / ');
      const owned = isOwned(c) ? ' ★所持' : '';
      lines.push(`  ${j + 1}位: ${c.name} [${codes}] RGB(${c.rgb.join(',')}) 距離${c.dist.toFixed(1)}${owned}`);
    });
    const ownedNearest = findNearestOwned(p.r, p.g, p.b);
    if (ownedNearest && !isOwned(entry.candidates[0])) {
      const isBest = ownedNearest.dist <= entry.candidates[0].dist;
      const mark = isBest ? ' ✨手持ちがベストマッチ' : '';
      lines.push(`  [所持色最近傍] ${ownedNearest.name} [${ownedNearest.codes}] RGB(${ownedNearest.rgb.join(',')}) 距離${ownedNearest.dist.toFixed(1)}${mark}`);
    }
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
  copyToClipboard(JSON.stringify(data, null, 2), '所持色データをクリップボードにコピーしました');
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
    if (Array.isArray(data.items)) {
      imported = data.items;
    } else if (Array.isArray(data.keys)) {
      imported = data.keys.map(k => ({ type: 'beads', key: k }));
    } else {
      throw new Error('items または keys が見つかりません');
    }
    let added = 0, dup = 0, invalid = 0;
    imported.forEach(item => {
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
    saveOwned();
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

// ========== ウィンドウリサイズで照準位置情報を更新 ==========
window.addEventListener('resize', () => {
  if (img) {
    drawMinimap();
    updatePickInfo();
    updateReticleMagnifier();
  }
});

// ========== 初期化 ==========
loadColors();
