'use strict';

const benchmarks = {
  wan14: {
    title: 'Wan2.1-T2V-14B', subtitle: 'VBench · Higher scores are better',
    columns: ['Method', 'Forward passes', 'Total ↑', 'Quality ↑', 'Semantic ↑'],
    rows: [['Teacher', '50 × 2', '83.58', '84.26', '80.92'], ['rCM', '4', '84.92', '85.43', '82.88'], ['DMAD', '4', '85.15', '85.96', '81.90']],
    best: {2: '85.15', 3: '85.96', 4: '82.88'},
  },
  wan13: {
    title: 'Wan2.1-T2V-1.3B', subtitle: 'VBench · Higher scores are better',
    columns: ['Method', 'Forward passes', 'Total ↑', 'Quality ↑', 'Semantic ↑'],
    rows: [['Teacher', '50 × 2', '83.02', '83.95', '79.26'], ['DMD2', '4', '84.56', '85.58', '80.50'], ['sCM', '4', '82.06', '84.00', '74.30'], ['rCM', '4', '84.43', '85.38', '80.63'], ['DMAD', '4', '84.70', '85.98', '79.55']],
    best: {2: '84.70', 3: '85.98', 4: '80.63'},
  },
  sdxl: {
    title: 'SDXL · COCO-10K', subtitle: 'Four-step comparisons · Lower FID, higher CLIP',
    columns: ['Method', 'Forward passes', 'FID ↓', 'Patch FID ↓', 'CLIP ↑'],
    rows: [['Teacher (CFG 6)', '100', '19.36', '21.38', '0.332'], ['LCM-SDXL', '4', '22.16', '33.92', '0.317'], ['SDXL-Turbo', '4', '23.19', '23.27', '0.334'], ['SDXL-Lightning', '4', '24.46', '24.56', '0.323'], ['DMD2', '4', '19.32', '20.86', '0.332'], ['SenseFlow', '4', '22.83', '26.05', '0.335'], ['DMAD', '4', '14.47', '19.88', '0.328']],
    best: {2: '14.47', 3: '19.88', 4: '0.335'},
  },
  edm: {
    title: 'EDM · ImageNet-64 × 64', subtitle: 'Class-conditional generation · Lower FID is better',
    columns: ['Method', 'Forward passes', 'FID ↓'],
    rows: [['EDM teacher (SDE)', '511', '1.36'], ['DMD2', '1', '1.51'], ['DMD2 + longer training', '1', '1.28'], ['D2O-F', '1', '1.16'], ['SiD', '1', '1.52'], ['SiDA', '1', '1.35'], ['SiD²A', '1', '1.11'], ['DMAD', '1', '1.24'], ['DMAD + projected discriminator', '1', '1.04']],
    best: {2: '1.04'},
  }
};

function renderBenchmark(key) {
  const data = benchmarks[key];
  document.querySelector('#benchmark-title').textContent = data.title;
  document.querySelector('#benchmark-subtitle').textContent = data.subtitle;
  const table = document.querySelector('#benchmark-table');
  table.replaceChildren();
  const caption = table.createCaption();
  caption.className = 'sr-only';
  caption.textContent = 'Selected ' + data.title + ' benchmark results';
  const head = table.createTHead().insertRow();
  data.columns.forEach(column => {
    const cell = document.createElement('th');
    cell.scope = 'col'; cell.textContent = column; head.append(cell);
  });
  const body = table.createTBody();
  data.rows.forEach(values => {
    const row = body.insertRow();
    const ours = values[0].startsWith('DMAD');
    if (ours) row.className = 'ours';
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      if (data.best[index] === value) {
        const strong = document.createElement('strong'); strong.textContent = value; cell.append(strong);
      } else cell.textContent = value;
      if (index === 0 && ours) { const badge = document.createElement('span'); badge.textContent = 'Ours'; cell.append(badge); }
      row.append(cell);
    });
  });
}

const dialog = document.querySelector('#sample-dialog');
const dialogVideo = document.querySelector('#dialog-video');
const demoVideo = document.querySelector('#demo-video');
const media = new Map(JSON.parse(document.querySelector('#sample-data').textContent).map(item => [item.key, item]));
const previews = [...document.querySelectorAll('[data-preview]')];
const previewToggle = document.querySelector('.preview-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let previewsPaused = reducedMotion.matches;
let lastOpener;
let comparisonPlaying = false;

function syncPreviews() {
  previews.forEach(video => {
    const rect = video.getBoundingClientRect();
    const hidden = Boolean(video.closest('[hidden]'));
    const visible = rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && !hidden;
    const shouldPlay = visible && !previewsPaused && !document.hidden && !dialog.open && demoVideo.paused && !comparisonPlaying;
    if (shouldPlay) {
      if (!video.getAttribute('src')) video.src = video.dataset.src;
      video.muted = true;
      if (video.paused) video.play().catch(() => { /* The poster remains usable if autoplay is unavailable. */ });
    } else {
      video.pause();
      if (video.getAttribute('src') && (hidden || rect.bottom < -innerHeight || rect.top > innerHeight * 2)) {
        video.removeAttribute('src');
        video.load();
      }
    }
  });
}
function updatePreviewToggle() {
  previewToggle.textContent = previewsPaused ? '▷ Play previews' : 'Ⅱ Pause previews';
  previewToggle.setAttribute('aria-pressed', String(previewsPaused));
}
updatePreviewToggle();
previewToggle.addEventListener('click', () => {
  previewsPaused = !previewsPaused;
  updatePreviewToggle();
  syncPreviews();
});
reducedMotion.addEventListener('change', event => {
  previewsPaused = event.matches;
  updatePreviewToggle();
  syncPreviews();
});
const previewObserver = new IntersectionObserver(syncPreviews, {threshold: [0, 0.1, 0.5]});
previews.forEach(video => previewObserver.observe(video));

document.querySelectorAll('[data-tabs]').forEach(group => {
  const tabs = [...group.querySelectorAll('[role="tab"]')];
  function select(tab) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      if (group.dataset.tabs === 'samples') {
        document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
      }
    });
    if (group.dataset.tabs === 'results') {
      document.querySelector('#benchmark-panel').setAttribute('aria-labelledby', tab.id);
      renderBenchmark(tab.id.replace('tab-', ''));
    } else {
      previewToggle.hidden = tab.id === 'tab-images';
      syncPreviews();
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); tabs[next].focus(); select(tabs[next]);
    });
  });
});

document.querySelectorAll('[data-sample]').forEach(button => {
  button.addEventListener('click', () => {
    const item = media.get(button.dataset.sample);
    if (!item) return;
    lastOpener = button;
    demoVideo.pause();
    document.querySelector('#dialog-title').textContent = item.title;
    document.querySelector('#dialog-meta').textContent = item.model + ' · 4 denoising steps' + (item.audio ? ' · Generated audio-video' : ' · Video only');
    document.querySelector('#dialog-prompt-text').textContent = item.prompt;
    document.querySelector('.dialog-prompt summary').textContent = item.promptLabel || 'Generation prompt';
    document.querySelector('.dialog-prompt').open = false;
    dialogVideo.src = 'assets/' + item.key + '.mp4';
    dialogVideo.poster = 'assets/' + item.key + '.jpg';
    dialogVideo.muted = !item.audio;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    syncPreviews();
    dialogVideo.play().catch(() => { /* Native controls remain available. */ });
  });
});
document.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  dialogVideo.pause();
  dialogVideo.removeAttribute('src');
  dialogVideo.load();
  document.body.style.overflow = '';
  lastOpener?.focus({preventScroll:true});
  syncPreviews();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { dialogVideo.pause(); demoVideo.pause(); }
  syncPreviews();
});

// The full demo and expanded samples own audio exclusively.
demoVideo.addEventListener('play', () => {
  dialogVideo.pause();
  syncPreviews();
});
demoVideo.addEventListener('pause', syncPreviews);
demoVideo.addEventListener('ended', syncPreviews);

const copyCitation = document.querySelector('#copy-citation');
copyCitation.addEventListener('click', async () => {
  const code = document.querySelector('#bibtex-text');
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(code.textContent);
    status.textContent = 'BibTeX copied.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = 'BibTeX selected. Press Ctrl+C or ⌘C to copy.';
  }
});
