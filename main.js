const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut, shell } = require('electron');
const path = require('path');
const https = require('https');

const GITHUB_OWNER = 'ugulsunday1306-droid';
const GITHUB_REPO = 'Calander';

// 버젼 비교 헬퍼 (Semver Comparison)
function isNewerVersion(currentVer, latestVer) {
  const cParts = currentVer.replace(/^v/, '').split('.').map(Number);
  const lParts = latestVer.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

function checkForGitHubUpdates(isManualCheck = false) {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    headers: {
      'User-Agent': 'UGUL-Calander-App'
    }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        if (res.statusCode !== 200) {
          if (isManualCheck && mainWindow) {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '업데이트 확인',
              message: '최신 릴리즈 정보를 가져올 수 없습니다.',
              detail: '아직 깃허브(GitHub)에 배포된 최신 릴리즈가 없거나 네트워크 상태를 확인해 주세요.'
            });
          }
          return;
        }

        const release = JSON.parse(data);
        const latestTag = release.tag_name || '';
        const currentVersion = app.getVersion();

        if (isNewerVersion(currentVersion, latestTag)) {
          dialog.showMessageBox(mainWindow || null, {
            type: 'info',
            title: 'UGUL Calander 새 버전 알림',
            message: `📢 새로운 버전(${latestTag})이 출시되었습니다!`,
            detail: `현재 버전: v${currentVersion}\n최신 버전: ${latestTag}\n\n다운로드 페이지로 이동하여 최신 버전을 받으시겠습니까?`,
            buttons: ['다운로드 페이지로 이동', '나중에'],
            defaultId: 0
          }).then(result => {
            if (result.response === 0 && release.html_url) {
              shell.openExternal(release.html_url);
            }
          });
        } else if (isManualCheck && mainWindow) {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '최신 버전 사용 중',
            message: '현재 최신 버전을 사용하고 계십니다! (v' + currentVersion + ')'
          });
        }
      } catch (err) {
        console.error('Failed to parse update info:', err);
      }
    });
  }).on('error', (err) => {
    console.error('Update check network error:', err);
    if (isManualCheck && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '네트워크 오류',
        message: '업데이트를 확인하는 중 오류가 발생했습니다.'
      });
    }
  });
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1366,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false
      },
      autoHideMenuBar: true,
      titleBarStyle: 'default',
      backgroundColor: '#080c14'
    });

    // index.html 즉시 로드 (clearCache 비동기 블로킹 방지)
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    try {
      mainWindow.webContents.session.clearCache();
    } catch (e) {}

    // F12 또는 Ctrl+Shift+I 키로 개발자 도구 토글 지원
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    // 창 닫기 버튼 클릭 시 백그라운드로 전환 (종료 플래그가 꺼져 있으면 창만 숨김)
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  }

  app.whenReady().then(() => {
    const fs = require('fs');

    // 상대 경로 방식으로 캘린더 경로 동적 연산 (옵션 1)
    let desktopDir;
    if (app.isPackaged) {
      // 패키징 모드: UGULCalander.exe와 동일한 폴더 내부 (즉, UGULCalander-win32-x64 폴더)
      desktopDir = path.dirname(process.execPath);
    } else {
      // 개발 모드: main.js와 동일한 폴더 내부 (즉, 캘린더_Dev 폴더)
      desktopDir = __dirname;
    }
    const desktopPath = path.join(desktopDir, 'events.json');

    // 시스템 트레이 생성 및 구성
    const iconPath = path.join(__dirname, 'icon.jpg');
    tray = new Tray(iconPath);
    
    const trayMenu = Menu.buildFromTemplate([
      { 
        label: '대시보드 열기', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        } 
      },
      { type: 'separator' },
      { 
        label: '종료', 
        click: () => {
          isQuitting = true;
          app.quit();
        } 
      }
    ]);

    tray.setToolTip('UGUL Calander');
    tray.setContextMenu(trayMenu);

    // 트레이 아이콘 더블 클릭 시 창 보이기
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    const cacheDir = path.join(desktopDir, 'cache');

    function ensureCacheDir() {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    }

    function cleanUnusedCacheImages(activePaths = []) {
      try {
        if (!fs.existsSync(cacheDir)) return;
        const files = fs.readdirSync(cacheDir);
        const activeBasenames = activePaths.map(p => {
          if (!p) return '';
          try {
            const cleanP = p.replace(/^file:\/\/\/?/, '');
            return path.basename(cleanP);
          } catch (err) {
            return path.basename(p);
          }
        });

        files.forEach(file => {
          if (!activeBasenames.includes(file)) {
            const filePath = path.join(cacheDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log('Cleaned unused memo cache image:', file);
            } catch (e) {}
          }
        });
      } catch (err) {
        console.error('Error cleaning unused cache images:', err);
      }
    }

    ipcMain.on('save-memo-image', (event, base64Data) => {
      try {
        ensureCacheDir();
        let ext = 'png';
        let cleanData = base64Data;
        const match = base64Data.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
        if (match) {
          ext = match[1] === 'jpeg' ? 'jpg' : match[1];
          cleanData = base64Data.replace(/^data:image\/[a-zA-Z0-9]+;base64,/, '');
        }
        const fileName = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
        const filePath = path.join(cacheDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(cleanData, 'base64'));
        event.returnValue = filePath;
      } catch (e) {
        console.error('Failed to save memo image to cache:', e);
        event.returnValue = null;
      }
    });

    ipcMain.on('clean-unused-memo-images', (event, activePaths) => {
      cleanUnusedCacheImages(activePaths || []);
    });

    ipcMain.on('save-events', (event, payload) => {
      try {
        if (!fs.existsSync(desktopDir)) {
          fs.mkdirSync(desktopDir, { recursive: true });
        }
        fs.writeFileSync(desktopPath, JSON.stringify(payload, null, 2), 'utf-8');
        
        if (payload && payload.memoItems) {
          const activePaths = payload.memoItems
            .filter(m => m.type === 'image' && m.content)
            .map(m => m.content);
          cleanUnusedCacheImages(activePaths);
        }

        event.returnValue = true;
      } catch (e) {
        console.error('Failed to save events:', e);
        event.returnValue = false;
      }
    });

    ipcMain.on('load-events', (event) => {
      try {
        if (fs.existsSync(desktopPath)) {
          let data = fs.readFileSync(desktopPath, 'utf-8');
          if (data && data.charCodeAt(0) === 0xFEFF) {
            data = data.slice(1);
          }
          event.returnValue = JSON.parse(data);
          return;
        }
      } catch (e) {
        console.error('Failed to load events:', e);
      }
      event.returnValue = null;
    });

    ipcMain.handle('show-save-dialog', async (event, defaultName) => {
      return await dialog.showSaveDialog(mainWindow, {
        title: '캘린더 백업 저장',
        defaultPath: defaultName,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
    });

    ipcMain.handle('show-open-dialog', async () => {
      return await dialog.showOpenDialog(mainWindow, {
        title: '캘린더 백업 불러오기',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
      });
    });

    let alarmWindow = null;

    ipcMain.on('trigger-alarm-window', (event, payload) => {
      if (alarmWindow) {
        try {
          alarmWindow.close();
        } catch (e) {}
      }

      alarmWindow = new BrowserWindow({
        width: 480,
        height: 380,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          preload: path.join(__dirname, 'preload.js')
        }
      });

      const query = new URLSearchParams({
        title: payload.title,
        time: payload.time,
        desc: payload.desc,
        isTest: payload.isTest || 'false'
      }).toString();

      alarmWindow.loadURL(`file://${__dirname}/alarm_overlay.html?${query}`);

      alarmWindow.on('closed', () => {
        alarmWindow = null;
      });
    });

    ipcMain.on('dismiss-alarm', () => {
      if (alarmWindow) {
        try {
          alarmWindow.close();
        } catch (e) {}
      }
    });

    ipcMain.on('snooze-alarm', () => {
      if (alarmWindow) {
        try {
          alarmWindow.close();
        } catch (e) {}
      }
      if (mainWindow) {
        mainWindow.webContents.send('register-snooze-from-main');
      }
    });

    ipcMain.on('show-window', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
      }
    });

    ipcMain.handle('register-global-shortcut', (event, accelerator) => {
      try {
        globalShortcut.unregisterAll();
        if (!accelerator) return true;
        const success = globalShortcut.register(accelerator, () => {
          if (mainWindow) {
            if (mainWindow.isVisible() && mainWindow.isFocused()) {
              mainWindow.hide();
            } else {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        });
        return success;
      } catch (e) {
        console.error('Failed to register global shortcut:', e);
        return false;
      }
    });

    ipcMain.on('check-for-updates-manual', () => {
      checkForGitHubUpdates(true);
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
    });

    createWindow();

    // 앱 실행 후 2초 뒤 자동 깃허브 업데이트 확인 (스무스한 로딩)
    setTimeout(() => {
      checkForGitHubUpdates(false);
    }, 2000);

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', function () {
    if (isQuitting) {
      if (process.platform !== 'darwin') app.quit();
    }
  });
}
