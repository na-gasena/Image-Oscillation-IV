// osciRender_p5_sketch.js – Processing 版スケッチを p5.js + p5.sound へフルポーティング
// 必要ライブラリ: p5.js 1.9.x 以上 + p5.sound 1.5.x 以上 (CDN)
// 2025-06-01 時点でのブラウザ動作を確認。

/*
──────────────────────────────────────────────
 グローバル変数
──────────────────────────────────────────────*/
let oscL, oscR;            // 左右独立オシレータ
let fftL, fftR;            // 波形可視化用 FFT (waveform モードだけ使用)
let baseFreq = 440;        // ベース周波数 (Hz)
let ratio    = 1.0;        // 右チャンネルの周波数比
let currentWave = 'sine';  // 'sine' | 'triangle' | 'square' | 'custom'

// カスタム波形テーブル
const TABLE_SIZE = 64;
let customTable   = new Float32Array(TABLE_SIZE);
let crushedTable  = new Float32Array(TABLE_SIZE);
let glitchSteps   = 16;      // 量子化分解能 (4–64)
let periodicWave  = null;    // Web Audio の PeriodicWave インスタンス

// ––––– UI 要素 (HTML)
let freqSlider, ratioSlider, glitchSlider;  // p5.dom range input

// ––––– レイアウト座標 (Processing 版に合わせて計算)
let ytR, ytCY, ytCXL, ytCXR; // Y‑T 円表示の中心・半径
let xySize, xyX0, xyY0;      // XY プロット領域
let padW, padH, padX0, padY0;// 波形エディタパッド
let keyY, keyR = 15;         // 画面下 UI 鍵盤円
let waveBtnY, waveBtnR = 20; // 波形切替ボタン (円)
let waveBtnX = [];           // X 座標配列 (3 個)

// ––––– UI 状態
const midiKeys = [60,61,62,63,64,65,66,67,68,69,70,71];
let uiKeyOn   = new Array(12).fill(false);
let notesHeld = [];          // アルペジエータ入力ノート
let arpIndex  = 0;
const BPM_FIXED = 135;
const DIV_FIXED = 4;
let lastStepMs = 0;
let waveOn     = [true, false, false]; // 波形ボタンの ON/OFF

// ––––– 編集フラグ
let editing    = false;      // カスタム波形描画中か

/*
──────────────────────────────────────────────
 初期化: setup()
──────────────────────────────────────────────*/
function setup(){
  createCanvas(1280, 720);
  pixelDensity(1);

  // ▼ オシレータ初期化 (デフォルト Sine, hard‑pan L/R)
  oscL = new p5.Oscillator('sine');
  oscR = new p5.Oscillator('sine');
  oscL.amp(0.5); oscR.amp(0.5);
  oscL.pan(-1);  oscR.pan( 1);
  oscL.start();  oscR.start();

  // ▼ FFT (waveform) – バッファ長 1024 サンプル
  fftL = new p5.FFT(0, 1024); fftL.setInput(oscL);
  fftR = new p5.FFT(0, 1024); fftR.setInput(oscR);

  // ▼ レイアウト計算 (Processing スケッチと同じ式)
  ytR    = (height * 0.25 - 20) / 2;
  ytCY   = ytR + 50;
  ytCXL  = ytR + 150;
  ytCXR  = width - ytR - 150;

  xySize = height * 0.50;
  xyX0   = (width - xySize) / 2;
  xyY0   = ytCY + ytR - 30;

  padW   = xySize * 0.4;
  padH   = 90;
  padX0  = (width - padW) / 2;
  padY0  = xyY0 + xySize + 10;

  keyY   = padY0 + padH + 40;

  waveBtnY = xyY0 + 130;
  const startX = ytCXL - 70;
  for(let i=0;i<3;i++) waveBtnX[i] = startX + i * (waveBtnR*2 + 20);

  // ▼ HTML Range スライダ UI
  freqSlider   = createSlider(20, 5000, 440, 1).position(10, 10).style('width','150px');
  ratioSlider  = createSlider(0.1, 4.0, 1.0, 0.01).position(10, 40).style('width','150px');
  glitchSlider = createSlider(4, 64, 16, 1).position(10, 70).style('width','150px');

  // ▼ デフォルト波形配列生成 (Sine)
  setDefaultWave('sine');
  applyGlitch();
  updateOscPeriodicWave();

  // ▼ AudioContext をユーザ操作で開始するためのヒント
  textSize(14); textAlign(LEFT, TOP);
}

/*
──────────────────────────────────────────────
 毎フレーム描画: draw()
──────────────────────────────────────────────*/
function draw(){
  background(0);

  // ––– スライダ値の反映 (リアルタイム)
  if(freqSlider.value() !== baseFreq)   setBaseFreq(freqSlider.value());
  if(ratioSlider.value() !== ratio)     setRatio(ratioSlider.value());
  if(glitchSlider.value() !== glitchSteps){ glitchSteps = glitchSlider.value(); applyGlitch(); }

  // ––– トリガ位置 (零交差検出) を求める
  const trig = risingEdge(fftL.waveform());

  // ––– 描画 (Processing と同じ順序)
  drawYTcircle(fftL.waveform(), ytCXL, ytCY, ytR, trig);
  drawYTcircle(fftR.waveform(), ytCXR, ytCY, ytR, trig);
  drawXY();
  drawCustomPad();
  drawUIKeys();
  drawUIWaveButtons();

  // ––– デバッグテキスト
  fill(255); noStroke();
  text(`Freq : ${baseFreq.toFixed(1)} Hz`, 180, 12);
  text(`Ratio: ${ratio.toFixed(2)}`,       180, 32);
  text(`Glitch: ${glitchSteps}`,           180, 52);

  // ––– アルペジエータ (Up モード固定)
  const stepDur = 60000 / BPM_FIXED / DIV_FIXED;
  if(millis() - lastStepMs >= stepDur && notesHeld.length > 0){
    noteOn(notesHeld[arpIndex % notesHeld.length]);
    arpIndex++;
    lastStepMs = millis();
  }
}

/*
──────────────────────────────────────────────
 オーディオ制御関数
──────────────────────────────────────────────*/
function setBaseFreq(f){
  baseFreq = f;
  oscL.freq(baseFreq);
  oscR.freq(baseFreq * ratio);
}
function setRatio(r){
  ratio = r;
  oscR.freq(baseFreq * ratio);
}
function noteOn(midi){
  const f = midiToFreq(midi); // p5.sound 付属
  setBaseFreq(f);
}

/* －－ 波形関連 －－ */
function setDefaultWave(type){
  for(let i=0;i<TABLE_SIZE;i++){
    const t = i / (TABLE_SIZE - 1);
    if     (type==='sine')     customTable[i] = Math.sin(TWO_PI * t);
    else if(type==='triangle') customTable[i] = 1 - 4*Math.abs(t - 0.5);
    else if(type==='square')   customTable[i] = (t < 0.5 ? 1 : -1);
    crushedTable[i] = customTable[i];
  }
}
function applyGlitch(){
  const q = 2.0 / glitchSteps;
  for(let i=0;i<TABLE_SIZE;i++) crushedTable[i] = Math.round(customTable[i]/q)*q;
  if(currentWave==='custom') updateOscPeriodicWave();
}
function updateOscPeriodicWave(){
  // customTable/crushedTable → Web Audio PeriodicWave に変換 (DFT)
  const ac    = getAudioContext();
  const N     = TABLE_SIZE;
  const real  = new Float32Array(N);
  const imag  = new Float32Array(N);
  for(let k=0;k<N;k++){
    let sumRe = 0, sumIm = 0;
    for(let n=0;n<N;n++){
      const phase = TWO_PI * k * n / N;
      sumRe += crushedTable[n] * Math.cos(phase);
      sumIm += -crushedTable[n] * Math.sin(phase);
    }
    real[k] = sumRe / N;
    imag[k] = sumIm / N;
  }
  periodicWave = ac.createPeriodicWave(real, imag, {disableNormalization:false});
  oscL.oscillator.setPeriodicWave(periodicWave);
  oscR.oscillator.setPeriodicWave(periodicWave);
}

function changeWaveIndex(idx){
  // idx: 0=Sine 1=Tri 2=Square 3=Custom
  const mapping = ['sine','triangle','square','custom'];
  currentWave = mapping[idx];
  waveOn = waveOn.map((_,i)=>i===idx);
  if(currentWave==='custom'){
    updateOscPeriodicWave();
  } else {
    oscL.setType(currentWave);
    oscR.setType(currentWave);
  }
}

/*
──────────────────────────────────────────────
 入力イベント
──────────────────────────────────────────────*/
function keyPressed(){
  // 数字キー 1–4 → 波形切替
  if(key>='1' && key<='4') changeWaveIndex(int(key)-1);

  // MIDI キー
  const m = keyToMidi(key);
  if(m>=0 && !notesHeld.includes(m)){
    notesHeld.push(m);
    setUIKey(m, true);
  }

  // TAB キーのブラウザ挙動を防止
  if(keyCode === TAB) return false;
}
function keyReleased(){
  const m = keyToMidi(key);
  if(m>=0){
    notesHeld = notesHeld.filter(v=>v!==m);
    setUIKey(m,false);
    arpIndex = 0;
  }
}

function mousePressed(){
  // ▼ AudioContext を許可 (初回のみ)
  if(getAudioContext().state !== 'running') getAudioContext().resume();

  // ▼ 鍵盤クリック判定
  for(let i=0;i<12;i++){
    const kx = padX0 + padW * i / 4 - 120;
    if(dist(mouseX, mouseY, kx, keyY) < keyR){
      uiKeyOn[i] = !uiKeyOn[i];
      const m = midiKeys[i];
      if(uiKeyOn[i]){
        if(!notesHeld.includes(m)) notesHeld.push(m);
      } else {
        notesHeld = notesHeld.filter(v=>v!==m);
        arpIndex = 0;
      }
      return;
    }
  }

  // ▼ 波形切替ボタン判定
  for(let i=0;i<3;i++){
    if(dist(mouseX, mouseY, waveBtnX[i], waveBtnY) < waveBtnR){
      changeWaveIndex(i);
      return;
    }
  }

  // ▼ カスタム波形パッド開始
  if(inPad(mouseX, mouseY)) editing = true;
}

function mouseDragged(){
  if(editing && inPad(mouseX, mouseY)){
    let idx = int(map(mouseX, padX0, padX0+padW, 0, TABLE_SIZE-1));
    idx = constrain(idx, 0, TABLE_SIZE-1);
    customTable[idx]  = map(mouseY, padY0, padY0+padH, 1, -1);
    crushedTable[idx] = customTable[idx];
  }
}

function mouseReleased(){
  if(editing){ editing = false; applyGlitch(); }
}

/*
──────────────────────────────────────────────
 描画ヘルパ関数
──────────────────────────────────────────────*/
function drawXY(){
  noStroke(); fill(0, 15); rect(xyX0, xyY0, xySize, xySize);
  const left  = fftL.waveform();
  const right = fftR.waveform();
  stroke(0, 255, 0); strokeWeight(2);
  for(let i=1;i<left.length;i++){
    const px0 = map(left[i-1],  -1,1, xyX0, xyX0+xySize);
    const py0 = map(right[i-1], -1,1, xyY0+xySize, xyY0);
    const px  = map(left[i],    -1,1, xyX0, xyX0+xySize);
    const py  = map(right[i],   -1,1, xyY0+xySize, xyY0);
    line(px0, py0, px, py);
  }
}

function drawYTcircle(buf, cx, cy, r, startIdx){
  stroke(180); noFill(); circle(cx, cy, 2*r);
  stroke(255); noFill(); beginShape();
  const n = buf.length;
  for(let i=0;i<n;i++){
    const idx = (startIdx + i) % n;
    const px = map(buf[idx], -1,1, cx-r, cx+r);
    const py = map(i, 0, n-1, cy+r*0.9, cy-r*0.9);
    if(dist(px, py, cx, cy) <= r) vertex(px, py);
  }
  endShape();
}

function drawCustomPad(){
  stroke(180); noFill(); rect(padX0, padY0, padW, padH);
  stroke(255); noFill(); beginShape();
  for(let i=0;i<TABLE_SIZE;i++){
    const x = map(i, 0, TABLE_SIZE-1, padX0, padX0+padW);
    const y = map(crushedTable[i], -1,1, padY0+padH, padY0);
    vertex(x, y);
  }
  endShape();
}

function drawUIKeys(){
  for(let i=0;i<12;i++){
    const kx = padX0 + padW * i / 4 - 120;
    fill(uiKeyOn[i] ? color(0,255,0) : 50);
    noStroke(); circle(kx, keyY, keyR*2);
  }
}

function drawUIWaveButtons(){
  for(let i=0;i<3;i++){
    fill(waveOn[i] ? color(0,255,0) : 50);
    noStroke(); circle(waveBtnX[i], waveBtnY, waveBtnR*2);
  }
}

/* －－ ユーティリティ －－ */
function risingEdge(buf){
  for(let i=1;i<buf.length;i++) if(buf[i-1]<0 && buf[i]>=0) return i;
  return 0;
}
function inPad(mx,my){
  return mx>=padX0 && mx<=padX0+padW && my>=padY0 && my<=padY0+padH;
}
function keyToMidi(k){
  switch(k){
    case 'a':return 60; case 'w':return 61; case 's':return 62; case 'e':return 63;
    case 'd':return 64; case 'f':return 65; case 't':return 66; case 'g':return 67;
    case 'y':return 68; case 'h':return 69; case 'u':return 70; case 'j':return 71;
    default:return -1;
  }
}
function setUIKey(midi,on){
  const idx = midiKeys.indexOf(midi);
  if(idx>=0) uiKeyOn[idx] = on;
}
