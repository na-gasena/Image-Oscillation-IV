// osciRender_p5_sketch.js – p5.js 移植版 (Processing → p5.js)
// 依存: p5.js + p5.sound (CDN)、本ファイルを index.html から読み込むだけで動作します。
// 機能: 2ch VCO, XY/Lissajous, Y‑T 波形表示, 波形エディタ, アルペジエータ, UI スライダ

let oscL, oscR, fftL, fftR;
let baseFreq = 440;
let ratio = 1.0;
let currentWave = 'sine'; // 'sine','triangle','square','custom'
let tableSize = 64;
let customTable = new Float32Array(tableSize);
let crushedTable = new Float32Array(tableSize);
let glitchSteps = 16;

// UI
let freqSlider, ratioSlider, glitchSlider;
let waveRadios;

// 可視化用
let xySize;
let xyX0, xyY0;
let ytR, ytCY, ytCXL, ytCXR;

// キーボード & アルペジエータ
const midiKeys = [60,61,62,63,64,65,66,67,68,69,70,71];
let uiKeyOn = new Array(12).fill(false);
let notesHeld = [];
let arpIndex = 0;
const BPM_FIXED = 135;
const DIV_FIXED = 4;
let lastStepMs = 0;

function setup(){
  createCanvas(1280,720);
  // ---------- Oscillators & Analyzer ----------
  oscL = new p5.Oscillator('sine');
  oscR = new p5.Oscillator('sine');
  oscL.pan(-1); oscR.pan(1); // ステレオ定位
  oscL.start(); oscR.start();
  fftL = new p5.FFT(0, 1024); fftL.setInput(oscL);
  fftR = new p5.FFT(0, 1024); fftR.setInput(oscR);

  // ---------- UI ----------
  freqSlider = createSlider(20, 5000, 440, 1).position(20, height-110).style('width','200px');
  ratioSlider = createSlider(0.1, 4.0, 1.0, 0.01).position(20, height-80).style('width','200px');
  glitchSlider = createSlider(4, 64, 16, 1).position(20, height-50).style('width','200px');
  waveRadios = createRadio().position(250, height-100);
  waveRadios.option('Sine','sine');
  waveRadios.option('Triangle','triangle');
  waveRadios.option('Square','square');
  waveRadios.option('Custom','custom');
  waveRadios.selected('sine');

  // ---------- 座標レイアウト ----------
  ytR = (height*0.25 - 20)/2;
  ytCY = ytR + 50;
  ytCXL = ytR + 150;
  ytCXR = width - ytR - 150;

  xySize = height*0.5;
  xyX0 = (width-xySize)/2;
  xyY0 = ytCY + ytR - 30;

  // ---------- デフォルト波形 ----------
  setDefaultWave('sine');
  applyGlitch();
}

function draw(){
  background(0);

  // ------ パラメータ反映 ------
  if(freqSlider.value() !== baseFreq){
    setBaseFreq(freqSlider.value());
  }
  if(ratioSlider.value() !== ratio){
    setRatio(ratioSlider.value());
  }
  if(glitchSlider.value() !== glitchSteps){
    glitchSteps = glitchSlider.value();
    applyGlitch();
  }
  if(waveRadios.value() !== currentWave){
    changeWave(waveRadios.value());
  }

  // ------ 可視化 ------
  drawYTcircle(fftL.waveform(), ytCXL, ytCY, ytR);
  drawYTcircle(fftR.waveform(), ytCXR, ytCY, ytR);
  drawXY();
  drawCustomPad();
  drawUIKeys();

  fill(255);
  noStroke();
  text(`Freq: ${baseFreq.toFixed(1)}Hz`, 10, 20);
  text(`Ratio: ${ratio.toFixed(2)}`, 10, 40);
  text(`Glitch: ${glitchSteps}`, 10, 60);

  // ------ アルペジエータ ------
  const stepDur = 60000 / BPM_FIXED / DIV_FIXED;
  if(millis() - lastStepMs >= stepDur && notesHeld.length>0){
    noteOn(notesHeld[arpIndex % notesHeld.length]);
    arpIndex++;
    lastStepMs = millis();
  }
}

function keyPressed(){
  // 波形切替 1–4
  if(key==='1'||key==='2'||key==='3'||key==='4'){
    const mapping = { '1':'sine','2':'triangle','3':'square','4':'custom' };
    waveRadios.selected(mapping[key]);
    changeWave(mapping[key]);
  }
  // UI キーボード
  const m = keyToMidi(key);
  if(m>=0 && !notesHeld.includes(m)){
    notesHeld.push(m);
    setUIKey(m,true);
  }
}

function keyReleased(){
  const m = keyToMidi(key);
  if(m>=0){
    notesHeld = notesHeld.filter(n=>n!==m);
    arpIndex = 0;
    setUIKey(m,false);
  }
}

function mousePressed(){
  // Custom pad 編集
  if(inPad(mouseX, mouseY)) editing=true;
}

function mouseDragged(){
  if(editing && inPad(mouseX, mouseY)){
    const idx = int(map(mouseX, padX0, padX0+padW, 0, tableSize-1));
    customTable[idx] = map(mouseY, padY0, padY0+padH, 1, -1);
    crushedTable[idx] = customTable[idx];
  }
}

function mouseReleased(){
  if(editing){ editing=false; applyGlitch(); }
}

// -------------------- オーディオ関連 --------------------
function setBaseFreq(f){
  baseFreq = f;
  oscL.freq(baseFreq);
  oscR.freq(baseFreq*ratio);
}
function setRatio(r){
  ratio = r;
  oscR.freq(baseFreq*ratio);
}
function noteOn(midi){
  const f = 440 * Math.pow(2, (midi-69)/12);
  setBaseFreq(f);
}
function changeWave(w){
  currentWave = w;
  if(w==='custom'){
    const oscTable = new p5.WaveTable(customTable);
    oscL.setPeriodicWave(oscTable);
    oscR.setPeriodicWave(oscTable);
  } else {
    oscL.setType(w);
    oscR.setType(w);
  }
}
function setDefaultWave(type){
  for(let i=0;i<tableSize;i++){
    const t = i/(tableSize-1);
    switch(type){
      case 'sine': customTable[i] = Math.sin(TWO_PI*t); break;
      case 'triangle': customTable[i] = 1-4*Math.abs(t-0.5); break;
      case 'square': customTable[i] = t<0.5?1:-1; break;
    }
    crushedTable[i]=customTable[i];
  }
}
function applyGlitch(){
  const q = 2.0/glitchSteps;
  for(let i=0;i<tableSize;i++){
    crushedTable[i] = Math.round(customTable[i]/q)*q;
  }
  if(currentWave==='custom'){
    const tbl = new p5.WaveTable(crushedTable);
    oscL.setPeriodicWave(tbl);
    oscR.setPeriodicWave(tbl);
  }
}

// -------------------- 可視化 --------------------
function drawXY(){
  noStroke(); fill(0,15); rect(xyX0,xyY0,xySize,xySize);
  const left = fftL.waveform();
  const right = fftR.waveform();
  stroke(0,255,0); strokeWeight(2);
  for(let i=1;i<left.length;i++){
    const px0 = map(left[i-1], -1,1, xyX0, xyX0+xySize);
    const py0 = map(right[i-1],-1,1, xyY0+xySize, xyY0);
    const px  = map(left[i],   -1,1, xyX0, xyX0+xySize);
    const py  = map(right[i],  -1,1, xyY0+xySize, xyY0);
    line(px0,py0,px,py);
  }
}
function drawYTcircle(buf,cx,cy,r){
  stroke(180); noFill(); circle(cx,cy,2*r);
  stroke(255); noFill(); beginShape();
  for(let i=0;i<buf.length;i++){
    const px = map(buf[i], -1,1, cx-r, cx+r);
    const py = map(i,0,buf.length-1, cy+r*0.9, cy-r*0.9);
    if(dist(px,py,cx,cy)<=r) vertex(px,py);
  }
  endShape();
}

// -------------------- Custom Wave Pad --------------------
let padW, padH, padX0, padY0, editing=false;
function drawCustomPad(){
  padW = xySize*0.4; padH=90;
  padX0 = (width-padW)/2; padY0 = xyY0+xySize+10;
  stroke(180); noFill(); rect(padX0,padY0,padW,padH);
  stroke(255); noFill(); beginShape();
  for(let i=0;i<tableSize;i++){
    const x = map(i,0,tableSize-1,padX0,padX0+padW);
    const y = map(crushedTable[i], -1,1, padY0+padH, padY0);
    vertex(x,y);
  }
  endShape();
}
function inPad(mx,my){
  return mx>=padX0 && mx<=padX0+padW && my>=padY0 && my<=padY0+padH;
}

// -------------------- Keyboard Helpers --------------------
function keyToMidi(k){
  switch(k){
    case 'a':return 60;case 'w':return 61;case 's':return 62;case 'e':return 63;
    case 'd':return 64;case 'f':return 65;case 't':return 66;case 'g':return 67;
    case 'y':return 68;case 'h':return 69;case 'u':return 70;case 'j':return 71;
    default:return -1;
  }
}
function setUIKey(midi,on){
  const idx = midiKeys.indexOf(midi);
  if(idx>=0) uiKeyOn[idx]=on;
}
function drawUIKeys(){
  const keyY = padY0 + padH + 40;
  const keyR = 15;
  for(let i=0;i<12;i++){
    const keyX = padX0 + padW * i / 4 - 120;
    fill(uiKeyOn[i]?color(0,255,0):50);
    noStroke(); circle(keyX,keyY,keyR*2);
  }
}
