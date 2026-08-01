const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut, shell, net } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');

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

// 철통 리다이렉트 스마트 다운로더 (GitHub 302 CDN Redirect & User-Agent & Content-Length 100% 추적)
function downloadFile(url, destPath, onProgress, onComplete, onError) {
  const fileStream = fs.createWriteStream(destPath);

  const follow = (targetUrl) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const options = {
        hostname: parsedUrl.hostname,
        protocol: parsedUrl.protocol,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*'
        }
      };

      https.get(options, (res) => {
        // 301, 302, 303, 307, 308 리다이렉트 무조건 추적
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location);
        }

        if (res.statusCode !== 200) {
          fileStream.close();
          fs.unlink(destPath, () => {});
          return onError(new Error(`Download HTTP Status ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          fileStream.write(chunk);

          if (totalBytes > 0 && onProgress) {
            const percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
            onProgress(percent);
          } else if (onProgress) {
            // content-length가 누락된 경우에도 바이트 누적 기반으로 퍼센트 실시간 상승!
            const pseudoPercent = Math.min(99, Math.max(5, Math.round((downloadedBytes / (1024 * 1024 * 35)) * 100)));
            onProgress(pseudoPercent);
          }
        });

        res.on('end', () => {
          fileStream.end(() => {
            if (onProgress) onProgress(100);
            onComplete();
          });
        });

        res.on('error', (err) => {
          fileStream.close();
          fs.unlink(destPath, () => {});
          onError(err);
        });
      }).on('error', (err) => {
        fileStream.close();
        fs.unlink(destPath, () => {});
        onError(err);
      });
    } catch (err) {
      fileStream.close();
      fs.unlink(destPath, () => {});
      onError(err);
    }
  };

  follow(url);
}

// 앱 재시작 및 덮어쓰기 배치 스크립트 실행
function applyUpdateAndRestart(zipPath) {
  let appDir;
  if (app.isPackaged) {
    appDir = path.dirname(process.execPath);
  } else {
    appDir = __dirname;
  }

  const exeName = app.isPackaged ? path.basename(process.execPath) : 'UGULCalander.exe';
  const batPath = path.join(app.getPath('temp'), 'ugul_updater.bat');

  // Windows PowerShell Expand-Archive를 사용하여 압축 프로그램 실행 없이 강제 덮어쓰기 후 앱 재실행
  const batContent = `@echo off
chcp 65001 > nul
timeout /t 2 /nobreak > nul
powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${appDir}' -Force"
del /f /q "${zipPath}"
start "" "${path.join(appDir, exeName)}"
del /f /q "%~f0"
`;

  try {
    fs.writeFileSync(batPath, batContent, 'utf-8');
    spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();

    app.quit();
  } catch (err) {
    console.error('Failed to launch update batch script:', err);
  }
}

let pendingDownloadUrl = null;

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
            mainWindow.webContents.send('update-not-available', '최신 릴리즈 정보를 가져올 수 없습니다.');
          }
          return;
        }

        const release = JSON.parse(data);
        const latestTag = release.tag_name || '';
        const currentVersion = app.getVersion();

        if (isNewerVersion(currentVersion, latestTag)) {
          const zipAsset = (release.assets || []).find(a => a.name.endsWith('.zip'));
          pendingDownloadUrl = zipAsset ? zipAsset.browser_download_url : null;

          if (mainWindow) {
            mainWindow.webContents.send('update-available', {
              latestVersion: latestTag,
              currentVersion: 'v' + currentVersion,
              downloadUrl: pendingDownloadUrl,
              body: release.body || ''
            });
          }
        } else if (isManualCheck && mainWindow) {
          mainWindow.webContents.send('update-not-available', '현재 최신 버전을 사용하고 계십니다! (v' + currentVersion + ')');
        }
      } catch (err) {
        console.error('Failed to parse update info:', err);
      }
    });
  }).on('error', (err) => {
    console.error('Update check network error:', err);
  });
}

ipcMain.on('start-download-update', () => {
  if (!pendingDownloadUrl) return;
  const tempZipPath = path.join(app.getPath('temp'), 'ugul_update.zip');

  downloadFile(
    pendingDownloadUrl,
    tempZipPath,
    (percent) => {
      if (mainWindow) {
        mainWindow.webContents.send('update-progress', percent);
      }
    },
    () => {
      if (mainWindow) {
        mainWindow.webContents.send('update-downloaded');
      }
      setTimeout(() => {
        applyUpdateAndRestart(tempZipPath);
      }, 1200);
    },
    (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('update-error', err.message);
      }
    }
  );
});

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

    function healCachePaths(payload) {
      if (!payload || !Array.isArray(payload.memoItems)) return payload;
      payload.memoItems.forEach(item => {
        if (item.type === 'image' && item.content) {
          try {
            const cleanP = item.content.replace(/^file:\/\/\/?/, '');
            const basename = path.basename(cleanP);
            const currentLocalPath = path.join(cacheDir, basename);
            
            // 만약 현재 실행 위치의 cacheDir에 해당 파일이 존재한다면 현재 실경로로 자동 교정!
            if (fs.existsSync(currentLocalPath)) {
              item.content = currentLocalPath;
            }
          } catch (e) {}
        }
      });
      return payload;
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
          let parsed = JSON.parse(data);
          parsed = healCachePaths(parsed);
          event.returnValue = parsed;
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

    ipcMain.handle('get-auto-launch', () => {
      try {
        const settings = app.getLoginItemSettings();
        return settings.openAtLogin;
      } catch (e) {
        return false;
      }
    });

    ipcMain.handle('set-auto-launch', (event, enable) => {
      try {
        app.setLoginItemSettings({
          openAtLogin: enable,
          path: process.execPath,
          args: []
        });
        return true;
      } catch (e) {
        console.error('Failed to set login item settings:', e);
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
