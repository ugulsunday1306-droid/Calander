const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut, shell, net } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { spawn, execSync, exec } = require('child_process');

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

// Electron 내장 net 모듈 기반 초강력 무결성 다운로더 (Chromium Network Engine 100% CDN 자동 리다이렉트 추적)
function downloadFile(initialUrl, destPath, onProgress, onComplete, onError) {
  let isFinished = false;
  let lastSentPercent = -1;

  try {
    const fileStream = fs.createWriteStream(destPath);
    const request = net.request({
      url: initialUrl,
      method: 'GET',
      redirect: 'follow'
    });

    request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    request.setHeader('Accept', '*/*');

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        if (!isFinished) {
          isFinished = true;
          fileStream.close();
          fs.unlink(destPath, () => {});
          onError(new Error(`HTTP Status ${response.statusCode}`));
        }
        return;
      }

      const contentLength = response.headers['content-length'];
      const totalBytes = parseInt(Array.isArray(contentLength) ? contentLength[0] : (contentLength || '0'), 10);
      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        fileStream.write(chunk);

        let percent = 5;
        if (totalBytes > 0) {
          percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
        } else {
          percent = Math.min(99, Math.max(5, Math.round((downloadedBytes / (1024 * 1024 * 10)) * 100)));
        }

        if (percent !== lastSentPercent) {
          lastSentPercent = percent;
          if (onProgress) onProgress(percent);
        }
      });

      response.on('end', () => {
        fileStream.end(() => {
          if (!isFinished) {
            isFinished = true;
            if (onProgress) onProgress(100);
            onComplete();
          }
        });
      });

      response.on('error', (err) => {
        if (!isFinished) {
          isFinished = true;
          fileStream.close();
          fs.unlink(destPath, () => {});
          onError(err);
        }
      });
    });

    request.on('error', (err) => {
      if (!isFinished) {
        isFinished = true;
        fileStream.close();
        fs.unlink(destPath, () => {});
        onError(err);
      }
    });

    request.end();
  } catch (err) {
    if (!isFinished) {
      isFinished = true;
      onError(err);
    }
  }
}

// 독립 업데이터: .ps1 스크립트 직접 생성 후 실행
function applyUpdateAndRestart(downloadUrl) {
  isQuitting = true;

  const appRootDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const scriptDir = path.join(app.getPath('temp'), 'ugul_updater');

  // 폴더 생성
  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }

  const finalUrl = (downloadUrl && downloadUrl.trim()) ? downloadUrl.trim() : (typeof pendingDownloadUrl !== 'undefined' && pendingDownloadUrl ? pendingDownloadUrl : 'https://github.com/ugulsunday1306-droid/Calander/releases/download/v0.0.17/UGULCalander-win32-x64.zip');

  const configPath = path.join(scriptDir, 'update_config.json'); // 디버깅 참고용 (스크립트는 이 파일을 읽지 않음)
  const psScriptPath = path.join(scriptDir, 'ugul_updater.ps1');

  const configData = {
    downloadUrl: finalUrl,
    appRootDir: appRootDir
  };

  // 사람이 읽기 위한 참고 로그 (실패해도 무시)
  try {
    fs.writeFileSync(configPath, '﻿' + JSON.stringify(configData, null, 2), 'utf-8');
  } catch (e) {}

  // 한글(비-ASCII) 경로가 Node -> 파일 -> PowerShell로 넘어가는 과정에서
  // 콘솔/시스템 코드페이지 문제로 깨지는 것을 원천 차단하기 위해, 별도 파일을 거치지 않고
  // Base64(UTF-8)로 인코딩해서 스크립트 본문에 직접 심어 전달한다.
  const configBase64 = Buffer.from(JSON.stringify(configData), 'utf-8').toString('base64');
  const exeName = app.isPackaged ? path.basename(process.execPath) : 'UGULCalander.exe';

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "UGUL Calander Updater"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   UGUL Calander Standalone Updater      " -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Base64(UTF-8)로 전달된 설정을 디코딩 (코드페이지로 인한 경로 깨짐 방지)
$configB64 = "${configBase64}"
$configJsonText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($configB64))
$cfg = $configJsonText | ConvertFrom-Json
$url = $cfg.downloadUrl
$appDir = $cfg.appRootDir
$exeName = "${exeName}"
$zipPath = Join-Path $env:TEMP "ugul_update.zip"
$extractDir = Join-Path $env:TEMP "ugul_extracted"

Write-Host "Download URL : $url" -ForegroundColor Gray
Write-Host "App Directory: $appDir" -ForegroundColor Gray
Write-Host ""

function Fail($msg) {
    Write-Host ""
    Write-Host "-> FAILED: $msg" -ForegroundColor Red
    Write-Host "(Press Enter to close this window)" -ForegroundColor DarkGray
    Read-Host | Out-Null
    [Environment]::Exit(1)
}

try {
    Write-Host "[1/5] Terminating app..." -ForegroundColor Green
    $procName = [System.IO.Path]::GetFileNameWithoutExtension($exeName)
    Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    # 프로세스가 완전히 종료될 때까지 최대 10초 대기 (파일 잠금 해제 보장)
    $waited = 0
    while ((Get-Process -Name $procName -ErrorAction SilentlyContinue) -and $waited -lt 10) {
        Start-Sleep -Milliseconds 500
        $waited += 0.5
    }
    Start-Sleep -Milliseconds 500
    Write-Host "-> Done" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "[2/5] Downloading patch..." -ForegroundColor Green
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "UGUL-App")
        $wc.DownloadFile($url, $zipPath)
        Write-Host "-> Download OK" -ForegroundColor Cyan
    } catch {
        Fail "Download failed - $_"
    }
    Write-Host ""

    Write-Host "[3/5] Extracting zip..." -ForegroundColor Green
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction Stop }
    try {
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force -ErrorAction Stop
        Write-Host "-> Extract OK" -ForegroundColor Cyan
    } catch {
        Fail "Extract failed - $_"
    }
    Write-Host ""

    Write-Host "[4/5] Overwriting files..." -ForegroundColor Green
    $src = $extractDir
    $inner = Join-Path $extractDir "UGULCalander-win32-x64"
    if (Test-Path $inner) { $src = $inner }
    if (-not (Test-Path $appDir)) {
        New-Item -ItemType Directory -Path $appDir -Force -ErrorAction Stop | Out-Null
    }
    try {
        Copy-Item -Path (Join-Path $src "*") -Destination $appDir -Recurse -Force -ErrorAction Stop
        Write-Host "-> Overwrite OK" -ForegroundColor Cyan
    } catch {
        Fail "Overwrite failed (file may still be locked) - $_"
    }
    Write-Host ""

    Write-Host "[5/5] Restarting app..." -ForegroundColor Green
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    $exe = Join-Path $appDir $exeName
    if (Test-Path $exe) {
        try {
            # cmd.exe의 start를 한 겹 더 거쳐서 새 exe를 완전히 독립된 프로세스/콘솔로 띄운다.
            # (이렇게 해야 이 업데이터 창을 닫아도 방금 켠 앱이 같이 죽지 않는다.)
            $cmdArgLine = '/c start "" "' + $exe + '"'
            Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgLine -WorkingDirectory $appDir -WindowStyle Hidden -ErrorAction Stop
            Write-Host "-> Launch OK" -ForegroundColor Cyan

            # 진단용 로그 (문제가 재발하면 이 파일로 원인을 좁힐 수 있다)
            try {
                $logPath = Join-Path $env:TEMP "ugul_updater_debug.log"
                $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
                "[$(Get-Date -Format o)] updater PID=$PID parentPID=$parentId launched=$exe" | Out-File -FilePath $logPath -Append -Encoding UTF8
            } catch {}
        } catch {
            Fail "Launch failed - $_"
        }
    } else {
        Fail "EXE not found at $exe"
    }
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "   Update Complete!                      " -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Cyan
    Start-Sleep -Seconds 2
} catch {
    Fail "Unexpected error - $_"
} finally {
    Write-Host ""
    [Environment]::Exit(0)
}
`;

  fs.writeFileSync(psScriptPath, psScript, 'utf-8');

  try {
    // detached+stdio:'ignore' spawn 조합은 Windows에서 콘솔 창 자체가 안 뜨는 경우가 있어
    // (헤드리스로 백그라운드 실행됨) "업데이터가 실행 안 되는 것처럼 보이는" 증상으로 이어졌다.
    // 창이 확실히 뜨는 걸로 검증된 기존 방식(cmd의 start)으로 되돌린다.
    exec(`start "" "${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')}" -ExecutionPolicy Bypass -NoProfile -File "${psScriptPath}"`, (err) => {
      if (err) console.error('Failed to launch updater (exec callback):', err);
    });

    setTimeout(() => {
      if (mainWindow) mainWindow.destroy();
      app.exit(0);
    }, 1000);
  } catch (err) {
    console.error('Failed to launch updater:', err);
  }
}

ipcMain.on('start-direct-update', (event, downloadUrl) => {
  applyUpdateAndRestart(downloadUrl);
});

ipcMain.handle('save-update-zip-and-apply', async (event, arrayBuffer) => {
  try {
    const tempZipPath = path.join(app.getPath('temp'), 'ugul_update.zip');
    const buffer = Buffer.from(arrayBuffer);

    // 1. 패치 ZIP 파일 저장 (동기 blocking 외부명령 제거로 100% 즉시 반환)
    fs.writeFileSync(tempZipPath, buffer);

    // 2. 0.3초 후 PowerShell 직통 업데이트 런처 실행
    setTimeout(() => {
      applyUpdateAndRestart(tempZipPath);
    }, 300);
    return { success: true };
  } catch (err) {
    console.error('Failed to save update zip buffer:', err);
    return { success: false, error: err.message };
  }
});

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
  const extractTempDir = path.join(app.getPath('temp'), 'ugul_extracted_update');

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

      if (fs.existsSync(extractTempDir)) {
        fs.rmSync(extractTempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(extractTempDir, { recursive: true });

      try {
        execSync(`tar -xf "${tempZipPath}" -C "${extractTempDir}"`);
      } catch (e1) {
        try {
          execSync(`powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${extractTempDir}' -Force"`);
        } catch (e2) {}
      }

      setTimeout(() => {
        applyUpdateAndRestart(tempZipPath, extractTempDir);
      }, 1200);
    },
    (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('update-error', err.message);
      }
    }
  );
});

ipcMain.on('open-external-url', (event, url) => {
  if (url) {
    shell.openExternal(url);
  }
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

    ipcMain.on('hide-window', () => {
      if (mainWindow) {
        mainWindow.hide();
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
