const { app, Tray, Menu, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

let tray = null;
let win = null;
let gifTimer = null;
let trayIconSize = 19; 
let currentTrayImage = null; 
let gifFramesCache = null;  

app.on("ready", () => {
  const iconPath = path.join(__dirname, "default.png");
  let defaultImg = resizeImageKeepAspect(nativeImage.createFromPath(iconPath));
  tray = new Tray(defaultImg);
  currentTrayImage = defaultImg;

  updateTrayMenu();
  tray.setToolTip("MiniMate");
  console.log("MiniMate 실행 준비 완료");
});

// 아이콘 크기 변경
function setIconSize(newSize) {
  if (newSize < 12 || newSize > 48) {
    console.warn(`아이콘 크기는 12~48px 사이여야 합니다. 입력값: ${newSize}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send("error", "아이콘 크기는 12~48px 범위여야 합니다.");
    }
    return false;
  }

  trayIconSize = newSize;
  console.log(`트레이 아이콘 크기 변경: ${trayIconSize}px`);

  if (gifFramesCache) {
    // GIF 전체 프레임 리사이즈
    gifFramesCache.icons = gifFramesCache.icons.map(icon =>
      resizeImageKeepAspect(icon, trayIconSize)
    );
  } else if (currentTrayImage && !currentTrayImage.isEmpty()) {
    // PNG/JPG 아이콘 리사이즈
    const resizedImage = resizeImageKeepAspect(currentTrayImage, trayIconSize);
    tray.setImage(resizedImage);
  }

  updateTrayMenu();

  if (win && !win.isDestroyed()) {
    win.webContents.send("icon-size-changed", trayIconSize);
  }
  return true;
}

// 메뉴 업데이트
function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    { label: `환경설정`, click: () => openWindow() },
    { type: "separator" },
    { label: "종료하기", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

// 설정창 열기
function openWindow() {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    show: false,
  });

  win.loadFile("index.html");
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => (win = null));
}

// GIF 애니메이션 정리
function clearGifAnimation() {
  if (gifTimer) {
    clearTimeout(gifTimer);
    gifTimer = null;
  }
  gifFramesCache = null;
}

// 리사이즈 (세로 고정, 가로 자동 비율)
function resizeImageKeepAspect(img, targetHeight = null) {
  if (img.isEmpty()) return img;
  const newHeight = targetHeight || trayIconSize;
  return img.resize({
    height: newHeight,
    quality: "best",
  });
}

function handlePngImage(filePath) {
  try {
    let img = nativeImage.createFromPath(filePath);
    img = resizeImageKeepAspect(img);
    if (img.isEmpty()) throw new Error("이미지 로드 실패");
    tray.setImage(img);
    currentTrayImage = img;
    gifFramesCache = null; 
    return true;
  } catch (err) {
    console.error("PNG/JPG 처리 오류:", err);
    if (win && !win.isDestroyed()) {
      win.webContents.send("error", "PNG/JPG 처리 실패: " + err.message);
    }
    return false;
  }
}

async function handleGifImage(filePath) {
  try {
    const gifFrames = require("gif-frames");
    const frameData = await gifFrames({
      url: filePath,
      frames: "all",
      outputType: "png",
      cumulative: true,
    });

    const icons = [];
    const delays = [];
    const maxFrames = 15;
    const step = Math.ceil(frameData.length / maxFrames);

    for (let i = 0; i < frameData.length; i += step) {
      const frame = frameData[i];
      const tempFile = path.join(__dirname, `temp_${Date.now()}_${i}.png`);

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(tempFile);
        frame.getImage().pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      let icon = nativeImage.createFromPath(tempFile);
      icon = resizeImageKeepAspect(icon);

      try { fs.unlinkSync(tempFile); } catch {}

      if (!icon.isEmpty()) {
        let rawDelay = frame.frameInfo?.delay || 10; 
        let delay = Math.max(rawDelay * 10 * step, 20);
        icons.push(icon);
        delays.push(delay);
      }
    }

    if (icons.length === 0) throw new Error("유효한 프레임 없음");

    gifFramesCache = { icons, delays }; 
    console.log(`GIF 애니메이션 준비 완료: ${icons.length} 프레임 (원본 속도 유지)`);

    let frameIndex = 0;
    function playFrame() {
      if (!tray || tray.isDestroyed()) {
        clearGifAnimation();
        return;
      }
      tray.setImage(gifFramesCache.icons[frameIndex]);
      currentTrayImage = gifFramesCache.icons[frameIndex];

      const delay = gifFramesCache.delays[frameIndex] || 100;
      frameIndex = (frameIndex + 1) % gifFramesCache.icons.length;
      gifTimer = setTimeout(playFrame, delay);
    }

    playFrame();
    return true;
  } catch (err) {
    console.error("GIF 처리 오류:", err);
    return handlePngImage(filePath);
  }
}

ipcMain.handle("select-image", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: "이미지", extensions: ["png", "gif", "jpg", "jpeg"] }],
    properties: ["openFile"],
  });

  if (canceled || !filePaths || filePaths.length === 0) return null;

  clearGifAnimation();
  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();

  if ([".png", ".jpg", ".jpeg"].includes(ext)) return handlePngImage(filePath) ? filePath : null;
  if (ext === ".gif") return (await handleGifImage(filePath)) ? filePath : null;
  return null;
});

ipcMain.handle("set-icon-size", async (_event, size) => {
  return setIconSize(size);
});

app.on("before-quit", () => clearGifAnimation());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
