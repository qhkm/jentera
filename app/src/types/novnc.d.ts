declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: string | WebSocket, options?: { wsProtocols?: string[] });
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    viewOnly: boolean;
    qualityLevel: number;
    compressionLevel: number;
    background: string;
    disconnect(): void;
    focus(): void;
    blur(): void;
    sendKey(keysym: number, code?: string, down?: boolean): void;
  }
}
