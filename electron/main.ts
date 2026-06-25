import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, shell } from "electron";
import type { MessageBoxOptions, OpenDialogOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createConnection, createServer } from "net";
import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

type OverlordServerHandle = {
  process?: ChildProcessWithoutNullStreams;
  port: number;
  external?: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev") || process.env.OVERLORD_ELECTRON_DEV === "1";
const appRoot = join(__dirname, "..", "..");
const iconPath = join(appRoot, "electron", "assets", "icon-128.png");

let mainWindow: BrowserWindow | null = null;
let serverHandle: OverlordServerHandle | null = null;
let updateCheckStarted = false;

function logBackend(chunk: Buffer, stream: "stdout" | "stderr") {
  const text = `[overlord:backend:${stream}] ${chunk.toString()}`;
  if (stream === "stderr") {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }

  if (app.isPackaged) {
    const logsDir = app.getPath("logs");
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(join(logsDir, "backend.log"), text);
  }
}

function getStaticRoot() {
  return join(appRoot, "dist", "client");
}

function setupAutoUpdates() {
  if (updateCheckStarted || isDev || !app.isPackaged) return;
  updateCheckStarted = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("update-available", async (info) => {
    const options: MessageBoxOptions = {
      type: "info",
      buttons: ["Download and install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Overlord update available",
      message: "A new version of Overlord is available.",
      detail: `Version ${info.version} is available. Download it now and install it automatically?`,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);

    if (result.response === 0) {
      mainWindow?.setProgressBar(0);
      mainWindow?.setTitle("Overlord - Downloading update");
      void autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.setProgressBar(Math.max(0, Math.min(progress.percent / 100, 1)));
    mainWindow?.setTitle(`Overlord - Downloading update ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    mainWindow?.setProgressBar(-1);
    mainWindow?.setTitle("Overlord");
    const options: MessageBoxOptions = {
      type: "info",
      buttons: ["Restart and install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Overlord update ready",
      message: "The update has been downloaded.",
      detail: `Version ${info.version} is ready to install. Overlord will restart to apply it.`,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);

    if (result.response === 0) {
      void shutdownBackend().finally(() => autoUpdater.quitAndInstall(false, true));
    }
  });

  autoUpdater.on("error", (error) => {
    mainWindow?.setProgressBar(-1);
    mainWindow?.setTitle("Overlord");
    console.error("[overlord:electron] update failed", error);
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates();
  }, 2500);
}

function getAvailablePort(preferredPort: number) {
  return new Promise<number>((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", () => {
      const fallback = createServer();
      fallback.unref();
      fallback.listen(0, () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : preferredPort;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferredPort, () => {
      probe.close(() => resolve(preferredPort));
    });
  });
}

function waitForBackend(port: number) {
  return new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 80;

    const tryConnect = () => {
      attempts += 1;
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error(`Backend did not start on port ${port}`));
          return;
        }
        setTimeout(tryConnect, 100);
      });
    };

    tryConnect();
  });
}

async function isOverlordBackend(port: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function startBackend() {
  const preferredPort = Number(process.env.PORT) || 4747;
  const port = await getAvailablePort(preferredPort);

  if (port !== preferredPort && await isOverlordBackend(preferredPort)) {
    console.log(`[overlord:electron] reusing existing backend on port ${preferredPort}`);
    serverHandle = { port: preferredPort, external: true };
    return preferredPort;
  }

  const usesElectronNode = !process.env.OVERLORD_NODE_PATH && app.isPackaged;
  const nodePath = process.env.OVERLORD_NODE_PATH || (usesElectronNode ? process.execPath : "node");
  const serverEntry = join(appRoot, "dist", "server", "index.js");

  console.log(`[overlord:electron] starting backend on port ${port}`);
  const serverProcess = spawn(nodePath, [serverEntry], {
    cwd: appRoot,
    env: {
      ...process.env,
      ...(usesElectronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      PORT: String(port),
      OVERLORD_STATIC_ROOT: getStaticRoot(),
    },
    stdio: "pipe",
  });

  serverProcess.stdout.on("data", (chunk: Buffer) => {
    logBackend(chunk, "stdout");
  });
  serverProcess.stderr.on("data", (chunk: Buffer) => {
    logBackend(chunk, "stderr");
  });

  const handle = { process: serverProcess, port };
  serverHandle = handle;

  await Promise.race([
    waitForBackend(port),
    new Promise<never>((_, reject) => {
      serverProcess.once("exit", (code, signal) => {
        reject(new Error(`Backend exited before startup (code=${code}, signal=${signal})`));
      });
    }),
  ]);

  return port;
}

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#09090b",
    title: "Overlord",
    icon: iconPath,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const url = isDev
    ? "http://127.0.0.1:4748"
    : `http://127.0.0.1:${port}`;

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl)) {
      void shell.openExternal(targetUrl);
      return { action: "deny" };
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== url && /^https?:\/\//i.test(targetUrl)) {
      event.preventDefault();
      void shell.openExternal(targetUrl);
    }
  });

  void mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupNotifications() {
  ipcMain.handle("overlord:select-directory", async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose workspace folder",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "overlord:notify-agent-done",
    (_event, payload: { projectName?: string; body?: string }) => {
      if (mainWindow?.isFocused()) {
        return { shown: false };
      }

      const notification = new Notification({
        title: payload.projectName ? `Overlord - ${payload.projectName}` : "Overlord",
        body: payload.body ?? "Claude has finished its work.",
        icon: nativeImage.createFromPath(iconPath),
      });

      notification.on("click", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      });

      notification.show();
      return { shown: true };
    }
  );
}

async function shutdownBackend() {
  if (!serverHandle || serverHandle.external) return;

  await new Promise<void>((resolve) => {
    const serverProcess = serverHandle?.process;
    if (!serverProcess || serverProcess.exitCode !== null) {
      resolve();
      return;
    }

    serverProcess.once("close", () => resolve());
    serverProcess.kill("SIGTERM");
  });
  serverHandle = null;
}

app.setName("Overlord");
if (process.platform === "win32") {
  app.setAppUserModelId("com.overlord.app");
}

process.on("uncaughtException", (error) => {
  console.error("[overlord:electron] uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[overlord:electron] unhandled rejection", error);
});

app.whenReady().then(async () => {
  console.log("[overlord:electron] app ready");
  setupNotifications();
  const port = await startBackend();
  createWindow(port);
  setupAutoUpdates();
  console.log(`[overlord:electron] window loading http://127.0.0.1:${port}`);
}).catch((error) => {
  console.error("[overlord:electron] startup failed", error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
    createWindow(serverHandle.port);
  }
});

app.on("before-quit", (event) => {
  if (!serverHandle) return;
  event.preventDefault();
  void shutdownBackend().then(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
