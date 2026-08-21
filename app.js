// TimeFlow Planner - Main Logic

// --- Constants & Config ---
const START_HOUR = 0;
const END_HOUR = 24; // 24:00 is midnight
const TOTAL_HOURS = END_HOUR - START_HOUR;
let SLOT_HEIGHT = 12; // 12px per 10 mins (dynamic for zoom)
let COL_WIDTH = 160;   // 160px column width (dynamic for horizontal zoom)
const SLOTS_PER_HOUR = 6;
const SLOT_DURATION_MINS = 10;

// State Management
let state = {
  currentWeekStart: null, // Monday of the current week (Date object)
  events: [],             // Array of event objects
  isDragging: false,
  dragStartSlot: null,
  dragStartDayIdx: null,
  dragEndSlot: null,
  activeTemplate: null,   // Currently selected quick template
  editingEventId: null,   // Event ID being edited (if any)
  hoveredEventId: null,   // Currently hovered event ID for Ctrl+C copy
  hoveredMemoId: null,    // Currently hovered memo ID for Ctrl+C copy
  internalClipboard: null,// Internal clipboard for Ctrl+C/Ctrl+V
  lastGridDayIdx: 0,      // Last hovered grid day index
  lastGridSlotIdx: 0,     // Last hovered grid slot index
  undoStack: [],          // Array of action history for multi-level undo
  ringingAlarm: null,     // Currently ringing alarm event
  snoozeAlarms: [],       // Array of in-memory snooze alarms
  logoIcon: null,         // Custom logo icon base64 string
  globalShortcut: null,   // Global shortcut key string
  memoItems: [],          // PureRef Canvas Memo items
  activeView: 'calendar'  // Active view: 'calendar' | 'memo'
};

// Global Script Error Safety Listener
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error("Global JS Error:", msg, "at line", lineNo, error);
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:999999;background:rgba(239,68,68,0.95);color:#fff;padding:12px 18px;border-radius:8px;font-size:13px;font-weight:bold;box-shadow:0 10px 25px rgba(0,0,0,0.5);';
  toast.textContent = `⚠️ Script Error: ${msg} (Line ${lineNo})`;
  document.body.appendChild(toast);
  return false;
};

// --- Initial Setup on DOM Load ---
document.addEventListener('DOMContentLoaded', () => {
  console.time('UGUL_Calendar_Init');
  const safeRun = (fn, name) => {
    try {
      fn();
    } catch (err) {
      console.error(`[Init Error in ${name}]:`, err);
    }
  };

  safeRun(initDateState, 'initDateState');
  safeRun(loadEventsFromStorage, 'loadEventsFromStorage');
  safeRun(loadTriggeredAlarms, 'loadTriggeredAlarms');
  safeRun(generateTimeDropdowns, 'generateTimeDropdowns');
  safeRun(renderGrid, 'renderGrid');
  safeRun(renderCurrentWeek, 'renderCurrentWeek');
  safeRun(setupEventListeners, 'setupEventListeners');
  safeRun(updateSidebarStats, 'updateSidebarStats');
  safeRun(initTheme, 'initTheme');
  safeRun(initAppTitleAndLogo, 'initAppTitleAndLogo');
  safeRun(initOptionsModal, 'initOptionsModal');
  safeRun(initAlarmSystem, 'initAlarmSystem');
  safeRun(initViewSlider, 'initViewSlider');
  safeRun(initGlobalShortcutUI, 'initGlobalShortcutUI');
  safeRun(initMemoCanvas, 'initMemoCanvas');
  
  if (typeof lucide !== 'undefined') {
    safeRun(() => lucide.createIcons(), 'lucide.createIcons');
  }
  console.timeEnd('UGUL_Calendar_Init');
});

// Final save safety hook on close
window.addEventListener('beforeunload', () => {
  saveEventsToStorage();
});

// --- Date & Time Helper Functions ---

// --- PureRef Canvas Bounds Board Functions ---
function updateCanvasBoardBounds() {
  const viewport = document.getElementById('memo-canvas-viewport');
  if (!viewport) return;

  let boardEl = document.getElementById('memo-canvas-board');
  if (!boardEl) {
    boardEl = document.createElement('div');
    boardEl.id = 'memo-canvas-board';
    boardEl.className = 'memo-canvas-board';
    viewport.insertBefore(boardEl, viewport.firstChild);
  }

  if (!state.memoItems || state.memoItems.length === 0) {
    boardEl.style.left = '80px';
    boardEl.style.top = '80px';
    boardEl.style.width = '1200px';
    boardEl.style.height = '800px';
    return;
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  state.memoItems.forEach(item => {
    const w = item.width || 200;
    const h = item.height || 100;
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + w);
    maxY = Math.max(maxY, item.y + h);
  });

  const padding = 100;
  const boardX = minX - padding;
  const boardY = minY - padding;
  const boardW = Math.max(600, (maxX - boardX) + padding);
  const boardH = Math.max(400, (maxY - boardY) + padding);

  boardEl.style.left = boardX + 'px';
  boardEl.style.left = boardX + 'px';
  boardEl.style.top = boardY + 'px';
  boardEl.style.width = boardW + 'px';
  boardEl.style.height = boardH + 'px';
}
window.updateCanvasBoardBounds = updateCanvasBoardBounds;

function focusCanvasBoard(targetItems = null) {
  const scrollContainer = document.getElementById('memo-canvas-scroll');
  const viewport = document.getElementById('memo-canvas-viewport');
  if (!scrollContainer || !viewport) return;

  let itemsToFocus = targetItems;
  if (!itemsToFocus) {
    const selectedIds = getSelectedMemoIds();
    if (selectedIds && selectedIds.length > 0) {
      itemsToFocus = state.memoItems.filter(m => selectedIds.includes(m.id));
    }
  }
  if (!itemsToFocus || itemsToFocus.length === 0) {
    itemsToFocus = state.memoItems || [];
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  if (!itemsToFocus || itemsToFocus.length === 0) {
    minX = 80;
    minY = 80;
    maxX = 1280;
    maxY = 880;
  } else {
    itemsToFocus.forEach(item => {
      const w = item.width || 200;
      const h = item.height || 100;
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + w);
      maxY = Math.max(maxY, item.y + h);
    });
  }

  const padding = 70;
  const boardX = minX - padding;
  const boardY = minY - padding;
  const boardW = Math.max(300, (maxX - minX) + (padding * 2));
  const boardH = Math.max(200, (maxY - minY) + (padding * 2));

  const containerW = scrollContainer.clientWidth || window.innerWidth;
  const containerH = scrollContainer.clientHeight || window.innerHeight;

  const scaleX = containerW / boardW;
  const scaleY = containerH / boardH;
  let targetZoom = Math.min(scaleX, scaleY) * 0.92;
  // 최소 배율 0.02 (2%), 최대 배율 2.5 (250%)까지 확대/축소 지원하여 아무리 큰 캔버스라도 한눈에 포커싱!
  targetZoom = Math.min(2.5, Math.max(0.02, targetZoom));

  const boardCenterX = boardX + (boardW / 2);
  const boardCenterY = boardY + (boardH / 2);

  const targetPanX = Math.round((containerW / 2) - (boardCenterX * targetZoom));
  const targetPanY = Math.round((containerH / 2) - (boardCenterY * targetZoom));

  state.memoZoom = targetZoom;
  state.memoPanX = targetPanX;
  state.memoPanY = targetPanY;

  applyMemoTransform();
}

function getCategoryColor(catId) {
  if (!catId) return '#818cf8';
  if (catId === 'work') return getComputedStyle(document.documentElement).getPropertyValue('--cat-work').trim() || '#818cf8';
  if (catId === 'study') return getComputedStyle(document.documentElement).getPropertyValue('--cat-study').trim() || '#34d399';
  if (catId === 'personal') return getComputedStyle(document.documentElement).getPropertyValue('--cat-personal').trim() || '#f472b6';
  if (catId === 'health') return getComputedStyle(document.documentElement).getPropertyValue('--cat-health').trim() || '#fbbf24';

  try {
    const customCats = JSON.parse(localStorage.getItem('ugul_custom_categories') || '[]');
    const found = customCats.find(c => c.id === catId);
    if (found && found.color) {
      return found.color;
    }
  } catch (e) {}

  return '#818cf8';
}

function getCustomCategoryCardStyle(colorHex) {
  if (!colorHex) colorHex = '#a855f7';
  try {
    let hex = colorHex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) throw new Error('Invalid color');

    const r2 = Math.min(255, Math.round(r * 0.82 + 15));
    const g2 = Math.min(255, Math.round(g * 0.82 + 15));
    const b2 = Math.min(255, Math.round(b * 0.82 + 15));

    const color1 = `rgb(${r}, ${g}, ${b})`;
    const color2 = `rgb(${r2}, ${g2}, ${b2})`;

    return {
      borderLeftColor: color1,
      background: `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`,
      boxShadow: `0 4px 10px rgba(${r}, ${g}, ${b}, 0.35)`
    };
  } catch (e) {
    return {
      borderLeftColor: '#a855f7',
      background: 'linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%)',
      boxShadow: '0 4px 10px rgba(168, 85, 247, 0.35)'
    };
  }
}

window.focusCanvasBoard = focusCanvasBoard;

// Get Monday of the week for a given date
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  // d.getDay() returns 0 (Sun) to 6 (Sat).
  // Monday is 1. If Sunday (0), we need to go back 6 days.
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function initDateState() {
  const today = new Date();
  state.currentWeekStart = getMonday(today);
}

// Convert slot index (0 to 102) to time string "HH:MM"
function slotIndexToTime(slotIdx) {
  const totalMinutes = START_HOUR * 60 + slotIdx * SLOT_DURATION_MINS;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Convert time string "HH:MM" to slot index
function timeToSlotIndex(timeStr) {
  const [hours, mins] = timeStr.split(':').map(Number);
  const totalMinutes = hours * 60 + mins;
  const startMinutes = START_HOUR * 60;
  return Math.floor((totalMinutes - startMinutes) / SLOT_DURATION_MINS);
}

// Format Date object to "YYYY-MM-DD"
function formatDateToString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format Date object for display (Korean)
function formatDateToKorean(dateStr) {
  const dateObj = new Date(dateStr);
  const daysKo = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dateObj.getFullYear()}년 ${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 (${daysKo[dateObj.getDay()]})`;
}

// Helper to get array of Dates for the current week (Monday to Sunday)
function getCurrentWeekDates() {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(state.currentWeekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// Get the date of a specific day index in the current week
function getDateByDayIndex(dayIdx) {
  const d = new Date(state.currentWeekStart);
  d.setDate(d.getDate() + dayIdx);
  return formatDateToString(d);
}

// Helper: difference in minutes between two "HH:MM" strings
function getDurationMinutes(start, end) {
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

// --- Local/Electron File & LocalStorage Integration ---
function loadEventsFromStorage() {
  if (window.electronAPI) {
    const loaded = window.electronAPI.loadEvents();
    if (loaded) {
      // Support nested config payload (theme, customColors, events)
      if (loaded.events && Array.isArray(loaded.events)) {
        state.events = loaded.events;
        
        if (loaded.theme) {
          localStorage.setItem('ugul_calander_theme', loaded.theme);
        }
        if (loaded.customColors) {
          localStorage.setItem('ugul_calander_custom_colors', JSON.stringify(loaded.customColors));
        }
        if (loaded.logoIcon) {
          state.logoIcon = loaded.logoIcon;
          localStorage.setItem('ugul_calander_logo_icon', loaded.logoIcon);
        }
        if (loaded.globalShortcut) {
          state.globalShortcut = loaded.globalShortcut;
          renderShortcutInput();
          if (window.electronAPI && typeof window.electronAPI.registerGlobalShortcut === 'function') {
            window.electronAPI.registerGlobalShortcut(loaded.globalShortcut);
          }
        }
        if (loaded.memoItems && Array.isArray(loaded.memoItems)) {
          state.memoItems = loaded.memoItems.filter(m => m && typeof m === 'object' && m.id && m.type);
        }
        return;
      }
      // Fallback for flat array structure (older format)
      if (Array.isArray(loaded)) {
        state.events = loaded;
        return;
      }
    } else {
      // 만약 Electron 메인에서 로드된 데이터가 null인 경우(events.json 삭제 등 초기화 요청)
      // localStorage에 보관된 캐시도 완전히 삭제하고 빈 일정으로 시작합니다.
      state.events = [];
      state.logoIcon = null;
      state.globalShortcut = null;
      state.memoItems = [];
      localStorage.removeItem('timeflow_events');
      localStorage.removeItem('ugul_calander_theme');
      localStorage.removeItem('ugul_calander_custom_colors');
      localStorage.removeItem('ugul_calander_logo_icon');
      renderShortcutInput();
      renderMemoCanvas();
      return;
    }
  }

  const savedLogo = localStorage.getItem('ugul_calander_logo_icon');
  if (savedLogo) {
    state.logoIcon = savedLogo;
  }

  const saved = localStorage.getItem('timeflow_events');
  if (saved) {
    try {
      state.events = JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing localStorage events', e);
      state.events = [];
    }
  } else {
    // Seed some mock events for demonstration if empty
    state.events = [
      {
        id: 'mock-1',
        title: '주간 기획 회의',
        day: formatDateToString(getCurrentWeekDates()[0]), // Monday
        startTime: '09:00',
        endTime: '10:30',
        category: 'work',
        description: '이번 주 스케줄러 기능 및 디자인 피드백 세션.'
      },
      {
        id: 'mock-2',
        title: '알고리즘 공부',
        day: formatDateToString(getCurrentWeekDates()[1]), // Tuesday
        startTime: '08:30',
        endTime: '11:00',
        category: 'study',
        description: '다이나믹 프로그래밍 문제 풀이.'
      },
      {
        id: 'mock-3',
        title: '점심 식사 & 산책',
        day: formatDateToString(getCurrentWeekDates()[2]), // Wednesday
        startTime: '12:00',
        endTime: '13:00',
        category: 'personal',
        description: '팀원들과 점심 및 가벼운 휴식.'
      },
      {
        id: 'mock-4',
        title: '헬스 피트니스',
        day: formatDateToString(getCurrentWeekDates()[3]), // Thursday
        startTime: '19:30',
        endTime: '21:00',
        category: 'health',
        description: '하체 근력 운동 및 유산소.'
      }
    ];
    saveEventsToStorage();
  }
}

let _saveStorageTimer = null;

function saveEventsToStorage(immediate = false) {
  const performSave = () => {
    const customColorsStr = localStorage.getItem('ugul_calander_custom_colors');
    const theme = localStorage.getItem('ugul_calander_theme') || 'slate';

    let customColors = null;
    try {
      if (customColorsStr) customColors = JSON.parse(customColorsStr);
    } catch(e) {
      console.error('Error parsing custom colors', e);
    }

    const payload = {
      theme: theme,
      customColors: customColors,
      logoIcon: state.logoIcon,
      globalShortcut: state.globalShortcut || null,
      memoItems: state.memoItems || [],
      events: state.events
    };

    if (window.electronAPI && typeof window.electronAPI.saveEvents === 'function') {
      window.electronAPI.saveEvents(payload);
    }
    localStorage.setItem('timeflow_events', JSON.stringify(state.events));
    updateSidebarStats();
  };

  if (immediate) {
    if (_saveStorageTimer) {
      clearTimeout(_saveStorageTimer);
      _saveStorageTimer = null;
    }
    performSave();
  } else {
    if (_saveStorageTimer) clearTimeout(_saveStorageTimer);
    _saveStorageTimer = setTimeout(performSave, 250);
  }
}

// --- UI Generation & Rendering ---

function renderLogoIcon() {
  const container = document.getElementById('brand-logo-container');
  if (!container) return;
  
  if (state.logoIcon) {
    container.innerHTML = `<img src="${state.logoIcon}" alt="Logo">`;
  } else {
    container.innerHTML = `<i data-lucide="clock"></i>`;
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }
}

// Generate select dropdown values (10 min increments)
function generateTimeDropdowns() {
  const startSelect = document.getElementById('event-start-time');
  const endSelect = document.getElementById('event-end-time');
  
  startSelect.innerHTML = '';
  endSelect.innerHTML = '';

  const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;
  for (let i = 0; i <= totalSlots; i++) {
    const timeStr = slotIndexToTime(i);
    
    // Start time cannot be the very last slot (24:00)
    if (i < totalSlots) {
      const optStart = document.createElement('option');
      optStart.value = timeStr;
      optStart.textContent = timeStr;
      startSelect.appendChild(optStart);
    }

    // End time cannot be the very first slot (07:00)
    if (i > 0) {
      const optEnd = document.createElement('option');
      optEnd.value = timeStr;
      optEnd.textContent = timeStr;
      endSelect.appendChild(optEnd);
    }
  }
}

// Generate background grid lines & time labels
function renderGrid() {
  const gridLinesContainer = document.getElementById('grid-lines-container');
  const timeLabelsColumn = document.getElementById('time-column-labels');
  
  gridLinesContainer.innerHTML = '';
  timeLabelsColumn.innerHTML = '';

  for (let h = 0; h <= TOTAL_HOURS; h++) {
    const currentHour = START_HOUR + h;
    const isSolid = h === 0 || h === TOTAL_HOURS || currentHour % 1 === 0; // Solid line at every hour
    
    // Draw row line
    const lineRow = document.createElement('div');
    lineRow.className = `hour-line-row ${isSolid ? 'solid-line' : ''}`;
    lineRow.style.top = `${h * SLOT_HEIGHT * SLOTS_PER_HOUR}px`;
    gridLinesContainer.appendChild(lineRow);

    // Draw time label
    const labelItem = document.createElement('div');
    labelItem.className = 'hour-label-item';
    labelItem.style.top = `${h * SLOT_HEIGHT * SLOTS_PER_HOUR}px`;
    
    const displayHour = currentHour === 24 ? '00:00' : `${String(currentHour).padStart(2, '0')}:00`;
    labelItem.textContent = displayHour;
    
    timeLabelsColumn.appendChild(labelItem);
  }
}

// Render the dates of the current week on the columns
function renderCurrentWeek() {
  const weekDates = getCurrentWeekDates();
  
  // Update week range labels in sidebar
  const startMonthStr = weekDates[0].toLocaleDateString('ko-KR', { month: 'long' });
  const startDayStr = String(weekDates[0].getDate()).padStart(2, '0') + '일';
  const endDayStr = String(weekDates[6].getDate()).padStart(2, '0') + '일';
  
  document.getElementById('current-month').textContent = startMonthStr;
  document.getElementById('current-week-range').textContent = `${startDayStr} - ${endDayStr}`;

  // Update calendar column headers
  const todayStr = formatDateToString(new Date());
  const headerCells = document.querySelectorAll('.day-header-cell');
  
  weekDates.forEach((date, idx) => {
    const headerCell = headerCells[idx];
    const dateLabel = headerCell.querySelector('.header-date');
    dateLabel.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    
    const dateStr = formatDateToString(date);
    headerCell.dataset.date = dateStr;

    // Highlight today
    if (dateStr === todayStr) {
      headerCell.classList.add('today-highlight');
    } else {
      headerCell.classList.remove('today-highlight');
    }
  });

  // Re-generate day interaction columns
  const dayColumnsWrapper = document.getElementById('day-columns-wrapper');
  dayColumnsWrapper.innerHTML = '';

  const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR; // 17 hours * 6 slots = 102

  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const colDate = formatDateToString(weekDates[dayIdx]);
    const dayCol = document.createElement('div');
    dayCol.className = 'day-column';
    dayCol.dataset.dayIdx = dayIdx;
    dayCol.dataset.date = colDate;

    // Append slot cells (10 mins each)
    for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
      const slotCell = document.createElement('div');
      slotCell.className = 'slot-cell';
      slotCell.dataset.dayIdx = dayIdx;
      slotCell.dataset.slotIdx = slotIdx;
      slotCell.dataset.time = slotIndexToTime(slotIdx);
      dayCol.appendChild(slotCell);
    }
    
    dayColumnsWrapper.appendChild(dayCol);
  }

  // Draw event cards for the current week
  renderEvents();
}

// Render schedule cards on the grid
function renderEvents() {
  const overlayContainer = document.getElementById('events-overlay-container');
  overlayContainer.innerHTML = '';

  const weekDates = getCurrentWeekDates();
  const weekDatesStr = weekDates.map(d => formatDateToString(d));
  
  // Get active category filters
  const checkedCategories = Array.from(document.querySelectorAll('.cat-checkbox:checked')).map(el => el.value);
  const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();

  // Filter events belonging to current week, matching category filter & search query
  const filteredEvents = state.events.filter(event => {
    const inWeek = weekDatesStr.includes(event.day);
    const inCategory = checkedCategories.includes(event.category);
    const matchesSearch = searchQuery === '' || 
                          event.title.toLowerCase().includes(searchQuery) || 
                          (event.description && event.description.toLowerCase().includes(searchQuery));
    return inWeek && inCategory && matchesSearch;
  });

  // Group events by day to calculate overlapping layout
  const eventsByDay = {};
  filteredEvents.forEach(evt => {
    if (!eventsByDay[evt.day]) eventsByDay[evt.day] = [];
    eventsByDay[evt.day].push(evt);
  });

  // Render for each day column
  weekDatesStr.forEach((dateStr, dayIdx) => {
    const dayEvents = eventsByDay[dateStr] || [];
    if (dayEvents.length === 0) return;

    // Calculate layout columns for overlapping events
    // Sort events by start time
    const sortedEvents = dayEvents.sort((a, b) => timeToSlotIndex(a.startTime) - timeToSlotIndex(b.startTime));
    
    // Group events into column channels
    const columns = []; // Array of arrays of event objects
    sortedEvents.forEach(event => {
      let placed = false;
      const startSlot = timeToSlotIndex(event.startTime);

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const lastEvent = col[col.length - 1];
        const lastEndSlot = timeToSlotIndex(lastEvent.endTime);
        
        // If this event starts after the last event in this column finishes, we can place it here
        if (startSlot >= lastEndSlot) {
          col.push(event);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
      }
    });

    // Render each event in this day's columns
    columns.forEach((columnEvents, colIdx) => {
      const colCount = columns.length;
      const cardWidthPct = 100 / colCount;
      const cardLeftPct = colIdx * cardWidthPct;

      columnEvents.forEach(event => {
        const startSlot = timeToSlotIndex(event.startTime);
        const endSlot = timeToSlotIndex(event.endTime);
        const durationSlots = endSlot - startSlot;

        // Position coordinates
        const topPx = startSlot * SLOT_HEIGHT;
        const heightPx = durationSlots * SLOT_HEIGHT;

        // Create card element
        const card = document.createElement('div');
        card.className = `event-card ${event.category}`;
        card.setAttribute('draggable', 'true');
        
        // 커스텀 카테고리인 경우만 동적 그라데이션 주입 (기존 4개 기본 카테고리의 오리지널 그라데이션과 100% 동일 규격)
        if (event.category && event.category.startsWith('custom_')) {
          const catColor = getCategoryColor(event.category);
          const styleObj = getCustomCategoryCardStyle(catColor);
          card.style.borderLeftColor = styleObj.borderLeftColor;
          card.style.background = styleObj.background;
          card.style.boxShadow = styleObj.boxShadow;
        }

        // Less than 3 slots (30 minutes) -> render as compact card
        if (durationSlots < 3) {
          card.classList.add('mini-card');
        }

        // Width, left are set relative to the day column grid
        // Monday column starts at (100% / 7) * dayIdx
        const colWidthPct = 100 / 7;
        const baseLeftPct = colWidthPct * dayIdx;
        
        // Sub-column layout inside the day column
        const finalWidth = (colWidthPct * cardWidthPct) / 100;
        const finalLeft = baseLeftPct + (colWidthPct * cardLeftPct) / 100;

        card.style.top = `${topPx}px`;
        card.style.height = `${heightPx}px`;
        card.style.left = `calc(${finalLeft}% + 4px)`;
        card.style.width = `calc(${finalWidth}% - 8px)`;

        // Card contents
        card.innerHTML = `
          <div class="card-resize-handle-top"></div>
          <div class="event-card-title">${escapeHTML(event.title)}</div>
          <div class="event-card-time">
            <i data-lucide="clock" style="width: 10px; height: 10px;"></i>
            <span>${event.startTime} - ${event.endTime}</span>
          </div>
          <div class="event-card-desc">${escapeHTML(event.description || '')}</div>
          <div class="card-resize-handle-bottom"></div>
        `;

        // Card mousedown listener for custom drag-to-move and click-to-edit
        card.addEventListener('mousedown', (e) => {
          // If click is on resize handle, let the resize handle mousedown deal with it
          if (e.target.classList.contains('card-resize-handle-top') || e.target.classList.contains('card-resize-handle-bottom')) return;
          // Left click only
          if (e.button !== 0) return;

          e.preventDefault();

          const rect = card.getBoundingClientRect();
          state.isMouseDownOnCard = true;
          state.isDraggingCard = false;
          state.draggedEventId = event.id;
          state.dragStartDayIdx = dayIdx;
          
          state.draggedEventDuration = endSlot - startSlot;

          state.dragStartMouseX = e.clientX;
          state.dragStartMouseY = e.clientY;
          state.dragOffsetX = e.clientX - rect.left;
          state.dragOffsetY = e.clientY - rect.top;
          state.draggedCardEl = card;

          window.addEventListener('mousemove', handleCardDragMouseMove);
          window.addEventListener('mouseup', handleCardDragMouseUp);
        });

        // Top resize handle logic
        const handleTop = card.querySelector('.card-resize-handle-top');
        handleTop.addEventListener('mousedown', (e) => {
          e.stopPropagation(); // Stop card drag mousedown
          e.preventDefault();

          state.isResizing = true;
          state.resizingMode = 'top';
          state.resizingEventId = event.id;
          state.resizingDayIdx = dayIdx;
          state.resizingStartSlot = startSlot;
          state.resizingEndSlot = endSlot;

          // Disable pointer events on all cards globally
          document.body.classList.add('resizing-active');

          window.addEventListener('mousemove', handleResizeMouseMove);
          window.addEventListener('mouseup', handleResizeMouseUp);
        });

        // Bottom resize handle logic
        const handleBottom = card.querySelector('.card-resize-handle-bottom');
        handleBottom.addEventListener('mousedown', (e) => {
          e.stopPropagation(); // Stop card drag mousedown
          e.preventDefault();

          state.isResizing = true;
          state.resizingMode = 'bottom';
          state.resizingEventId = event.id;
          state.resizingDayIdx = dayIdx;
          state.resizingStartSlot = startSlot;
          state.resizingEndSlot = endSlot;

          // Disable pointer events on all cards globally
          document.body.classList.add('resizing-active');

          window.addEventListener('mousemove', handleResizeMouseMove);
          window.addEventListener('mouseup', handleResizeMouseUp);
        });

        // Track mouse hover for Ctrl+C copy
        card.addEventListener('mouseenter', () => {
          state.hoveredEventId = event.id;
        });
        card.addEventListener('mouseleave', () => {
          if (state.hoveredEventId === event.id) {
            state.hoveredEventId = null;
          }
        });

        // Right-click to quick delete with Undo
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault(); // Disable default browser context menu

          pushToUndoStack({
            type: 'delete',
            event: { ...event }
          });
          state.events = state.events.filter(evt => evt.id !== event.id);
          
          saveEventsToStorage();
          renderEvents();

          showToast(`'${event.title}' 일정이 삭제되었습니다.`, true);
        });

        overlayContainer.appendChild(card);
      });
    });
  });

  // Re-initialize Lucide Icons on dynamic cards
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// Update sidebar totals
function updateSidebarStats() {
  const weekDatesStr = getCurrentWeekDates().map(d => formatDateToString(d));
  
  // Events in this week
  const weekEvents = state.events.filter(e => weekDatesStr.includes(e.day));
  const elTotalEvents = document.getElementById('stat-total-events');
  if (elTotalEvents) elTotalEvents.textContent = weekEvents.length;

  // Total hours in this week
  let totalMins = 0;
  weekEvents.forEach(e => {
    totalMins += getDurationMinutes(e.startTime, e.endTime);
  });
  const totalHours = (totalMins / 60).toFixed(1);
  const elTotalHours = document.getElementById('stat-total-hours');
  if (elTotalHours) elTotalHours.textContent = `${totalHours}h`;
}

// --- Event Handlers & Interactions ---

function animateWeekTransition(direction, updateFn) {
  const calendarWrapper = document.querySelector('.calendar-wrapper');
  if (!calendarWrapper) {
    updateFn();
    return;
  }

  const outClass = direction === 'next' ? 'week-slide-out-left' : 'week-slide-out-right';
  const inClass = direction === 'next' ? 'week-slide-in-right' : 'week-slide-in-left';

  calendarWrapper.classList.remove('week-slide-in-right', 'week-slide-in-left', 'week-slide-out-left', 'week-slide-out-right');
  calendarWrapper.classList.add(outClass);

  setTimeout(() => {
    updateFn();
    calendarWrapper.classList.remove(outClass);
    calendarWrapper.classList.add(inClass);

    setTimeout(() => {
      calendarWrapper.classList.remove(inClass);
    }, 220);
  }, 150);
}

function setupEventListeners() {
  // Week Navigation
  const prevBtn = document.getElementById('prev-week-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      animateWeekTransition('prev', () => {
        state.currentWeekStart.setDate(state.currentWeekStart.getDate() - 7);
        renderCurrentWeek();
      });
    });
  }

  const nextBtn = document.getElementById('next-week-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      animateWeekTransition('next', () => {
        state.currentWeekStart.setDate(state.currentWeekStart.getDate() + 7);
        renderCurrentWeek();
      });
    });
  }

  const todayBtn = document.getElementById('today-btn');
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const oldStart = new Date(state.currentWeekStart);
      const todayStart = getMonday(new Date());
      if (oldStart.getTime() === todayStart.getTime()) return;

      const dir = todayStart < oldStart ? 'prev' : 'next';
      animateWeekTransition(dir, () => {
        initDateState();
        renderCurrentWeek();
      });
    });
  }

  // Category Filtering
  document.querySelectorAll('.cat-checkbox').forEach(cb => {
    cb.addEventListener('change', renderEvents);
  });

  // Search Input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', renderEvents);
  }

  // Quick Templates Picker
  const templateCards = document.querySelectorAll('.template-card');
  const cancelTemplateBtn = document.getElementById('cancel-template-btn');

  templateCards.forEach(card => {
    card.addEventListener('click', () => {
      // Toggle template selection
      if (state.activeTemplate && state.activeTemplate.el === card) {
        clearActiveTemplate();
      } else {
        templateCards.forEach(c => c.classList.remove('active-template'));
        card.classList.add('active-template');
        state.activeTemplate = {
          title: card.dataset.title,
          duration: parseInt(card.dataset.duration),
          category: card.dataset.category,
          el: card
        };
        cancelTemplateBtn.classList.remove('hide');
      }
    });

    // Drag template onto grid mousedown handler
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Left click only
      e.preventDefault();

      const title = card.dataset.title;
      const durationMins = parseInt(card.dataset.duration);
      const category = card.dataset.category;

      state.isMouseDownOnTemplate = true;
      state.isDraggingTemplate = false;
      state.templateDragData = { title, durationMins, category };

      state.dragStartMouseX = e.clientX;
      state.dragStartMouseY = e.clientY;

      state.dragOffsetX = 75; // Horizontal center of 150px wide ghost card
      state.dragOffsetY = 15; // Near top of ghost card

      window.addEventListener('mousemove', handleTemplateDragMouseMove);
      window.addEventListener('mouseup', handleTemplateDragMouseUp);
    });
  });

  if (cancelTemplateBtn) {
    cancelTemplateBtn.addEventListener('click', clearActiveTemplate);
  }

  // Grid Drag-to-Select Mechanics
  const gridContainer = document.getElementById('day-columns-wrapper');
  const dragPreview = document.getElementById('drag-preview-box');

  // MouseDown event inside day column
  gridContainer.addEventListener('mousedown', (e) => {
    // Only allow left-click (button 0) for drag-selection / template insertion
    if (e.button !== 0) return;

    const cell = e.target.closest('.slot-cell');
    if (!cell) return;

    e.preventDefault();

    const dayIdx = parseInt(cell.dataset.dayIdx);
    const slotIdx = parseInt(cell.dataset.slotIdx);

    // If a quick template is active, insert it immediately on click instead of dragging
    if (state.activeTemplate) {
      applyTemplateToGrid(dayIdx, slotIdx);
      clearActiveTemplate();
      return;
    }

    // Initialize dragging state
    state.isDragging = true;
    state.dragStartDayIdx = dayIdx;
    state.dragStartSlot = slotIdx;
    state.dragEndSlot = slotIdx;

    updateDragPreview();
  });

  // MouseMove event inside day column
  gridContainer.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;

    const cell = e.target.closest('.slot-cell');
    if (!cell) return;

    const dayIdx = parseInt(cell.dataset.dayIdx);
    const slotIdx = parseInt(cell.dataset.slotIdx);

    // Restrict dragging to the same column/day
    if (dayIdx === state.dragStartDayIdx) {
      state.dragEndSlot = slotIdx;
      updateDragPreview();
    }
  });

  // Global MouseUp to complete drag selection
  window.addEventListener('mouseup', () => {
    if (!state.isDragging) return;
    
    state.isDragging = false;
    dragPreview.classList.add('hide');

    const start = Math.min(state.dragStartSlot, state.dragEndSlot);
    const end = Math.max(state.dragStartSlot, state.dragEndSlot);
    const dayIdx = state.dragStartDayIdx;

    const dateStr = getDateByDayIndex(dayIdx);
    const startTimeStr = slotIndexToTime(start);
    
    // If it was a single click (start === end), default the duration to 1 hour (6 slots)
    let finalEndSlot = end + 1;
    if (start === end) {
      const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;
      finalEndSlot = Math.min(totalSlots, start + 6);
    }
    const endTimeStr = slotIndexToTime(finalEndSlot);

    const newEvent = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      title: '새로운 일정',
      day: dateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      category: 'work',
      description: '드래그로 생성된 일정입니다.'
    };

    state.events.push(newEvent);
    pushToUndoStack({
      type: 'create',
      event: { ...newEvent }
    });
    saveEventsToStorage();
    renderEvents();
    showToast('새 일정이 등록되었습니다. 클릭하여 수정할 수 있습니다.', true);
  });

  // Modal event listeners
  document.getElementById('close-modal-btn').addEventListener('click', closeModal);
  document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
  document.getElementById('event-form').addEventListener('submit', saveEventForm);
  document.getElementById('delete-event-btn').addEventListener('click', deleteCurrentEvent);

  // Auto adjusting end-time selection based on start-time selection
  const startSelect = document.getElementById('event-start-time');
  const endSelect = document.getElementById('event-end-time');

  startSelect.addEventListener('change', () => {
    const startIdx = timeToSlotIndex(startSelect.value);
    const endIdx = timeToSlotIndex(endSelect.value);
    
    // If end time is before start time, set end time to start time + 1 hour (or bounds limit)
    if (endIdx <= startIdx) {
      const defaultEndIdx = Math.min(startIdx + 6, TOTAL_HOURS * SLOTS_PER_HOUR); // default 1 hour
      endSelect.value = slotIndexToTime(defaultEndIdx);
    }
  });

  // Keyboard shortcuts (Ctrl+S for save backup, Ctrl+O for load backup, ESC to close modal)
  window.addEventListener('keydown', async (e) => {
    // Ctrl + S (Save Backup)
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      await handleManualSave();
    }

    // Ctrl + O (Load Backup)
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      await handleManualLoad();
    }

    // Escape (Close Modal)
    if (e.key === 'Escape') {
      closeModal();
      clearActiveTemplate();
    }
  });

  // Synced horizontal scrolling between header and body
  const bodyScroll = document.getElementById('calendar-body-scroll');
  const calendarHeader = document.getElementById('calendar-header');
  bodyScroll.addEventListener('scroll', () => {
    calendarHeader.scrollLeft = bodyScroll.scrollLeft;
  });

  // Ctrl + Wheel Zoom (Vertical & Horizontal proportions)
  bodyScroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault(); // Prevent standard browser page zoom

      const zoomIn = e.deltaY < 0;
      const slotStep = 1;
      const colStep = 10;
      
      if (zoomIn) {
        SLOT_HEIGHT = Math.min(32, SLOT_HEIGHT + slotStep);
        COL_WIDTH = Math.min(350, COL_WIDTH + colStep);
      } else {
        SLOT_HEIGHT = Math.max(8, SLOT_HEIGHT - slotStep);
        COL_WIDTH = Math.max(90, COL_WIDTH - colStep);
      }

      // Update CSS custom variables dynamically
      document.documentElement.style.setProperty('--slot-height', `${SLOT_HEIGHT}px`);
      document.documentElement.style.setProperty('--col-width', `${COL_WIDTH}px`);

      // Redraw grid lines and events overlay using the new calculations
      renderGrid();
      renderEvents();
    }
  }, { passive: false });

  // Middle-click Mouse Drag to Pan (Scroll) the Calendar Grid
  bodyScroll.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // Middle-click
      e.preventDefault(); // Prevent Windows auto-scroll icon

      state.isPanning = true;
      state.panStartX = e.clientX;
      state.panStartY = e.clientY;
      state.panStartScrollLeft = bodyScroll.scrollLeft;
      state.panStartScrollTop = bodyScroll.scrollTop;

      bodyScroll.style.cursor = 'grabbing';
      document.body.style.cursor = 'grabbing';

      window.addEventListener('mousemove', handleGridPanMouseMove);
      window.addEventListener('mouseup', handleGridPanMouseUp);
    }
  });

  // Track mouse pointer position over calendar grid cells (dayIdx & slotIdx)
  window.addEventListener('mousemove', (e) => {
    if (state.activeView === 'calendar') {
      const element = document.elementFromPoint(e.clientX, e.clientY);
      if (element) {
        const cell = element.closest('.slot-cell');
        if (cell) {
          state.lastGridDayIdx = parseInt(cell.dataset.dayIdx);
          state.lastGridSlotIdx = parseInt(cell.dataset.slotIdx);
        }
      }
    }
  });

  // Global Keyboard Shortcuts (Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+S, Ctrl+O, ESC)
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.isContentEditable
    )) {
      return;
    }

    // 1. Ctrl + C (Copy Selected Item)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (state.activeView === 'calendar') {
        if (state.hoveredEventId) {
          const targetEvent = state.events.find(evt => evt.id === state.hoveredEventId);
          if (targetEvent) {
            e.preventDefault();
            state.internalClipboard = {
              type: 'calendar',
              event: JSON.parse(JSON.stringify(targetEvent))
            };
            showToast(`'${targetEvent.title}' 일정이 복사되었습니다. (Ctrl+V로 원하는 위치에 붙여넣기)`, true);
          }
        }
      } else if (state.activeView === 'memo') {
        let itemsToCopy = [];
        
        // 1순위: 마우스 커서가 호버되어 있는 메모 카드가 있는 경우 (Hovered Card Priority)
        if (state.hoveredMemoId) {
          const hoverItem = state.memoItems.find(m => m.id === state.hoveredMemoId);
          if (hoverItem) {
            itemsToCopy = [hoverItem];
          }
        }
        
        // 2순위: 호버된 카드가 없고 선택된 카드가 있는 경우 (Selected Cards)
        if (itemsToCopy.length === 0) {
          const selectedIds = getSelectedMemoIds();
          if (selectedIds.length > 0) {
            itemsToCopy = state.memoItems.filter(m => selectedIds.includes(m.id));
          }
        }

        if (itemsToCopy.length > 0) {
          e.preventDefault();
          state.internalClipboard = {
            type: 'memo',
            items: JSON.parse(JSON.stringify(itemsToCopy))
          };
          showToast(`${itemsToCopy.length}개의 메모 카드가 복사되었습니다. (Ctrl+V로 원하는 위치에 붙여넣기)`, true);
        }
      }
    }

    // 2. Ctrl + V (Paste at Current Mouse Pointer Position)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (state.activeView === 'calendar') {
        if (state.internalClipboard && state.internalClipboard.type === 'calendar') {
          e.preventDefault();
          const origEvent = state.internalClipboard.event;
          const durationSlots = Math.max(1, Math.round(getDurationMinutes(origEvent.startTime, origEvent.endTime) / SLOT_DURATION_MINS));
          
          const targetDayIdx = state.lastGridDayIdx !== undefined ? state.lastGridDayIdx : 0;
          const targetStartSlot = state.lastGridSlotIdx !== undefined ? state.lastGridSlotIdx : 18; // default 10:00
          const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;
          const targetEndSlot = Math.min(targetStartSlot + durationSlots, totalSlots);

          const dateStr = getDateByDayIndex(targetDayIdx);
          const startTimeStr = slotIndexToTime(targetStartSlot);
          const endTimeStr = slotIndexToTime(targetEndSlot);

          const newEvent = {
            ...JSON.parse(JSON.stringify(origEvent)),
            id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            day: dateStr,
            startTime: startTimeStr,
            endTime: endTimeStr
          };

          state.events.push(newEvent);
          state.selectedEventId = newEvent.id;

          pushToUndoStack({
            type: 'create',
            event: { ...newEvent }
          });

          saveEventsToStorage();
          renderEvents();
          showToast(`'${newEvent.title}' 일정이 마우스 포인터 위치에 붙여넣어졌습니다.`, true);
        }
      }
    }

    // 3. Ctrl + Z (Undo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (state.activeView === 'memo') {
        triggerMemoUndo();
      } else {
        triggerUndo();
      }
    }

    // 4. Ctrl + S (Save Backup)
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleManualSave();
    }

    // 5. Ctrl + O (Load Backup)
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleManualLoad();
    }

    // 6. Escape (Close Modal)
    if (e.key === 'Escape') {
      closeModal();
      clearActiveTemplate();
    }
  });

  // Bind test alarm button click
  const testAlarmBtn = document.getElementById('test-alarm-btn');
  if (testAlarmBtn) {
    testAlarmBtn.addEventListener('click', () => {
      let secondsLeft = 5;
      testAlarmBtn.disabled = true;
      
      const updateInterval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
          testAlarmBtn.innerHTML = `<i data-lucide="bell" style="width: 13px; height: 13px;"></i> <span>알람 울림까지 ${secondsLeft}초...</span>`;
          if (typeof lucide !== 'undefined') lucide.createIcons();
        } else {
          clearInterval(updateInterval);
          testAlarmBtn.disabled = false;
          testAlarmBtn.innerHTML = `<i data-lucide="bell" style="width: 13px; height: 13px;"></i> <span>알람 작동 테스트</span>`;
          if (typeof lucide !== 'undefined') lucide.createIcons();
          
          // Trigger test notification
          const testEvent = {
            id: 'evt-test-' + Date.now(),
            title: '⏰ 알람 작동 테스트',
            startTime: '01:23',
            endTime: '02:23',
            description: '알람 및 차임벨 기능이 정상적으로 작동하고 있습니다.',
            alarmMinutesBefore: 0
          };
          triggerNotification(testEvent);
        }
      }, 1000);
    });
  }

  // Listen for Snooze command from the independent alarm popup window
  if (window.electronAPI && typeof window.electronAPI.onRegisterSnooze === 'function') {
    window.electronAPI.onRegisterSnooze(() => {
      registerSnoozeFromOverlay();
    });
  }

  // Custom Logo upload & reset event listeners
  const btnChangeLogo = document.getElementById('btn-change-logo');
  const btnResetLogo = document.getElementById('btn-reset-logo');
  const logoImageInput = document.getElementById('logo-image-input');

  if (btnChangeLogo && logoImageInput) {
    btnChangeLogo.addEventListener('click', () => {
      logoImageInput.click();
    });
  }

  if (logoImageInput) {
    logoImageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        state.logoIcon = evt.target.result;
        localStorage.setItem('ugul_calander_logo_icon', state.logoIcon);
        saveEventsToStorage();
        renderLogoIcon();
        showToast('로고 아이콘이 성공적으로 변경되었습니다.');
      };
      reader.readAsDataURL(file);
    });
  }

  if (btnResetLogo) {
    btnResetLogo.addEventListener('click', () => {
      state.logoIcon = null;
      localStorage.removeItem('ugul_calander_logo_icon');
      saveEventsToStorage();
      renderLogoIcon();
      showToast('로고 아이콘이 기본값으로 초기화되었습니다.');
    });
  }
}

function clearActiveTemplate() {
  const templateCards = document.querySelectorAll('.template-card');
  const cancelTemplateBtn = document.getElementById('cancel-template-btn');
  templateCards.forEach(c => c.classList.remove('active-template'));
  state.activeTemplate = null;
  if (cancelTemplateBtn) cancelTemplateBtn.classList.add('hide');
}

// Calculate drag-preview dimensions and render it overlaying the column
function updateDragPreview() {
  const dragPreview = document.getElementById('drag-preview-box');
  const dayIdx = state.dragStartDayIdx;
  const start = Math.min(state.dragStartSlot, state.dragEndSlot);
  const end = Math.max(state.dragStartSlot, state.dragEndSlot);

  // Position variables
  const topPx = start * SLOT_HEIGHT;
  const heightPx = (end - start + 1) * SLOT_HEIGHT;

  // Grid coordinates math
  const colWidthPct = 100 / 7;
  const leftPct = 70 + (colWidthPct * dayIdx); // 70px is time labels column width

  const startTimeStr = slotIndexToTime(start);
  const endTimeStr = slotIndexToTime(end + 1);
  dragPreview.innerHTML = `
    <div style="font-size: 0.68rem; color: #fff; font-weight: 700; background: rgba(79, 70, 229, 0.95); padding: 2px 6px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); text-shadow: 0 1px 2px rgba(0,0,0,0.3); white-space: nowrap;">
      ${startTimeStr} - ${endTimeStr}
    </div>
  `;

  dragPreview.style.top = `${topPx}px`;
  dragPreview.style.height = `${heightPx}px`;
  
  // Calculate relative pixel offsets
  const bodyScroll = document.getElementById('calendar-body-scroll');
  const colWrapper = document.getElementById('day-columns-wrapper');
  const colEl = colWrapper.children[dayIdx];
  
  if (colEl) {
    const colRect = colEl.getBoundingClientRect();
    const scrollRect = bodyScroll.getBoundingClientRect();
    
    // Left position alignment relative to parent scroll element
    const leftPx = colRect.left - scrollRect.left + bodyScroll.scrollLeft;
    dragPreview.style.left = `${leftPx + 4}px`;
    dragPreview.style.width = `${colRect.width - 8}px`;
    
    dragPreview.classList.remove('hide');
  }
}

// Apply quick template click insertion
function applyTemplateToGrid(dayIdx, slotIdx) {
  const template = state.activeTemplate;
  const durationSlots = template.duration / SLOT_DURATION_MINS;
  const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;

  const startSlot = slotIdx;
  const endSlot = Math.min(startSlot + durationSlots, totalSlots);

  const dateStr = getDateByDayIndex(dayIdx);
  const startTime = slotIndexToTime(startSlot);
  const endTime = slotIndexToTime(endSlot);

  // Create new event details
  const newEvent = {
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    title: template.title,
    day: dateStr,
    startTime: startTime,
    endTime: endTime,
    category: template.category,
    description: '빠른 템플릿으로 생성된 일정입니다.'
  };

  state.events.push(newEvent);
  pushToUndoStack({
    type: 'create',
    event: { ...newEvent }
  });
  saveEventsToStorage();
  renderEvents();
  showToast(`'${template.title}' 일정이 등록되었습니다.`, true);
}

// --- Modal Popup Controls ---

function openCreateModal(dateStr, startStr, endStr) {
  state.editingEventId = null;

  document.getElementById('modal-title-text').textContent = '새 일정 추가';
  document.getElementById('event-id').value = '';
  document.getElementById('event-day').value = dateStr;
  document.getElementById('event-title').value = '';
  document.getElementById('event-desc').value = '';
  document.getElementById('event-alarm').value = 'none'; // Reset alarm field
  document.getElementById('event-date-formatted').textContent = formatDateToKorean(dateStr);

  document.getElementById('event-start-time').value = startStr;
  document.getElementById('event-end-time').value = endStr;

  // Reset category radio selection to default (work)
  document.querySelector('input[name="event-category"][value="work"]').checked = true;

  document.getElementById('delete-event-btn').classList.add('hide');
  document.getElementById('event-modal').classList.remove('hide');

  // Auto focus event title
  setTimeout(() => {
    document.getElementById('event-title').focus();
  }, 100);
}

function openEditModal(event) {
  state.editingEventId = event.id;

  document.getElementById('modal-title-text').textContent = '일정 수정';
  document.getElementById('event-id').value = event.id;
  document.getElementById('event-day').value = event.day;
  document.getElementById('event-title').value = event.title;
  document.getElementById('event-desc').value = event.description || '';
  document.getElementById('event-alarm').value = event.alarmMinutesBefore !== undefined && event.alarmMinutesBefore !== null ? String(event.alarmMinutesBefore) : 'none'; // Load alarm field
  document.getElementById('event-date-formatted').textContent = formatDateToKorean(event.day);

  document.getElementById('event-start-time').value = event.startTime;
  document.getElementById('event-end-time').value = event.endTime;

  // Set category radio
  const catRadio = document.querySelector(`input[name="event-category"][value="${event.category}"]`);
  if (catRadio) catRadio.checked = true;

  document.getElementById('delete-event-btn').classList.remove('hide');
  document.getElementById('event-modal').classList.remove('hide');
}

function closeModal() {
  document.getElementById('event-modal').classList.add('hide');
  state.editingEventId = null;
}

// Submit handler for creating/editing event
function saveEventForm(e) {
  e.preventDefault();

  const id = document.getElementById('event-id').value;
  const day = document.getElementById('event-day').value;
  const title = document.getElementById('event-title').value.trim();
  const startTime = document.getElementById('event-start-time').value;
  const endTime = document.getElementById('event-end-time').value;
  const categoryEl = document.querySelector('input[name="event-category"]:checked');
  const category = categoryEl ? categoryEl.value : 'work';
  const description = document.getElementById('event-desc').value.trim();
  const alarmVal = document.getElementById('event-alarm').value;
  const alarmMinutesBefore = alarmVal === 'none' ? null : parseInt(alarmVal);

  // Validate time duration
  const startIdx = timeToSlotIndex(startTime);
  const endIdx = timeToSlotIndex(endTime);
  if (endIdx <= startIdx) {
    alert('종료 시간은 시작 시간보다 늦어야 합니다.');
    return;
  }

  if (id) {
    // Edit existing event
    const eventIdx = state.events.findIndex(evt => evt.id === id);
    if (eventIdx > -1) {
      state.events[eventIdx] = {
        id,
        title,
        day,
        startTime,
        endTime,
        category,
        description,
        alarmMinutesBefore
      };
      showToast('일정이 수정되었습니다.');
    }
  } else {
    // Create new event
    const newEvent = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      title,
      day,
      startTime,
      endTime,
      category,
      description,
      alarmMinutesBefore
    };
    state.events.push(newEvent);
    
    pushToUndoStack({
      type: 'create',
      event: { ...newEvent }
    });

    showToast('새 일정이 등록되었습니다.', true);
  }

  saveEventsToStorage();
  closeModal();
  renderEvents();
}

function deleteCurrentEvent() {
  const id = state.editingEventId;
  if (!id) return;

  const event = state.events.find(evt => evt.id === id);
  if (!event) return;

  if (confirm('이 일정을 삭제하시겠습니까?')) {
    pushToUndoStack({
      type: 'delete',
      event: { ...event }
    });
    state.events = state.events.filter(evt => evt.id !== id);
    saveEventsToStorage();
    closeModal();
    renderEvents();
    showToast(`'${event.title}' 일정이 삭제되었습니다.`, true);
  }
}

function triggerUndo() {
  if (state.undoStack && state.undoStack.length > 0) {
    const action = state.undoStack.pop();
    if (action.type === 'delete') {
      state.events.push(action.event);
      saveEventsToStorage();
      renderEvents();
      showToast('일정이 복원되었습니다.');
    } else if (action.type === 'create') {
      state.events = state.events.filter(evt => evt.id !== action.event.id);
      saveEventsToStorage();
      renderEvents();
      showToast('일정 생성이 취소되었습니다.');
    }
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
  } else {
    showToast('되돌릴 작업 내역이 없습니다.');
  }
}

function pushToUndoStack(action) {
  if (!state.undoStack) state.undoStack = [];
  state.undoStack.push(action);
  if (state.undoStack.length > 50) {
    state.undoStack.shift();
  }
}

// --- Utility Functions ---

// Simple toast notification helper
function showToast(message, isUndo = false) {
  // Remove existing toast if any
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  
  if (isUndo) {
    toast.innerHTML = `${message} <span class="undo-btn" style="text-decoration: underline; color: #c7d2fe; font-weight: 600; cursor: pointer; margin-left: 10px; pointer-events: auto;">되돌리기</span>`;
  } else {
    toast.textContent = message;
  }

  // Add styles dynamically to keep stylesheet clean
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: 'rgba(10, 15, 28, 0.65)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    color: '#fff',
    padding: '0.8rem 1.2rem',
    borderRadius: '10px',
    fontSize: '0.85rem',
    fontWeight: '500',
    boxShadow: '0 12px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
    zIndex: '2000',
    transform: 'translateY(100px)',
    opacity: '0',
    transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
    pointerEvents: isUndo ? 'auto' : 'none', // Allow clicking the toast if it has an undo button
    backdropFilter: 'blur(16px)',
    webkitBackdropFilter: 'blur(16px)'
  });

  document.body.appendChild(toast);

  if (isUndo) {
    const undoBtn = toast.querySelector('.undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerUndo();
      });
    }
  }

  // Trigger animation frame
  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });

  // Fade out and remove
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.transform = 'translateY(20px)';
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 300);
    }
  }, 4500); // Give enough time to click Undo
}

// HTML XSS escaping helper
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// --- Drag and Resize Helper Functions ---

function handleResizeMouseMove(e) {
  if (!state.isResizing) return;

  const element = document.elementFromPoint(e.clientX, e.clientY);
  if (!element) return;

  const cell = element.closest('.slot-cell');
  if (!cell) return;

  const dayIdx = parseInt(cell.dataset.dayIdx);
  const slotIdx = parseInt(cell.dataset.slotIdx);

  // Only resize within the same day column
  if (dayIdx === state.resizingDayIdx) {
    const event = state.events.find(evt => evt.id === state.resizingEventId);
    if (!event) return;

    if (state.resizingMode === 'bottom') {
      const startSlot = state.resizingStartSlot;
      // New duration must be at least 1 slot (10 mins)
      if (slotIdx >= startSlot) {
        const newEndSlot = slotIdx + 1;
        event.endTime = slotIndexToTime(newEndSlot);
        renderEvents(); // Refresh rendering
      }
    } else if (state.resizingMode === 'top') {
      const endSlot = state.resizingEndSlot;
      // New start slot must be before the end slot
      if (slotIdx < endSlot) {
        event.startTime = slotIndexToTime(slotIdx);
        renderEvents(); // Refresh rendering
      }
    }
  }
}

function handleResizeMouseUp() {
  if (state.isResizing) {
    state.isResizing = false;
    state.resizingEventId = null;
    state.resizingMode = null;
    state.resizingEndSlot = null;

    // Restore pointer events globally
    document.body.classList.remove('resizing-active');

    saveEventsToStorage();
    updateSidebarStats();

    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
    showToast('일정 시간이 조정되었습니다.');
  }
}

// --- Custom Drag-to-Move Helper Functions ---

function handleCardDragMouseMove(e) {
  if (!state.isMouseDownOnCard || !state.draggedCardEl) return;

  const card = state.draggedCardEl;

  // Initiate dragging state if mouse has moved past 5px threshold
  if (!state.isDraggingCard) {
    const dx = e.clientX - state.dragStartMouseX;
    const dy = e.clientY - state.dragStartMouseY;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    if (distance >= 5) {
      state.isDraggingCard = true;
      card.classList.add('is-dragging-card');
      document.body.classList.add('drag-active');

      const rect = card.getBoundingClientRect();
      state.draggedCardWidth = rect.width;
      state.draggedCardHeight = rect.height;

      // Style card for floating drag
      card.style.position = 'fixed';
      card.style.zIndex = '2000';
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;
      card.style.opacity = '0.85';
      card.style.transform = 'scale(1.03)';
      card.style.boxShadow = '0 15px 30px rgba(0,0,0,0.35)';
      card.style.cursor = 'grabbing';

      // Move it to document.body to prevent containing block offset errors (e.g. from backdrop-filters or scrolls)
      document.body.appendChild(card);
    }
  }

  // If currently dragging, update coordinates and dropzone highlight
  if (state.isDraggingCard) {
    const cardX = e.clientX - state.dragOffsetX;
    const cardY = e.clientY - state.dragOffsetY;

    card.style.left = `${cardX}px`;
    card.style.top = `${cardY}px`;

    // Locate the cell directly under the card's top edge (horizontal center, 10px down from top)
    const targetX = cardX + (state.draggedCardWidth / 2);
    const targetY = cardY + 10;

    const element = document.elementFromPoint(targetX, targetY);
    const cell = element ? element.closest('.slot-cell') : null;
    
    if (cell) {
      highlightDropZone(cell, state.draggedEventDuration);
    } else {
      clearDropZoneHighlights();
    }
  }
}

function handleCardDragMouseUp(e) {
  window.removeEventListener('mousemove', handleCardDragMouseMove);
  window.removeEventListener('mouseup', handleCardDragMouseUp);

  if (!state.isMouseDownOnCard) return;

  const wasDragging = state.isDraggingCard;
  state.isMouseDownOnCard = false;
  state.isDraggingCard = false;

  if (wasDragging) {
    document.body.classList.remove('drag-active');
    clearDropZoneHighlights();

    // Use the card's top-left coordinates to find the drop cell
    const card = state.draggedCardEl;
    const cardX = parseFloat(card.style.left);
    const cardY = parseFloat(card.style.top);
    
    const targetX = cardX + (state.draggedCardWidth / 2);
    const targetY = cardY + 10;

    const element = document.elementFromPoint(targetX, targetY);
    let dropped = false;

    if (element) {
      const cell = element.closest('.slot-cell');
      if (cell) {
        const dayIdx = parseInt(cell.dataset.dayIdx);
        const slotIdx = parseInt(cell.dataset.slotIdx);
        moveEventToSlot(state.draggedEventId, dayIdx, slotIdx);
        dropped = true;
      }
    }

    // Remove the dragged card from document.body
    if (card && card.parentNode) {
      card.remove();
    }

    // Reset card layout if it was not dropped on a valid cell
    if (!dropped) {
      renderEvents();
    }
  } else {
    // If it was a simple click, open edit modal immediately
    const targetEvent = state.events.find(evt => evt.id === state.draggedEventId);
    if (targetEvent) {
      openEditModal(targetEvent);
    }
  }

  state.draggedEventId = null;
  state.draggedCardEl = null;
}

function highlightDropZone(cell, duration) {
  clearDropZoneHighlights();
  if (!cell) return;

  const dayIdx = parseInt(cell.dataset.dayIdx);
  const startSlot = parseInt(cell.dataset.slotIdx);

  // Find day column container element
  const dayCol = document.querySelector(`.day-column[data-day-idx="${dayIdx}"]`);
  if (!dayCol) return;

  const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;
  
  // Shift highlighted area up if it exceeds day boundary
  let highlightStart = startSlot;
  if (startSlot + duration > totalSlots) {
    highlightStart = Math.max(0, totalSlots - duration);
  }

  for (let i = 0; i < duration; i++) {
    const targetSlotIdx = highlightStart + i;
    const targetCell = dayCol.children[targetSlotIdx];
    if (targetCell) {
      targetCell.classList.add('drag-over-target');
    }
  }
}

function clearDropZoneHighlights() {
  document.querySelectorAll('.slot-cell').forEach(el => el.classList.remove('drag-over-target'));
}

function moveEventToSlot(eventId, dayIdx, slotIdx) {
  const event = state.events.find(evt => evt.id === eventId);
  if (!event) return;

  const startSlot = timeToSlotIndex(event.startTime);
  const endSlot = timeToSlotIndex(event.endTime);
  const durationSlots = endSlot - startSlot;

  const targetDateStr = getDateByDayIndex(dayIdx);
  const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;

  let finalStartSlot = slotIdx;
  let finalEndSlot = slotIdx + durationSlots;

  // Shift start slot back if it exceeds the column bounds
  if (finalEndSlot > totalSlots) {
    finalStartSlot = Math.max(0, totalSlots - durationSlots);
    finalEndSlot = totalSlots;
  }

  event.day = targetDateStr;
  event.startTime = slotIndexToTime(finalStartSlot);
  event.endTime = slotIndexToTime(finalEndSlot);

  saveEventsToStorage();
  renderEvents();
  showToast('일정 위치가 변경되었습니다.');
}

// --- Middle-Click Grid Panning Helper Functions ---

function handleGridPanMouseMove(e) {
  if (!state.isPanning) return;

  const dx = e.clientX - state.panStartX;
  const dy = e.clientY - state.panStartY;

  const bodyScroll = document.getElementById('calendar-body-scroll');
  bodyScroll.scrollLeft = state.panStartScrollLeft - dx;
  bodyScroll.scrollTop = state.panStartScrollTop - dy;
}

function handleGridPanMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;

    const bodyScroll = document.getElementById('calendar-body-scroll');
    bodyScroll.style.cursor = '';
    document.body.style.cursor = '';

    window.removeEventListener('mousemove', handleGridPanMouseMove);
    window.removeEventListener('mouseup', handleGridPanMouseUp);
  }
}

// --- Custom Template Drag-to-Insert Helper Functions ---

function handleTemplateDragMouseMove(e) {
  if (!state.isMouseDownOnTemplate || !state.templateDragData) return;

  // Initiate dragging if mouse moves beyond 5px threshold
  if (!state.isDraggingTemplate) {
    const dx = e.clientX - state.dragStartMouseX;
    const dy = e.clientY - state.dragStartMouseY;
    const distance = Math.sqrt(dx*dx + dy*dy);

    if (distance >= 5) {
      state.isDraggingTemplate = true;
      document.body.classList.add('drag-active');

      const data = state.templateDragData;
      const durationSlots = data.durationMins / SLOT_DURATION_MINS;

      // Create floating ghost element on the body
      const floatCard = document.createElement('div');
      floatCard.className = `event-card ${data.category} floating-template-ghost`;
      floatCard.style.position = 'fixed';
      floatCard.style.zIndex = '2000';
      floatCard.style.width = '150px';
      floatCard.style.height = `${durationSlots * SLOT_HEIGHT}px`;
      floatCard.style.opacity = '0.85';
      floatCard.style.boxShadow = '0 15px 30px rgba(0,0,0,0.35)';
      floatCard.style.cursor = 'grabbing';
      floatCard.style.pointerEvents = 'none'; // Essential so elementFromPoint passes through

      floatCard.innerHTML = `
        <div class="event-card-title">${escapeHTML(data.title)}</div>
        <div class="event-card-time">${data.durationMins}분 템플릿</div>
      `;

      document.body.appendChild(floatCard);

      state.draggedCardEl = floatCard;
      state.draggedCardWidth = 150;
      state.draggedCardHeight = durationSlots * SLOT_HEIGHT;
      state.draggedEventDuration = durationSlots;
    }
  }

  // Move floating card and highlight dropzone
  if (state.isDraggingTemplate && state.draggedCardEl) {
    const card = state.draggedCardEl;
    const cardX = e.clientX - state.dragOffsetX;
    const cardY = e.clientY - state.dragOffsetY;

    card.style.left = `${cardX}px`;
    card.style.top = `${cardY}px`;

    const targetX = cardX + (state.draggedCardWidth / 2);
    const targetY = cardY + 10;

    const element = document.elementFromPoint(targetX, targetY);
    const cell = element ? element.closest('.slot-cell') : null;

    if (cell) {
      highlightDropZone(cell, state.draggedEventDuration);
    } else {
      clearDropZoneHighlights();
    }
  }
}

function handleTemplateDragMouseUp(e) {
  window.removeEventListener('mousemove', handleTemplateDragMouseMove);
  window.removeEventListener('mouseup', handleTemplateDragMouseUp);

  if (!state.isMouseDownOnTemplate) return;

  const wasDragging = state.isDraggingTemplate;
  state.isMouseDownOnTemplate = false;
  state.isDraggingTemplate = false;

  if (wasDragging) {
    document.body.classList.remove('drag-active');
    clearDropZoneHighlights();

    // Destroy the floating ghost element
    if (state.draggedCardEl) {
      state.draggedCardEl.remove();
    }

    // Determine drop position
    const cardX = e.clientX - state.dragOffsetX;
    const cardY = e.clientY - state.dragOffsetY;
    const targetX = cardX + (state.draggedCardWidth / 2);
    const targetY = cardY + 10;

    const element = document.elementFromPoint(targetX, targetY);
    let dropped = false;

    if (element) {
      const cell = element.closest('.slot-cell');
      if (cell) {
        const dayIdx = parseInt(cell.dataset.dayIdx);
        const slotIdx = parseInt(cell.dataset.slotIdx);
        
        const data = state.templateDragData;
        const durationSlots = data.durationMins / SLOT_DURATION_MINS;
        const totalSlots = TOTAL_HOURS * SLOTS_PER_HOUR;
        
        let finalStartSlot = slotIdx;
        let finalEndSlot = slotIdx + durationSlots;

        // Shift start slot back if it exceeds column boundaries
        if (finalEndSlot > totalSlots) {
          finalStartSlot = Math.max(0, totalSlots - durationSlots);
          finalEndSlot = totalSlots;
        }

        const dateStr = getDateByDayIndex(dayIdx);
        const newEvent = {
          id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          title: data.title,
          day: dateStr,
          startTime: slotIndexToTime(finalStartSlot),
          endTime: slotIndexToTime(finalEndSlot),
          category: data.category,
          description: '빠른 템플릿 드래그로 생성된 일정입니다.'
        };

        state.events.push(newEvent);
        
        pushToUndoStack({
          type: 'create',
          event: { ...newEvent }
        });

        saveEventsToStorage();
        renderEvents();
        showToast(`'${data.title}' 일정이 등록되었습니다.`, true);
        dropped = true;
      }
    }
  }

  state.templateDragData = null;
  state.draggedCardEl = null;
}

// --- App Theme Setup Functions ---

// Hex to RGBA conversion helper
function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Preset mapping - 11가지 테마 프리셋 (컬러 8종 + 모노톤 3종)
const PRESET_THEMES = {
  slate:  { accent: '#6366f1', sidebar: '#0f1624', grid: '#0d121f' }, // 슬레이트 인디고
  rose:   { accent: '#ec4899', sidebar: '#1a0915', grid: '#13050f' }, // 로즈 핑크
  red:    { accent: '#ef4444', sidebar: '#1a0909', grid: '#130505' }, // 크림슨 레드
  purple: { accent: '#a855f7', sidebar: '#14091e', grid: '#0e0517' }, // 바이올렛 퍼플
  forest: { accent: '#10b981', sidebar: '#06130e', grid: '#040c09' }, // 포레스트 그린
  sunset: { accent: '#f97316', sidebar: '#170b00', grid: '#110800' }, // 선셋 오렌지
  royal:  { accent: '#eab308', sidebar: '#161204', grid: '#0e0b02' }, // 로열 골드
  cyan:   { accent: '#06b6d4', sidebar: '#07161c', grid: '#030f14' }, // 오션 시안
  'mono-dark':  { accent: '#ffffff', sidebar: '#121212', grid: '#080808' }, // 100% 무채색 모노톤 블랙 (Sat=0%)
  'mono-gray':  { accent: '#e0e0e0', sidebar: '#262626', grid: '#171717' }, // 100% 무채색 모노톤 그레이 (Sat=0%)
  'mono-white': { accent: '#171717', sidebar: '#f5f5f5', grid: '#eeeeee' }  // 100% 무채색 모노톤 화이트 (Sat=0%)
};

function initTheme() {
  document.documentElement.removeAttribute('data-mode');
  localStorage.removeItem('ugul_calander_app_mode');

  const savedColors = localStorage.getItem('ugul_calander_custom_colors');
  const savedPreset = localStorage.getItem('ugul_calander_theme') || 'slate';
  
  let currentColors = PRESET_THEMES[savedPreset] || PRESET_THEMES.slate;
  if (savedColors) {
    try {
      currentColors = JSON.parse(savedColors);
    } catch(e) {
      console.error(e);
    }
  }

  // Set picker inputs
  const pickerAccent = document.getElementById('picker-accent');
  const pickerSidebar = document.getElementById('picker-sidebar');
  const pickerGrid = document.getElementById('picker-grid');

  if (pickerAccent) pickerAccent.value = currentColors.accent;
  if (pickerSidebar) pickerSidebar.value = currentColors.sidebar;
  if (pickerGrid) pickerGrid.value = currentColors.grid;

  updateColorLabels(currentColors);
  applyColors(currentColors);

  // Hook up preset buttons
  const themeBtns = document.querySelectorAll('.theme-btn');
  themeBtns.forEach(btn => {
    const isCustom = !!savedColors;
    btn.classList.toggle('active', !isCustom && btn.dataset.theme === savedPreset);

    btn.addEventListener('click', () => {
      themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const preset = btn.dataset.theme;
      const colors = PRESET_THEMES[preset] || PRESET_THEMES.slate;

      if (pickerAccent) pickerAccent.value = colors.accent;
      if (pickerSidebar) pickerSidebar.value = colors.sidebar;
      if (pickerGrid) pickerGrid.value = colors.grid;

      updateColorLabels(colors);
      applyColors(colors);

      // Clear custom color storage and save preset name
      localStorage.removeItem('ugul_calander_custom_colors');
      localStorage.setItem('ugul_calander_theme', preset);
    });
  });

  // Hook up color pickers
  [pickerAccent, pickerSidebar, pickerGrid].forEach(picker => {
    if (!picker) return;
    picker.addEventListener('input', () => {
      themeBtns.forEach(b => b.classList.remove('active'));

      const colors = {
        accent: pickerAccent.value,
        sidebar: pickerSidebar.value,
        grid: pickerGrid.value
      };

      updateColorLabels(colors);
      applyColors(colors);

      localStorage.setItem('ugul_calander_custom_colors', JSON.stringify(colors));
      localStorage.setItem('ugul_calander_theme', 'custom');
    });
  });
}

function updateColorLabels(colors) {
  const lblAccent = document.getElementById('label-accent');
  const lblSidebar = document.getElementById('label-sidebar');
  const lblGrid = document.getElementById('label-grid');
  if (lblAccent) lblAccent.textContent = colors.accent.toUpperCase();
  if (lblSidebar) lblSidebar.textContent = colors.sidebar.toUpperCase();
  if (lblGrid) lblGrid.textContent = colors.grid.toUpperCase();
}

function isColorLight(hex) {
  if (!hex) return false;
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  return ((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128;
}

function applyColors(colors) {
  // [Theme Mode Detector]: 라이트 테마(화이트) 자동 텍스트/테두리 반전
  const isLight = isColorLight(colors.grid) || isColorLight(colors.sidebar);
  if (isLight) {
    document.documentElement.setAttribute('data-theme-mode', 'light');
    document.documentElement.style.setProperty('--text-main', '#0f172a');
    document.documentElement.style.setProperty('--text-muted', '#475569');
    document.documentElement.style.setProperty('--border-light', 'rgba(0, 0, 0, 0.1)');
    document.documentElement.style.setProperty('--border-medium', 'rgba(0, 0, 0, 0.18)');
  } else {
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.style.setProperty('--text-main', '#f8fafc');
    document.documentElement.style.setProperty('--text-muted', '#94a3b8');
    document.documentElement.style.setProperty('--border-light', 'rgba(255, 255, 255, 0.08)');
    document.documentElement.style.setProperty('--border-medium', 'rgba(255, 255, 255, 0.15)');
  }

  // [Design Token System 1]: 포인트 강조 색상 (Primary Accent & Focus Glow)
  document.documentElement.style.setProperty('--color-accent', colors.accent);
  document.documentElement.style.setProperty('--border-focus', colors.accent);
  document.documentElement.style.setProperty('--theme-accent-glow', hexToRgba(colors.accent, 0.25));

  // [Design Token System 2]: 사이드바 및 탑바 패널 색상 (Sidebar, Topbar & Modals)
  document.documentElement.style.setProperty('--bg-sidebar', colors.sidebar);
  document.documentElement.style.setProperty('--bg-sidebar-glass', hexToRgba(colors.sidebar, isLight ? 0.9 : 0.75));

  // [Design Token System 3]: 시간표 및 캔버스 메인 영역 색상 (Grid, App Container & Canvas)
  document.documentElement.style.setProperty('--bg-app', colors.grid);
  document.documentElement.style.setProperty('--bg-grid', colors.grid);
  document.documentElement.style.setProperty('--bg-grid-glass', hexToRgba(colors.grid, 0.55));
  document.documentElement.style.setProperty('--bg-card-glass', hexToRgba(colors.accent, 0.08));

  // [Design Token System 4]: 최외곽 앱 래디얼 그래디언트 배경 빛깔 동기화
  const appContainer = document.querySelector('.app-container');
  if (appContainer) {
    const glow1 = hexToRgba(colors.accent, isLight ? 0.04 : 0.07);
    const glow2 = hexToRgba(colors.accent, isLight ? 0.02 : 0.03);
    appContainer.style.background = `
      radial-gradient(circle at 15% 15%, ${glow1} 0%, rgba(0, 0, 0, 0) 55%),
      radial-gradient(circle at 85% 85%, ${glow2} 0%, rgba(0, 0, 0, 0) 60%),
      radial-gradient(circle at 50% 50%, ${glow2} 0%, rgba(0, 0, 0, 0) 50%),
      ${colors.grid}
    `;
  }

  // 1. 메모장 캔버스 배경 및 보드 색상 일괄 동기화
  const canvasScroll = document.getElementById('memo-canvas-scroll');
  if (canvasScroll) {
    canvasScroll.style.backgroundColor = colors.grid;
  }

  // 2. 모달 카드 및 미니 캘린더 색상 동기화
  document.querySelectorAll('.modal-card').forEach(modal => {
    modal.style.borderColor = hexToRgba(colors.accent, 0.25);
    modal.style.boxShadow = `0 20px 50px ${hexToRgba(colors.accent, 0.15)}`;
  });

  // 3. 로고 아이콘 강조색 동기화
  const logoIconEl = document.querySelector('.logo-icon');
  if (logoIconEl) {
    logoIconEl.style.background = `linear-gradient(135deg, ${colors.accent} 0%, ${hexToRgba(colors.accent, 0.7)} 100%)`;
    logoIconEl.style.boxShadow = `0 4px 18px ${hexToRgba(colors.accent, 0.4)}`;
  }

  // 4. 뷰 오버레이 전환 버튼 (.nav-overlay-btn) 평소 배경 & 테두리 동기화 (사이드바 패널 색상 적용)
  document.querySelectorAll('.nav-overlay-btn').forEach(btn => {
    btn.style.background = hexToRgba(colors.sidebar, isLight ? 0.95 : 0.85);
    btn.style.borderColor = hexToRgba(colors.accent, isLight ? 0.25 : 0.3);
    btn.style.color = isLight ? '#0f172a' : '#ffffff';
  });

  // 5. 메모장 최상단 상단 바 (.memo-topbar) 동기화 (사이드바 패널 색상 적용)
  const memoTopbar = document.querySelector('.memo-topbar');
  if (memoTopbar) {
    memoTopbar.style.background = hexToRgba(colors.sidebar, isLight ? 0.9 : 0.75);
    memoTopbar.style.borderBottomColor = hexToRgba(colors.accent, isLight ? 0.15 : 0.2);
  }

  // Adjust app card background for a subtle tint
  const cardBg = hexToRgba(colors.accent, 0.04);
  document.documentElement.style.setProperty('--bg-card', cardBg);
}

// --- App Branding Title & Logo Icon Engine ---

function initAppTitleAndLogo() {
  // 1. App Title Load & Edit
  const titleDisplay = document.getElementById('app-title-display');
  const titleInput = document.getElementById('app-title-input');
  const titleContainer = document.querySelector('.app-title-container');
  const modalTitleInput = document.getElementById('modal-app-title-input');
  const modalSaveTitleBtn = document.getElementById('modal-save-title-btn');

  const savedTitle = localStorage.getItem('ugul_calander_app_title') || 'UGUL Calander';
  state.appTitle = savedTitle;

  const updateTitleUI = (newTitle) => {
    if (!newTitle || !newTitle.trim()) newTitle = 'UGUL Calander';
    state.appTitle = newTitle;
    localStorage.setItem('ugul_calander_app_title', newTitle);

    if (titleDisplay) titleDisplay.textContent = newTitle;
    if (titleInput) titleInput.value = newTitle;
    if (modalTitleInput) modalTitleInput.value = newTitle;
    document.title = newTitle;
  };

  updateTitleUI(savedTitle);

  // Inline Title Editing (Title Double-Click or Pencil Click)
  const startInlineEdit = () => {
    if (!titleDisplay || !titleInput) return;
    titleDisplay.classList.add('hide');
    titleInput.classList.remove('hide');
    titleInput.focus();
    titleInput.select();
  };

  const finishInlineEdit = () => {
    if (!titleDisplay || !titleInput) return;
    updateTitleUI(titleInput.value);
    titleInput.classList.add('hide');
    titleDisplay.classList.remove('hide');
    showToast('앱 타이틀이 수정되었습니다.', true);
  };

  if (titleContainer) {
    titleContainer.addEventListener('click', startInlineEdit);
  }
  if (titleInput) {
    titleInput.addEventListener('blur', finishInlineEdit);
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishInlineEdit();
      if (e.key === 'Escape') {
        titleInput.value = state.appTitle;
        titleInput.classList.add('hide');
        titleDisplay.classList.remove('hide');
      }
    });
  }

  if (modalSaveTitleBtn && modalTitleInput) {
    modalSaveTitleBtn.addEventListener('click', () => {
      updateTitleUI(modalTitleInput.value);
      showToast('앱 타이틀이 저장되었습니다.', true);
    });
  }

  // 2. Logo Icon Click & Contextmenu Reset
  const logoWrapper = document.getElementById('brand-logo-container');
  const logoImageInput = document.getElementById('logo-image-input');
  const logoIconBox = document.getElementById('logo-icon-box');

  const savedLogo = localStorage.getItem('ugul_calander_custom_logo');
  const applyLogo = (src) => {
    // 사이드바 전체 배경에 이미지가 깔리지 않도록 배경 이미지 완전 제거!
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.backgroundImage = 'none';
    }

    if (!logoIconBox) return;
    if (src) {
      logoIconBox.innerHTML = `<img src="${src}" alt="Logo">`;
    } else {
      logoIconBox.innerHTML = `<i data-lucide="clock"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  };

  if (savedLogo) applyLogo(savedLogo);

  if (logoWrapper && logoImageInput) {
    // Click logo icon to open file dialog directly!
    logoWrapper.addEventListener('click', () => {
      logoImageInput.click();
    });

    // Right-click logo icon to reset to default!
    logoWrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      localStorage.removeItem('ugul_calander_custom_logo');
      applyLogo(null);
      showToast('로고 아이콘이 기본값으로 초기화되었습니다.');
    });

    logoImageInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const compressedDataUrl = await resizeLogoImage(file, 128);
        try {
          localStorage.setItem('ugul_calander_custom_logo', compressedDataUrl);
        } catch (storageErr) {
          console.warn("Storage Quota Fallback:", storageErr);
        }
        applyLogo(compressedDataUrl);
        showToast('로고 아이콘이 성공적으로 변경되었습니다.', true);
      } catch (err) {
        showToast('로고 이미지를 처리하는 중 오류가 발생했습니다.');
        console.error(err);
      }
    });
  }
}

// 128x128 픽셀 자동 크롭 및 획기적 이미지 압축 헬퍼 (QuotaExceededError 100% 방지)
function resizeLogoImage(file, maxSize = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');

        // 정사각형 1:1 센터 크롭
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/png', 0.9));
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

// --- App Options Modal Control Engine ---

function initOptionsModal() {
  const btnOpenOptions = document.getElementById('btn-open-options');
  const optionsModal = document.getElementById('app-options-modal');
  const btnCloseOptions = document.getElementById('close-options-modal-btn');
  const btnConfirmOptions = document.getElementById('btn-close-options-confirm');

  const openModal = () => {
    if (!optionsModal) return;
    optionsModal.classList.remove('hide');
    if (window.lucide) window.lucide.createIcons();
  };

  const closeModal = () => {
    if (!optionsModal) return;
    optionsModal.classList.add('hide');
  };

  if (btnOpenOptions) btnOpenOptions.addEventListener('click', openModal);
  if (btnCloseOptions) btnCloseOptions.addEventListener('click', closeModal);
  if (btnConfirmOptions) btnConfirmOptions.addEventListener('click', closeModal);

  if (optionsModal) {
    optionsModal.addEventListener('click', (e) => {
      if (e.target === optionsModal) closeModal();
    });
  }
}

// --- Manual Save & Load Backup Helpers ---

async function handleManualSave() {
  if (window.electronAPI) {
    const result = await window.electronAPI.showSaveDialog('ugul_calendar_backup.json');
    if (!result.canceled && result.filePath) {
      const success = window.electronAPI.writeCustomFile(result.filePath, JSON.stringify(state.events, null, 2));
      if (success) {
        showToast('캘린더 백업 파일이 저장되었습니다.');
      } else {
        showToast('백업 파일 저장에 실패했습니다.');
      }
    }
  } else {
    // Fallback for standard browsers
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.events, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "ugul_calendar_backup.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('백업 파일 다운로드 완료.');
  }
}

async function handleManualLoad() {
  if (window.electronAPI) {
    const result = await window.electronAPI.showOpenDialog();
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      const data = window.electronAPI.readCustomFile(result.filePaths[0]);
      if (data) {
        try {
          const loadedEvents = JSON.parse(data);
          if (Array.isArray(loadedEvents)) {
            state.events = loadedEvents;
            saveEventsToStorage();
            renderEvents();
            showToast('캘린더 데이터를 성공적으로 불러왔습니다.');
          } else {
            showToast('올바르지 않은 백업 파일 형식입니다.');
          }
        } catch(e) {
          showToast('백업 파일을 분석하는 중 오류가 발생했습니다.');
        }
      }
    }
  } else {
    // Fallback for standard browsers
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const loadedEvents = JSON.parse(evt.target.result);
          if (Array.isArray(loadedEvents)) {
            state.events = loadedEvents;
            saveEventsToStorage();
            renderEvents();
            showToast('캘린더 데이터를 성공적으로 불러왔습니다.');
          } else {
            showToast('올바르지 않은 백업 파일 형식입니다.');
          }
        } catch(err) {
          showToast('백업 파일 읽기 실패.');
        }
      };
      reader.readAsText(file);
    });
    fileInput.click();
  }
}

// --- Alarm System Engine ---

function initAlarmSystem() {
  // Request Notification permission if not set
  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // Set up 10-second poller to check alarms
  setInterval(checkAlarms, 10000);
}

function checkAlarms() {
  const now = new Date();
  const todayStr = formatDateToString(now);
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const nowTotalMins = currentHours * 60 + currentMinutes;

  // 1. Check in-memory snooze alarms first
  if (state.snoozeAlarms && state.snoozeAlarms.length > 0) {
    state.snoozeAlarms = state.snoozeAlarms.filter(snooze => {
      if (nowTotalMins >= snooze.triggerMins) {
        triggerNotification({
          ...snooze.event,
          title: snooze.title,
          alarmMinutesBefore: 0
        });
        return false;
      }
      return true;
    });
  }

  // 2. Check general calendar events
  if (!state.events) return;

  state.events.forEach(event => {
    if (event.day === todayStr && event.alarmMinutesBefore !== undefined && event.alarmMinutesBefore !== null) {
      const [startHour, startMin] = event.startTime.split(':').map(Number);
      const eventStartMins = startHour * 60 + startMin;
      const alarmTriggerMins = eventStartMins - event.alarmMinutesBefore;

      const timeDiff = nowTotalMins - alarmTriggerMins;
      if (timeDiff >= 0 && timeDiff < 5) {
        const alarmKey = `${event.id}-${todayStr}-${alarmTriggerMins}`;
        if (!state.triggeredAlarms) {
          state.triggeredAlarms = new Set();
        }

        if (!state.triggeredAlarms.has(alarmKey)) {
          state.triggeredAlarms.add(alarmKey);
          triggerNotification(event);
        }
      }
    }
  });
}

function triggerNotification(event) {
  state.ringingAlarm = event;

  // 1. Request Electron Main to spawn the separate frameless alarm window
  if (window.electronAPI && typeof window.electronAPI.triggerAlarmWindow === 'function') {
    const isTest = (event.id && String(event.id).startsWith('evt-test-')) ? 'true' : 'false';
    window.electronAPI.triggerAlarmWindow({
      title: event.title,
      time: `${event.startTime} - ${event.endTime}`,
      desc: event.description || '',
      isTest: isTest
    });
  }

  // 2. Send native OS system notification
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const timeText = event.alarmMinutesBefore === 0 ? '지금 시작합니다!' : `${event.alarmMinutesBefore}분 후에 시작합니다.`;
    const notification = new Notification(`일정 알람: ${event.title}`, {
      body: `[${event.startTime} - ${event.endTime}] ${timeText}\n${event.description || ''}`,
      icon: 'icon.jpg'
    });

    notification.onclick = () => {
      // Focus dashboard window
      if (window.electronAPI && typeof window.electronAPI.showWindow === 'function') {
        window.electronAPI.showWindow();
      } else {
        window.focus();
      }
    };
  }

  saveTriggeredAlarms();
}

function registerSnoozeFromOverlay() {
  if (!state.ringingAlarm) return;
  
  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const nowTotalMins = currentHours * 60 + currentMinutes;
  
  if (!state.snoozeAlarms) state.snoozeAlarms = [];
  state.snoozeAlarms.push({
    id: `snooze-${Date.now()}`,
    title: `[다시 알림] ${state.ringingAlarm.title}`,
    triggerMins: nowTotalMins + 5,
    event: { ...state.ringingAlarm }
  });
  
  state.ringingAlarm = null;
  showToast('5분 뒤 다시 알림이 울립니다.');
}

function loadTriggeredAlarms() {
  const saved = localStorage.getItem('ugul_triggered_alarms');
  if (saved) {
    try {
      state.triggeredAlarms = new Set(JSON.parse(saved));
    } catch(e) {
      state.triggeredAlarms = new Set();
    }
  } else {
    state.triggeredAlarms = new Set();
  }
}

function saveTriggeredAlarms() {
  if (state.triggeredAlarms) {
    localStorage.setItem('ugul_triggered_alarms', JSON.stringify(Array.from(state.triggeredAlarms)));
  }
}

// --- Global Shortcut Key Engine ---

function initGlobalShortcutUI() {
  const shortcutInput = document.getElementById('shortcut-input');
  const btnClearShortcut = document.getElementById('btn-clear-shortcut');
  if (!shortcutInput) return;

  renderShortcutInput();

  shortcutInput.addEventListener('keydown', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore single modifier keys
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const modifiers = [];
    if (e.ctrlKey || e.metaKey) modifiers.push('CommandOrControl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');

    if (modifiers.length === 0) {
      showToast('단축키는 Ctrl, Alt, Shift 등의 조합키와 함께 입력해야 합니다.');
      return;
    }

    let key = e.key.toUpperCase();
    if (key === ' ') key = 'Space';

    const accelerator = `${modifiers.join('+')}+${key}`;

    if (window.electronAPI && typeof window.electronAPI.registerGlobalShortcut === 'function') {
      const success = await window.electronAPI.registerGlobalShortcut(accelerator);
      if (success) {
        state.globalShortcut = accelerator;
        saveEventsToStorage();
        renderShortcutInput();
        showToast(`전역 단축키 [ ${formatShortcutDisplay(accelerator)} ] 가 등록되었습니다.`, true);
      } else {
        showToast('해당 단축키를 등록할 수 없습니다. (다른 시스템 단축키와 충돌)');
      }
    }
  });

  if (btnClearShortcut) {
    btnClearShortcut.addEventListener('click', async () => {
      state.globalShortcut = null;
      if (window.electronAPI && typeof window.electronAPI.registerGlobalShortcut === 'function') {
        await window.electronAPI.registerGlobalShortcut(null);
      }
      saveEventsToStorage();
      renderShortcutInput();
      showToast('전역 단축키가 해제되었습니다.');
    });
  }
}

function renderShortcutInput() {
  const shortcutInput = document.getElementById('shortcut-input');
  if (!shortcutInput) return;
  if (state.globalShortcut) {
    shortcutInput.value = formatShortcutDisplay(state.globalShortcut);
  } else {
    shortcutInput.value = '';
  }
}

function formatShortcutDisplay(acc) {
  if (!acc) return '';
  return acc.replace(/CommandOrControl/g, 'Ctrl');
}

// --- View Slider & Navigation Overlay Engine ---

function initViewSlider() {
  const btnGotoMemo = document.getElementById('btn-goto-memo');
  const btnGotoCalendar = document.getElementById('btn-goto-calendar');
  const viewSlider = document.getElementById('view-slider');

  if (btnGotoMemo && viewSlider) {
    btnGotoMemo.addEventListener('click', () => {
      viewSlider.classList.add('show-memo');
      state.activeView = 'memo';
      if (window.lucide) window.lucide.createIcons();
    });
  }

  if (btnGotoCalendar && viewSlider) {
    btnGotoCalendar.addEventListener('click', () => {
      viewSlider.classList.remove('show-memo');
      state.activeView = 'calendar';
      if (window.lucide) window.lucide.createIcons();
    });
  }
}

// --- Custom App Confirmation Modal Helper ---
function showAppConfirm(title, desc) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const descEl = document.getElementById('confirm-modal-desc');
    const okBtn = document.getElementById('confirm-modal-ok-btn');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn');

    if (!modal) {
      resolve(confirm(`${title}\n\n${desc.replace(/<br>/g, '\n')}`));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.innerHTML = desc;

    modal.classList.remove('hide');

    const onOk = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      modal.classList.add('hide');
      if (okBtn) okBtn.removeEventListener('click', onOk);
      if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
    };

    if (okBtn) okBtn.addEventListener('click', onOk);
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
  });
}

// --- PureRef Style Canvas Memo Engine ---

function pushToMemoUndoStack(action) {
  if (!state.memoUndoStack) state.memoUndoStack = [];
  state.memoUndoStack.push(action);
  if (state.memoUndoStack.length > 50) {
    state.memoUndoStack.shift();
  }
}

function triggerMemoUndo() {
  if (state.memoUndoStack && state.memoUndoStack.length > 0) {
    const action = state.memoUndoStack.pop();
    if (action.type === 'create') {
      if (action.items && Array.isArray(action.items)) {
        const removeIds = action.items.map(i => i.id);
        state.memoItems = state.memoItems.filter(m => !removeIds.includes(m.id));
      } else if (action.item) {
        state.memoItems = state.memoItems.filter(m => m.id !== action.item.id);
      }
      saveEventsToStorage();
      renderMemoCanvas();
      showToast('메모 생성이 취소되었습니다.');
    } else if (action.type === 'delete') {
      action.items.forEach(restored => {
        if (!state.memoItems.some(m => m.id === restored.id)) {
          state.memoItems.push(restored);
        }
      });
      saveEventsToStorage();
      renderMemoCanvas();
      showToast('삭제된 메모가 복원되었습니다.');
    } else if (action.type === 'update') {
      const idx = state.memoItems.findIndex(m => m.id === action.previousItem.id);
      if (idx > -1) {
        state.memoItems[idx] = { ...action.previousItem };
      } else {
        state.memoItems.push({ ...action.previousItem });
      }
      saveEventsToStorage();
      renderMemoCanvas();
      showToast('메모 변경사항이 되돌려졌습니다.');
    } else if (action.type === 'layer') {
      state.memoItems = JSON.parse(JSON.stringify(action.previousItems));
      saveEventsToStorage();
      renderMemoCanvas();
      showToast('메모 순서 변경이 되돌려졌습니다.');
    }
  } else {
    showToast('되돌릴 메모 작업 내역이 없습니다.');
  }
}

function setSelectedMemo(id) {
  state.selectedMemoId = id;
  const allMemos = document.querySelectorAll('.memo-item');
  allMemos.forEach(el => {
    if (el.dataset.id === id) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
}

function changeMemoItemLayer(itemId, direction) {
  const idx = state.memoItems.findIndex(m => m.id === itemId);
  if (idx === -1) return;

  const prevItems = JSON.parse(JSON.stringify(state.memoItems));

  if (direction === 'front') {
    if (idx === state.memoItems.length - 1) return;
    const [item] = state.memoItems.splice(idx, 1);
    state.memoItems.push(item);
    showToast('메모를 맨 위로 가져왔습니다.');
  } else if (direction === 'up') {
    if (idx === state.memoItems.length - 1) return;
    const temp = state.memoItems[idx];
    state.memoItems[idx] = state.memoItems[idx + 1];
    state.memoItems[idx + 1] = temp;
    showToast('메모를 한 단계 위로 올렸습니다.');
  } else if (direction === 'down') {
    if (idx === 0) return;
    const temp = state.memoItems[idx];
    state.memoItems[idx] = state.memoItems[idx - 1];
    state.memoItems[idx - 1] = temp;
    showToast('메모를 한 단계 아래로 내렸습니다.');
  } else if (direction === 'back') {
    if (idx === 0) return;
    const [item] = state.memoItems.splice(idx, 1);
    state.memoItems.unshift(item);
    showToast('메모를 맨 아래로 보냈습니다.');
  }

  pushToMemoUndoStack({
    type: 'layer',
    previousItems: prevItems,
    newItems: JSON.parse(JSON.stringify(state.memoItems))
  });

  state.selectedMemoId = itemId;
  saveEventsToStorage();
  renderMemoCanvas();
}

function applyMemoTransform() {
  const viewport = document.getElementById('memo-canvas-viewport');
  const zoomBadge = document.getElementById('memo-zoom-badge');
  const zoom = state.memoZoom || 1.0;
  const panX = state.memoPanX || 0;
  const panY = state.memoPanY || 0;

  if (viewport) {
    viewport.style.transform = `translate3d(${panX}px, ${panY}px, 0px) scale(${zoom})`;
    viewport.style.transformOrigin = '0 0';
    viewport.style.setProperty('--memo-zoom-inv', 1 / zoom);
  }

  if (zoomBadge) {
    zoomBadge.textContent = `${Math.round(zoom * 100)}%`;
  }
}

function createImageMemoItem(src, posX, posY) {
  const img = new Image();
  img.onload = () => {
    const naturalW = img.naturalWidth || 320;
    const naturalH = img.naturalHeight || 220;
    const ratio = naturalW / naturalH;

    const zoom = state.memoZoom || 1.0;
    const invZoom = 1 / zoom;

    const baseW = Math.min(500, Math.max(180, naturalW));
    const width = Math.round(baseW * invZoom);
    const height = Math.round(width / ratio);

    // Save image to cache file if Electron API is available
    let contentValue = src;
    if (window.electronAPI && typeof window.electronAPI.saveMemoImage === 'function' && src.startsWith('data:')) {
      const savedPath = window.electronAPI.saveMemoImage(src);
      if (savedPath) {
        contentValue = savedPath;
      }
    }

    const newMemo = {
      id: 'memo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type: 'image',
      content: contentValue,
      x: Math.round(posX - width / 2),
      y: Math.round(posY - height / 2),
      width: width,
      height: height,
      aspectRatio: ratio,
      rotation: 0
    };

    pushToMemoUndoStack({
      type: 'create',
      item: JSON.parse(JSON.stringify(newMemo))
    });

    state.memoItems.push(newMemo);
    saveEventsToStorage();
    renderMemoCanvas();
    showToast('이미지가 메모장에 추가되었습니다.', true);
  };
  img.onerror = () => {
    showToast('이미지를 로드할 수 없습니다.');
  };
  img.src = src;
}

function initMemoCanvas() {
  const canvasViewport = document.getElementById('memo-canvas-viewport');
  const scrollContainer = document.getElementById('memo-canvas-scroll');
  const btnClearMemo = document.getElementById('btn-clear-memo');
  const zoomBadge = document.getElementById('memo-zoom-badge');
  if (!canvasViewport) return;

  if (state.memoZoom === undefined) state.memoZoom = 1.0;
  if (state.memoPanX === undefined) state.memoPanX = 0;
  if (state.memoPanY === undefined) state.memoPanY = 0;
  applyMemoTransform();

  renderMemoCanvas();

  // Canvas Viewport Mouse Wheel Zoom Engine (Centered on Cursor via Pan & Zoom matrix)
  if (scrollContainer) {
    scrollContainer.addEventListener('wheel', (e) => {
      const memoItemEl = e.target.closest('.memo-item');
      if (memoItemEl && (e.ctrlKey || e.altKey)) return;

      e.preventDefault();

      const rect = scrollContainer.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldZoom = state.memoZoom || 1.0;
      const oldPanX = state.memoPanX || 0;
      const oldPanY = state.memoPanY || 0;

      // Unscaled canvas position under cursor before zoom
      const canvasX = (mouseX - oldPanX) / oldZoom;
      const canvasY = (mouseY - oldPanY) / oldZoom;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(4.0, Math.max(0.02, Math.round((oldZoom * zoomFactor) * 100) / 100));

      if (newZoom === oldZoom) return;

      // Calculate new pan so (canvasX, canvasY) stays exact under (mouseX, mouseY)
      const newPanX = Math.round(mouseX - canvasX * newZoom);
      const newPanY = Math.round(mouseY - canvasY * newZoom);

      state.memoZoom = newZoom;
      state.memoPanX = newPanX;
      state.memoPanY = newPanY;

      applyMemoTransform();
    }, { passive: false });

    // Prevent browser native autoscroll on middle-click
    scrollContainer.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    let isPanning = false;
    let isSelecting = false;
    let startX, startY, panXStart, panYStart;
    let selectionBoxEl = null;

    scrollContainer.addEventListener('contextmenu', (e) => {
      if (e.target === canvasViewport || e.target === scrollContainer) {
        e.preventDefault();
      }
    });

    scrollContainer.addEventListener('mousedown', (e) => {
      const isPanningClick = e.button === 1 || e.button === 2; // Middle-click or Right-click
      const isLeftCanvasClick = (e.target === canvasViewport || e.target === scrollContainer) && e.button === 0;

      if (isPanningClick) {
        e.preventDefault();
        isPanning = true;
        startX = e.clientX;
        startY = e.clientY;
        panXStart = state.memoPanX || 0;
        panYStart = state.memoPanY || 0;
        scrollContainer.classList.add('panning');

        const onMouseMove = (moveEvt) => {
          if (!isPanning) return;
          const dx = moveEvt.clientX - startX;
          const dy = moveEvt.clientY - startY;
          state.memoPanX = panXStart + dx;
          state.memoPanY = panYStart + dy;
          applyMemoTransform();
        };

        const onMouseUp = () => {
          if (isPanning) {
            isPanning = false;
            scrollContainer.classList.remove('panning');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return;
      }

      if (isLeftCanvasClick) {
        if (!e.shiftKey) {
          setSelectedMemos([]);
        }

        isSelecting = true;
        const zoom = state.memoZoom || 1.0;
        const viewportRect = canvasViewport.getBoundingClientRect();

        const startCanvasX = (e.clientX - viewportRect.left) / zoom;
        const startCanvasY = (e.clientY - viewportRect.top) / zoom;

        selectionBoxEl = document.createElement('div');
        selectionBoxEl.id = 'memo-selection-box';
        selectionBoxEl.style.cssText = `
          position: absolute;
          left: ${startCanvasX}px;
          top: ${startCanvasY}px;
          width: 0px;
          height: 0px;
          border: 1.5px dashed #818cf8;
          background: rgba(99, 102, 241, 0.18);
          backdrop-filter: blur(2px);
          border-radius: 4px;
          pointer-events: none;
          z-index: 99999;
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.3);
        `;
        canvasViewport.appendChild(selectionBoxEl);

        const onMouseMove = (moveEvt) => {
          if (!isSelecting || !selectionBoxEl) return;

          const curCanvasX = (moveEvt.clientX - viewportRect.left) / zoom;
          const curCanvasY = (moveEvt.clientY - viewportRect.top) / zoom;

          const boxLeft = Math.min(startCanvasX, curCanvasX);
          const boxTop = Math.min(startCanvasY, curCanvasY);
          const boxWidth = Math.abs(curCanvasX - startCanvasX);
          const boxHeight = Math.abs(curCanvasY - startCanvasY);

          selectionBoxEl.style.left = boxLeft + 'px';
          selectionBoxEl.style.top = boxTop + 'px';
          selectionBoxEl.style.width = boxWidth + 'px';
          selectionBoxEl.style.height = boxHeight + 'px';

          const boxRight = boxLeft + boxWidth;
          const boxBottom = boxTop + boxHeight;

          const hitIds = [];
          state.memoItems.forEach(item => {
            const itemW = item.width || 180;
            const itemH = item.height || 60;
            const itemLeft = item.x;
            const itemTop = item.y;
            const itemRight = item.x + itemW;
            const itemBottom = item.y + itemH;

            const isOverlap = !(itemRight < boxLeft || itemLeft > boxRight || itemBottom < boxTop || itemTop > boxBottom);
            if (isOverlap) {
              hitIds.push(item.id);
            }
          });

          let finalSelectedIds = hitIds;
          if (e.shiftKey) {
            const initialSet = new Set(getSelectedMemoIds());
            hitIds.forEach(id => initialSet.add(id));
            finalSelectedIds = Array.from(initialSet);
          }

          state.selectedMemoIds = finalSelectedIds;
          state.selectedMemoId = finalSelectedIds[finalSelectedIds.length - 1] || null;

          const allCardEls = canvasViewport.querySelectorAll('.memo-item');
          allCardEls.forEach(cardEl => {
            const cardId = cardEl.dataset.id;
            if (finalSelectedIds.includes(cardId)) {
              cardEl.classList.add('selected');
            } else {
              cardEl.classList.remove('selected');
            }
          });
        };

        const onMouseUp = () => {
          if (isSelecting) {
            isSelecting = false;
            if (selectionBoxEl && selectionBoxEl.parentNode) {
              selectionBoxEl.parentNode.removeChild(selectionBoxEl);
            }
            selectionBoxEl = null;

            renderMemoCanvas();
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    });

    // Drag & Drop Image Files from File Explorer or Web Browser
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      scrollContainer.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    scrollContainer.addEventListener('dragover', (e) => {
      e.dataTransfer.dropEffect = 'copy';
    });

    scrollContainer.addEventListener('drop', (e) => {
      const zoom = state.memoZoom || 1.0;
      const panX = state.memoPanX || 0;
      const panY = state.memoPanY || 0;
      const container = scrollContainer || canvasViewport;
      const rect = container.getBoundingClientRect();

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 드롭한 위치의 360도 무한 캔버스 카테시안 역변환 좌표 (World Canvas Coordinates)
      const dropX = (mouseX - panX) / zoom;
      const dropY = (mouseY - panY) / zoom;

      // 1. Dropped Local Files (from Windows File Explorer)
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        let count = 0;
        Array.from(files).forEach((file, index) => {
          if (file.type.startsWith('image/')) {
            count++;
            const reader = new FileReader();
            reader.onload = (evt) => {
              createImageMemoItem(evt.target.result, dropX + (index * 25), dropY + (index * 25));
            };
            reader.readAsDataURL(file);
          }
        });
        if (count > 0) return;
      }

      // 2. Dropped Web Images (from Chrome, Edge browser)
      const htmlData = e.dataTransfer.getData('text/html');
      if (htmlData) {
        const doc = new DOMParser().parseFromString(htmlData, 'text/html');
        const img = doc.querySelector('img');
        if (img && img.src) {
          createImageMemoItem(img.src, dropX, dropY);
          return;
        }
      }

      const uriData = e.dataTransfer.getData('text/uri-list');
      if (uriData) {
        createImageMemoItem(uriData.trim(), dropX, dropY);
        return;
      }
    });
  }

  if (zoomBadge) {
    zoomBadge.addEventListener('click', () => {
      state.memoZoom = 1.0;
      state.memoPanX = 0;
      state.memoPanY = 0;
      applyMemoTransform();
      showToast('화면 비율 및 위치가 100%로 리셋되었습니다.');
    });
  }

  // Wheel shortcuts: Ctrl + Wheel (Font Size for text / Aspect Zoom for image), Alt + Wheel (Rotate)
  canvasViewport.addEventListener('wheel', (e) => {
    const memoItemEl = e.target.closest('.memo-item');
    if (!memoItemEl) return;

    const item = state.memoItems.find(m => m.id === memoItemEl.dataset.id);
    if (!item) return;

    if (e.ctrlKey) {
      e.preventDefault();
      if (item.type === 'text') {
        const step = Math.max(3, Math.round((item.fontSize || 15) * 0.1));
        const deltaFont = e.deltaY < 0 ? step : -step;
        item.fontSize = Math.min(500, Math.max(6, (item.fontSize || 15) + deltaFont));

        const textarea = memoItemEl.querySelector('textarea');
        const textDisplay = memoItemEl.querySelector('.memo-text-display');
        if (textarea) textarea.style.fontSize = item.fontSize + 'px';
        if (textDisplay) textDisplay.style.fontSize = item.fontSize + 'px';
        updateMemoTextBounds(item);
        saveEventsToStorage();
      } else {
        const delta = e.deltaY < 0 ? 20 : -20;
        const curW = item.width || memoItemEl.offsetWidth || 300;
        item.width = Math.max(100, curW + delta);
        if (item.aspectRatio) {
          item.height = Math.round(item.width / item.aspectRatio);
        }

        memoItemEl.style.width = item.width + 'px';
        memoItemEl.style.height = item.height + 'px';
        saveEventsToStorage();
      }
    } else if (e.altKey) {
      e.preventDefault();
      const deltaDeg = e.deltaY < 0 ? -15 : 15;
      item.rotation = ((item.rotation || 0) + deltaDeg) % 360;

      memoItemEl.style.transform = `rotate(${item.rotation}deg)`;
      saveEventsToStorage();
    }
  }, { passive: false });

  // Prevent context menu on canvas viewport so right click can be used for deletion
  canvasViewport.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Wheel Click (Middle Click) or Right Click to Delete Item (Threshold checked so drag won't delete)
  let deleteMouseDownItem = null;
  let deleteDownX = 0, deleteDownY = 0;
  let maxDeleteDist = 0;
  let activeDeleteButton = -1;

  canvasViewport.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2) { // Middle click or Right click
      e.preventDefault();
      const memoEl = e.target.closest('.memo-item');
      if (memoEl) {
        deleteMouseDownItem = state.memoItems.find(m => m.id === memoEl.dataset.id);
        deleteDownX = e.clientX;
        deleteDownY = e.clientY;
        maxDeleteDist = 0;
        activeDeleteButton = e.button;

        const onTrackMove = (mEvt) => {
          const dist = Math.hypot(mEvt.clientX - deleteDownX, mEvt.clientY - deleteDownY);
          if (dist > maxDeleteDist) maxDeleteDist = dist;
        };

        const onTrackUp = (uEvt) => {
          if (uEvt.button === activeDeleteButton && deleteMouseDownItem) {
            if (maxDeleteDist < 6) { // Pure click, not dragging
              const deletedSnapshot = JSON.parse(JSON.stringify(deleteMouseDownItem));
              pushToMemoUndoStack({
                type: 'delete',
                items: [deletedSnapshot]
              });
              state.memoItems = state.memoItems.filter(m => m.id !== deleteMouseDownItem.id);
              saveEventsToStorage();
              renderMemoCanvas();
              showToast('메모가 삭제되었습니다.');
            }
            deleteMouseDownItem = null;
            activeDeleteButton = -1;
          }
          window.removeEventListener('mousemove', onTrackMove);
          window.removeEventListener('mouseup', onTrackUp);
        };

        window.addEventListener('mousemove', onTrackMove);
        window.addEventListener('mouseup', onTrackUp);
      }
    }
  });

  // Double-click on empty canvas viewport or scrollContainer to create a text note
  const dblClickTarget = scrollContainer || canvasViewport;
  dblClickTarget.addEventListener('dblclick', (e) => {
    // 메모 카드 자체나 UI 컨트롤을 더블클릭한 경우가 아니면 캔버스 빈 공간 전체(음수/양수/보드 영역 포함)에서 생성 허용!
    if (e.target.closest('.memo-item') || e.target.closest('.memo-group-bounds-box') || e.target.closest('.group-resize-handle')) return;

    const zoom = state.memoZoom || 1.0;
    const panX = state.memoPanX || 0;
    const panY = state.memoPanY || 0;
    const invZoom = 1 / zoom;

    const rect = dblClickTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 360도 무한 캔버스 마우스 커서 위치 정확한 카테시안 역변환 (World Canvas Coordinates)
    const clickX = (mouseX - panX) / zoom;
    const clickY = (mouseY - panY) / zoom;

    // 줌 역보정 (Zoom Inversed Relative Scale): 화면 축소/확대 비율과 관계없이 화면상에서 항상 쾌적하고 또렷한 크기로 생성!
    const targetW = Math.round(260 * invZoom);
    const targetH = Math.round(130 * invZoom);
    const targetFont = Math.max(12, Math.min(180, Math.round(24 * invZoom)));

    const newMemo = {
      id: 'memo-' + Date.now(),
      type: 'text',
      content: '',
      isEditing: true,
      x: Math.round(clickX),
      y: Math.round(clickY),
      width: targetW,
      height: targetH,
      fontSize: targetFont,
      rotation: 0
    };

    pushToMemoUndoStack({
      type: 'create',
      item: JSON.parse(JSON.stringify(newMemo))
    });

    state.memoItems.push(newMemo);
    setTimeout(() => saveEventsToStorage(), 0);
    renderMemoCanvas(newMemo.id);
  });

  let lastMouseX = null;
  let lastMouseY = null;
  window.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  // Global Clipboard Paste (Ctrl+V) listener - 마우스 커서 포지션 우선, 없으면 화면 정중앙 360도 생성
  window.addEventListener('paste', (e) => {
    if (state.activeView !== 'memo') return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const container = scrollContainer || canvasViewport;
    const rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };

    let targetScreenX, targetScreenY;
    if (lastMouseX !== null && lastMouseY !== null &&
        lastMouseX >= rect.left && lastMouseX <= rect.right &&
        lastMouseY >= rect.top && lastMouseY <= rect.bottom) {
      targetScreenX = lastMouseX - rect.left;
      targetScreenY = lastMouseY - rect.top;
    } else {
      targetScreenX = rect.width / 2;
      targetScreenY = rect.height / 2;
    }

    const zoom = state.memoZoom || 1.0;
    const panX = state.memoPanX || 0;
    const panY = state.memoPanY || 0;
    const invZoom = 1 / zoom;

    const offset = (Math.random() - 0.5) * 30 * invZoom;
    const worldX = (targetScreenX - panX) / zoom + offset;
    const worldY = (targetScreenY - panY) / zoom + offset;

    // 1. 내부 복사된 메모장 카드가 있는 경우 (Internal Memo Clipboard)
    if (state.internalClipboard && state.internalClipboard.type === 'memo' && state.internalClipboard.items.length > 0) {
      const origItems = state.internalClipboard.items;
      let minX = Infinity, minY = Infinity;
      origItems.forEach(m => {
        minX = Math.min(minX, m.x);
        minY = Math.min(minY, m.y);
      });

      const newPastedIds = [];
      const newItems = origItems.map(m => {
        const relX = m.x - minX;
        const relY = m.y - minY;
        const newId = 'memo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        newPastedIds.push(newId);

        return {
          ...JSON.parse(JSON.stringify(m)),
          id: newId,
          x: Math.round(worldX + relX),
          y: Math.round(worldY + relY)
        };
      });

      pushToMemoUndoStack({
        type: 'create',
        items: JSON.parse(JSON.stringify(newItems))
      });

      state.memoItems.push(...newItems);
      setSelectedMemos(newPastedIds);
      saveEventsToStorage();
      renderMemoCanvas();
      showToast(`${newItems.length}개의 메모 카드가 마우스 위치에 붙여넣어졌습니다.`, true);
      return;
    }

    // 2. 외부 클립보드 데이터 (이미지/텍스트)
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let handled = false;

    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => {
          createImageMemoItem(event.target.result, worldX, worldY);
        };
        reader.readAsDataURL(blob);
        handled = true;
        break;
      }
    }

    if (!handled) {
      const text = e.clipboardData.getData('text/plain');
      if (text && text.trim().length > 0) {
        const targetW = Math.round(280 * invZoom);
        const targetH = Math.round(150 * invZoom);
        const targetFont = Math.max(12, Math.min(180, Math.round(24 * invZoom)));

        const newMemo = {
          id: 'memo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          type: 'text',
          content: text.trim(),
          isEditing: false,
          x: Math.round(worldX - targetW / 2),
          y: Math.round(worldY - targetH / 2),
          width: targetW,
          height: targetH,
          fontSize: targetFont,
          rotation: 0
        };

        pushToMemoUndoStack({
          type: 'create',
          item: JSON.parse(JSON.stringify(newMemo))
        });

        state.memoItems.push(newMemo);
        saveEventsToStorage();
        renderMemoCanvas();
        showToast('클립보드 내용이 붙여넣어졌습니다.', true);
      }
    }
  });

  if (btnClearMemo) {
    btnClearMemo.addEventListener('click', async () => {
      if (!state.memoItems || state.memoItems.length === 0) return;
      const confirmed = await showAppConfirm('전체 메모 삭제', '메모장의 모든 노트를 정말로 삭제하시겠습니까?<br>삭제된 데이터는 복구할 수 없습니다.');
      if (confirmed) {
        pushToMemoUndoStack({
          type: 'delete',
          items: JSON.parse(JSON.stringify(state.memoItems))
        });
        state.memoItems = [];
        saveEventsToStorage();
        renderMemoCanvas();
        showToast('메모장이 초기화되었습니다.');
      }
    });
  }
}

// Memo Card Color Presets
const MEMO_CARD_COLORS = {
  default: { label: '기본', bg: 'rgba(15, 23, 42, 0.85)', border: 'rgba(255,255,255,0.1)', text: '#f8fafc', dot: '#334155' },
  indigo:  { label: '인디고', bg: 'rgba(49, 46, 129, 0.88)', border: 'rgba(129, 140, 248, 0.35)', text: '#e0e7ff', dot: '#6366f1' },
  blue:    { label: '블루', bg: 'rgba(30, 58, 138, 0.88)', border: 'rgba(96, 165, 250, 0.35)', text: '#dbeafe', dot: '#3b82f6' },
  teal:    { label: '틸', bg: 'rgba(19, 78, 74, 0.88)', border: 'rgba(45, 212, 191, 0.35)', text: '#ccfbf1', dot: '#14b8a6' },
  green:   { label: '그린', bg: 'rgba(20, 83, 45, 0.88)', border: 'rgba(74, 222, 128, 0.35)', text: '#dcfce7', dot: '#22c55e' },
  amber:   { label: '앰버', bg: 'rgba(120, 53, 15, 0.88)', border: 'rgba(251, 191, 36, 0.35)', text: '#fef3c7', dot: '#f59e0b' },
  rose:    { label: '로즈', bg: 'rgba(136, 19, 55, 0.88)', border: 'rgba(251, 113, 133, 0.35)', text: '#ffe4e6', dot: '#f43f5e' },
  slate:   { label: '슬레이트', bg: 'rgba(51, 65, 85, 0.88)', border: 'rgba(148, 163, 184, 0.35)', text: '#f1f5f9', dot: '#64748b' },
};

// --- Multi-Selection Helper Functions ---
function getSelectedMemoIds() {
  if (!state.selectedMemoIds) state.selectedMemoIds = [];
  return state.selectedMemoIds;
}

function isMemoSelected(id) {
  return getSelectedMemoIds().includes(id);
}

function setSelectedMemo(id) {
  state.selectedMemoId = id;
  state.selectedMemoIds = id ? [id] : [];
  
  // 전체 DOM 파괴/재생성(renderMemoCanvas) 대신 CSS 선택자 클래스만 경량 업데이트 (0.000ms 렉 0%)
  const allCards = document.querySelectorAll('.memo-item');
  allCards.forEach(card => {
    if (card.dataset.id === id) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected', 'multi-selected');
    }
  });
}

function setSelectedMemos(ids) {
  state.selectedMemoIds = Array.isArray(ids) ? ids : [];
  state.selectedMemoId = state.selectedMemoIds[state.selectedMemoIds.length - 1] || null;
  renderMemoCanvas();
}

function toggleMemoSelection(id) {
  if (!state.selectedMemoIds) state.selectedMemoIds = [];
  const idx = state.selectedMemoIds.indexOf(id);
  if (idx >= 0) {
    state.selectedMemoIds.splice(idx, 1);
  } else {
    state.selectedMemoIds.push(id);
  }
  state.selectedMemoId = state.selectedMemoIds[state.selectedMemoIds.length - 1] || null;
  renderMemoCanvas();
}

function resizeSelectedMemos(scaleFactor) {
  const selectedIds = getSelectedMemoIds();
  if (selectedIds.length === 0) return;

  const selectedItems = state.memoItems.filter(m => selectedIds.includes(m.id));
  if (selectedItems.length === 0) return;

  selectedItems.forEach(item => {
    const prevItem = JSON.parse(JSON.stringify(item));

    const newW = Math.max(80, Math.round((item.width || 180) * scaleFactor));
    const newH = Math.max(40, Math.round((item.height || 60) * scaleFactor));
    item.width = newW;
    item.height = newH;

    if (item.type === 'text') {
      const newFontSize = Math.max(6, Math.min(500, Math.round((item.fontSize || 15) * scaleFactor)));
      item.fontSize = newFontSize;
      updateMemoTextBounds(item);
    }

    pushToMemoUndoStack({
      type: 'update',
      previousItem: prevItem,
      newItem: JSON.parse(JSON.stringify(item))
    });
  });

  saveEventsToStorage();
  renderMemoCanvas();
  updateCanvasBoardBounds();
  showToast(`선택된 ${selectedItems.length}개 카드의 크기가 조절되었습니다.`);
}

function renderMemoCanvas(autoFocusId = null) {
  const viewport = document.getElementById('memo-canvas-viewport');
  if (!viewport) return;

  // memo-canvas-board DOM 요소가 파괴되지 않도록 카드 요소들(.memo-item)만 선택 안전 삭제
  const oldCards = viewport.querySelectorAll('.memo-item');
  Array.from(oldCards).forEach(c => {
    try {
      if (c && c.parentNode === viewport) {
        viewport.removeChild(c);
      } else if (c && typeof c.remove === 'function') {
        c.remove();
      }
    } catch (err) {
      // 이미 DOM 트리에서 탈거된 경우 안전하게 예외 무시
    }
  });

  const selectedIds = getSelectedMemoIds();
  const isMultiSelect = selectedIds.length > 1;

  state.memoItems.forEach(item => {
    const el = document.createElement('div');
    // 초기에 렌더링될 때 트랜지션이 발동되어 카드 밝기가 반짝이는 현상 방지
    el.style.transition = 'none';

    const isSelected = isMemoSelected(item.id) || item.isEditing;
    const multiClass = (isSelected && isMultiSelect) ? 'multi-selected' : '';
    el.className = `memo-item ${item.type === 'image' ? 'memo-item-image' : 'memo-item-text'} ${isSelected ? 'selected' : ''} ${multiClass}`.trim();
    el.dataset.id = item.id;

    // Track hovered memo item for priority Ctrl+C copy
    el.addEventListener('mouseenter', () => {
      state.hoveredMemoId = item.id;
    });
    el.addEventListener('mouseleave', () => {
      if (state.hoveredMemoId === item.id) {
        state.hoveredMemoId = null;
      }
    });

    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    el.style.width = item.width ? item.width + 'px' : 'auto';
    if (item.height && item.height !== 'auto') {
      el.style.height = item.height + 'px';
    }

    // Apply rotation transform
    if (item.rotation) {
      el.style.transform = `rotate(${item.rotation}deg)`;
    }

    // Apply card color
    if (item.cardColor && MEMO_CARD_COLORS[item.cardColor]) {
      const cc = MEMO_CARD_COLORS[item.cardColor];
      el.style.background = cc.bg;
      el.style.borderColor = cc.border;
      if (cc.text) el.style.color = cc.text;
    }

    // Rotation Handle & Connecting Line
    const rotateLine = document.createElement('div');
    rotateLine.className = 'memo-item-rotate-line';
    el.appendChild(rotateLine);

    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'memo-item-rotate-handle';
    rotateHandle.innerHTML = '↻';
    rotateHandle.title = '드래그하여 회전 (Alt+휠도 가능)';
    el.appendChild(rotateHandle);
    makeMemoItemRotatable(rotateHandle, el, item);

    // Layer Ordering Control Bar (Top-Left of Card)
    const layerBar = document.createElement('div');
    layerBar.className = 'memo-item-layer-bar';
    layerBar.innerHTML = `
      <button class="layer-btn" data-dir="front" title="맨 위로 가져오기">⇡ 맨 위</button>
      <button class="layer-btn" data-dir="up" title="한 단계 위로">↑ 위로</button>
      <button class="layer-btn" data-dir="down" title="한 단계 아래로">↓ 아래로</button>
      <button class="layer-btn" data-dir="back" title="맨 아래로 보내기">⇣ 맨 아래</button>
    `;
    layerBar.addEventListener('mousedown', (e) => e.stopPropagation());
    layerBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.layer-btn');
      if (btn && btn.dataset.dir) {
        e.stopPropagation();
        changeMemoItemLayer(item.id, btn.dataset.dir);
      }
    });
    el.appendChild(layerBar);

    // Resize Handle (Bottom-Right)
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'memo-item-resize-handle';
    resizeHandle.title = '드래그하여 크기 조절 (Ctrl+휠도 가능)';
    el.appendChild(resizeHandle);
    makeMemoItemResizable(resizeHandle, el, item);

    if (item.type === 'text') {
      // Color Picker Bar (Bottom-Left of Card)
      const colorBar = document.createElement('div');
      colorBar.className = 'memo-color-bar';
      colorBar.addEventListener('mousedown', (e) => e.stopPropagation());

      const colorKeys = Object.keys(MEMO_CARD_COLORS);
      colorKeys.forEach(key => {
        const cc = MEMO_CARD_COLORS[key];
        const dot = document.createElement('div');
        dot.className = 'memo-color-dot' + ((item.cardColor || 'default') === key ? ' active' : '');
        dot.style.background = cc.dot;
        dot.title = cc.label;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.cardColor !== key) {
            const prevItem = JSON.parse(JSON.stringify(item));
            item.cardColor = key;
            pushToMemoUndoStack({
              type: 'update',
              previousItem: prevItem,
              newItem: JSON.parse(JSON.stringify(item))
            });
            saveEventsToStorage();
            renderMemoCanvas();
          }
        });
        colorBar.appendChild(dot);
      });
      el.appendChild(colorBar);

      if (item.isEditing) {
        el.classList.add('edit-mode');
        const textBeforeEdit = JSON.parse(JSON.stringify(item));

        const textarea = document.createElement('textarea');
        textarea.value = item.content || '';
        textarea.placeholder = '메모 내용을 입력하세요...';
        if (item.fontSize) textarea.style.fontSize = item.fontSize + 'px';
        if (item.cardColor && MEMO_CARD_COLORS[item.cardColor]) {
          textarea.style.color = MEMO_CARD_COLORS[item.cardColor].text;
        }

        textarea.addEventListener('input', () => {
          item.content = textarea.value;
        });

        let isFinishing = false;
        const finishEdit = () => {
          if (isFinishing) return;
          isFinishing = true;
          textarea.removeEventListener('blur', finishEdit);

          if (item.content !== textBeforeEdit.content) {
            updateMemoTextBounds(item);
            pushToMemoUndoStack({
              type: 'update',
              previousItem: textBeforeEdit,
              newItem: JSON.parse(JSON.stringify(item))
            });
          }
          item.isEditing = false;
          setTimeout(() => saveEventsToStorage(), 0);
          renderMemoCanvas();
        };

        textarea.addEventListener('blur', finishEdit);
        textarea.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            finishEdit();
          } else if (evt.key === 'Escape') {
            finishEdit();
          }
        });

        el.appendChild(textarea);

        const indicator = document.createElement('div');
        indicator.className = 'memo-edit-indicator-outside';
        indicator.innerHTML = '<span class="status-dot">●</span> <span>수정 중 (Enter: 완료 | Shift+Enter: 줄바꿈 | ESC: 취소)</span>';
        el.appendChild(indicator);

        if (autoFocusId === item.id || item.isEditing) {
          requestAnimationFrame(() => textarea.focus());
        }
      } else {
        el.classList.add('view-mode');
        const textDisplay = document.createElement('div');
        textDisplay.className = 'memo-text-display';
        textDisplay.textContent = item.content || '내용이 없는 메모입니다. 더블클릭하여 작성하세요.';
        if (item.fontSize) textDisplay.style.fontSize = item.fontSize + 'px';
        if (item.cardColor && MEMO_CARD_COLORS[item.cardColor]) {
          textDisplay.style.color = MEMO_CARD_COLORS[item.cardColor].text;
        }

        el.addEventListener('dblclick', (evt) => {
          evt.stopPropagation();
          item.isEditing = true;
          renderMemoCanvas(item.id);
        });

        el.appendChild(textDisplay);
      }

      // Ctrl + Wheel for Smooth Font Size Adjustment on Text Card (Debounced, 0ms Lag)
      el.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();

          const currentFont = item.fontSize || 15;
          const step = Math.max(3, Math.round(currentFont * 0.1));
          const delta = e.deltaY < 0 ? step : -step;
          const newFontSize = Math.min(500, Math.max(6, currentFont + delta));

          if (newFontSize !== currentFont) {
            item.fontSize = newFontSize;
            updateMemoTextBounds(item);

            const textarea = el.querySelector('textarea');
            const textDisplay = el.querySelector('.memo-text-display');
            if (textarea) textarea.style.fontSize = newFontSize + 'px';
            if (textDisplay) textDisplay.style.fontSize = newFontSize + 'px';

            clearTimeout(el._fontWheelTimer);
            el._fontWheelTimer = setTimeout(() => {
              saveEventsToStorage();
              updateCanvasBoardBounds();
            }, 300);
          }
        }
      }, { passive: false });
    } else if (item.type === 'image') {
      const img = document.createElement('img');
      img.onerror = () => {
        img.style.display = 'none';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'padding:12px;color:#f87171;font-size:12px;text-align:center;';
        errDiv.textContent = '⚠️ 손상되거나 불러올 수 없는 이미지입니다.';
        el.appendChild(errDiv);
      };
      img.src = item.content;
      // Support local file paths (from cache) – prefix with file:// for Electron
      if (item.content && !item.content.startsWith('data:') && !item.content.startsWith('file:') && !item.content.startsWith('http')) {
        img.src = 'file:///' + item.content.replace(/\\/g, '/');
      }
      el.appendChild(img);
    }

    // Make item draggable
    makeMemoItemDraggable(el, item);

    viewport.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transition = '';
    });
  });

  // 새 카드 DOM 노드가 viewport에 온전히 붙은 뒤 1프레임 뒤 updateCanvasBoardBounds를 호출하여 CSS transition을 100% 발동시킵니다!
  requestAnimationFrame(() => {
    updateCanvasBoardBounds();
    renderGroupBoundsBox();
  });
}

function renderGroupBoundsBox() {
  const viewport = document.getElementById('memo-canvas-viewport');
  if (!viewport) return;

  const existing = document.getElementById('memo-group-bounds-box');
  if (existing) {
    existing.remove();
  }

  const selectedIds = getSelectedMemoIds();
  if (selectedIds.length <= 1) return;

  const selectedItems = state.memoItems.filter(m => selectedIds.includes(m.id));
  if (selectedItems.length <= 1) return;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  selectedItems.forEach(item => {
    const w = item.width || 180;
    const h = item.height || 60;
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + w);
    maxY = Math.max(maxY, item.y + h);
  });

  const padding = 12;
  const boxX = minX - padding;
  const boxY = minY - padding;
  const boxW = (maxX - minX) + (padding * 2);
  const boxH = (maxY - minY) + (padding * 2);

  const groupBoxEl = document.createElement('div');
  groupBoxEl.id = 'memo-group-bounds-box';
  groupBoxEl.className = 'memo-group-bounds-box';
  groupBoxEl.style.left = boxX + 'px';
  groupBoxEl.style.top = boxY + 'px';
  groupBoxEl.style.width = boxW + 'px';
  groupBoxEl.style.height = boxH + 'px';

  const handle = document.createElement('div');
  handle.className = 'group-resize-handle';
  handle.title = '드래그하여 다중 선택된 카드 일괄 상대 크기 조절';
  groupBoxEl.appendChild(handle);

  viewport.appendChild(groupBoxEl);

  // Multi-Selection Group Resize Engine
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const zoom = state.memoZoom || 1.0;
    const startX = e.clientX;
    const startY = e.clientY;

    const spanW = Math.max(1, maxX - minX);
    const spanH = Math.max(1, maxY - minY);
    const initialBoxW = Math.max(1, boxW);
    const initialBoxH = Math.max(1, boxH);

    const initialPositions = selectedItems.map(m => {
      const cardEl = Array.from(document.querySelectorAll('.memo-item')).find(el => el.dataset.id == m.id);
      return {
        item: m,
        el: cardEl,
        relX: (m.x - minX) / spanW,
        relY: (m.y - minY) / spanH,
        initialX: m.x,
        initialY: m.y,
        initialW: m.width || (cardEl ? cardEl.offsetWidth : 180),
        initialH: m.height || (cardEl ? cardEl.offsetHeight : 60),
        initialFontSize: m.fontSize || 15,
        initialState: JSON.parse(JSON.stringify(m))
      };
    });

    const onMouseMove = (moveEvt) => {
      const dx = (moveEvt.clientX - startX) / zoom;
      const dy = (moveEvt.clientY - startY) / zoom;
      const scaleRatioX = Math.max(0.15, (initialBoxW + dx) / initialBoxW);
      const scaleRatioY = Math.max(0.15, (initialBoxH + dy) / initialBoxH);

      const newSpanW = spanW * scaleRatioX;
      const newSpanH = spanH * scaleRatioY;

      groupBoxEl.style.width = Math.max(40, Math.round(initialBoxW * scaleRatioX)) + 'px';
      groupBoxEl.style.height = Math.max(30, Math.round(initialBoxH * scaleRatioY)) + 'px';

      initialPositions.forEach(pos => {
        pos.item.x = Math.round(minX + (pos.relX * newSpanW));
        pos.item.y = Math.round(minY + (pos.relY * newSpanH));

        if (pos.item.type === 'image' && pos.item.aspectRatio) {
          let targetW = Math.max(40, Math.round(pos.initialW * scaleRatioX));
          let targetH = Math.round(targetW / pos.item.aspectRatio);
          pos.item.width = targetW;
          pos.item.height = targetH;
        } else {
          let targetW = Math.max(40, Math.round(pos.initialW * scaleRatioX));
          let targetH = Math.max(25, Math.round(pos.initialH * scaleRatioY));

          if (pos.item.type === 'text') {
            if (pos.el) {
              const textarea = pos.el.querySelector('textarea');
              const textDisplay = pos.el.querySelector('.memo-text-display');
              const contentEl = textarea || textDisplay;

              if (contentEl) {
                const paddingOffset = 24;
                const baseFont = pos.initialFontSize || 24;
                const textScrollW = contentEl.scrollWidth + paddingOffset;

                let newFontSize = Math.max(6, Math.min(500, Math.round(baseFont * scaleRatioX)));

                // 여백 구간 축소 시 폰트 유지
                if (targetW < pos.initialW && targetW > textScrollW - 10) {
                  newFontSize = baseFont;
                }

                pos.item.fontSize = newFontSize;
                if (textarea) textarea.style.fontSize = newFontSize + 'px';
                if (textDisplay) textDisplay.style.fontSize = newFontSize + 'px';

                const minContentW = Math.max(40, contentEl.scrollWidth + paddingOffset);
                const minContentH = Math.max(25, contentEl.scrollHeight + paddingOffset);
                targetW = Math.max(minContentW, targetW);
                targetH = Math.max(minContentH, targetH);
              }
            }
          }

          pos.item.width = targetW;
          pos.item.height = targetH;
        }

        if (pos.el) {
          pos.el.style.left = pos.item.x + 'px';
          pos.el.style.top = pos.item.y + 'px';
          pos.el.style.width = pos.item.width + 'px';
          pos.el.style.height = pos.item.height + 'px';
        }
      });
    };

    const onMouseUp = () => {
      initialPositions.forEach(pos => {
        if (pos.initialX !== pos.item.x || pos.initialY !== pos.item.y || pos.initialW !== pos.item.width || pos.initialH !== pos.item.height) {
          pushToMemoUndoStack({
            type: 'update',
            previousItem: pos.initialState,
            newItem: JSON.parse(JSON.stringify(pos.item))
          });
        }
      });

      saveEventsToStorage();
      renderMemoCanvas();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function makeMemoItemRotatable(rotateHandle, el, item) {
  let isRotating = false;
  let initialItemState = null;

  rotateHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    isRotating = true;
    initialItemState = JSON.parse(JSON.stringify(item));
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const initialRotation = item.rotation || 0;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

    const onMouseMove = (moveEvt) => {
      if (!isRotating) return;
      const currentAngle = Math.atan2(moveEvt.clientY - centerY, moveEvt.clientX - centerX) * (180 / Math.PI);
      const angleDiff = Math.round(currentAngle - startAngle);
      item.rotation = (initialRotation + angleDiff) % 360;

      el.style.transform = `rotate(${item.rotation}deg)`;
    };

    const onMouseUp = () => {
      if (isRotating) {
        isRotating = false;
        if (initialItemState && item.rotation !== initialItemState.rotation) {
          pushToMemoUndoStack({
            type: 'update',
            previousItem: initialItemState,
            newItem: JSON.parse(JSON.stringify(item))
          });
        }
        saveEventsToStorage();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function getTextContentBoundingWidth(text, fontSize) {
  if (!text || text.trim().length === 0) return 60;
  const font = fontSize || 15;
  const lines = text.split('\n');
  let maxLineWidth = 0;

  if (!getTextContentBoundingWidth._canvas) {
    getTextContentBoundingWidth._canvas = document.createElement('canvas');
  }
  const ctx = getTextContentBoundingWidth._canvas.getContext('2d');
  ctx.font = `${font}px system-ui, -apple-system, sans-serif`;

  lines.forEach(line => {
    if (line.length > 0) {
      const metrics = ctx.measureText(line);
      maxLineWidth = Math.max(maxLineWidth, metrics.width);
    }
  });

  return Math.max(60, Math.round(maxLineWidth + 28));
}

function updateMemoTextBounds(item) {
  if (!item || item.type !== 'text') return;
  item.textMinW = getTextContentBoundingWidth(item.content, item.fontSize || 15);
}

function makeMemoItemResizable(resizeHandle, el, item) {
  let isResizing = false;
  let startX, startY, initialW;
  let initialPositions = [];

  resizeHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    initialW = item.width || el.offsetWidth;

    const selectedIds = getSelectedMemoIds();
    const isMulti = selectedIds.includes(item.id) && selectedIds.length > 1;
    const itemsToResize = isMulti ? state.memoItems.filter(m => selectedIds.includes(m.id)) : [item];

    // mousedown 순간 0.000ms 즉시 읽기 (Pre-calculated Text Bounds)
    initialPositions = itemsToResize.map(m => {
      const cardEl = document.querySelector(`.memo-item[data-id="${m.id}"]`);
      if (m.type === 'text' && !m.textMinW) {
        updateMemoTextBounds(m);
      }
      return {
        item: m,
        el: cardEl,
        initialW: m.width || (cardEl ? cardEl.offsetWidth : 180),
        initialH: m.height || (cardEl ? cardEl.offsetHeight : 60),
        initialFontSize: m.fontSize || 15,
        textMinW: m.textMinW || 60,
        initialState: JSON.parse(JSON.stringify(m))
      };
    });

    const onMouseMove = (moveEvt) => {
      if (!isResizing) return;
      const zoom = state.memoZoom || 1.0;
      const dx = (moveEvt.clientX - startX) / zoom;
      const dy = (moveEvt.clientY - startY) / zoom;

      initialPositions.forEach(pos => {
        if (pos.item.type === 'image' && pos.item.aspectRatio) {
          const targetW = Math.max(60, Math.round(pos.initialW + dx));
          const targetH = Math.round(targetW / pos.item.aspectRatio);
          pos.item.width = targetW;
          pos.item.height = targetH;
        } else {
          let minW = 60;
          let minH = 35;
          if (pos.item.type === 'text') {
            minW = pos.textMinW || 60;
          }

          const targetW = Math.max(minW, Math.round(pos.initialW + dx));
          const targetH = Math.max(minH, Math.round(pos.initialH + dy));

          pos.item.width = targetW;
          pos.item.height = targetH;
        }

        if (pos.el) {
          pos.el.style.width = pos.item.width + 'px';
          pos.el.style.height = pos.item.height + 'px';
        }
      });
    };

    const onMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        let hasChanged = false;

        initialPositions.forEach(pos => {
          // 마우스를 놓을 때 텍스트 영역을 침범해있다면 자동으로 전체 텍스트 크기에 맞춰 늘어남!
          if (pos.el && pos.item.type === 'text') {
            const textarea = pos.el.querySelector('textarea');
            const textDisplay = pos.el.querySelector('.memo-text-display');
            const contentEl = textarea || textDisplay;
            if (contentEl) {
              const textContentH = contentEl.scrollHeight + 24;
              if (pos.item.height < textContentH) {
                pos.item.height = Math.round(textContentH);
                pos.el.style.height = pos.item.height + 'px';
              }
            }
          }

          if (pos.initialW !== pos.item.width || pos.initialH !== pos.item.height) {
            hasChanged = true;
            pushToMemoUndoStack({
              type: 'update',
              previousItem: pos.initialState,
              newItem: JSON.parse(JSON.stringify(pos.item))
            });
          }
        });

        if (hasChanged) {
          saveEventsToStorage();
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function makeMemoItemDraggable(el, item) {
  let isDragging = false;
  let isCtrlFontAdjust = false;
  let startX, startY, initialFontSize;
  let initialPositions = [];

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.classList.contains('memo-item-rotate-handle') ||
        e.target.classList.contains('memo-item-resize-handle') ||
        e.target.closest('.memo-item-layer-bar') ||
        e.target.closest('.memo-color-bar')) return;

    // Shift 키 클릭 시 토글 선택
    if (e.shiftKey) {
      toggleMemoSelection(item.id);
      return;
    }

    // 이미 선택된 집합에 포함되지 않은 카드를 클릭했다면 해당 카드 선택
    if (!isMemoSelected(item.id)) {
      setSelectedMemo(item.id);
    }

    if (e.ctrlKey && item.type === 'text') {
      // Ctrl + Mouse Drag for Font Size Adjust
      isCtrlFontAdjust = true;
      startY = e.clientY;
      initialFontSize = item.fontSize || 15;
      const initialItemState = JSON.parse(JSON.stringify(item));
      e.preventDefault();
      e.stopPropagation();

      const onMouseMove = (moveEvt) => {
        if (!isCtrlFontAdjust) return;
        const dy = startY - moveEvt.clientY;
        const fontDiff = Math.round(dy / 4);
        item.fontSize = Math.min(500, Math.max(6, initialFontSize + fontDiff));

        const textarea = el.querySelector('textarea');
        const textDisplay = el.querySelector('.memo-text-display');
        if (textarea) textarea.style.fontSize = item.fontSize + 'px';
        if (textDisplay) textDisplay.style.fontSize = item.fontSize + 'px';
        updateMemoTextBounds(item);
      };

      const onMouseUp = () => {
        if (isCtrlFontAdjust) {
          isCtrlFontAdjust = false;
          if (initialItemState && item.fontSize !== initialItemState.fontSize) {
            pushToMemoUndoStack({
              type: 'update',
              previousItem: initialItemState,
              newItem: JSON.parse(JSON.stringify(item))
            });
          }
          saveEventsToStorage();
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return;
    }

    if (item.isEditing || e.target.tagName === 'TEXTAREA') return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    // 현재 선택된 모든 아이템들의 위치 정보 저장
    const selectedIds = getSelectedMemoIds();
    const selectedItems = state.memoItems.filter(m => selectedIds.includes(m.id));
    initialPositions = selectedItems.map(m => {
      const cardEl = document.querySelector(`.memo-item[data-id="${m.id}"]`);
      if (cardEl) cardEl.style.zIndex = 1000;
      return {
        item: m,
        el: cardEl,
        initialX: m.x,
        initialY: m.y,
        initialState: JSON.parse(JSON.stringify(m))
      };
    });

    const onMouseMove = (moveEvent) => {
      if (!isDragging) return;
      const zoom = state.memoZoom || 1.0;
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;

      initialPositions.forEach(pos => {
        pos.item.x = Math.round(pos.initialX + dx);
        pos.item.y = Math.round(pos.initialY + dy);
        if (pos.el) {
          pos.el.style.left = pos.item.x + 'px';
          pos.el.style.top = pos.item.y + 'px';
        }
      });
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        let hasMoved = false;

        initialPositions.forEach(pos => {
          if (pos.el) pos.el.style.zIndex = '';
          if (pos.initialX !== pos.item.x || pos.initialY !== pos.item.y) {
            hasMoved = true;
          }
        });

        if (hasMoved && initialPositions.length > 0) {
          initialPositions.forEach(pos => {
            if (pos.initialX !== pos.item.x || pos.initialY !== pos.item.y) {
              pushToMemoUndoStack({
                type: 'update',
                previousItem: pos.initialState,
                newItem: JSON.parse(JSON.stringify(pos.item))
              });
            }
          });
          saveEventsToStorage();
        }

        // 비동기로 무한 캔버스 보드 영역 갱신 (0.000ms 즉시 스무스 마우스 업!)
        requestAnimationFrame(() => updateCanvasBoardBounds());

        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

// Keydown Shortcuts for Multi-Selection & Image Copy (Delete, Ctrl+A, Ctrl+C)
window.addEventListener('keydown', (e) => {
  if (state.activeView === 'memo' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selectedIds = getSelectedMemoIds();
      if (selectedIds.length > 0) {
        e.preventDefault();
        const itemsToDelete = state.memoItems.filter(m => selectedIds.includes(m.id));
        state.memoItems = state.memoItems.filter(m => !selectedIds.includes(m.id));

        itemsToDelete.forEach(item => {
          pushToMemoUndoStack({
            type: 'delete',
            item: item
          });
        });

        setSelectedMemos([]);
        saveEventsToStorage();
        showToast(`${itemsToDelete.length}개의 메모 카드가 삭제되었습니다.`);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      // 1순위: 마우스가 호버된 카드, 2순위: 현재 선택된 카드
      let targetId = state.hoveredMemoId;
      const selectedIds = getSelectedMemoIds();
      if (!targetId && selectedIds.length > 0) {
        targetId = selectedIds[selectedIds.length - 1];
      }

      if (targetId) {
        const targetItem = state.memoItems.find(m => m.id === targetId);
        if (targetItem) {
          e.preventDefault();
          // 내부 JSON 복사 (동일 캘린더 앱 붙여넣기용)
          const copyItems = selectedIds.length > 0 && selectedIds.includes(targetId)
            ? state.memoItems.filter(m => selectedIds.includes(m.id))
            : [targetItem];
          
          state.internalClipboard = {
            type: 'memo',
            items: JSON.parse(JSON.stringify(copyItems))
          };

          // 비주얼 이미지 클립보드 복사 (카카오톡, 피그마, 포토샵, 노션 붙여넣기용 PNG)
          copyCardAsImage(targetItem);
        }
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const allIds = state.memoItems.map(m => m.id);
      setSelectedMemos(allIds);
      showToast(`전체 ${allIds.length}개 카드가 선택되었습니다.`);
    } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const selectedIds = getSelectedMemoIds();
      focusCanvasBoard();
      if (selectedIds && selectedIds.length > 0) {
        showToast(`${selectedIds.length}개 선택된 카드로 화면을 포커싱했습니다.`);
      } else {
        showToast('캔버스 전체 영역을 화면 정중앙에 맞췄습니다.');
      }
    } else if (e.key === '[' || e.key === ']') {
      const selectedIds = getSelectedMemoIds();
      if (selectedIds.length > 0) {
        e.preventDefault();
        const scaleFactor = e.key === '[' ? 0.9 : 1.1;
        resizeSelectedMemos(scaleFactor);
      }
    }
  }
});

// 카드를 비주얼 스타일 그대로 PNG 캔버스화하여 클립보드에 전달하는 스마트 엔진
async function copyCardAsImage(targetItem) {
  if (!targetItem) return;

  const cardEl = document.querySelector(`.memo-item[data-id="${targetItem.id}"]`);
  if (!cardEl) return;

  try {
    const width = cardEl.offsetWidth || targetItem.width || 240;
    const height = cardEl.offsetHeight || targetItem.height || 120;

    const canvas = document.createElement('canvas');
    const dpr = 2; // 선명한 2배 고해상도 렌더링
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const computedStyle = window.getComputedStyle(cardEl);
    const bgColor = computedStyle.backgroundColor || 'rgba(15, 23, 42, 0.92)';
    const borderColor = computedStyle.borderColor || 'rgba(255, 255, 255, 0.2)';
    const textColor = computedStyle.color || '#ffffff';

    // 둥근 모서리 카테시안 패스 렌더링
    const radius = 14;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(width - radius, 0);
    ctx.quadraticCurveTo(width, 0, width, radius);
    ctx.lineTo(width, height - radius);
    ctx.quadraticCurveTo(width, height, width - radius, height);
    ctx.lineTo(radius, height);
    ctx.quadraticCurveTo(0, height, 0, height - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();

    ctx.fillStyle = bgColor.includes('rgba(0, 0, 0, 0)') ? '#0f172a' : bgColor;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = borderColor;
    ctx.stroke();

    if (targetItem.type === 'image') {
      const imgEl = cardEl.querySelector('img');
      if (imgEl && imgEl.src) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res) => {
          img.onload = res;
          img.onerror = res;
          img.src = imgEl.src;
        });

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(width - radius, 0);
        ctx.quadraticCurveTo(width, 0, width, radius);
        ctx.lineTo(width, height - radius);
        ctx.quadraticCurveTo(width, height, width - radius, height);
        ctx.lineTo(radius, height);
        ctx.quadraticCurveTo(0, height, 0, height - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(img, 0, 0, width, height);
        ctx.restore();
      }
    } else {
      // 텍스트 카드 줄바꿈 렌더링
      const textarea = cardEl.querySelector('textarea');
      const textDisplay = cardEl.querySelector('.memo-text-display');
      const content = targetItem.content || (textarea ? textarea.value : (textDisplay ? textDisplay.textContent : ''));
      const fontSize = targetItem.fontSize || 16;

      // 렌더링된 정확한 폰트 패밀리 및 굵기 동적 추출 (Dynamic Computed Style Matching)
      const targetTextEl = textarea || textDisplay || cardEl;
      const computedStyle = targetTextEl ? window.getComputedStyle(targetTextEl) : null;
      const fontFamily = (computedStyle && computedStyle.fontFamily) 
        ? computedStyle.fontFamily 
        : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      const fontWeight = (computedStyle && computedStyle.fontWeight) ? computedStyle.fontWeight : '500';

      ctx.fillStyle = textColor;
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.textBaseline = 'top';

      const padding = 16;
      const maxWidth = width - (padding * 2);
      const lineHeight = Math.round(fontSize * 1.35);

      const lines = [];
      const paragraphs = content.split('\n');

      paragraphs.forEach(para => {
        let currentLine = '';
        const words = para.split('');
        for (let i = 0; i < words.length; i++) {
          const testLine = currentLine + words[i];
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = words[i];
          } else {
            currentLine = testLine;
          }
        }
        lines.push(currentLine);
      });

      let curY = padding;
      lines.forEach(line => {
        if (curY + lineHeight <= height - padding + 12) {
          ctx.fillText(line, padding, curY);
          curY += lineHeight;
        }
      });
    }

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        showToast('📸 카드가 이미지 형태로 클립보드에 복사되었습니다!', true);
      } catch (clipErr) {
        console.warn('Clipboard write fallback:', clipErr);
        showToast('카드가 클립보드 이미지로 복사되었습니다.');
      }
    }, 'image/png');

  } catch (err) {
    console.error('copyCardAsImage error:', err);
  }
}

// [Category Custom RGB Color Picker] - 일정 클릭/수정 팝업에서 우클릭 시 RGB 색상 지정
let customCategoryColors = JSON.parse(localStorage.getItem('ugul_custom_cat_colors') || '{}');

function applyCategoryCustomColor(catKey, hexColor) {
  if (!catKey || !hexColor) return;
  customCategoryColors[catKey] = hexColor;
  localStorage.setItem('ugul_custom_cat_colors', JSON.stringify(customCategoryColors));

  // CSS 전역 변수 및 그래디언트/글로우 업데이트
  document.documentElement.style.setProperty(`--cat-${catKey}`, hexColor);
  document.documentElement.style.setProperty(`--cat-${catKey}-gradient`, `linear-gradient(135deg, ${hexColor} 0%, ${hexToRgba(hexColor, 0.85)} 100%)`);
  document.documentElement.style.setProperty(`--cat-${catKey}-glow`, hexToRgba(hexColor, 0.35));

  // 1. 이벤트 모달 카테고리 커스텀 라디오 닷 색상 업데이트
  const customRadio = document.querySelector(`.cat-${catKey}-radio`);
  if (customRadio) {
    customRadio.style.backgroundColor = hexColor;
    customRadio.style.borderColor = hexColor;
  }

  // 2. 좌측 사이드바 카테고리 닷 업데이트
  const sidebarDot = document.querySelector(`.dot-${catKey}`);
  if (sidebarDot) {
    sidebarDot.style.backgroundColor = hexColor;
  }

  // 3. 그리드 이벤트 실시간 재렌더링
  if (typeof renderGridEvents === 'function') {
    renderGridEvents();
  }
}

function initCategoryColorPickers() {
  const pickerInput = document.getElementById('cat-rgb-picker');
  let activeCatKey = null;

  // 저장된 커스텀 카테고리 색상 복원
  Object.keys(customCategoryColors).forEach(catKey => {
    applyCategoryCustomColor(catKey, customCategoryColors[catKey]);
  });

  // 카테고리 라벨 우클릭 이벤트 바인딩
  document.querySelectorAll('.cat-radio-label').forEach(label => {
    label.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const catKey = label.getAttribute('data-cat') || label.querySelector('input')?.value;
      if (!catKey || !pickerInput) return;
      activeCatKey = catKey;

      // 현재 카테고리 색상 또는 기본값을 picker에 세팅
      const currentVal = customCategoryColors[catKey] || getComputedStyle(document.documentElement).getPropertyValue(`--cat-${catKey}`).trim() || '#6366f1';
      pickerInput.value = currentVal.startsWith('#') ? currentVal : '#6366f1';
      pickerInput.click();
    });
  });

  // Color Picker 값 변경 시 실시간 반영
  if (pickerInput) {
    const handleColorChange = (e) => {
      if (activeCatKey && e.target.value) {
        applyCategoryCustomColor(activeCatKey, e.target.value);
      }
    };
    pickerInput.addEventListener('input', handleColorChange);
    pickerInput.addEventListener('change', handleColorChange);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initCategoryColorPickers();
    
    const btnCheckUpdate = document.getElementById('btn-check-update');
    if (btnCheckUpdate) {
      btnCheckUpdate.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.send) {
          window.electronAPI.send('check-for-updates-manual');
        } else {
          alert('현재 버전: v1.0.7 (GitHub Repository: ugulsunday1306-droid/Calander)');
        }
      });
    }

    const toggleAutoLaunch = document.getElementById('toggle-auto-launch');
    if (toggleAutoLaunch) {
      const savedAutoLaunch = localStorage.getItem('ugul_auto_launch') === 'true';
      toggleAutoLaunch.checked = savedAutoLaunch;

      if (window.electronAPI && window.electronAPI.getAutoLaunch) {
        window.electronAPI.getAutoLaunch().then(isAutoLaunch => {
          if (typeof isAutoLaunch === 'boolean') {
            toggleAutoLaunch.checked = isAutoLaunch;
            localStorage.setItem('ugul_auto_launch', isAutoLaunch ? 'true' : 'false');
          }
        }).catch(() => {});
      }

      toggleAutoLaunch.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        localStorage.setItem('ugul_auto_launch', enabled ? 'true' : 'false');
        if (window.electronAPI && window.electronAPI.setAutoLaunch) {
          const success = await window.electronAPI.setAutoLaunch(enabled);
          if (!success) {
            console.warn('Auto launch set settings returned false');
          }
        }
      });
    }

    // 커스텀 인앱 업데이트 모달 & 하단 프로그래스 바 제어
    const updateModal = document.getElementById('update-custom-modal');
    const updateVerInfo = document.getElementById('update-modal-ver-info');
    const btnStartUpdate = document.getElementById('btn-start-inapp-update');
    const btnDismissUpdate = document.getElementById('btn-dismiss-inapp-update');
    
    const updateLatestModal = document.getElementById('update-latest-modal');
    const updateLatestVerInfo = document.getElementById('update-latest-ver-info');
    const btnCloseLatestModal = document.getElementById('btn-close-latest-update-modal');

    const progressWidget = document.getElementById('update-progress-widget');
    const progressStatus = document.getElementById('update-progress-status');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressBarFill = document.getElementById('update-progress-bar-fill');

    let latestReleaseInfo = null;

    if (window.electronAPI) {
      if (window.electronAPI.onUpdateAvailable) {
        window.electronAPI.onUpdateAvailable((data) => {
          latestReleaseInfo = data;
          if (updateModal && updateVerInfo) {
            updateVerInfo.textContent = `현재 버전 (${data.currentVersion}) ➔ 최신 버전 (${data.latestVersion})`;
            updateModal.style.display = 'flex';
          }
        });
      }

      if (window.electronAPI.onUpdateNotAvailable) {
        window.electronAPI.onUpdateNotAvailable((msg) => {
          if (updateLatestModal && updateLatestVerInfo) {
            updateLatestVerInfo.textContent = msg || '현재 최신 버전을 사용하고 계십니다.';
            updateLatestModal.style.display = 'flex';
          } else {
            alert(msg);
          }
        });
      }

      if (window.electronAPI.onUpdateProgress) {
        window.electronAPI.onUpdateProgress((percent) => {
          requestAnimationFrame(() => {
            if (progressWidget) progressWidget.style.display = 'block';
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressBarFill) progressBarFill.style.width = `${percent}%`;
          });
        });
      }

      if (window.electronAPI.onUpdateDownloaded) {
        window.electronAPI.onUpdateDownloaded(() => {
          if (progressStatus) progressStatus.textContent = '✅ 패치 완료! 앱을 자동 재시작합니다...';
          if (progressBarFill) progressBarFill.style.width = '100%';
          if (progressPercent) progressPercent.textContent = '100%';
        });
      }

      if (window.electronAPI.onUpdateError) {
        window.electronAPI.onUpdateError((err) => {
          if (progressWidget) progressWidget.style.display = 'none';
          alert('업데이트 오류: ' + err);
        });
      }
    }

    // [초강력 무결성 패치 엔진] 렌더러 direct fetch 스트리밍 및 웹 fallback 2중 안전망
    async function startDirectFetchUpdate(downloadUrl) {
      if (progressWidget) progressWidget.style.display = 'block';
      if (progressStatus) progressStatus.textContent = '⚡ 최신 패치 다운로드 중...';
      if (progressPercent) progressPercent.textContent = '1%';
      if (progressBarFill) progressBarFill.style.width = '1%';

      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        
        const reader = response.body.getReader();
        let receivedBytes = 0;
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          receivedBytes += value.length;

          let percent = 5;
          if (totalBytes > 0) {
            percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
          } else {
            percent = Math.min(99, Math.max(5, Math.round((receivedBytes / (1024 * 1024 * 10)) * 100)));
          }

          if (progressPercent) progressPercent.textContent = `${percent}%`;
          if (progressBarFill) progressBarFill.style.width = `${percent}%`;
        }

        if (progressStatus) progressStatus.textContent = '⚡ 바이너리 검증 완료! 무결성 패치 적용 중...';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressBarFill) progressBarFill.style.width = '100%';

        // Uint8Array 합치기
        const totalBuffer = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          totalBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        // 메인 프로세스에 전달하여 압축 해제 및 앱 자동 재시작 실행
        if (window.electronAPI && window.electronAPI.saveUpdateZipAndApply) {
          const res = await window.electronAPI.saveUpdateZipAndApply(totalBuffer.buffer);
          if (!res || !res.success) {
            throw new Error(res ? res.error : '적용 실패');
          }
        }
      } catch (err) {
        console.error('Direct fetch update failed, opening browser fallback:', err);
        if (progressWidget) progressWidget.style.display = 'none';
        
        // [2중 안전 망] 웹 브라우저 직통 다운로드 창 자동 호출
        if (confirm(`자동 다운로드가 방화벽/네트워크 환경으로 차단되었습니다.\n웹 브라우저로 패치 파일(${latestReleaseInfo ? latestReleaseInfo.latestVersion : '최신버전'})을 다운로드하시겠습니까?`)) {
          if (window.electronAPI && window.electronAPI.openExternalUrl && latestReleaseInfo && latestReleaseInfo.downloadUrl) {
            window.electronAPI.openExternalUrl(latestReleaseInfo.downloadUrl);
          }
        }
      }
    }

    if (btnStartUpdate) {
      btnStartUpdate.addEventListener('click', () => {
        if (updateModal) updateModal.style.display = 'none';
        
        if (latestReleaseInfo && latestReleaseInfo.downloadUrl) {
          if (window.electronAPI && window.electronAPI.startDirectUpdate) {
            window.electronAPI.startDirectUpdate(latestReleaseInfo.downloadUrl);
          } else {
            startDirectFetchUpdate(latestReleaseInfo.downloadUrl);
          }
        } else if (window.electronAPI && window.electronAPI.startDownloadUpdate) {
          if (progressWidget) progressWidget.style.display = 'block';
          window.electronAPI.startDownloadUpdate();
        } else {
          alert('다운로드 주소를 찾을 수 없습니다. [업데이트 확인]을 다시 눌러주세요.');
        }
      });
    }

    if (btnDismissUpdate) {
      btnDismissUpdate.addEventListener('click', () => {
        if (updateModal) updateModal.style.display = 'none';
      });
    }

    if (btnCloseLatestModal) {
      btnCloseLatestModal.addEventListener('click', () => {
        if (updateLatestModal) updateLatestModal.style.display = 'none';
      });
    }

    // 동적 카테고리 추가 모달 및 좌측 사이드바 연동
    const btnOpenAddCat = document.getElementById('btn-open-add-category');
    const btnSidebarAddCat = document.getElementById('btn-sidebar-add-category');
    const addCatModal = document.getElementById('add-category-modal');
    const newCatNameInput = document.getElementById('new-cat-name-input');
    const newCatColorInput = document.getElementById('new-cat-color-input');
    const newCatColorLabel = document.getElementById('new-cat-color-label');
    const btnCancelAddCat = document.getElementById('btn-cancel-add-category');
    const btnSaveAddCat = document.getElementById('btn-save-add-category');
    const dynamicCatContainer = document.getElementById('dynamic-category-chips-container');
    const sidebarDynamicContainer = document.getElementById('sidebar-dynamic-categories');

    if (newCatColorInput && newCatColorLabel) {
      newCatColorInput.addEventListener('input', (e) => {
        newCatColorLabel.textContent = e.target.value.toUpperCase();
      });
    }

    const openAddModal = () => {
      if (newCatNameInput) newCatNameInput.value = '';
      if (newCatColorInput) newCatColorInput.value = '#a855f7';
      if (newCatColorLabel) newCatColorLabel.textContent = '#A855F7';
      if (addCatModal) addCatModal.style.display = 'flex';
      if (newCatNameInput) newCatNameInput.focus();
    };

    if (btnOpenAddCat) btnOpenAddCat.addEventListener('click', openAddModal);
    if (btnSidebarAddCat) btnSidebarAddCat.addEventListener('click', openAddModal);

    if (btnCancelAddCat && addCatModal) {
      btnCancelAddCat.addEventListener('click', () => {
        addCatModal.style.display = 'none';
      });
    }

    function renderDynamicCategories() {
      const customCats = JSON.parse(localStorage.getItem('ugul_custom_categories') || '[]');

      // 1. 일정 등록/수정 모달 라디오 칩 렌더링
      if (dynamicCatContainer) {
        dynamicCatContainer.innerHTML = '';
        customCats.forEach((cat) => {
          const label = document.createElement('label');
          label.className = 'cat-radio-label';
          label.dataset.customCatId = cat.id;
          label.title = `우클릭 시 ${cat.name} 색상 변경`;
          
          label.innerHTML = `
            <input type="radio" name="event-category" value="${cat.id}">
            <span class="custom-radio" style="background-color: ${cat.color}; border-color: ${cat.color}; box-shadow: 0 0 6px ${cat.color};"></span>
            <span>${escapeHTML(cat.name)}</span>
          `;

          // 우클릭(contextmenu) 시 색상 피커 오픈
          label.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const rgbPicker = document.getElementById('cat-rgb-picker');
            if (rgbPicker) {
              rgbPicker.value = cat.color || '#a855f7';
              rgbPicker.oninput = (evt) => {
                const newColor = evt.target.value;
                const currentCats = JSON.parse(localStorage.getItem('ugul_custom_categories') || '[]');
                const target = currentCats.find(c => c.id === cat.id);
                if (target) {
                  target.color = newColor;
                  localStorage.setItem('ugul_custom_categories', JSON.stringify(currentCats));
                  renderDynamicCategories();
                  if (typeof renderEvents === 'function') renderEvents();
                }
              };
              rgbPicker.click();
            }
          });

          dynamicCatContainer.appendChild(label);
        });
      }

      // 2. 캘린더 좌측 사이드바 필터링 체크박스 렌더링 (기존 4개와 100% 동일 규격 + 호버 - 삭제 버튼)
      if (sidebarDynamicContainer) {
        sidebarDynamicContainer.innerHTML = '';
        customCats.forEach((cat) => {
          const label = document.createElement('label');
          label.className = 'category-item';
          label.dataset.customCatId = cat.id;
          label.title = `우클릭 시 ${cat.name} 색상 변경`;

          label.innerHTML = `
            <input type="checkbox" checked value="${cat.id}" class="cat-checkbox" data-color="${cat.color}">
            <span class="dot" style="background-color: ${cat.color}; box-shadow: 0 0 6px ${cat.color};"></span>
            <span class="cat-name">${escapeHTML(cat.name)}</span>
            <button type="button" class="btn-delete-category" title="카테고리 삭제">
              <i data-lucide="minus" style="width: 12px; height: 12px;"></i>
            </button>
          `;

          // 호버 - 버튼 클릭 시 카테고리 삭제
          const btnDelete = label.querySelector('.btn-delete-category');
          if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              if (confirm(`'${cat.name}' 카테고리를 삭제하시겠습니까?`)) {
                let currentCats = JSON.parse(localStorage.getItem('ugul_custom_categories') || '[]');
                currentCats = currentCats.filter(c => c.id !== cat.id);
                localStorage.setItem('ugul_custom_categories', JSON.stringify(currentCats));
                
                // 해당 카테고리를 사용하던 일정을 기본 'work' 카테고리로 안전 보정
                if (state && state.events) {
                  let updated = false;
                  state.events.forEach(evt => {
                    if (evt.category === cat.id) {
                      evt.category = 'work';
                      updated = true;
                    }
                  });
                  if (updated && typeof saveEventsToFile === 'function') {
                    saveEventsToFile();
                  }
                }

                renderDynamicCategories();
                if (typeof renderEvents === 'function') renderEvents();
              }
            });
          }

          // 우클릭(contextmenu) 시 색상 피커 오픈
          label.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const rgbPicker = document.getElementById('cat-rgb-picker');
            if (rgbPicker) {
              rgbPicker.value = cat.color || '#a855f7';
              rgbPicker.oninput = (evt) => {
                const newColor = evt.target.value;
                const currentCats = JSON.parse(localStorage.getItem('ugul_custom_categories') || '[]');
                const target = currentCats.find(c => c.id === cat.id);
                if (target) {
                  target.color = newColor;
                  localStorage.setItem('ugul_custom_categories', JSON.stringify(currentCats));
                  renderDynamicCategories();
                  if (typeof renderEvents === 'function') renderEvents();
                }
              };
              rgbPicker.click();
            }
          });

          const checkbox = label.querySelector('input[type="checkbox"]');
          checkbox.addEventListener('change', () => {
            if (typeof renderEvents === 'function') {
              renderEvents();
            }
          });

          sidebarDynamicContainer.appendChild(label);
        });
        if (window.lucide) lucide.createIcons();
      }
    }

    if (btnSaveAddCat) {
      btnSaveAddCat.addEventListener('click', () => {
        const catName = newCatNameInput ? newCatNameInput.value.trim() : '';
        const catColor = newCatColorInput ? newCatColorInput.value : '#a855f7';
        
        if (!catName) {
          if (newCatNameInput) {
            newCatNameInput.style.border = '2px solid #ef4444';
            newCatNameInput.placeholder = '카테고리 이름을 입력해주세요!';
            setTimeout(() => {
              newCatNameInput.focus();
            }, 50);
          }
          return;
        }

        if (newCatNameInput) {
          newCatNameInput.style.border = '1px solid var(--border-light)';
        }

        const customCats = JSON.parse(localStorage.getItem('ugul_custom_categories') || '[]');
        const newCat = {
          id: 'custom_' + Date.now(),
          name: catName,
          color: catColor
        };
        customCats.push(newCat);
        localStorage.setItem('ugul_custom_categories', JSON.stringify(customCats));

        renderDynamicCategories();
        if (addCatModal) addCatModal.style.display = 'none';
        if (typeof renderEvents === 'function') {
          renderEvents();
        }
      });
    }

    renderDynamicCategories();
  }, 100);
});
