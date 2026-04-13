const { contextBridge, ipcRenderer } = require("electron");
console.log('preload.cjs loaded');

function subscribe(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("desktopApi", {
  getState: () => ipcRenderer.invoke("chat:getState"),
  newSession: () => ipcRenderer.invoke("chat:newSession"),
  sendMessage: async (payload) => {
    console.log("preload: sendMessage called", payload);
    try {
      const res = await ipcRenderer.invoke("chat:send", payload);
      console.log("preload: sendMessage result", res);
      return res;
    } catch (err) {
      console.error("preload: sendMessage error", err);
      return { ok: false, error: err?.message || String(err) };
    }
  },
  stopMessage: () => ipcRenderer.invoke("chat:stop"),
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  openDrive: (drive) => ipcRenderer.invoke("open:drive", drive),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  clearModelSettings: () => ipcRenderer.invoke("settings:clearModel"),
  listModels: (payload) => ipcRenderer.invoke("models:list", payload),
  onDelta: (handler) => subscribe("chat:delta", handler),
  onStatus: (handler) => subscribe("chat:status", handler),
});
