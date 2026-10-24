// One running build and one replaceable pending build: rapid changes never form a backlog.
let worker, workerP, running = null, pending = null, nextId = 0;
// the background worker itself failed (a module didn't load, it crashed, its result was unreadable), as opposed to an
// error in the build: the page retries with a fresh worker (app.js)
const workerFailure = (cause) => Object.assign(new Error('background worker failed'), { worker: true, cause });
const closeImages = (job) => { job.img?.close(); job.edit?.add.close(); job.edit?.cut.close(); };
async function dispatch(job) {
  running = job;
  try {
    // Module-worker dependencies may use an older HTTP cache entry even after a page reload.
    // Revalidate this small, unbundled module graph before starting a fresh worker.
    workerP ||= Promise.all(['build-worker', 'depth', 'sculpt', 'matte', 'relief', 'outline', 'grid', 'model', 'mesh', 'stl', 'exact', 'i18n']
      .map(async (name) => {
        const response = await fetch(new URL(`./${name}.js`, import.meta.url), { cache: 'reload' });
        if (!response.ok) throw workerFailure(`${name}.js: ${response.status}`);
        await response.arrayBuffer();
      })).then(() => new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' }));
    worker = await workerP;
    worker.onmessage = ({ data }) => {
      if (data.id !== running?.id) return;
      if (data.status) { running.onStatus(data.status); return; }
      const done = running; running = null;
      if (data.error) done.reject(new Error(data.error)); else done.resolve(data);
      if (pending) { const next = pending; pending = null; dispatch(next); }
    };
    const fail = (error) => {
      running?.reject(error);
      if (pending) { closeImages(pending); pending.reject(error); }
      running = pending = null; worker.terminate(); worker = null; workerP = null;
    };
    worker.onerror = (event) => fail(workerFailure(event.message));
    worker.onmessageerror = () => fail(workerFailure('unreadable result'));
    const { resolve, reject, onStatus, ...payload } = job;
    const transfer = [job.img, job.edit?.add, job.edit?.cut].filter(Boolean);
    worker.postMessage(payload, transfer);
  } catch (error) {
    running = null; worker?.terminate(); worker = null; workerP = null; closeImages(job);
    job.reject(error.worker ? error : workerFailure(error.message));
    if (pending) { const next = pending; pending = null; dispatch(next); }
  }
}
export function buildInWorker(payload, onStatus) {
  return new Promise((resolve, reject) => {
    const job = { ...payload, id: ++nextId, resolve, reject, onStatus };
    if (!running) dispatch(job);
    else {
      if (pending) { closeImages(pending); pending.resolve(null); }
      pending = job;
    }
  });
}
