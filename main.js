const { app, Tray, Menu, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const path = require("path");

let tray = null;
let win = null;
let gifTimer = null;
let trayIconSize = 19;
let currentTrayImage = null;
let gifFramesCache = null;
let quitting = false; // 종료 여부 플래그

app.on("ready", () => {
  const iconPath = path.join(__dirname, "assets", "default.png");
  let defaultImg = resizeImageKeepAspect(nativeImage.createFromPath(iconPath));
  tray = new Tray(defaultImg);
  currentTrayImage = defaultImg;

  updateTrayMenu();
  tray.setToolTip("MiniMate");

  // macOS에서는 Dock 아이콘 숨기기 (RunCat 스타일)
  if (process.platform === "darwin") {
    app.dock.hide();
  }

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
    gifFramesCache.icons = gifFramesCache.icons.map(icon =>
      resizeImageKeepAspect(icon, trayIconSize)
    );
  } else if (currentTrayImage && !currentTrayImage.isEmpty()) {
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
    { label: "환경설정", click: () => openWindow() },
    { type: "separator" },
    { 
      label: "종료하기", 
      click: () => {
        quitting = true; // 여기서만 종료 허용
        if (tray) {
          tray.destroy(); // 상태표시줄 아이콘 제거
          tray = null;
        }
        app.quit();
      } 
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// 설정창 열기
function openWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
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

  // 창 닫을 때 → 숨기기만 (GIF는 계속 유지)
  win.on("close", (event) => {
    event.preventDefault();
    win.hide();

    if (gifFramesCache && !gifTimer) {
      startGifLoop(); // 혹시 멈췄으면 다시 돌림
    }
  });
}

// GIF 애니메이션 루프 실행
function startGifLoop() {
  if (!gifFramesCache || gifFramesCache.icons.length === 0) return;

  let frameIndex = 0;

  function playFrame() {
    if (!tray || tray.isDestroyed()) {
      clearGifAnimation(true);
      return;
    }
    tray.setImage(gifFramesCache.icons[frameIndex]);
    currentTrayImage = gifFramesCache.icons[frameIndex];

    const delay = gifFramesCache.delays[frameIndex] || 100;
    frameIndex = (frameIndex + 1) % gifFramesCache.icons.length;
    gifTimer = setTimeout(playFrame, delay);
  }

  playFrame();
}

// GIF 애니메이션 정리
function clearGifAnimation(force = false) {
  if (gifTimer) {
    clearTimeout(gifTimer);
    gifTimer = null;
  }
  if (force) {
    gifFramesCache = null;
  }
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

// PNG/JPG 처리
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

// GIF 처리 (버퍼 기반)
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
      const chunks = [];

      await new Promise((resolve, reject) => {
        const stream = frame.getImage();
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });

      const buffer = Buffer.concat(chunks);
      let icon = nativeImage.createFromBuffer(buffer);
      icon = resizeImageKeepAspect(icon);

      if (!icon.isEmpty()) {
        let rawDelay = frame.frameInfo?.delay || 10;
        let delay = Math.max(rawDelay * 10 * step, 20);
        icons.push(icon);
        delays.push(delay);
      }
    }

    if (icons.length === 0) throw new Error("유효한 프레임 없음");

    gifFramesCache = { icons, delays };
    console.log(`GIF 애니메이션 준비 완료: ${icons.length} 프레임 (버퍼 기반)`);

    startGifLoop();
    return true;
  } catch (err) {
    console.error("GIF 처리 오류:", err);
    return handlePngImage(filePath);
  }
}

// IPC 핸들러
ipcMain.handle("select-image", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: "이미지", extensions: ["png", "gif", "jpg", "jpeg"] }],
    properties: ["openFile"],
  });

  if (canceled || !filePaths || filePaths.length === 0) return null;

  clearGifAnimation(false);
  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();

  if ([".png", ".jpg", ".jpeg"].includes(ext)) return handlePngImage(filePath) ? filePath : null;
  if (ext === ".gif") return (await handleGifImage(filePath)) ? filePath : null;
  return null;
});

ipcMain.handle("set-icon-size", async (_event, size) => {
  return setIconSize(size);
});

// 종료 제어
app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault(); // ⌘+Q 방지
    console.log("⚠️ 종료는 트레이 메뉴에서만 가능합니다.");
  } else {
    if (tray) {
      tray.destroy(); // 종료 시 아이콘 완전히 제거
      tray = null;
    }
    clearGifAnimation(true);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
