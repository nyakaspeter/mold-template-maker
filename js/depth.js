// AI depth estimation (Depth Anything V2, small) in the browser. The model is downloaded once, then cached.
import { t } from './i18n.js';

let estimatorP = null;

// Returns a greyscale canvas: lighter = nearer. onStatus receives progress messages.
export async function aiDepth(img, onStatus) {
  if (!estimatorP) {
    estimatorP = (async () => {
      onStatus(t('Loading depth model…'));
      const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');
      return tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
        dtype: 'q8',
        progress_callback: (e) => { if (e.status === 'progress' && e.file?.endsWith('.onnx')) onStatus(t('Downloading depth model… {p}%', { p: Math.round(e.progress) })); },
      });
    })();
    estimatorP.catch(() => { estimatorP = null; });
  }
  const est = await estimatorP;
  onStatus(t('Estimating depth…'));
  const sc = Math.min(1, 768 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { depth } = await est(c.toDataURL('image/png'));
  const out = document.createElement('canvas'); out.width = depth.width; out.height = depth.height;
  const octx = out.getContext('2d'), id = octx.createImageData(depth.width, depth.height);
  for (let i = 0; i < depth.width * depth.height; i++) {
    const v = depth.data[i * depth.channels];
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  octx.putImageData(id, 0, 0);
  return out;
}
