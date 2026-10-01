'use strict';

const comparisonData = JSON.parse(document.querySelector('#comparison-data').textContent);
const comparisonTabs = [...document.querySelectorAll('[data-comparison-family]')];
const comparisonPanel = document.querySelector('#comparison-panel');
const comparisonCase = document.querySelector('#comparison-case');
const comparisonPrevious = document.querySelector('#comparison-previous');
const comparisonNext = document.querySelector('#comparison-next');
const comparisonBaseline = document.querySelector('#comparison-baseline');
const comparisonPlay = document.querySelector('#comparison-play');
const comparisonSeek = document.querySelector('#comparison-seek');
const comparisonTime = document.querySelector('#comparison-time');
const comparisonAudio = document.querySelector('#comparison-audio');
const comparisonError = document.querySelector('#comparison-error');
const comparisonVideos = [...document.querySelectorAll('.comparison-visual video')];
let comparisonFamily = 'h3';
let comparisonCaseData;
let comparisonItems;
let comparisonFrame = null;
let comparisonAttempt = 0;
let comparisonScrubbing = false;
let comparisonResumeAfterSeek = false;

function updateComparisonTime() {
  const duration = comparisonCaseData?.duration || 0;
  const time = Math.min(comparisonVideos[0].currentTime || 0, duration);
  const progress = duration ? time / duration : 0;
  comparisonSeek.value = Math.round(progress * 1000);
  comparisonTime.textContent = `${time.toFixed(1)} / ${duration.toFixed(1)} s`;
  comparisonSeek.setAttribute('aria-valuetext', `${time.toFixed(1)} of ${duration.toFixed(1)} seconds`);
  if (!comparisonPlaying) comparisonPlay.textContent = progress >= 1 ? '↻ Replay comparison' : '▷ Play comparison';
}

function pauseComparison() {
  comparisonAttempt++;
  comparisonPlaying = false;
  cancelAnimationFrame(comparisonFrame);
  comparisonVideos.forEach(video => video.pause());
  comparisonPlay.textContent = '▷ Play comparison';
  comparisonPlay.setAttribute('aria-pressed', 'false');
  syncPreviews();
  syncMethodPlayback();
  updateComparisonTime();
}

function setComparisonAudio() {
  comparisonVideos.forEach((video, index) => {
    video.muted = !comparisonData[comparisonFamily].audio || comparisonAudio.value !== (index === 0 ? 'baseline' : 'ours');
  });
}

function tickComparison() {
  if (!comparisonPlaying) return;
  const [leader, follower] = comparisonVideos;
  // Correct drift against one clock; never alter playback speed or source duration.
  if (leader.readyState >= 2 && follower.readyState >= 2 && !follower.seeking && Math.abs(leader.currentTime - follower.currentTime) > 0.08) {
    follower.currentTime = Math.min(leader.currentTime, comparisonCaseData.duration);
  }
  updateComparisonTime();
  comparisonFrame = requestAnimationFrame(tickComparison);
}

async function playComparison() {
  if (comparisonPlaying) { pauseComparison(); return; }
  const attempt = ++comparisonAttempt;
  comparisonPlaying = true;
  comparisonError.hidden = true;
  comparisonPlay.textContent = 'Loading…';
  comparisonPlay.setAttribute('aria-pressed', 'true');
  demoVideo.pause();
  dialogVideo.pause();
  syncPreviews();
  syncMethodPlayback();
  const restart = comparisonVideos.some(video => video.ended || video.currentTime >= comparisonCaseData.duration - 0.001);
  comparisonVideos.forEach(video => {
    if (!video.getAttribute('src')) video.src = video.dataset.src;
    if (restart) video.currentTime = 0;
  });
  setComparisonAudio();
  try {
    await Promise.all(comparisonVideos.map(video => video.play()));
    if (attempt !== comparisonAttempt) return;
    comparisonVideos[1].currentTime = comparisonVideos[0].currentTime;
    comparisonSeek.disabled = false;
    comparisonPlay.textContent = 'Ⅱ Pause comparison';
    tickComparison();
  } catch (error) {
    if (attempt !== comparisonAttempt) return;
    pauseComparison();
    comparisonError.textContent = 'Unable to play the comparison. Try again, or expand a video to use its player controls.';
    comparisonError.hidden = false;
  }
}

function renderComparison() {
  comparisonScrubbing = false;
  comparisonResumeAfterSeek = false;
  pauseComparison();
  const family = comparisonData[comparisonFamily];
  comparisonCaseData = family.cases.find(item => item.id === comparisonCase.value);
  const caseIndex = family.cases.indexOf(comparisonCaseData);
  document.querySelector('#comparison-index').textContent = `${caseIndex + 1} / ${family.cases.length}`;
  comparisonPrevious.disabled = caseIndex === 0;
  comparisonNext.disabled = caseIndex === family.cases.length - 1;
  comparisonItems = {baseline: comparisonCaseData.methods[comparisonBaseline.value], ours: comparisonCaseData.methods.ours};
  const isVideo = family.type === 'video';
  const ours = comparisonItems.ours;
  document.querySelector('.comparison-pair').style.setProperty('--comparison-ratio', `${ours.width} / ${ours.height}`);
  document.querySelector('#comparison-baseline-name').textContent = comparisonItems.baseline.label;
  document.querySelector('#comparison-format').textContent = `${family.label} · ${ours.width} × ${ours.height}`;
  document.querySelector('#comparison-prompt-text').textContent = comparisonCaseData.prompt;
  document.querySelector('.comparison-prompt').open = false;
  document.querySelector('.comparison-playback').hidden = !isVideo;
  document.querySelector('.comparison-audio-control').hidden = !family.audio;
  comparisonAudio.value = 'none';
  comparisonAudio.options[1].textContent = comparisonItems.baseline.label;
  comparisonSeek.disabled = true;
  comparisonSeek.max = 1000;
  comparisonError.hidden = true;
  Object.entries(comparisonItems).forEach(([side, item]) => {
    const card = document.querySelector(`[data-comparison-side="${side}"]`);
    const video = card.querySelector('video');
    const imageLink = card.querySelector('.comparison-image-link');
    const image = imageLink.querySelector('img');
    const expand = card.querySelector('[data-comparison-expand]');
    document.querySelector(`#comparison-${side}-steps`).textContent = `${item.steps} steps`;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = !isVideo;
    imageLink.hidden = isVideo;
    expand.hidden = !isVideo;
    if (isVideo) {
      video.dataset.src = item.src;
      video.poster = item.poster;
      video.setAttribute('aria-label', `${item.label}: ${comparisonCaseData.title}`);
      expand.setAttribute('aria-label', `Expand ${item.label} video`);
      image.removeAttribute('src');
    } else {
      imageLink.href = item.src;
      imageLink.setAttribute('aria-label', `View ${item.label} image at 1024 by 1024 resolution`);
      image.src = item.src;
      image.alt = `${item.label}: ${comparisonCaseData.prompt}`;
    }
  });
  setComparisonAudio();
  updateComparisonTime();
}

function selectComparisonFamily(key, preferredBaseline = comparisonBaseline.value || 'teacher') {
  comparisonFamily = key;
  const family = comparisonData[key];
  const baseline = family.cases[0].methods[preferredBaseline] ? preferredBaseline : 'teacher';
  comparisonCase.replaceChildren(...family.cases.map((item, index) => new Option(`${String(index + 1).padStart(2, '0')} · ${item.title}`, item.id)));
  comparisonBaseline.replaceChildren(...Object.entries(family.cases[0].methods)
    .filter(([method]) => method !== 'ours').map(([method, item]) => new Option(item.label, method, method === 'teacher', method === baseline)));
  comparisonTabs.forEach(tab => {
    const selected = tab.dataset.comparisonFamily === key;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  comparisonPanel.setAttribute('aria-labelledby', `compare-tab-${key}`);
  renderComparison();
}

comparisonTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectComparisonFamily(tab.dataset.comparisonFamily));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % comparisonTabs.length;
    if (event.key === 'ArrowLeft') next = (index + comparisonTabs.length - 1) % comparisonTabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = comparisonTabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    comparisonTabs[next].focus();
    selectComparisonFamily(comparisonTabs[next].dataset.comparisonFamily);
  });
});
comparisonCase.addEventListener('change', renderComparison);
comparisonPrevious.addEventListener('click', () => {
  if (comparisonCase.selectedIndex <= 0) return;
  comparisonCase.selectedIndex--;
  renderComparison();
});
comparisonNext.addEventListener('click', () => {
  if (comparisonCase.selectedIndex >= comparisonCase.options.length - 1) return;
  comparisonCase.selectedIndex++;
  renderComparison();
});
comparisonBaseline.addEventListener('change', renderComparison);
comparisonPlay.addEventListener('click', playComparison);
comparisonAudio.addEventListener('change', setComparisonAudio);
function beginComparisonSeek() {
  if (comparisonScrubbing || comparisonSeek.disabled) return;
  comparisonScrubbing = true;
  comparisonResumeAfterSeek = comparisonPlaying;
  // Keep the intended playback state while the pointer controls the clock.
  const progress = comparisonSeek.value;
  pauseComparison();
  comparisonSeek.value = progress;
}
function finishComparisonSeek() {
  if (!comparisonScrubbing) return;
  comparisonScrubbing = false;
  const resume = comparisonResumeAfterSeek && Number(comparisonSeek.value) < 1000;
  comparisonResumeAfterSeek = false;
  updateComparisonTime();
  if (resume) playComparison();
}
comparisonSeek.addEventListener('pointerdown', beginComparisonSeek);
comparisonSeek.addEventListener('input', () => {
  beginComparisonSeek();
  const progress = Number(comparisonSeek.value) / 1000;
  comparisonVideos.forEach(video => {
    // The final thumb position must reach each file's actual end, including audio tails.
    video.currentTime = progress === 1 ? video.duration : progress * comparisonCaseData.duration;
  });
  updateComparisonTime();
});
comparisonSeek.addEventListener('change', finishComparisonSeek);
window.addEventListener('pointerup', finishComparisonSeek);
window.addEventListener('pointercancel', finishComparisonSeek);
comparisonVideos.forEach(video => video.addEventListener('ended', () => {
  if (comparisonScrubbing) return;
  pauseComparison();
  updateComparisonTime();
  comparisonPlay.textContent = '↻ Replay comparison';
}));
document.querySelectorAll('[data-comparison-expand]').forEach(button => {
  button.addEventListener('click', () => {
    const item = comparisonItems[button.dataset.comparisonExpand];
    const family = comparisonData[comparisonFamily];
    pauseComparison();
    demoVideo.pause();
    lastOpener = button;
    document.querySelector('#dialog-title').textContent = `${item.label} · ${comparisonCaseData.title}`;
    document.querySelector('#dialog-meta').textContent = `${family.label} · ${item.steps} denoising steps · ${family.audio ? 'Generated audio-video' : 'Video only'}`;
    document.querySelector('#dialog-prompt-text').textContent = comparisonCaseData.prompt;
    document.querySelector('.dialog-prompt summary').textContent = 'Generation prompt';
    document.querySelector('.dialog-prompt').open = false;
    dialogVideo.src = item.src;
    dialogVideo.poster = item.poster;
    dialogVideo.muted = !family.audio;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    syncPreviews();
    dialogVideo.play().catch(() => { /* Native controls remain available. */ });
  });
});
demoVideo.addEventListener('play', pauseComparison);
new MutationObserver(() => { if (dialog.open) pauseComparison(); }).observe(dialog, {attributes: true, attributeFilter: ['open']});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseComparison(); });
new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting) pauseComparison();
}, {threshold: 0}).observe(comparisonPanel);
selectComparisonFamily('h3', 'teacher');
