const box = document.getElementById('box');
const size = document.getElementById('size');
let start = null;
let rect = null;

function draw() {
  box.style.display = 'block';
  Object.assign(box.style, {
    left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
  });
  const dpr = window.devicePixelRatio || 1;
  size.textContent = `${Math.round(rect.width * dpr)} × ${Math.round(rect.height * dpr)}`;
}

window.addEventListener('mousedown', (e) => {
  start = { x: e.clientX, y: e.clientY };
  rect = { x: start.x, y: start.y, width: 0, height: 0 };
  document.body.classList.add('selecting');
  draw();
});

window.addEventListener('mousemove', (e) => {
  if (!start) return;
  rect = {
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y),
  };
  draw();
});

window.addEventListener('mouseup', () => {
  start = null;
  // Releasing the mouse confirms, like most snipping tools.
  if (rect && rect.width >= 16 && rect.height >= 16) window.api.regionDone(rect);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.regionDone(null);
  if (e.key === 'Enter' && rect) window.api.regionDone(rect);
});
