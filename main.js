const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');

// [규칙] 창 식별자는 상수로 관리해 문자열 오타와 참조 불일치를 방지한다.
const WINDOW_NAME_CLOSE_POPUP = 'closePopup';
const WINDOW_NAME_UPDATE_POPUP = 'updatePopup';
const WINDOW_NAME_TEXTBOOK = 'textbook';
const WINDOW_NAME_MAIN = 'main';

// [규칙] BrowserWindow 공통 설정값. 개별 창에서 특별한 요구가 없으면 이 값을 사용한다.
const WINDOW_WEB_PREFERENCES = {
  preload: path.join(__dirname, 'preload.js'),
  plugins: true,
  nodeIntegration: true,
  textAreasAreResizable: false,
  defaultEncoding: 'UTF-8',
};

// [동작] 창 이름 -> webContents id 매핑 저장소. 동일 이름 창 재사용에 사용한다.
const windowIdByName = {};
let projectTitle = null;

/*************************** get Route ****************************/
// [목적] 실행 위치(run/electron, 패키징 여부)가 달라도 공통 리소스 루트를 계산한다.
const currentDir = __dirname;
const matchedFolderName = ['run', 'electron'].find((folder) => currentDir.includes(folder)) || '';
const route = {};
route.template = matchedFolderName ? `${currentDir.split(matchedFolderName)[0]}` : currentDir;
route.app = path.join(route.template, 'app');
route.resource = path.join(route.app, 'resource');
route.viewer = path.join(route.app, 'viewer');
/******************************************************************/

/************************ local functions *************************/
function getWindowByName(name) {
  return BrowserWindow.getAllWindows().filter((window) => window.name === name)[0];
}

function getWindowById(id) {
  return BrowserWindow.getAllWindows().filter((window) => window.webContents.id === id)[0];
}

function permissionCheckHandler(_webContents, permission, _requestingOrigin) {
  // [규칙] 현재 앱에서 필요한 권한만 허용한다.
  if (permission === 'media') return true;
}

function registerWindowIdByName(window) {
  // [동작] IPC 재호출 시 기존 창을 찾을 수 있도록 창 id를 이름 기준으로 등록한다.
  windowIdByName[window.name] = window.webContents.id;
}

function createContentWindow(properties = {}) {
  const window = new BrowserWindow({
    width: properties.width || 1280,
    height: properties.height || 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { ...WINDOW_WEB_PREFERENCES },
  });
  window.webContents.session.setPermissionCheckHandler(permissionCheckHandler);
  window.once('ready-to-show', () => window.show());

  // [규칙] 외부 링크(http/https)는 앱 내부가 아닌 OS 기본 브라우저에서 연다.
  window.webContents.setWindowOpenHandler(({ url: openedUrl }) => {
    if (openedUrl.startsWith('http')) {
      shell.openExternal(openedUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  return window;
}

function handleWindowClose(event) {
  // [동작] 내부 플래그로 닫기 요청된 경우 확인 절차 없이 즉시 종료한다.
  if (this.isClosing) {
    this.close();
    this.isClosing = false;
    return;
  }

  // [동작] 사용자 직접 종료는 기본 동작을 막고 확인 팝업으로 최종 의사를 받는다.
  event.preventDefault();
  this.once('close', handleWindowClose);
  const mode = this.name === WINDOW_NAME_TEXTBOOK ? 'save' : 'close';
  const popup = getWindowByName(WINDOW_NAME_CLOSE_POPUP) || new BrowserWindow({
    width: 500,
    height: 300,
    titleBarStyle: 'hidden',
    center: true,
    resizable: false,
    webPreferences: { ...WINDOW_WEB_PREFERENCES },
  });
  popup.name = WINDOW_NAME_CLOSE_POPUP;
  popup.loadURL(path.join(route.template, 'splash', `close.html`) + `?mode=${mode}&&name=${this.name}`);
  popup.focus();
}

// ------------------------------ 업데이트 처리 ------------------------------ //
function runUpdateDialog() {
  const popup = getWindowByName(WINDOW_NAME_UPDATE_POPUP) || new BrowserWindow({
    width: 500,
    height: 300,
    titleBarStyle: 'hidden',
    center: true,
    resizable: false,
    webPreferences: { ...WINDOW_WEB_PREFERENCES },
  });
  popup.name = WINDOW_NAME_UPDATE_POPUP;
  popup.loadURL(path.join(route.template, 'splash', `update.html`));
  popup.focus();
}

async function downloadFile(url) {
  // [입출력] URL -> Buffer. 네트워크 응답이 실패면 예외를 발생시킨다.
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.buffer();
}

async function checkUpdate(updateInfo, signal) {
  // [입출력] 로컬 update 정보와 서버 정보를 비교해 "필요한 업데이트 목록"을 반환한다.
  // [예외] 최신 버전이거나 응답 실패 시 예외를 발생시킨다.
  const { server, updateList } = updateInfo;
  const response = await fetch(`${server}/update.json`, { signal });
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }

  const jsonData = await response.json();
  const latestUpdateList = jsonData.updateList;
  const notLatest = updateList.length === 0 || updateList.at(-1).version < latestUpdateList.at(-1).version;
  if (!notLatest) {
    throw new Error('It\'s the latest version!');
  }

  return {
    server,
    updateJSON: await downloadFile(`${server}/update.json`),
    updateList: latestUpdateList.filter((update) => (updateList.length > 0 ? updateList.at(-1).version < update.version : true)),
  };
}

async function runUpdate() {
  // [동작] 업데이트 zip을 순차 적용한다. (버전 순서 의존 가능성 고려)
  const { updateJSON, updateList, server } = app.updateData;

  for (let i = 0; i < updateList.length; i++) {
    const name = updateList[i].name || `ver_${updateList[i].version}.zip`;
    const zipPath = server.includes('http') ? new URL(name, server).href : path.join(server, name);
    const destPath = path.join(route.resource);
    const downloadedZipFile = await downloadFile(zipPath);
    const zipFile = await unzipper.Open.buffer(downloadedZipFile);
    await zipFile.extract({ path: destPath });
    console.log('finished');
  }

  fs.writeFileSync(path.join(route.resource, 'update.json'), updateJSON);
  getWindowByName(WINDOW_NAME_UPDATE_POPUP)?.destroy();
  createMainWindow();
}
// --------------------------------------------------------------------------- //

const createMainWindow = () => {
  // [동작] 메인 콘텐츠 준비 전 스플래시를 먼저 노출해 초기 로딩 공백을 줄인다.
  const splash = new BrowserWindow({
    width: 500,
    height: 500,
    titleBarStyle: 'hidden',
    center: true,
    resizable: false,
    alwaysOnTop: true,
  });
  splash.loadFile(path.join(route.template, 'splash', 'splash.html'));

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { ...WINDOW_WEB_PREFERENCES },
  });
  mainWindow.name = WINDOW_NAME_MAIN;
  mainWindow.isClosing = false;
  mainWindow.loadFile('launcher.html');
  mainWindow.webContents.session.setPermissionCheckHandler(permissionCheckHandler);

  mainWindow.once('ready-to-show', async () => {
    // [동작] config.json 기준으로 실제 시작 페이지/창 속성을 적용한다.
    const properties = JSON.parse(fs.readFileSync(path.join(route.resource, 'config.json')));
    mainWindow.loadFile(path.join(route.resource, properties.main));
    mainWindow.setSize(properties.width || 1280, properties.height || 720);
    if (properties.title) {
      mainWindow.setTitle(properties.title);
      projectTitle = properties.title;
    }
    if (properties.icon) mainWindow.setIcon(path.join(route.resource, properties.icon));
    if (properties.maximize) mainWindow.maximize();

    mainWindow.show();
    splash.destroy();
  });

  // [규칙] 외부 링크는 앱 내부 창으로 열지 않고 시스템 브라우저로 위임한다.
  mainWindow.webContents.setWindowOpenHandler(({ url: openedUrl }) => {
    if (openedUrl.startsWith('http')) {
      shell.openExternal(openedUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.once('close', handleWindowClose);
  registerWindowIdByName(mainWindow);
};
/******************************************************************/

/************************* create APP API *************************/
ipcMain.on('open-dev-tools', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window.webContents.openDevTools();
});

ipcMain.on('open-window', (event, resourceUrl, target = '_blank', properties = {}) => {
  let currentWindow;
  const name = properties.name || 'contents';

  if (target !== '_blank') {
    // [동작] 현재 창에서 열기 요청이면 송신자 창을 재사용한다.
    currentWindow = BrowserWindow.fromWebContents(event.sender);
  } else {
    // [동작] 새 창 요청이면 기존 창 우선 재사용, 없으면 새 창 생성.
    currentWindow = getWindowById(windowIdByName[name]) || createContentWindow(properties);
  }
  currentWindow.name = name;
  currentWindow.setIcon(path.join(route.resource, 'favicon.png'));
  currentWindow.loadURL(path.join(route.resource, resourceUrl));
  // currentWindow.focus();
  if (properties.maximize) currentWindow.maximize();
  if (name === 'contents') currentWindow.once('close', handleWindowClose);
  if (properties.focusing !== false) currentWindow.focus();
  if (projectTitle) currentWindow.setTitle(projectTitle);
  registerWindowIdByName(currentWindow);
});

ipcMain.on('open-viewer', (event, contentUrl, target = '_blank', properties = {}) => {
  let currentWindow;
  const name = properties.name || WINDOW_NAME_TEXTBOOK;
  const targetViewer = properties.targetViewer || name;
  const viewerUrl = path.join(route.viewer, 'index.html') + '?contentURL=' + contentUrl;

  if (target !== '_blank') {
    currentWindow = BrowserWindow.fromWebContents(event.sender);
  } else {
    // [동작] viewer 창은 targetViewer 우선, 없으면 name 기준으로 재사용한다.
    currentWindow = getWindowById(windowIdByName[targetViewer]) || getWindowById(windowIdByName[name]) || createContentWindow(properties);
  }
  currentWindow.name = name;
  currentWindow.setIcon(path.join(route.resource, 'favicon.png'));
  currentWindow.loadURL(viewerUrl);
  currentWindow.maximize();
  currentWindow.isClosing = false;
  // currentWindow.focus();
  if (name === WINDOW_NAME_TEXTBOOK) currentWindow.once('close', handleWindowClose);
  if (properties.focusing !== false) currentWindow.focus();
  if (projectTitle) currentWindow.setTitle(projectTitle);
  registerWindowIdByName(currentWindow);
});

ipcMain.on('open-link', (event, externalUrl) => {
  // [규칙] 스킴이 없는 링크는 http://를 기본값으로 보완한다.
  shell.openExternal(externalUrl.includes('http') ? externalUrl : 'http://' + externalUrl);
});

// [목적] renderer 입력 경로를 route.resource 하위로 제한해 경로 이탈(path traversal)을 차단한다.
function resolveTargetPath(targetPath, location, openFolder = false) {
  const resourceRoot = path.resolve(route.resource);
  let baseDir = resourceRoot;

  if (location) {
    const relativeLocation = location.includes('resource/')
      ? location.split('/resource/')[1]
      : location.split('/viewer/')[1];
    baseDir = path.resolve(resourceRoot, path.dirname(relativeLocation || ''));
  }

  const resolvedPath = openFolder
    ? path.resolve(resourceRoot, targetPath)
    : path.resolve(baseDir, targetPath);

  // [예외] route.resource 루트 밖 경로는 차단한다.
  if (resolvedPath !== resourceRoot && !resolvedPath.startsWith(`${resourceRoot}${path.sep}`)) {
    throw new Error(`Blocked path outside resource: ${targetPath}`);
  }
  return resolvedPath;
}

ipcMain.on('open-file', (event, { url: targetPath, location }) => {
  try {
    const resolvedPath = resolveTargetPath(targetPath, location);

    if (targetPath.includes('.pdf')) {
      const currentWindow = createContentWindow();
      currentWindow.loadURL(resolvedPath);
      currentWindow.setIcon(path.join(route.resource, 'favicon.png'));
      currentWindow.maximize();
    } else {
      shell.openPath(resolvedPath);
    }
  } catch (error) {
    console.error('open-file blocked:', error.message);
  }
});

ipcMain.on('open-folder', (event, { url: targetPath, location }) => {
  try {
    shell.showItemInFolder(resolveTargetPath(targetPath, location, true));
  } catch (error) {
    console.error('open-folder blocked:', error.message);
  }
});

ipcMain.on('capture', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window.webContents.capturePage().then((image) => {
    // [동작] 사용자가 선택한 파일 경로에 캡처 이미지를 PNG로 저장한다.
    dialog.showSaveDialog().then((result) => {
      if (result.canceled || !result.filePath) return;
      fs.writeFileSync(result.filePath, image.toPNG());
      console.log('It\'s saved!');
      return image.toDataURL();
    });
  });
});

ipcMain.on('save-progress', (event, classNumber) => {
  const window = getWindowByName(WINDOW_NAME_TEXTBOOK);
  window?.webContents?.executeJavaScript(`PROGRESS.save('${classNumber}')`).catch((error) => {
    console.error('Error save progress:', error);
  });
});

ipcMain.on('move-page-textbook', (event, page) => {
  const window = getWindowByName(WINDOW_NAME_TEXTBOOK);
  // window?.webContents?.executeJavaScript(`VIEWER.GO_PAGE_LOAD(${page})`);
});

// [기능] 교안 창 인쇄 요청 처리
ipcMain.on('print', (event) => {
  const window = getWindowByName(WINDOW_NAME_TEXTBOOK);
  window?.webContents?.print({
    silent: false,
    printBackground: true,
    marginsType: 1,
  });
});

// ------------------------------ 업데이트 IPC ------------------------------ //
ipcMain.on('update', (event, result) => {
  if (result) runUpdate();
  else createMainWindow();
});

ipcMain.on('request-update-info', (event) => {
  const window = getWindowByName(WINDOW_NAME_UPDATE_POPUP);
  window?.webContents?.executeJavaScript(`window.getUpdateInfo('${app.updateMessage}')`).catch((error) => {
    console.error('Error requesting update info:', error);
  });
});
// ------------------------------------------------------------------------- //

ipcMain.on('close-window', (event, name = null) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window.close();
  if (name) {
    const targetWindow = getWindowByName(name);
    if (!targetWindow) return;
    targetWindow.isClosing = true;
    targetWindow.close();
  }
});
/******************************************************************/

// 터치 이벤트 플래그 추가(전자칠판에서 터치하면 Electron이 터치 이벤트를 인식 못 하거나 iframe 경계에서 드랍하는 경우를 대비하여 삽입)
app.commandLine.appendSwitch('touch-events', 'enabled');

app.whenReady().then(async () => {
  for (const type of ['chrome', 'node', 'electron']) {
    console.log(`${type}-version`, process.versions[type]);
  }

  // ------------------------------ 시작 시 업데이트 확인 ------------------------------ //
  const abortController = new AbortController();
  try {
    await new Promise((resolve, reject) => {
      // 서버에서 답이 없는 경우 10초 뒤에 업데이트 요청 중지
      const timeId = setTimeout(() => abortController.abort(), 10 * 1000);

      // const data = fs.readFileSync(path.join(route.resource, 'update.json'));
      let data;
      try {
        data = fs.readFileSync(path.join(route.resource, 'update.json'));
        checkUpdate(JSON.parse(data), abortController.signal)
          .then((updateData) => {
            clearTimeout(timeId);
            if (updateData) {
              app.updateData = updateData;
              app.updateMessage = updateData.updateList.map(({ version, desc }) => `<p>${version}: ${desc}</p>`).join('');
              runUpdateDialog();
            } else {
              resolve();
            }
          })
          .catch((error) => {
            clearTimeout(timeId);
            console.error('Checking Update Json Error!', error);
            reject(error);
          });
      } catch (error) {
        clearTimeout(timeId);
        console.error('Dose Not Exist update.json:', error.message);
        reject(error); // 파일이 없으면 업데이트 건너뜀
      }
    });
  } catch (error) {
    console.log(`Unable Update Error!`, error.message);
  }
  // ------------------------------------------------------------------------------ //

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
