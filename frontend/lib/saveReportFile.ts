const DB_NAME = 'hustix-report-files';
const STORE = 'handles';

export type ReportDestination =
  | { kind: 'download' }
  | { kind: 'file'; handle: FileSystemFileHandle };

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    id?: string;
    startIn?: 'downloads';
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle(key: string): Promise<FileSystemFileHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as FileSystemFileHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function forgetHandle(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function writableHandle(key: string, filename: string): Promise<FileSystemFileHandle | null> {
  const showSaveFilePicker = (window as SavePickerWindow).showSaveFilePicker;
  if (!showSaveFilePicker) return null;

  let handle = await readHandle(key).catch(() => null);
  if (handle) {
    const current = await handle.queryPermission({ mode: 'readwrite' });
    const permission = current === 'granted' ? current : await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') handle = null;
  }

  if (!handle) {
    handle = await showSaveFilePicker({
      id: 'hustix-advisor-report',
      startIn: 'downloads',
      suggestedName: filename,
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    });
    await storeHandle(key, handle);
  }
  return handle;
}

export async function chooseAdvisorReportDestination(
  portfolioId: string,
  filename: string,
): Promise<ReportDestination | 'cancelled'> {
  try {
    const handle = await writableHandle(portfolioId, filename);
    return handle ? { kind: 'file', handle } : { kind: 'download' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveReportBlob(destination: ReportDestination, filename: string, blob: Blob, portfolioId?: string) {
  if (destination.kind === 'download') {
    downloadBlob(filename, blob);
    return;
  }

  try {
    const writable = await destination.handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    if (portfolioId) await forgetHandle(portfolioId).catch(() => undefined);
    if (err instanceof DOMException && err.name === 'NoModificationAllowedError') {
      throw new Error('Close the open Advisor Report, then download it again so the new file can replace it.');
    }
    throw new Error('Could not replace the Advisor Report. Click Advisor Report again and choose the file to replace.');
  }
}
