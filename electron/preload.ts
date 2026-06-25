import { contextBridge, ipcRenderer } from "electron";

function markDesktop() {
  document.documentElement?.classList.add("overlord-desktop");
}

if (document.documentElement) {
  markDesktop();
} else {
  window.addEventListener("DOMContentLoaded", markDesktop, { once: true });
}

contextBridge.exposeInMainWorld("overlordDesktop", {
  isDesktop: true,
  selectDirectory: () => ipcRenderer.invoke("overlord:select-directory"),
  notifyAgentDone: (payload: { projectName: string; body?: string }) =>
    ipcRenderer.invoke("overlord:notify-agent-done", payload),
});
