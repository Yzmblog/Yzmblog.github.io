'use strict';

// Original paper videos are display previews. Noise, features and weights are schematic.
const methodStages = [
  {label: 'Generate', title: 'From noise to a moving world.', description: 'A few-step student turns noise into a generated sample.', student: 'Generating', discriminator: 'Idle'},
  {label: 'Add noise', title: 'Three sources. A shared noise level.', description: 'Cached teacher samples, student outputs and real data are independently noised at the same sampled time. Their noisy latents are evaluated separately by one shared discriminator.', student: 'Fixed', discriminator: 'Forward pass'},
  {label: 'Classify', title: 'One backbone. Two decisions.', description: 'The teacher head separates teacher from student; the real head separates real from student. Binary classification updates the discriminator while student samples are detached.', student: 'Fixed', discriminator: 'Updating'},
  {label: 'Reweight', title: 'Adapt how much to trust the teacher.', description: 'The same real head estimates a smoothed gap between mean real and teacher logits in each noise band. Smaller gaps receive more teacher weight. Weights are normalized and detached from the student gradient.', student: 'Fixed', discriminator: 'Gap statistics'},
  {label: 'Distill', title: 'Send the learning signal back.', description: 'A linear loss combines the two head logits, with adaptive weighting on the teacher term. Gradients flow through the fixed discriminator and noisy student latent to update only the student.', student: 'Updating', discriminator: 'Parameters fixed'}
];
const methodCanvas = document.querySelector('#method-canvas');
const methodContext = methodCanvas.getContext('2d');
const methodPlayer = document.querySelector('.method-player');
const methodButtons = [...document.querySelectorAll('[data-method-stage]')];
const methodPlay = document.querySelector('#method-play');
const methodSeek = document.querySelector('#method-seek');
const methodTime = document.querySelector('#method-time');
const methodColors = {teacher: '#8abcf2', student: '#77e0cb', real: '#edbd85', ink: '#edf3fa', muted: '#9aaabc', line: '#2b3c4d'};
const methodMedia = {};
const methodNoise = [];
let methodStage = 0;
let methodPaused = reducedMotion.matches;
let methodVisible = false;
let methodPlaying = false;
let methodFrame = null;
let methodLastTime = 0;
let methodClock = 0;
let methodElapsed = 0;
let methodLastNoise = -1;
let methodWidth = 1200;
let methodHeight = 570;
let methodMobile = false;
let methodScrubbing = false;
const methodDurations = [6000, 6000, 6500, 6500, 6500];
const methodTotalDuration = methodDurations.reduce((sum, duration) => sum + duration, 0);
const methodFormulas = {
  gap: ['EMA[', {text: 'h', sub: 'R'}, '(R) − ', {text: 'h', sub: 'R'}, '(T)]'],
  teacher: [{text: 'ω'}, ' · ', {text: 'h', sub: 'T'}],
  real: [{text: 'h', sub: 'R'}],
  loss: [{text: 'L', sub: 'G'}, ' = −', {text: 'λ', sub: 'T'}, ' ', {text: 'ω'}, ' ', {text: 'h', sub: 'T'}, '(G) − ', {text: 'λ', sub: 'R'}, ' ', {text: 'h', sub: 'R'}, '(G)']
};

for (const role of ['teacher', 'student', 'real']) {
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'none';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.dataset.methodVideo = role;
  document.querySelector('.method-media-sources').append(video);
  const frames = [0, 1, 2].map(index => {
    const image = new Image();
    image.onload = () => { if (!methodPlaying) drawMethod(); };
    image.src = `assets/method-motion/${role}-${index}.jpg`;
    return image;
  });
  methodMedia[role] = {video, frames};
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = (methodClock / 1000) % video.duration;
  });
  video.addEventListener('seeked', () => { if (!methodPlaying) drawMethod(); });
  const noise = document.createElement('canvas');
  noise.width = 120; noise.height = 68;
  methodNoise.push(noise);
}

function methodText(text, x, y, size = 16, color = methodColors.ink, align = 'center', weight = 400) {
  const c = methodContext;
  c.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle';
  c.fillText(text, x, y);
}

function methodMathText(runs, x, y, size = 20, color = methodColors.ink) {
  const c = methodContext;
  const font = (scale = 1, italic = false) => `${italic ? 'italic ' : ''}${size * scale}px "Cambria Math", "STIX Two Math", "Times New Roman", serif`;
  c.save();
  c.fillStyle = color; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const measured = runs.map(run => {
    const token = typeof run === 'string' ? {text: run} : run;
    c.font = font(1, typeof run !== 'string');
    const width = c.measureText(token.text).width;
    c.font = font(.68);
    const subWidth = token.sub ? c.measureText(token.sub).width + 1 : 0;
    return {...token, italic: typeof run !== 'string', width, subWidth};
  });
  let left = x - measured.reduce((sum, run) => sum + run.width + run.subWidth, 0) / 2;
  const baseline = y + size * .28;
  for (const run of measured) {
    c.font = font(1, run.italic);
    c.fillText(run.text, left, baseline);
    left += run.width;
    if (run.sub) {
      c.font = font(.68);
      c.fillText(run.sub, left + 1, baseline + size * .25);
      left += run.subWidth;
    }
  }
  c.restore();
}

function methodDot(x, y, color, radius = 3, glow = true) {
  const c = methodContext;
  c.save(); c.fillStyle = color;
  if (glow) { c.shadowColor = color; c.shadowBlur = radius * 4; }
  c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill(); c.restore();
}

function methodPath(points, color = methodColors.student, active = true, reverse = false, token = null) {
  const c = methodContext;
  const [a, b, d, e] = points;
  c.save(); c.strokeStyle = color; c.globalAlpha *= active ? 0.5 : 0.22; c.lineWidth = active ? 1.4 : 1;
  c.beginPath(); c.moveTo(...a); c.bezierCurveTo(...b, ...d, ...e); c.stroke(); c.restore();
  if (!active) return;
  for (let i = 0; i < 3; i++) {
    let p = (methodClock / 2500 + i / 3) % 1;
    if (reverse) p = 1 - p;
    const q = 1 - p;
    const x = q*q*q*a[0] + 3*q*q*p*b[0] + 3*q*p*p*d[0] + p*p*p*e[0];
    const y = q*q*q*a[1] + 3*q*q*p*b[1] + 3*q*p*p*d[1] + p*p*p*e[1];
    if (token && i === 1) {
      const img = methodMedia[token].frames[1];
      if (img.complete && img.naturalWidth) { c.drawImage(img, x-12, y-7, 24, 14); }
    } else methodDot(x, y, color, i === 0 ? 3 : 2);
  }
}

function methodLine(x1, y1, x2, y2, color, active = true, reverse = false) {
  methodPath([[x1,y1],[x1+(x2-x1)*.4,y1],[x2-(x2-x1)*.4,y2],[x2,y2]], color, active, reverse);
}

function updateMethodNoise() {
  const tick = Math.floor(methodClock / 85);
  if (tick === methodLastNoise) return;
  methodLastNoise = tick;
  methodNoise.forEach((surface, k) => {
    const c = surface.getContext('2d');
    const data = c.createImageData(surface.width, surface.height);
    let state = (tick * 7919 + k * 104729 + 41) >>> 0;
    for (let i = 0; i < data.data.length; i += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const u1 = (state + 1) / 4294967297;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const u2 = (state + 1) / 4294967297;
      const value = Math.max(0, Math.min(255, 124 + 43 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)));
      data.data[i] = value * .86; data.data[i+1] = value; data.data[i+2] = value * 1.04; data.data[i+3] = 255;
    }
    c.putImageData(data, 0, 0);
  });
}

function methodNoiseTile(x, y, w, h, amount = 1, role = 'student', grid = false) {
  const c = methodContext;
  const media = methodMedia[role];
  const source = media.video.readyState >= 2 ? media.video : media.frames[1];
  c.save(); c.beginPath(); c.roundRect(x, y, w, h, 3); c.clip();
  c.fillStyle = '#15222b'; c.fillRect(x, y, w, h);
  if (source.readyState >= 2 || source.naturalWidth) c.drawImage(source, x, y, w, h);
  c.save(); c.globalAlpha *= amount; c.imageSmoothingEnabled = false;
  c.drawImage(methodNoise[['teacher','student','real'].indexOf(role)], x, y, w, h); c.restore();
  if (grid) {
    c.strokeStyle = '#b4ecde55'; c.lineWidth = .6;
    for (let i=1; i<10; i++) { c.beginPath(); c.moveTo(x+w*i/10,y); c.lineTo(x+w*i/10,y+h); c.stroke(); }
    for (let i=1; i<6; i++) { c.beginPath(); c.moveTo(x,y+h*i/6); c.lineTo(x+w,y+h*i/6); c.stroke(); }
  }
  c.restore(); c.save(); c.strokeStyle = methodColors[role]+'88'; c.lineWidth = 1; c.strokeRect(x,y,w,h); c.restore();
}

function methodFilm(role, x, y, w, tilt = -.035, noise = 0, scan = true) {
  const c = methodContext;
  const media = methodMedia[role];
  const h = w * .577;
  c.save(); c.translate(x,y); c.rotate(tilt);
  for (let i = 2; i >= 0; i--) {
    const ox = i*11, oy = -i*10;
    c.save(); c.globalAlpha *= i ? .28 + (2-i)*.14 : 1;
    c.fillStyle = '#101b26'; c.fillRect(-w/2+ox,-h/2+oy,w,h);
    const source = i === 0 && media.video.readyState >= 2 ? media.video : media.frames[i];
    if (source.readyState >= 2 || source.naturalWidth) c.drawImage(source,-w/2+ox,-h/2+oy,w,h);
    c.strokeStyle = methodColors[role]+(i ? '55' : 'b0'); c.lineWidth = .9;
    c.strokeRect(-w/2+ox,-h/2+oy,w,h); c.restore();
  }
  if (noise > 0) {
    c.save(); c.globalAlpha *= noise; c.imageSmoothingEnabled = false;
    c.drawImage(methodNoise[['teacher','student','real'].indexOf(role)],-w/2,-h/2,w,h); c.restore();
  }
  if (scan) {
    const pos = (methodClock/2800)%1;
    const gradient = c.createLinearGradient(-w/2+w*pos-22,0,-w/2+w*pos,0);
    gradient.addColorStop(0,'#77e0cb00'); gradient.addColorStop(1,'#77e0cb22');
    c.fillStyle = gradient; c.fillRect(-w/2+w*pos-22,-h/2,22,h);
    c.strokeStyle = '#b1ffee99'; c.beginPath(); c.moveTo(-w/2+w*pos,-h/2); c.lineTo(-w/2+w*pos,h/2); c.stroke();
  }
  c.restore();
}

function methodNetwork(x, y, size, color, active = true, layers = 5, reverse = false) {
  const c = methodContext;
  const pulse = (methodElapsed/650) % layers;
  const flowColor = reverse ? methodColors.student : color;
  const planes = [];
  for (let i=0; i<layers; i++) {
    const offset = i-(layers-1)/2;
    const px = methodMobile ? x-offset*size*.045 : x-size*.46+i*size*.16;
    const py = methodMobile ? y+offset*size*.16 : y+size*.12-i*size*.045;
    planes.push({x:px,y:py});
  }
  const point = (p,u,v) => methodMobile
    ? [p.x+size*(-.42+.54*u+.30*v),p.y+size*(-.055+.245*u-.135*v)]
    : [p.x+size*.30*u,p.y+size*(-.42+.12*u+.72*v)];
  // Upper/right layers recede on desktop; upper layers recede on mobile.
  // Keep this back-to-front order and opaque base independent of illumination.
  const order = planes.map((_,i)=>i);
  if(!methodMobile) order.reverse();
  c.save();
  order.forEach((i,depth) => {
    const p=planes[i], phaseIndex=reverse?layers-1-i:i;
    const distance=Math.abs(pulse-phaseIndex);
    const strength=active?Math.max(0,1-Math.min(distance,layers-distance)):0;
    if(depth>0) {
      const back=planes[order[depth-1]];
      c.strokeStyle=color+'44'; c.lineWidth=.7;
      for(let row=0;row<4;row++) {
        c.beginPath(); c.moveTo(...point(back,.82,(row+1)/5));
        c.lineTo(...point(p,.82,(row+1)/5)); c.stroke();
      }
    }
    c.beginPath(); c.moveTo(...point(p,0,0)); c.lineTo(...point(p,1,0));
    c.lineTo(...point(p,1,1)); c.lineTo(...point(p,0,1)); c.closePath();
    c.fillStyle='#14222d'; c.strokeStyle=color+'55'; c.lineWidth=1; c.fill(); c.stroke();
    if(strength>0) {
      c.save(); c.globalAlpha*=strength;
      c.fillStyle=flowColor+'16'; c.strokeStyle=flowColor+'dd'; c.lineWidth=1.7;
      c.fill(); c.stroke(); c.restore();
    }
    for(let row=0;row<4;row++) for(let col=0;col<3;col++) {
      const node=point(p,(col+1)/4,(row+1)/5);
      if(row<3) { c.strokeStyle=color+'25'; c.lineWidth=.7; c.beginPath(); c.moveTo(...node); c.lineTo(...point(p,(col+1)/4,(row+2)/5)); c.stroke(); }
      methodDot(...node,'#637b86',1.6,false);
      if(strength>0) { c.save(); c.globalAlpha*=strength; methodDot(...node,flowColor,2.5,true); c.restore(); }
    }
  });
  c.restore();
}

function methodHead(x,y,color,title,classes,active=true) {
  const c=methodContext;
  const nodes=[[-30,-25],[-30,0],[-30,25],[0,-15],[0,15],[32,0]];
  c.save(); c.strokeStyle=color+'44'; c.lineWidth=1;
  for(let a=0;a<3;a++) for(let b=3;b<5;b++) {c.beginPath();c.moveTo(x+nodes[a][0],y+nodes[a][1]);c.lineTo(x+nodes[b][0],y+nodes[b][1]);c.stroke();}
  for(let b=3;b<5;b++) {c.beginPath();c.moveTo(x+nodes[b][0],y+nodes[b][1]);c.lineTo(x+32,y);c.stroke();}
  nodes.forEach(([nx,ny],i)=>methodDot(x+nx,y+ny,color,active&&Math.floor(methodClock/250)%6===i?4:2.3,active));
  c.restore();
  methodText(title,x,y-52,methodMobile?18:19,methodColors.ink,'center',500);
  if(Array.isArray(classes)) methodMathText(classes,x,y+51,20,color);
  else methodText(classes,x,y+51,15,color);
}

function methodGenerate() {
  const mobile=methodMobile, c=methodContext;
  const t=Math.min(1,methodElapsed/5000), step=Math.min(4,Math.floor(t*5));
  const opacity=[1,.78,.5,.24,0][step];
  const n=mobile?{x:210,y:105,s:100}:{x:155,y:255,s:146};
  const g=mobile?{x:210,y:345,s:180}:{x:551,y:255,s:236};
  const v=mobile?{x:205,y:638,w:282}:{x:958,y:248,w:314};
  if(mobile) {
    methodPath([[210,164],[210,220],[210,225],[210,254]],methodColors.student);
    methodPath([[210,436],[210,477],[210,503],[210,544]],methodColors.student);
  } else {
    methodLine(237,255,443,255,methodColors.student);
    methodLine(665,255,785,255,methodColors.student);
  }
  methodNoiseTile(n.x-n.s/2,n.y-n.s/2,n.s,n.s,1);
  methodText('Gaussian noise',n.x,n.y+n.s/2+32,mobile?19:19,methodColors.muted);
  methodText('z',n.x,n.y-n.s/2-28,18,methodColors.student);
  methodNetwork(g.x,g.y,g.s,methodColors.student,true);
  methodText('Few-step student',g.x,g.y+g.s*.57,mobile?23:25,methodColors.ink,'center',500);
  const dotsY=g.y+g.s*.57+37;
  for(let i=0;i<4;i++) {
    const x=g.x-57+i*38;
    methodDot(x,dotsY,i<step?methodColors.student:'#344750',i===Math.min(3,step)?5:3,i<step);
    if(!mobile) methodText(String(i+1),x,dotsY+24,12,methodColors.muted);
  }
  methodFilm('student',v.x,v.y,v.w,-.035,opacity);
  methodText('Generated video',v.x,v.y+v.w*.577/2+35,mobile?22:24,methodColors.student,'center',500);
  if(!mobile) {
    methodText('4 denoising steps',551,467,15,methodColors.muted);
    methodText('Noise → structure → motion',958,439,16,methodColors.muted);
  }
}

function methodNoising() {
  const c=methodContext, mobile=methodMobile;
  const level=.12+.76*(.5-.5*Math.cos(methodClock/1500));
  const roles=['teacher','student','real'];
  roles.forEach((role,i)=>{
    const color=methodColors[role], label=['Cached teacher','Student output','Real data'][i];
    if(mobile) {
      const y=137+i*227;
      methodFilm(role,111,y,149,-.035,0,false);
      methodText(label,112,y-83,18,color,'center',500);
      methodLine(203,y,254,y,color);
      methodNoiseTile(270,y-45,107,88,level,role,true);
      methodText('xₜ',323,y+65,18,color);
    } else {
      const x=213+i*384;
      methodText(label,x,61,20,color,'center',500);
      methodFilm(role,x,170,253,-.035,0,false);
      methodPath([[x,255],[x,287],[x,296],[x,323]],color);
      methodNoiseTile(x-81,336,162,94,level,role,true);
      methodText(['xₜ teacher','xₜ student','xₜ real'][i],x,458,16,color);
    }
  });
  const y=mobile?766:522, x=mobile?75:408, w=mobile?270:384;
  c.save();c.strokeStyle='#314650';c.lineWidth=2;c.beginPath();c.moveTo(x,y);c.lineTo(x+w,y);c.stroke();c.restore();
  methodDot(x+w*level,y,methodColors.student,5);
  methodText('Shared noise level · t',mobile?210:600,y+31,mobile?18:15,methodColors.muted);
}

function methodClassify() {
  const mobile=methodMobile;
  const roles=['teacher','student','real'];
  if(mobile) {
    roles.forEach((role,i)=>{
      const x=75+i*135;
      methodFilm(role,x,102,91,-.04,.27,false);
      methodText(['Teacher','Student','Real'][i],x,164,16,methodColors[role]);
      methodPath([[x,187],[x,245],[210+(i-1)*29,241],[210+(i-1)*29,286]],methodColors[role],true,false,role);
    });
    methodPath([[145,473],[20,495],[15,662],[79,662]],methodColors.teacher);
    methodPath([[274,478],[410,495],[415,662],[284,662]],methodColors.real);
    methodNetwork(210,383,209,methodColors.student,true,6);
    methodText('Shared backbone',210,525,23,methodColors.ink,'center',500);
    methodHead(109,687,methodColors.teacher,'Teacher head','Teacher + / Student −');
    methodHead(314,687,methodColors.real,'Real head','Real + / Student −');
    methodText('Update D · student samples detached',210,799,17,methodColors.muted);
  } else {
    roles.forEach((role,i)=>{
      const y=117+i*166;
      methodFilm(role,158,y,153,-.04,.25,false);
      methodText(['Teacher','Student','Real data'][i],155,y+65,16,methodColors[role]);
      methodPath([[250,y],[344,y],[357,270+(i-1)*40],[479,270+(i-1)*40]],methodColors[role],true,false,role);
    });
    methodNetwork(601,272,268,methodColors.student,true,6);
    methodText('Shared backbone',612,472,25,methodColors.ink,'center',500);
    methodPath([[746,242],[803,242],[812,163],[908,163]],methodColors.teacher);
    methodPath([[746,320],[803,320],[812,393],[908,393]],methodColors.real);
    methodHead(974,163,methodColors.teacher,'Teacher head','Teacher +  /  Student −');
    methodHead(974,393,methodColors.real,'Real head','Real +  /  Student −');
    for(let j=0;j<2;j++) {
      const color=j?methodColors.real:methodColors.teacher, y=j?393:163;
      methodLine(1012,y,1100,y,color);
      for(let k=0;k<10;k++) methodDot(1112+(k%2)*15,y-32+Math.floor(k/2)*15,color,2,false);
    }
  }
}

function methodWeightCurve(x,y,w,h) {
  const c=methodContext, color=methodColors.real;
  const fn=p=>1/(1+Math.exp((p-.5)*7));
  c.save();c.strokeStyle='#3b4b57';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x,y+h);c.lineTo(x+w,y+h);c.stroke();
  const fill=c.createLinearGradient(0,y,0,y+h);fill.addColorStop(0,'#77e0cb28');fill.addColorStop(1,'#77e0cb00');
  c.beginPath();c.moveTo(x,y+h);
  for(let i=0;i<=100;i++)c.lineTo(x+w*i/100,y+h*(1-fn(i/100)));
  c.lineTo(x+w,y+h);c.closePath();c.fillStyle=fill;c.fill();
  c.beginPath();for(let i=0;i<=100;i++){const px=x+w*i/100,py=y+h*(1-fn(i/100));if(i===0)c.moveTo(px,py);else c.lineTo(px,py);}c.strokeStyle=methodColors.student;c.lineWidth=2.5;c.stroke();
  const phase=.5+.43*Math.sin(methodClock/1900), px=x+w*phase,py=y+h*(1-fn(phase));
  c.setLineDash([4,5]);c.strokeStyle=color+'66';c.beginPath();c.moveTo(px,y+h);c.lineTo(px,py);c.lineTo(x,py);c.stroke();c.setLineDash([]);
  methodDot(px,py,methodColors.student,5);
  c.restore();
  methodText('Raw teacher weight',x,y-28,18,methodColors.student,'left');
  methodText('Real–teacher gap →',x+w/2,y+h+30,methodMobile?18:17,methodColors.muted);
  methodText('Schematic',x+w,y-28,13,methodColors.muted,'right');
}

function methodReweight() {
  const mobile=methodMobile;
  if(mobile) {
    methodFilm('teacher',102,89,137,-.04,0,false);methodFilm('real',310,89,137,.025,0,false);
    methodText('Teacher',102,152,17,methodColors.teacher);methodText('Real',310,152,17,methodColors.real);
    methodPath([[102,174],[102,242],[126,277],[180,277]],methodColors.teacher);
    methodPath([[310,174],[403,238],[340,327],[180,327]],methodColors.real);
    methodHead(210,302,methodColors.real,'Same real head',methodFormulas.gap);
    methodWeightCurve(55,440,310,189);
    methodWeightBars(70,735,280,53);
  } else {
    methodFilm('teacher',165,149,182,-.04,0,false);methodFilm('real',165,394,182,-.02,0,false);
    methodText('Teacher',165,232,18,methodColors.teacher);methodText('Real data',165,477,18,methodColors.real);
    methodPath([[268,149],[337,149],[332,241],[426,241]],methodColors.teacher);
    methodPath([[268,394],[337,394],[332,291],[426,291]],methodColors.real);
    methodHead(456,266,methodColors.real,'Same real head',methodFormulas.gap);
    methodLine(503,266,631,266,methodColors.real);
    methodWeightCurve(688,102,413,270);
    methodWeightBars(714,471,364,47);
    methodText('Smaller gap. More teacher guidance.',874,34,22,methodColors.ink,'center',500);
  }
}

function methodWeightBars(x,y,w,h) {
  const c=methodContext;
  const values=Array.from({length:8},(_,i)=>1/(1+Math.exp(.32*Math.sin(i*.81+methodClock/2600)*7)));
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const bar=w/values.length;
  values.forEach((value,i)=>{
    const height=h*value/mean/2.1;
    c.fillStyle=i===Math.floor(methodClock/650)%8?methodColors.student:'#39655e';
    c.fillRect(x+i*bar,y+h-height,bar-10,height);
  });
  methodText('Normalize across noise bands · detach',x+w/2,y+h+28,methodMobile?17:15,methodColors.muted);
}

function methodDistill() {
  const color=methodColors.student, mobile=methodMobile;
  if(mobile) {
    methodNetwork(210,115,170,color,true,5,true);
    methodText('Update student',210,232,22,color,'center',500);
    methodFilm('student',100,334,132,-.04,0,false);
    methodText('Video preview',100,391,15,methodColors.muted);
    methodNoiseTile(280,294,71,75,.52,'student',true);
    methodText('Noisy latent',316,391,15,color);
    methodPath([[257,184],[316,209],[316,241],[316,285]],color,true,true);
    methodPath([[279,328],[248,328],[227,328],[181,328]],methodColors.muted,false);
    methodPath([[316,404],[316,435],[244,435],[244,471]],color,true,true);
    methodText('↑  Gradient flow',137,440,17,color);
    methodPath([[155,620],[19,670],[14,760],[74,760]],color,true,true);
    methodPath([[262,632],[404,670],[414,760],[286,760]],color,true,true);
    methodNetwork(210,555,169,methodColors.teacher,true,6,true);
    methodText('Discriminator · fixed',210,680,21,methodColors.muted);
    methodHead(104,785,methodColors.teacher,'Teacher head',methodFormulas.teacher,false);
    methodHead(316,785,methodColors.real,'Real head',methodFormulas.real,false);
    methodMathText(methodFormulas.loss,210,878,20,methodColors.muted);
  } else {
    methodNoiseTile(39,230,58,69,1);
    methodText('z',67,324,17,methodColors.muted);
    methodLine(103,263,154,263,color,false);
    methodNetwork(241,263,190,color,true,5,true);
    methodText('Update student',239,421,22,color,'center',500);
    methodFilm('student',465,157,162,-.025,0,false);
    methodText('Video preview',465,234,14,methodColors.muted);
    // RGB is a display-only branch; the gradient travels through the latent path below it.
    methodLine(331,310,570,310,color,true,true);
    methodDot(462,310,color,4);
    methodPath([[462,302],[462,290],[462,263],[462,246]],methodColors.muted,false);
    methodNoiseTile(574,269,76,82,.55,'student',true);
    methodText('Noisy latent',612,386,15,color);
    methodLine(657,310,710,310,color,true,true);
    methodNetwork(799,280,195,methodColors.teacher,true,6,true);
    methodText('Discriminator',808,421,22,methodColors.ink,'center',500);
    methodText('Parameters fixed',808,453,16,methodColors.muted);
    methodPath([[895,256],[940,256],[940,163],[1003,163]],color,true,true);
    methodPath([[895,326],[940,326],[940,365],[1003,365]],color,true,true);
    methodHead(1064,163,methodColors.teacher,'Teacher head',methodFormulas.teacher,false);
    methodHead(1064,365,methodColors.real,'Real head',methodFormulas.real,false);
    methodText('←  Gradient flow',540,459,18,color);
    methodMathText(methodFormulas.loss,881,526,23,methodColors.muted);
  }
}

function drawMethod() {
  const c=methodContext;
  updateMethodNoise();
  c.clearRect(0,0,methodWidth,methodHeight);
  const glow=c.createRadialGradient(methodWidth*.5,methodHeight*.48,0,methodWidth*.5,methodHeight*.48,methodWidth*.62);
  glow.addColorStop(0,'#12232d');glow.addColorStop(.65,'#0d1722');glow.addColorStop(1,'#0b121d');
  c.fillStyle=glow;c.fillRect(0,0,methodWidth,methodHeight);
  c.fillStyle='#6e9b9b18';
  for(let x=20;x<methodWidth;x+=32)for(let y=20;y<methodHeight;y+=32)c.fillRect(x,y,1,1);
  c.save();
  const fade=Math.min(1,methodElapsed/300);
  c.globalAlpha=methodPaused||methodScrubbing?1:Math.max(.1,fade);
  [methodGenerate,methodNoising,methodClassify,methodReweight,methodDistill][methodStage]();
  c.restore();
  const time=(methodDurations.slice(0,methodStage).reduce((sum,duration)=>sum+duration,0)+methodElapsed)/1000;
  methodSeek.value=time;
  methodTime.textContent=`${time.toFixed(1)} / ${(methodTotalDuration/1000).toFixed(1)} s`;
  methodSeek.setAttribute('aria-valuetext',`${time.toFixed(1)} of ${(methodTotalDuration/1000).toFixed(1)} seconds`);
}

function resizeMethod() {
  const width=methodCanvas.clientWidth;
  methodMobile=width<650;
  methodWidth=methodMobile?420:1200;
  methodHeight=methodMobile?900:570;
  methodCanvas.style.aspectRatio=`${methodWidth} / ${methodHeight}`;
  const ratio=Math.min(devicePixelRatio||1,2), scale=width/methodWidth;
  methodCanvas.width=Math.round(width*ratio);
  methodCanvas.height=Math.round(methodHeight*scale*ratio);
  methodContext.setTransform(methodCanvas.width/methodWidth,0,0,methodCanvas.height/methodHeight,0,0);
  drawMethod();
}

function setMethodStage(index, manual=false) {
  methodStage=index;
  methodElapsed=manual?1700:(methodPaused?methodDurations[index]*.8:0);
  methodPlayer.dataset.stage=String(index);
  const stage=methodStages[index];
  document.querySelector('#method-step-title').textContent=stage.title;
  document.querySelector('#method-step-description').textContent=stage.description;
  document.querySelector('#method-scene-number').textContent=`0${index+1} / 05`;
  document.querySelector('#student-state').textContent=stage.student;
  document.querySelector('#discriminator-state').textContent=stage.discriminator;
  document.querySelector('#student-state').classList.toggle('updating',stage.student==='Updating');
  document.querySelector('#discriminator-state').classList.toggle('updating',stage.discriminator==='Updating');
  methodButtons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  methodCanvas.setAttribute('aria-label',`${stage.title} ${stage.description}`);
  if(manual)methodPaused=true;
  resizeMethod();
  if(manual)syncMethodPlayback();
}

function tickMethod(now) {
  if(!methodPlaying)return;
  if(!methodLastTime)methodLastTime=now;
  const delta=Math.min(100,now-methodLastTime);
  if(delta>=1000/30) {
    methodLastTime=now;methodClock+=delta;methodElapsed+=delta;
    if(methodElapsed>=methodDurations[methodStage])setMethodStage((methodStage+1)%methodStages.length);
    drawMethod();
  }
  methodFrame=requestAnimationFrame(tickMethod);
}

function syncMethodPlayback() {
  const playing=!methodPaused&&!methodScrubbing&&methodVisible&&!document.hidden&&demoVideo.paused&&!dialog.open&&!comparisonPlaying;
  methodPlayer.dataset.playing=String(playing);
  methodPlay.textContent=methodPaused?'▶ Play animation':'Ⅱ Pause animation';
  methodPlay.setAttribute('aria-pressed',String(!methodPaused));
  Object.entries(methodMedia).forEach(([role,{video}])=>{
    if(playing) {
      if(!video.getAttribute('src'))video.src=`assets/method-motion/${role}.mp4`;
      if(video.paused)video.play().catch(()=>{});
    } else video.pause();
  });
  if(playing===methodPlaying)return;
  methodPlaying=playing;
  cancelAnimationFrame(methodFrame);methodLastTime=0;
  if(playing)methodFrame=requestAnimationFrame(tickMethod);
  else drawMethod();
}

methodButtons.forEach((button,index)=>{
  button.addEventListener('click',()=>setMethodStage(index,true));
  button.addEventListener('keydown',event=>{
    let next;
    if(event.key==='ArrowRight')next=(index+1)%5;
    if(event.key==='ArrowLeft')next=(index+4)%5;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=4;
    if(next===undefined)return;
    event.preventDefault();methodButtons[next].focus();setMethodStage(next,true);
  });
});
methodPlay.addEventListener('click',()=>{methodPaused=!methodPaused;syncMethodPlayback();});
function beginMethodSeek() {
  if(methodScrubbing)return;
  const requested=methodSeek.value;
  methodScrubbing=true;
  syncMethodPlayback();
  methodSeek.value=requested;
}
function finishMethodSeek() {
  if(!methodScrubbing)return;
  methodScrubbing=false;
  syncMethodPlayback();
}
methodSeek.addEventListener('pointerdown',beginMethodSeek);
methodSeek.addEventListener('input',()=>{
  beginMethodSeek();
  const time=Number(methodSeek.value)*1000;
  let stage=0,elapsed=time;
  while(stage<methodDurations.length-1&&elapsed>=methodDurations[stage])elapsed-=methodDurations[stage++];
  if(stage!==methodStage)setMethodStage(stage);
  methodElapsed=elapsed;
  methodClock=time;
  Object.entries(methodMedia).forEach(([role,{video}])=>{
    if(!video.getAttribute('src'))video.src=`assets/method-motion/${role}.mp4`;
    if(video.readyState>=1)video.currentTime=(time/1000)%video.duration;
  });
  drawMethod();
});
methodSeek.addEventListener('change',finishMethodSeek);
window.addEventListener('pointerup',finishMethodSeek);
window.addEventListener('pointercancel',finishMethodSeek);
new ResizeObserver(resizeMethod).observe(methodCanvas);
new IntersectionObserver(entries=>{methodVisible=entries[0].isIntersecting;syncMethodPlayback();},{threshold:.12}).observe(methodCanvas);
reducedMotion.addEventListener('change',event=>{methodPaused=event.matches;syncMethodPlayback();});
document.addEventListener('visibilitychange',syncMethodPlayback);
demoVideo.addEventListener('play',syncMethodPlayback);
demoVideo.addEventListener('pause',syncMethodPlayback);
dialog.addEventListener('close',syncMethodPlayback);
new MutationObserver(syncMethodPlayback).observe(dialog,{attributes:true,attributeFilter:['open']});
setMethodStage(0);
syncMethodPlayback();
