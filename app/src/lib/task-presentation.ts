/** Presentation aliases only. These do not rename files or change download URLs. */
export function displayWorkspacePaths(text: string): string {
  return text
    .replace(/(^|[\s`("'])\/home\/sprite\/aisar\/outputs\/[0-9a-f-]{36}\//gi, '$1outputs/')
    .replace(/(^|[\s`("'])\/home\/sprite\/aisar\/(documents|outputs)\//gi, '$1$2/')
    .replace(/(^|[\s`("'])\/(?:home\/sprite|var\/lib\/aisar)(?:\/[^\s`"'<>)]*)?/g, '$1[internal computer path]');
}

/** Raw command arguments and runtime narration are not a user-facing trace. */
export function displayTaskStep(step: string, lang: 'en' | 'bm'): string {
  const bm = lang === 'bm';
  const tool = step.match(/(?:^|\s)([a-z][a-z0-9_]{1,50}):\s/i)?.[1]?.toLowerCase();
  if (tool) {
    if (/search/.test(tool)) return bm ? 'Mencari maklumat' : 'Searching for information';
    if (/extract|read|browse/.test(tool)) return bm ? 'Membaca maklumat' : 'Reading information';
    if (tool === 'vision_analyze') return bm ? 'Memeriksa imej' : 'Checking an image';
    if (tool === 'process') return bm ? 'Menyemak kemajuan tugasan' : 'Checking task progress';
    return bm ? 'Menjalankan tugasan pada komputer Jentera' : 'Working on Jentera’s computer';
  }
  if (/shortening conversation context/i.test(step)) return bm ? 'Menyediakan konteks perbualan' : 'Preparing conversation context';
  // Historical narration may contain passwords, runtime names or command
  // output without a recognised tool prefix. Do not publish it verbatim.
  return bm ? 'Menjalankan tugasan' : 'Working through the task';
}
