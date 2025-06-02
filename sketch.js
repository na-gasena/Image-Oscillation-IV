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
let glitchSteps   = 64;      // 量子化分解能 (4–64)
let periodicWave  = null;    // Web Audio の PeriodicWave インスタンス

// ––––– UI 要素 (HTML)
let freqLabel, freqSlider, ratioLabel, ratioSlider, glitchLabel, glitchSlider;  // p5.dom range input
let octaveUpBtn, octaveDownBtn; // オクターブ変更ボタン
let triggerModeBtn; // トリガーモード切替ボタン
let currentOctave = 0; // 現在のオクターブオフセット（-2から+2程度）

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

let prevPadIdx = null;
let prevPadY   = null;

let lastPlayedMidi = null;

let prevFreqSlider = null;
let prevRatioSlider = null;
let prevGlitchSlider = null;

let mouseKeyDownIndex = null; // マウスで押している鍵盤のインデックス

let keyIsDownMap = {}; // 例: {'a': true, 's': false, ...}

const midiKeyChars = ['a','w','s','e','d','f','t','g','y','h','u','j'];


/* ──  XY 描画用 ── */
let customTableR  = new Float32Array(TABLE_SIZE);   // 右チャンネル用
let crushedTableR = new Float32Array(TABLE_SIZE);   // 右チャンネル量子化

let editingXY  = false;   // XY お絵描きモード
let xyDrawPts  = [];      // XY で描いた点列
let xyDrawingUsed = false; // XYお絵描きが使用されたかどうか

let phaseCheckInterval = 0;    // 位相チェック用カウンター

let useAdaptiveTrigger = true; // 適応的トリガーの使用フラグ




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
  freqLabel   = createDiv('Freq').position(ytCXR-80, padY0-24).style('color', '#fff');
  freqSlider  = createSlider(0, 1000, freqToSlider(440), 1).position(ytCXR-80, padY0).style('width','150px');

  // オクターブボタン（Freqスライダーの下に配置）
  octaveDownBtn = createButton('-').position(ytCXR-80, padY0+35).size(30, 25);
  octaveUpBtn = createButton('+').position(ytCXR-45, padY0+35).size(30, 25);
  octaveDownBtn.mousePressed(() => changeOctave(-1));
  octaveUpBtn.mousePressed(() => changeOctave(1));
  octaveDownBtn.style('background-color', '#444').style('color', '#fff').style('border', '1px solid #666');
  octaveUpBtn.style('background-color', '#444').style('color', '#fff').style('border', '1px solid #666');

  ratioLabel  = createDiv('Ratio').position(ytCXL-80, padY0-24).style('color', '#fff');
  ratioSlider = createSlider(0.1, 4.0, 1.0, 0.01).position(ytCXL-80, padY0).style('width','150px');

  glitchLabel = createDiv('Glitch').position(ytCXL-80, padY0+16).style('color', '#fff');
  glitchSlider= createSlider(4, 64, 64, 1).position(ytCXL-80, padY0+40).style('width','150px');

  // ▼ デフォルト波形配列生成 (Sine)
  setDefaultWave('sine');
  applyGlitch();
  updateOscPeriodicWave();

  // ▼ AudioContext をユーザ操作で開始するためのヒント
  textSize(14); textAlign(LEFT, TOP);

  prevFreqSlider = freqSlider.value();
  prevRatioSlider = ratioSlider.value();
  prevGlitchSlider = glitchSlider.value();
  
  // 全スライダーの統一スタイル設定
  setupSliderStyles();
  updateSliderAppearance(false);
}

/*
──────────────────────────────────────────────
 毎フレーム描画: draw()
──────────────────────────────────────────────*/
function draw(){
  background(0);

  // --- スライダ値の反映 (リアルタイム) ---
  // スライダ値が変化した瞬間は必ず反映
  if(freqSlider.value() !== prevFreqSlider){
    const logFreq = sliderToFreq(freqSlider.value());
    setBaseFreq(logFreq);
    lastPlayedMidi = null; // スライダ操作時はlastPlayedMidiをリセット
    prevFreqSlider = freqSlider.value();
  }
  if(ratioSlider.value() !== prevRatioSlider){
    setRatio(ratioSlider.value());
    prevRatioSlider = ratioSlider.value();
  }
  if(glitchSlider.value() !== prevGlitchSlider){
    glitchSteps = glitchSlider.value();
    applyGlitch();
    prevGlitchSlider = glitchSlider.value();
  }

  // ––– トリガ位置 (零交差検出) を求める
  const trig = adaptiveTrigger(fftL.waveform(), fftR.waveform());

  // ––– 描画 (Processing と同じ順序)
  drawYTcircle(fftL.waveform(), ytCXL, ytCY, ytR, trig);
  drawYTcircle(fftR.waveform(), ytCXR, ytCY, ytR, trig);
  drawXY();
  drawCustomPad();
  drawUIKeys();
  drawUIWaveButtons();

  // ––– デバッグテキスト
  fill(255); noStroke();
  textAlign(LEFT, TOP);
  text(`Freq : ${baseFreq.toFixed(1)} Hz`, 25, 12);
  
  // 整数値の場合は強調表示
  const isIntegerRatio = Math.abs(ratio - Math.round(ratio)) < 0.001;
  if (isIntegerRatio) {
    fill(0, 255, 0); // 緑色で表示
    text(`Ratio: ${ratio.toFixed(0)} `, 25, 32);
  } else {
    fill(255); // 通常の白色
    text(`Ratio: ${ratio.toFixed(2)}`, 25, 32);
  }
  
  fill(255); // 以降のテキストは白色に戻す
  text(`Glitch: ${glitchSteps}`,           25, 52);
  text(`Octave: ${currentOctave >= 0 ? '+' : ''}${currentOctave}`, 25, 72);

  // ––– アルペジエータ (Up モード固定)
  const stepDur = 60000 / BPM_FIXED / DIV_FIXED;
  if(notesHeld.length > 0){
    if(millis() - lastStepMs >= stepDur){
      noteOn(notesHeld[arpIndex % notesHeld.length]);
      arpIndex = (arpIndex + 1) % notesHeld.length;
      lastStepMs = millis();
    }
  }

  // ––– 定期的な位相補正（周波数比が1.0の時のみ）
  phaseCheckInterval++;
  if (phaseCheckInterval >= 30 && Math.abs(ratio - 1.0) < 0.001) { // 約0.5秒間隔
    syncPhases();
    phaseCheckInterval = 0;
  }

  syncKeyboardNotes();
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
  // 整数値への吸着処理
  const snapThreshold = 0.05; // 吸着する閾値
  const nearestInteger = Math.round(r);
  
  let newRatio;
  let isSnapped = false;
  
  if (Math.abs(r - nearestInteger) <= snapThreshold) {
    // 整数値に近い場合は吸着
    newRatio = nearestInteger;
    isSnapped = true;
    // スライダーの値も更新（無限ループを避けるため、値が実際に変わる場合のみ）
    if (Math.abs(ratioSlider.value() - nearestInteger) > 0.001) {
      ratioSlider.value(nearestInteger);
      prevRatioSlider = nearestInteger; // prevRatioSliderも更新
    }
  } else {
    // 通常の丸め処理
    newRatio = Math.round(r * 100) / 100;
    isSnapped = false;
  }
  
  // スライダーのUI更新
  updateSliderAppearance(isSnapped);
  
  // 実際に比率が変わった場合のみ処理
  if (Math.abs(newRatio - ratio) > 0.001) {
    ratio = newRatio;
    oscR.freq(baseFreq * ratio);
    
    // 比率が1.0に戻った場合のみ位相を同期
    if (Math.abs(ratio - 1.0) < 0.001) {
      simpleSyncPhases();
    }
  }
}

// シンプルな位相同期関数
function simpleSyncPhases() {
  try {
    // 両チャンネルの位相を0にリセット
    oscL.phase(0);
    oscR.phase(0);
  } catch(e) {
    console.warn('位相同期エラー:', e);
  }
}

// 波形復元関数（現在の状態に応じて適切な波形を設定）
function restoreWaveforms() {
  if (xyDrawingUsed) {
    // XY描画が使用されている場合
    updateOscPeriodicWaveXY();
  } else {
    // 通常の波形（基本波形またはカスタム描画）
    updateOscPeriodicWave();
  }
}

// 位相同期関数（軽量版）
function syncPhases(){
  // 比率が1.0でない場合は同期を行わない
  if (Math.abs(ratio - 1.0) > 0.001) {
    return;
  }
  
  simpleSyncPhases();
}

function noteOn(midi){
  // オクターブオフセットを適用
  const adjustedMidi = midi + (currentOctave * 12);
  const f = midiToFreq(adjustedMidi); // p5.sound 付属
  setBaseFreq(f);
  lastPlayedMidi = midi; // 元のMIDIノートを保存（オフセット前）
}

// オクターブ変更機能
function changeOctave(direction) {
  // オクターブ範囲を制限（-3から+3）
  currentOctave = constrain(currentOctave + direction, -3, 3);
  
  // 現在演奏中のMIDIノートがある場合、オクターブ変更を適用
  if (lastPlayedMidi !== null) {
    const newMidi = lastPlayedMidi + (currentOctave * 12);
    const f = midiToFreq(newMidi);
    setBaseFreq(f);
    
    // スライダーの値も更新（対数スケール）
    freqSlider.value(freqToSlider(f));
    prevFreqSlider = freqSlider.value();
  }
}

/* －－ 波形関連 －－ */
function setDefaultWave(type){
  for(let i=0;i<TABLE_SIZE;i++){
    const t = i / (TABLE_SIZE - 1);
    if     (type==='sine')     customTable[i] = Math.sin(TWO_PI * t);
    else if(type==='triangle') customTable[i] = 1 - 4*Math.abs(t - 0.5);
    else if(type==='square')   customTable[i] = (t < 0.5 ? 1 : -1);
    // crushedTableの更新はapplyGlitch()で行う
  }
}
function applyGlitch(){
  const q = 2.0 / glitchSteps;
  for(let i=0;i<TABLE_SIZE;i++) crushedTable[i] = Math.round(customTable[i]/q)*q;
  
  // XYお絵描き後の場合は左チャンネルのみ更新、それ以外は左右リンク
  if (xyDrawingUsed) {
    updateOscPeriodicWaveLeft(); // 左チャンネルのみ更新
  } else {
    updateOscPeriodicWave(); // 従来通り左右リンク
  }
}
function updateOscPeriodicWave(){
  const ac    = getAudioContext();
  const N     = TABLE_SIZE;
  const harmonics = N/2;
  const real  = new Float32Array(harmonics);
  const imag  = new Float32Array(harmonics);

  // DC成分は0
  real[0] = 0;
  imag[0] = 0;

  // DFTで各ハーモニクス成分を計算
  for(let k=1;k<harmonics;k++){
    let sumRe = 0, sumIm = 0;
    for(let n=0;n<N;n++){
      const phase = TWO_PI * k * n / N;
      sumRe += crushedTable[n] * Math.cos(phase);
      sumIm += -crushedTable[n] * Math.sin(phase);
    }
    real[k] = sumRe / N;
    imag[k] = sumIm / N;
  }
  periodicWave = ac.createPeriodicWave(real, imag, {disableNormalization:true});
  oscL.oscillator.setPeriodicWave(periodicWave);
  oscR.oscillator.setPeriodicWave(periodicWave);
}

// 左チャンネルのみを更新する関数
function updateOscPeriodicWaveLeft(){
  const ac    = getAudioContext();
  const N     = TABLE_SIZE;
  const harmonics = N/2;
  const real  = new Float32Array(harmonics);
  const imag  = new Float32Array(harmonics);

  // DC成分は0
  real[0] = 0;
  imag[0] = 0;

  // DFTで各ハーモニクス成分を計算
  for(let k=1;k<harmonics;k++){
    let sumRe = 0, sumIm = 0;
    for(let n=0;n<N;n++){
      const phase = TWO_PI * k * n / N;
      sumRe += crushedTable[n] * Math.cos(phase);
      sumIm += -crushedTable[n] * Math.sin(phase);
    }
    real[k] = sumRe / N;
    imag[k] = sumIm / N;
  }
  const periodicWaveLeft = ac.createPeriodicWave(real, imag, {disableNormalization:true});
  oscL.oscillator.setPeriodicWave(periodicWaveLeft); // 左チャンネルのみ更新
}

function changeWaveIndex(idx){
  // idx: 0=Sine 1=Tri 2=Square
  const mapping = ['sine','triangle','square'];
  currentWave = mapping[idx];
  waveOn = waveOn.map((_, i) => i === idx);

  // XYお絵描きフラグをリセット（基本波形に戻したため）
  xyDrawingUsed = false;

  setDefaultWave(currentWave);          // customTable（L）を生成
                                        // ↓ ここから追加 ----------------
  for (let i = 0; i < TABLE_SIZE; i++) {
    customTableR[i]  = customTable[i];  // R も同じ波形で上書き
    crushedTableR[i] = crushedTable[i]; // Glitch 前の値もコピー
  }
                                        // ↑ ここまで追加 ----------------
  applyGlitch();                        // L 側量子化
  applyGlitchR();                       // R 側量子化
  updateOscPeriodicWaveXY();            // L/R の PeriodicWave を再適用
}


/*
──────────────────────────────────────────────
 入力イベント
──────────────────────────────────────────────*/
function keyPressed(){
  // 数字キー 1–3 → 波形切替
  if(key>='1' && key<='3') changeWaveIndex(int(key)-1);
  
  // オクターブ変更キー
  if(key === ';') changeOctave(1);  // +キーでオクターブアップ
  if(key === '-') changeOctave(-1); // =キーでオクターブダウン
  
  if(keyCode === TAB) return false;
}
function keyReleased(){
  // 何もしない（syncKeyboardNotesで全て管理するため）
}

function mousePressed(){
  // ▼ AudioContext を許可 (初回のみ)
  if(getAudioContext().state !== 'running') getAudioContext().resume();

  // ▼ 鍵盤クリック判定
  for(let i=0;i<12;i++){
    const kx = padX0 + padW * i / 4 - 120;
    if(dist(mouseX, mouseY, kx, keyY) < keyR){
      if(!uiKeyOn[i]){
        uiKeyOn[i] = true;
        const m = midiKeys[i];
        if(!notesHeld.includes(m)) notesHeld.push(m);
        arpIndex = 0;
      }
      mouseKeyDownIndex = i; // どの鍵盤を押したか記録
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
  if(inPad(mouseX, mouseY)) {
    editing = true;
    prevPadIdx = int(map(mouseX, padX0, padX0+padW, 0, TABLE_SIZE-1));
    prevPadIdx = constrain(prevPadIdx, 0, TABLE_SIZE-1);
    prevPadY   = mouseY;
    // 1点目も描画
    customTable[prevPadIdx]  = map(mouseY, padY0, padY0+padH, 1, -1);
    crushedTable[prevPadIdx] = customTable[prevPadIdx];
    applyGlitch();
  }

  // ▼ XY 描画開始判定
  if (!editing && mxInXY(mouseX, mouseY)) {
    editingXY = true;
    xyDrawPts = [{ x: mouseX, y: mouseY }];
    //xyDrawPts.push({ x: mouseX, y: mouseY }); //
  }
}

function mouseDragged(){
  if(editing && inPad(mouseX, mouseY)){
    let idx = int(map(mouseX, padX0, padX0+padW, 0, TABLE_SIZE-1));
    idx = constrain(idx, 0, TABLE_SIZE-1);
    let y  = mouseY;

    if(prevPadIdx !== null){
      // 線形補間
      let from = prevPadIdx;
      let to   = idx;
      if(from > to){ [from, to] = [to, from]; }
      for(let i=from; i<=to; i++){
        // yも線形補間
        let t = (to === from) ? 0 : (i - from) / (to - from);
        let interpY = prevPadY + (y - prevPadY) * t;
        customTable[i]  = map(interpY, padY0, padY0+padH, 1, -1);
        crushedTable[i] = customTable[i];
      }
    }else{
      customTable[idx]  = map(y, padY0, padY0+padH, 1, -1);
      crushedTable[idx] = customTable[idx];
    }
    prevPadIdx = idx;
    prevPadY   = y;
    applyGlitch();
  }

  if (editingXY && mxInXY(mouseX, mouseY)) {
    xyDrawPts.push({ x: mouseX, y: mouseY });
    updateTablesFromXY(xyDrawPts);      // ★リアルタイム更新
  }
  
  
}

function mouseReleased(){
  if(editing){
    editing = false;
    prevPadIdx = null;
    prevPadY   = null;
  }

  // ▼ 押していた鍵盤だけOFFにする
  if(mouseKeyDownIndex !== null){
    if(uiKeyOn[mouseKeyDownIndex]){
      uiKeyOn[mouseKeyDownIndex] = false;
      const m = midiKeys[mouseKeyDownIndex];
      notesHeld = notesHeld.filter(v=>v!==m);
      arpIndex = 0;
    }
    mouseKeyDownIndex = null;
  }

  if (editingXY) {
    editingXY = false;
    if (xyDrawPts.length > 4) {         // 十分点があれば
      updateTablesFromXY(xyDrawPts);    // ★最終確定
    }
  }  
  
}

/*
──────────────────────────────────────────────
 描画ヘルパ関数
──────────────────────────────────────────────*/
function drawXY(){
  noStroke(); fill(0, 15); rect(xyX0, xyY0, xySize, xySize);

  /* 波形表示エリアをグレー枠で囲む */
  stroke(180);
  noFill();
  rect(xyX0, xyY0, xySize, xySize);

  const left  = fftL.waveform();
  const right = fftR.waveform();
  
  // 波形データの安定化（移動平均による平滑化）
  const smoothLeft = smoothWaveform(left, 3);
  const smoothRight = smoothWaveform(right, 3);
  
  // 適応的トリガーまたはトリガーレス表示
  let startIdx = 0;
  if (useAdaptiveTrigger) {
    startIdx = adaptiveTrigger(smoothLeft, smoothRight);
  } else {
    // トリガーレス：時間基準で滑らかに進行
    const timeOffset = (millis() * 0.001 * baseFreq) % 1.0;
    startIdx = Math.floor(timeOffset * smoothLeft.length);
  }
  
  stroke(0, 255, 0); strokeWeight(2);
  
  // より安定した描画のため、適度な間隔でサンプリング
  const step = max(1, Math.floor(smoothLeft.length / 200));
  const n = smoothLeft.length;
  
  for(let i = 0; i < Math.floor(n / step); i++){
    const idx0 = (startIdx + i * step) % n;
    const idx1 = (startIdx + (i + 1) * step) % n;
    
    const px0 = map(smoothLeft[idx0],  -0.4, 0.4, xyX0, xyX0+xySize);
    const py0 = map(smoothRight[idx0], -0.4, 0.4, xyY0+xySize, xyY0);
    const px  = map(smoothLeft[idx1],  -0.4, 0.4, xyX0, xyX0+xySize);
    const py  = map(smoothRight[idx1], -0.4, 0.4, xyY0+xySize, xyY0);
    
    // 範囲外の点は描画しない
    if (px0 >= xyX0 && px0 <= xyX0+xySize && py0 >= xyY0 && py0 <= xyY0+xySize &&
        px >= xyX0 && px <= xyX0+xySize && py >= xyY0 && py <= xyY0+xySize) {
      line(px0, py0, px, py);
    }
  }
  
  // 位相情報表示（デバッグ用）
  fill(255, 150); noStroke();
  textAlign(LEFT, TOP);
  textSize(10);
  const currentPhase = phaseHistory.length > 0 ? 
    phaseHistory[phaseHistory.length - 1] * 180 / Math.PI : 0;
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
    
    // キーラベルを描画
    fill(255); // 白い文字
    textAlign(CENTER, CENTER);
    textSize(12);
    text(midiKeyChars[i].toUpperCase(), kx, keyY + keyR + 12);
  }
}

function drawUIWaveButtons(){
  for(let i=0;i<3;i++){
    fill(waveOn[i] ? color(0,255,0) : 50);
    noStroke(); circle(waveBtnX[i], waveBtnY, waveBtnR*2);
    
    // キーラベルを描画
    fill(255); // 白い文字
    textAlign(CENTER, CENTER);
    textSize(12);
    text((i + 1).toString(), waveBtnX[i], waveBtnY + waveBtnR + 12);
  }
}


/* ── XY 描画用関数 ── */
// XY 域内か判定
function mxInXY(x, y) {
  return x >= xyX0 && x <= xyX0 + xySize && y >= xyY0 && y <= xyY0 + xySize;
}

// 右チャンネル側の量子化
function applyGlitchR() {
  const q = 2.0 / glitchSteps;
  for (let i = 0; i < TABLE_SIZE; i++) {
    crushedTableR[i] = Math.round(customTableR[i] / q) * q;
  }
}

// 任意テーブル → PeriodicWave 生成
function createPW(tbl) {
  const N = TABLE_SIZE;
  const H = N / 2;
  const re = new Float32Array(H);
  const im = new Float32Array(H);
  for (let k = 1; k < H; k++) {
    let sr = 0, si = 0;
    for (let n = 0; n < N; n++) {
      const ph = TWO_PI * k * n / N;
      sr += tbl[n] * Math.cos(ph);
      si += -tbl[n] * Math.sin(ph);
    }
    re[k] = sr / N;
    im[k] = si / N;
  }
  return getAudioContext().createPeriodicWave(re, im, { disableNormalization: true });
}

// L/R を別々に更新
function updateOscPeriodicWaveXY() {
  oscL.oscillator.setPeriodicWave(createPW(crushedTable));
  oscR.oscillator.setPeriodicWave(createPW(crushedTableR));
}


function updateTablesFromXY(points){
  if (points.length < 2) return;

  // XYお絵描きが使用されたフラグを設定
  xyDrawingUsed = true;

  /* -------- マウス座標を直接 -1〜+1 にマップ -------- */
  const toNorm = p => ({
    x: map(p.x, xyX0, xyX0 + xySize, -1, 1, true),        // 左=−1 右=+1
    y: map(p.y, xyY0 + xySize, xyY0, 1, -1, true)         // 下=−1 上=+1
  });
  const norm    = points.map(toNorm);

  /* ---- 64 サンプル抽出（以前と同じリサンプリング） ---- */
  let seg = [], total = 0;
  for (let i = 1; i < norm.length; i++) {
    const d = dist(norm[i-1].x, norm[i-1].y, norm[i].x, norm[i].y);
    seg.push(d); total += d;
  }
  const step = total / (TABLE_SIZE - 1);
  let acc = 0, idx = 1;
  for (let s = 0; s < TABLE_SIZE; s++) {
    const tDist = s * step;
    while (acc + seg[idx - 1] < tDist && idx < seg.length) {
      acc += seg[idx - 1]; idx++;
    }
    const t = (tDist - acc) / seg[idx - 1];
    const x = lerp(norm[idx - 1].x, norm[idx].x, t);
    const y = lerp(norm[idx - 1].y, norm[idx].y, t);

    customTable[s] = x;                 // 左チャンネル
    const target   = (s * Math.round(ratio)) % TABLE_SIZE;
    customTableR[target] = -y;          // 右チャンネル（反転・巻き取り）
  }

  applyGlitch();
  applyGlitchR();
  updateOscPeriodicWaveXY();

  /* 位相ずれを防ぐ */
  oscL.phase(0);
  oscR.phase(0);
}





/* XY 点列を XY 領域にフィットさせる */
function normalizeXYPoints(points) {
  let minX = Infinity, maxX = -Infinity, 
      minY = Infinity, maxY = -Infinity;
  points.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  // 幅・高さを揃えて正方形に収める
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span   = max(spanX, spanY);       // 大きい方に合わせて等倍スケール
  const cx     = (minX + maxX) / 2;
  const cy     = (minY + maxY) / 2;

  // 中心を正方形中央へ移動し、-1〜+1 に収める
  return points.map(p => ({
    x: ((p.x - cx) / span) * 2,
    y: ((p.y - cy) / span) * 2
  }));
}




/* －－ ユーティリティ －－ */
function risingEdge(buf){
  // 従来の左チャンネル単独トリガー（フォールバック用）
  let maxIdx = 0;
  let maxVal = -Infinity;
  for(let i=0;i<buf.length;i++){
    if(buf[i] > maxVal){
      maxVal = buf[i];
      maxIdx = i;
    }
  }
  // 最大値の少し前から0クロス（負→正）を探す
  for(let offset=0; offset<buf.length; offset++){
    let i = (maxIdx + buf.length - offset) % buf.length;
    if(buf[(i-1+buf.length)%buf.length]<0 && buf[i]>=0){
      return i;
    }
  }
  return 0;
}

// 適応的トリガー検出（左右両チャンネル対応）
function adaptiveTrigger(bufL, bufR) {
  const ratioInt = Math.round(ratio);
  const isIntegerRatio = Math.abs(ratio - ratioInt) < 0.01;
  
  if (isIntegerRatio && Math.abs(ratio - 1.0) < 0.01) {
    // 周波数比 1:1 の場合 → 複合ゼロクロス検出
    return synchronizedTrigger(bufL, bufR);
  } else if (isIntegerRatio) {
    // 整数比の場合 → 周期的トリガー
    return periodicTrigger(bufL, bufR, ratioInt);
  } else {
    // 非整数比の場合 → 位相追跡トリガー
    return phaseTrackingTrigger(bufL, bufR);
  }
}

// 同期トリガー（1:1専用）
function synchronizedTrigger(bufL, bufR) {
  const n = bufL.length;
  let bestIdx = 0;
  let minPhaseDiff = Infinity;
  
  // 両チャンネルの零交差点を探す
  for (let i = 1; i < n; i++) {
    const crossL = (bufL[i-1] < 0 && bufL[i] >= 0);
    const crossR = (bufR[i-1] < 0 && bufR[i] >= 0);
    
    if (crossL || crossR) {
      // 位相差を計算（両チャンネルの値の差）
      const phaseDiff = Math.abs(bufL[i] - bufR[i]);
      if (phaseDiff < minPhaseDiff) {
        minPhaseDiff = phaseDiff;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

// 周期的トリガー（整数比用）
function periodicTrigger(bufL, bufR, ratioInt) {
  const n = bufL.length;
  const period = Math.floor(n / ratioInt);
  
  // 左チャンネルの主要周期でトリガー
  let maxCorr = -Infinity;
  let bestIdx = 0;
  
  for (let i = 0; i < period; i++) {
    const crossL = (bufL[i-1] < 0 && bufL[i] >= 0);
    if (crossL) {
      // 周期性の確認
      let correlation = 0;
      for (let j = 0; j < Math.min(period, n-i); j++) {
        correlation += bufL[i+j] * bufL[(i+period+j) % n];
      }
      if (correlation > maxCorr) {
        maxCorr = correlation;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

// 位相追跡トリガー（非整数比用）
let phaseHistory = [];
const PHASE_HISTORY_SIZE = 10;

function phaseTrackingTrigger(bufL, bufR) {
  const n = bufL.length;
  
  // 現在の推定位相差を計算
  let currentPhase = 0;
  let peakL = -Infinity, peakR = -Infinity;
  let peakIdxL = 0, peakIdxR = 0;
  
  for (let i = 0; i < n; i++) {
    if (bufL[i] > peakL) { peakL = bufL[i]; peakIdxL = i; }
    if (bufR[i] > peakR) { peakR = bufR[i]; peakIdxR = i; }
  }
  
  currentPhase = (peakIdxR - peakIdxL) / n * TWO_PI;
  
  // 位相履歴を更新
  phaseHistory.push(currentPhase);
  if (phaseHistory.length > PHASE_HISTORY_SIZE) {
    phaseHistory.shift();
  }
  
  // 平滑化された位相差を使用
  const avgPhase = phaseHistory.reduce((a, b) => a + b, 0) / phaseHistory.length;
  
  // 予測されるトリガー位置
  const predictedTrigger = (peakIdxL + avgPhase / TWO_PI * n) % n;
  
  // 最も近い零交差点を探す
  let bestIdx = Math.round(predictedTrigger);
  let minDist = Infinity;
  
  for (let offset = -n/4; offset <= n/4; offset++) {
    const i = Math.round((predictedTrigger + offset + n) % n);
    if (i > 0 && bufL[i-1] < 0 && bufL[i] >= 0) {
      const dist = Math.abs(offset);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }
  }
  
  return Math.round(bestIdx);
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

function smoothTable(table, windowSize=3){
  const N = table.length;
  const result = new Float32Array(N);
  for(let i=0;i<N;i++){
    let sum = 0, count = 0;
    for(let j=-Math.floor(windowSize/2); j<=Math.floor(windowSize/2); j++){
      let idx = i + j;
      if(idx >= 0 && idx < N){
        sum += table[idx];
        count++;
      }
    }
    result[i] = sum / count;
  }
  return result;
}

function smoothWaveform(waveform, windowSize=3){
  const N = waveform.length;
  const result = new Float32Array(N);
  const halfWindow = Math.floor(windowSize / 2);
  
  for(let i = 0; i < N; i++){
    let sum = 0;
    let count = 0;
    
    for(let j = -halfWindow; j <= halfWindow; j++){
      let idx = i + j;
      // 循環的に処理（位相連続性を保つ）
      if(idx < 0) idx += N;
      if(idx >= N) idx -= N;
      
      sum += waveform[idx];
      count++;
    }
    result[i] = sum / count;
  }
  return result;
}

function syncKeyboardNotes(){
  for(let i=0; i<midiKeyChars.length; i++){
    const k = midiKeyChars[i];
    const midi = midiKeys[i];
    if(keyIsDown(k.toUpperCase().charCodeAt(0)) || keyIsDown(k.toLowerCase().charCodeAt(0))){
      // 物理的に押されている
      if(!notesHeld.includes(midi)){
        notesHeld.push(midi);
        setUIKey(midi, true);
        arpIndex = 0;
      }
    }else{
      // 物理的に離されている
      if(notesHeld.includes(midi)){
        notesHeld = notesHeld.filter(v => v !== midi);
        setUIKey(midi, false);
        arpIndex = 0;
      }
    }
  }
}

// 全スライダーの統一スタイル設定
function setupSliderStyles() {
  const baseSliderStyle = `
    <style id="base-slider-style">
      input[type="range"] {
        -webkit-appearance: none !important;
        appearance: none !important;
        height: 8px !important;
        background: #666 !important;
        outline: none !important;
        border-radius: 4px !important;
        border: none !important;
      }
      input[type="range"]::-webkit-slider-track {
        -webkit-appearance: none !important;
        appearance: none !important;
        height: 8px !important;
        background: #666 !important;
        border-radius: 4px !important;
      }
      input[type="range"]::-moz-range-track {
        height: 8px !important;
        background: #666 !important;
        border-radius: 4px !important;
        border: none !important;
      }
    </style>
  `;
  
  // 既存のベーススタイルを削除してから新しいスタイルを追加
  const existingBaseStyle = document.getElementById('base-slider-style');
  if (existingBaseStyle) existingBaseStyle.remove();
  document.head.insertAdjacentHTML('beforeend', baseSliderStyle);
}

// スライダーの見た目を更新する関数
function updateSliderAppearance(isSnapped) {
  if (isSnapped) {
    // ratioSliderのみSNAP状態：特定のスライダーだけ緑色で大きなつまみ
    // まず、ratioSliderにユニークなクラスを追加
    ratioSlider.addClass('ratio-snapped');
    
    const snapStyle = `
      <style id="slider-thumb-style">
        /* 通常のスライダー */
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none !important;
          appearance: none !important;
          height: 18px !important;
          width: 18px !important;
          border-radius: 50% !important;
          background: #fff !important;
          border: 2px solid #888 !important;
          cursor: pointer !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
        }
        input[type="range"]::-moz-range-thumb {
          height: 18px !important;
          width: 18px !important;
          border-radius: 50% !important;
          background: #fff !important;
          border: 2px solid #888 !important;
          cursor: pointer !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
          -moz-appearance: none !important;
        }
        
        /* ratioSliderのSNAP状態のみ */
        input[type="range"].ratio-snapped::-webkit-slider-thumb {
          height: 24px !important;
          width: 24px !important;
          background: #00ff00 !important;
          border: 2px solid #fff !important;
          box-shadow: 0 0 8px rgba(0, 255, 0, 0.5) !important;
        }
        input[type="range"].ratio-snapped::-moz-range-thumb {
          height: 24px !important;
          width: 24px !important;
          background: #00ff00 !important;
          border: 2px solid #fff !important;
          box-shadow: 0 0 8px rgba(0, 255, 0, 0.5) !important;
        }
      </style>
    `;
    
    // 既存のスタイルを削除してから新しいスタイルを追加
    const existingStyle = document.getElementById('slider-thumb-style');
    if (existingStyle) existingStyle.remove();
    document.head.insertAdjacentHTML('beforeend', snapStyle);
    
  } else {
    // ratioSliderのクラスを削除
    ratioSlider.removeClass('ratio-snapped');
    
    // 全スライダーの通常状態：統一された白いつまみ
    const normalStyle = `
      <style id="slider-thumb-style">
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none !important;
          appearance: none !important;
          height: 18px !important;
          width: 18px !important;
          border-radius: 50% !important;
          background: #fff !important;
          border: 2px solid #888 !important;
          cursor: pointer !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
        }
        input[type="range"]::-moz-range-thumb {
          height: 18px !important;
          width: 18px !important;
          border-radius: 50% !important;
          background: #fff !important;
          border: 2px solid #888 !important;
          cursor: pointer !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
          -moz-appearance: none !important;
        }
      </style>
    `;
    
    // 既存のスタイルを削除してから新しいスタイルを追加
    const existingStyle = document.getElementById('slider-thumb-style');
    if (existingStyle) existingStyle.remove();
    document.head.insertAdjacentHTML('beforeend', normalStyle);
  }
}

function freqToSlider(frequency) {
  // 周波数(20-5000Hz)をスライダー値(0-1000)に変換
  const minFreq = 20;
  const maxFreq = 5000;
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const logValue = Math.log(Math.max(minFreq, Math.min(maxFreq, frequency)));
  return Math.round((logValue - logMin) / (logMax - logMin) * 1000);
}

// 周波数スライダーの対数変換関数
function sliderToFreq(sliderValue) {
  // スライダー値(0-1000)を周波数(20-5000Hz)の対数スケールに変換
  const minFreq = 20;
  const maxFreq = 5000;
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const logValue = logMin + (sliderValue / 1000) * (logMax - logMin);
  return Math.exp(logValue);
}
