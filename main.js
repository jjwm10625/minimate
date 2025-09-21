const { app, Tray, Menu, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const path = require("path");

let tray = null;
let win = null;
let gifTimer = null;
let trayIconSize = 19;
let currentTrayImage = null;
let gifFramesCache = null;

// 앱 시작
app.on("ready", () => {
  const iconPath = path.join(__dirname, "assets", "default.png");
  let defaultImg = resizeImageKeepAspect(nativeImage.createFromPath(iconPath));
  tray = new Tray(defaultImg);
  currentTrayImage = defaultImg;

  updateTrayMenu();
  tray.setToolTip("MiniMate");

  if (process.platform === "darwin") app.dock.hide(); // Dock 숨기기
});

// 아이콘 크기 변경
function setIconSize(newSize) {
  if (newSize < 12 || newSize > 48) return false;
  trayIconSize = newSize;

  if (gifFramesCache) {
    gifFramesCache.icons = gifFramesCache.icons.map(icon =>
      resizeImageKeepAspect(icon, trayIconSize)
    );
  } else if (currentTrayImage && !currentTrayImage.isEmpty()) {
    tray.setImage(resizeImageKeepAspect(currentTrayImage, trayIconSize));
  }

  if (win && !win.isDestroyed()) win.webContents.send("icon-size-changed", trayIconSize);
  return true;
}

// 트레이 메뉴
function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    { label: "환경설정", click: () => openWindow() },
    { type: "separator" },
    { 
      label: "종료하기", 
      click: () => {
        if (tray) {
          tray.destroy();
          tray = null;
        }
        clearGifAnimation(true);
        app.exit(0); // 강제 종료
      } 
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// 설정창
function openWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }

  win = new BrowserWindow({
    width: 600, height: 500,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    show: false,
  });

  win.loadFile("index.html");
  win.once("ready-to-show", () => win.show());

  // 닫으면 숨기기만 (트레이 + GIF 유지)
  win.on("close", (event) => { event.preventDefault(); win.hide(); });
}

// GIF 루프
function startGifLoop() {
  if (!gifFramesCache || gifFramesCache.icons.length === 0) return;
  let frameIndex = 0;

  function playFrame() {
    if (!tray || tray.isDestroyed()) { clearGifAnimation(true); return; }
    tray.setImage(gifFramesCache.icons[frameIndex]);
    currentTrayImage = gifFramesCache.icons[frameIndex];
    const delay = gifFramesCache.delays[frameIndex] || 100;
    frameIndex = (frameIndex + 1) % gifFramesCache.icons.length;
    gifTimer = setTimeout(playFrame, delay);
  }

  playFrame();
}

// GIF 정리
function clearGifAnimation(force = false) {
  if (gifTimer) { clearTimeout(gifTimer); gifTimer = null; }
  if (force) gifFramesCache = null;
}

// 이미지 리사이즈
function resizeImageKeepAspect(img, targetHeight = null) {
  if (img.isEmpty()) return img;
  return img.resize({ height: targetHeight || trayIconSize, quality: "best" });
}

// PNG/JPG 처리
function handlePngImage(filePath) {
  try {
    let img = resizeImageKeepAspect(nativeImage.createFromPath(filePath));
    if (img.isEmpty()) throw new Error("이미지 로드 실패");
    tray.setImage(img);
    currentTrayImage = img;
    gifFramesCache = null;
    return true;
  } catch { return false; }
}

// GIF 처리 (버퍼 기반)
async function handleGifImage(filePath) {
  try {
    const gifFrames = require("gif-frames");
    const frameData = await gifFrames({ url: filePath, frames: "all", outputType: "png", cumulative: true });

    const icons = [], delays = [];
    const maxFrames = 15, step = Math.ceil(frameData.length / maxFrames);

    for (let i = 0; i < frameData.length; i += step) {
      const frame = frameData[i], chunks = [];
      await new Promise((resolve, reject) => {
        const stream = frame.getImage();
        stream.on("data", (c) => chunks.push(c));
        stream.on("end", resolve);
        stream.on("error", reject);
      });

      let icon = resizeImageKeepAspect(nativeImage.createFromBuffer(Buffer.concat(chunks)));
      if (!icon.isEmpty()) {
        let rawDelay = frame.frameInfo?.delay || 10;
        icons.push(icon);
        delays.push(Math.max(rawDelay * 10 * step, 20));
      }
    }

    if (icons.length === 0) throw new Error("유효한 프레임 없음");
    gifFramesCache = { icons, delays };
    startGifLoop();
    return true;
  } catch { return handlePngImage(filePath); }
}

// IPC
ipcMain.handle("select-image", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: "이미지", extensions: ["png", "gif", "jpg", "jpeg"] }],
    properties: ["openFile"],
  });

  if (canceled || !filePaths?.length) return null;
  clearGifAnimation(false);
  const ext = path.extname(filePaths[0]).toLowerCase();
  if ([".png", ".jpg", ".jpeg"].includes(ext)) return handlePngImage(filePaths[0]) ? filePaths[0] : null;
  if (ext === ".gif") return (await handleGifImage(filePaths[0])) ? filePaths[0] : null;
  return null;
});

ipcMain.handle("set-icon-size", async (_event, size) => setIconSize(size));

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
