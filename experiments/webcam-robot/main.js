import './style.css';
import * as THREE from 'three';
import { PARTS, point, visibleParts, demoLandmarks } from './pose.js';

const $ = id => document.getElementById(id);
const video = $('video'), photo = $('photo'), guide = $('guide');
const source = document.createElement('canvas');
const status = message => { $('status').textContent = message; };
let stream, detector, detectorPromise, landmarks = [], generation = 0;
let width = 640, height = 480, capturing = false;
let timings = {}, available = [];
const ratios = Object.fromEntries(PARTS.map(p => [p.id, 0]));
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, width, height, 0, .1, 2000);
camera.position.z = 1000;
scene.add(new THREE.HemisphereLight(0xe3ffe9, 0x314a3a, 3));
const light = new THREE.DirectionalLight(0xffffff, 4);
light.position.set(-300, 500, 800); scene.add(light);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('robot'), alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
} catch {
  status('WebGL2를 사용할 수 없습니다. 다른 브라우저에서 다시 열어주세요.');
}
const robotGroup = new THREE.Group(); scene.add(robotGroup);
const meshes = [];
const geometry = new THREE.BoxGeometry(1, 1, 1);

function stopCamera() {
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined; video.srcObject = null; video.hidden = true;
  $('capture').disabled = true;
}
function setSize(w, h) {
  width = w; height = h;
  for (const canvas of [photo, source, guide]) { canvas.width = w; canvas.height = h; }
  $('stage').style.aspectRatio = `${w}/${h}`;
  camera.right = w; camera.top = h; camera.updateProjectionMatrix();
  renderer?.setSize(w, h, false);
}
function clearMeshes() {
  for (const mesh of meshes) { robotGroup.remove(mesh); mesh.material.dispose(); }
  meshes.length = 0;
}
function material(part) {
  return new THREE.MeshStandardMaterial({ color: part === 'torso' ? 0xa3b9b0 : 0x91ac9f, metalness: .7, roughness: .3, transparent: true });
}
function segment(a, b, thickness, part) {
  const p = point(a, width, height), q = point(b, width, height);
  const length = Math.hypot(q.x-p.x, q.y-p.y);
  if (length < 1) return;
  const mesh = new THREE.Mesh(geometry, material(part));
  mesh.position.set((p.x+q.x)/2, height-(p.y+q.y)/2, 30);
  mesh.scale.set(thickness, length, thickness * .6);
  mesh.rotation.z = Math.atan2(-(q.y-p.y), q.x-p.x)-Math.PI/2;
  mesh.userData.part = part; meshes.push(mesh); robotGroup.add(mesh);
}
function buildRobot() {
  clearMeshes(); available = visibleParts(landmarks);
  for (const part of PARTS.filter(p => available.includes(p.id))) {
    const pts = part.indices.map(i => landmarks[i]);
    if (part.id === 'torso') {
      const top = { x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2 };
      const bottom = { x:(pts[2].x+pts[3].x)/2, y:(pts[2].y+pts[3].y)/2 };
      segment(top, bottom, Math.hypot((pts[0].x-pts[1].x)*width,(pts[0].y-pts[1].y)*height)*.9,part.id);
    } else {
      const thickness = width * (part.id.includes('Leg') ? .065 : .045);
      segment(pts[0], pts[1], thickness, part.id);
      segment(pts[1], pts[2], thickness*.8, part.id);
    }
  }
  $('parts').textContent = PARTS.map(p => `${p.label}: ${available.includes(p.id) ? '검출' : '미검출'}`).join(' / ');
  for (const part of PARTS) $(`ratio-${part.id}`).disabled = !available.includes(part.id);
  render();
}
function render() {
  const start = performance.now();
  for (const mesh of meshes) {
    const value = ratios[mesh.userData.part] / 100;
    mesh.visible = value > 0; mesh.material.opacity = value;
  }
  renderer?.render(scene, camera);
  const ctx = guide.getContext('2d'); ctx.clearRect(0,0,width,height);
  if ($('showGuide').checked) {
    const indices = new Set(PARTS.flatMap(p => p.indices));
    for (const i of indices) {
      const p = landmarks[i];
      if (!p || (p.visibility ?? 0) < .6 || (p.presence ?? 1) < .6 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const q = point(p,width,height);
      ctx.fillStyle='#f8d78d'; ctx.beginPath(); ctx.arc(q.x,q.y,4,0,Math.PI*2); ctx.fill();
    }
  }
  timings.render = performance.now()-start;
  $('metrics').textContent = `촬영 ${timings.capture?.toFixed(1) ?? '—'}ms / 인식 ${timings.detect?.toFixed(1) ?? '—'}ms / 렌더 제출 ${timings.render.toFixed(1)}ms`;
}
function setRatios(value) {
  for (const part of PARTS) {
    ratios[part.id] = value; $(`ratio-${part.id}`).value = value; $(`value-${part.id}`).textContent = `${value}%`;
  }
  render();
}
function reset() {
  generation++; capturing = false; stopCamera(); landmarks = []; timings = {};
  setSize(640,480); clearMeshes(); available = []; setRatios(0);
  $('parts').textContent = '인식된 부위 없음';
  PARTS.forEach(p => { $(`ratio-${p.id}`).disabled = true; });
  $('start').disabled = !renderer;
  $('checkModel').disabled = false;
  status('초기화 완료. 촬영 이미지와 관절 좌표를 지웠습니다.');
}
async function getDetector() {
  if (detector) return detector;
  if (!detectorPromise) detectorPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/wasm');
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate:'CPU' },
      runningMode:'IMAGE', numPoses:1,
    });
  })().then(value => { detector = value; return value; }).catch(error => { detectorPromise = undefined; throw error; });
  return detectorPromise;
}
async function startCamera() {
  reset(); const token = generation; $('start').disabled = true;
  status('카메라 권한 요청 중…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    const incoming = await navigator.mediaDevices.getUserMedia({ video: { width: {ideal:1280}, height: {ideal:720} }, audio:false });
    if (token !== generation) { incoming.getTracks().forEach(t=>t.stop()); return; }
    stream = incoming; video.srcObject = stream; video.hidden = false;
    await video.play();
    if (token !== generation) return;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (token !== generation || !stream) return;
      stopCamera(); $('start').disabled = false; status('카메라 연결이 끊겼습니다. 다시 연결하세요.');
    });
    $('capture').disabled = false;
    status('전신이 화면에 들어오면 정지 이미지를 촬영하세요.');
  } catch(error) {
    if (token !== generation) return;
    stopCamera(); $('start').disabled = false;
    const messages = { NotAllowedError:'카메라 권한이 거부되었습니다. 브라우저·OS 권한을 확인하고 다시 연결하세요.', NotFoundError:'연결된 카메라가 없습니다. 웹캠을 연결한 뒤 다시 시도하세요.', NotReadableError:'카메라를 다른 앱에서 사용 중일 수 있습니다. 사용 중인 앱을 닫고 다시 연결하세요.' };
    status(messages[error.name] ?? '카메라를 시작할 수 없습니다. localhost 또는 HTTPS와 카메라 연결을 확인하세요.');
  }
}
async function capture() {
  if (capturing || !stream) return;
  if (video.readyState < 2 || !video.videoWidth) { status('카메라 화면 준비 중입니다. 잠시 후 촬영하세요.'); return; }
  capturing = true; const token = generation; $('capture').disabled = true;
  const start = performance.now();
  setSize(video.videoWidth, video.videoHeight);
  source.getContext('2d').drawImage(video,0,0,width,height);
  const ctx = photo.getContext('2d');
  ctx.save(); ctx.translate(width,0); ctx.scale(-1,1); ctx.drawImage(source,0,0); ctx.restore();
  timings.capture = performance.now()-start; stopCamera();
  status('정지 이미지 인식 중… 첫 실행은 인식 모델을 다운로드합니다.');
  try {
    const model = await getDetector();
    if (token !== generation) return;
    const begin = performance.now(); const result = model.detect(source);
    timings.detect = performance.now()-begin;
    landmarks = result.landmarks[0] ?? []; buildRobot();
    status(available.length ? `${available.length}개 부위를 인식했습니다. 비율을 조절해 배치를 확인하세요.` : '신체를 인식하지 못했습니다. 밝은 곳에서 전신이 보이도록 다시 촬영하세요.');
  } catch {
    if (token !== generation) return;
    landmarks = []; buildRobot(); status('인식 모델을 불러오거나 실행하지 못했습니다. 인터넷 연결을 확인하고 다시 촬영하세요.');
  } finally {
    if (token === generation) { capturing = false; $('start').disabled = !renderer; }
  }
}
for (const part of PARTS) {
  const div = document.createElement('div'); div.className='control';
  div.innerHTML=`<label for="ratio-${part.id}">${part.label}<output id="value-${part.id}">0%</output></label><input id="ratio-${part.id}" type="range" min="0" max="100" step="1" value="0" disabled>`;
  $('controls').append(div);
  $(`ratio-${part.id}`).addEventListener('input', event => {
    ratios[part.id] = Number(event.target.value); $(`value-${part.id}`).textContent=`${ratios[part.id]}%`; render();
  });
}
$('start').onclick = startCamera; $('capture').onclick = capture; $('reset').onclick = reset;
$('demo').onclick = () => {
  reset(); landmarks=demoLandmarks();
  const ctx=photo.getContext('2d'); ctx.fillStyle='#23392d'; ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='#638572'; ctx.lineWidth=22;
  for (const p of PARTS.filter(p=>p.id!=='torso')) {
    ctx.beginPath(); p.indices.forEach((i,j)=>{const q=point(landmarks[i],width,height); j?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}); ctx.stroke();
  }
  ctx.fillStyle='#638572';ctx.fillRect(250,120,140,180);ctx.beginPath();ctx.arc(320,78,40,0,Math.PI*2);ctx.fill();
  buildRobot();setRatios(60);
  status('데모 좌표 모드: 카메라·자동 인식을 사용하지 않았습니다. 임시 3D 배치와 부위별 비율만 확인합니다.');
};
$('all').onclick=()=>setRatios(100); $('zero').onclick=()=>setRatios(0); $('showGuide').onchange=render;
$('checkModel').onclick = async () => {
  const token = generation; $('checkModel').disabled=true;
  status('인식 모델 점검 중… 모델 다운로드와 빈 이미지 인식을 실행합니다.');
  try {
    const model = await getDetector();
    if (token !== generation) return;
    const empty = document.createElement('canvas'); empty.width=640; empty.height=480;
    empty.getContext('2d').fillRect(0,0,640,480);
    const result = model.detect(empty);
    status(`인식 모델 준비 완료. 빈 이미지에서 ${result.landmarks.length}명을 검출했습니다. 실제 촬영 인식은 별도 확인하세요.`);
  } catch {
    if (token === generation) status('인식 모델 점검 실패. 인터넷 연결과 WASM 준비 상태를 확인하세요.');
  } finally { if (token === generation) $('checkModel').disabled=false; }
};
window.addEventListener('pagehide',event=>{
  reset();
  if (!event.persisted) { detector?.close(); renderer?.dispose(); }
});
setSize(width,height); render();
if (!renderer) { $('start').disabled=true; $('demo').disabled=true; }
