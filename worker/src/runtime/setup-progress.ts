export const SETUP_STAGES = ['downloads', 'install', 'npm', 'browser', 'configure', 'checks', 'checkpoint'] as const;
export type SetupStage = typeof SETUP_STAGES[number];

/** Only fixed, non-secret stage markers cross into the owner's status API. */
export function setupStageReporter(report: (stage: SetupStage) => Promise<void>) {
  let pending = '';
  let highest = -1;
  return async (chunk: string) => {
    pending = (pending + chunk.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')).slice(-8192);
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const stage = line.match(/^JENTERA_SETUP_STAGE:([a-z]+)\r?$/)?.[1] as SetupStage;
      const index = SETUP_STAGES.indexOf(stage);
      if (index > highest) { highest = index; await report(stage); }
    }
  };
}
