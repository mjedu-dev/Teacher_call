// admin/admin.js
import { firebaseConfig, isFirebaseConfigured } from '../firebase-config.js';

// Global variables
let dbService = null;
let audioEnabled = false;
let pageLoadTime = Date.now();
let knownCallIds = new Set();
let isInitialCallsLoad = true;
let currentTeachers = [];
let currentCalls = [];

// Mock database keys
const MOCK_TEACHERS_KEY = "mock_teachers";
const MOCK_CALLS_KEY = "mock_calls";

const DEFAULT_TEACHERS = [
  { id: "T1", name: "김철수", subject: "국어", status: "호출 가능" },
  { id: "T2", name: "이영희", subject: "수학", status: "자리비움" },
  { id: "T3", name: "박민수", subject: "영어", status: "수업 중" },
  { id: "T4", name: "최수진", subject: "과학", status: "출장" },
  { id: "T5", name: "정우성", subject: "체육", status: "호출 가능" }
];

let teacherSubscribers = [];
let callSubscribers = [];

function getMockTeachers() {
  const stored = localStorage.getItem(MOCK_TEACHERS_KEY);
  if (!stored) {
    localStorage.setItem(MOCK_TEACHERS_KEY, JSON.stringify(DEFAULT_TEACHERS));
    return DEFAULT_TEACHERS;
  }
  return JSON.parse(stored);
}

function getMockCalls() {
  const stored = localStorage.getItem(MOCK_CALLS_KEY);
  return stored ? JSON.parse(stored) : [];
}

function notifySubscribers() {
  const teachers = getMockTeachers();
  teacherSubscribers.forEach(cb => cb(teachers));
  const calls = getMockCalls();
  callSubscribers.forEach(cb => cb(calls));
}

// Listen to other tabs updates for Mock mode
window.addEventListener('storage', (e) => {
  if (e.key === MOCK_TEACHERS_KEY || e.key === MOCK_CALLS_KEY) {
    notifySubscribers();
  }
});

// Setup DB Service
async function initDbService() {
  if (isFirebaseConfigured()) {
    console.log("Initializing Firebase Firestore Mode (Admin)...");
    try {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
      const { 
        getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy, limit 
      } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
      
      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);
      
      dbService = {
        isMock: false,
        subscribeTeachers(callback) {
          return onSnapshot(collection(db, "teachers"), (snapshot) => {
            const teachers = [];
            snapshot.forEach(doc => {
              teachers.push({ id: doc.id, ...doc.data() });
            });
            if (teachers.length === 0) {
              DEFAULT_TEACHERS.forEach(t => {
                addDoc(collection(db, "teachers"), {
                  name: t.name,
                  subject: t.subject,
                  status: t.status,
                  updatedAt: serverTimestamp()
                });
              });
            }
            callback(teachers);
          });
        },
        subscribeCalls(callback) {
          const q = query(collection(db, "calls"), orderBy("timestamp", "desc"), limit(100));
          return onSnapshot(q, (snapshot) => {
            const calls = [];
            snapshot.forEach(doc => {
              const data = doc.data();
              const timestamp = data.timestamp ? data.timestamp.toMillis() : Date.now();
              calls.push({ id: doc.id, ...data, timestamp });
            });
            callback(calls);
          });
        },
        async addTeacher(name, subject) {
          await addDoc(collection(db, "teachers"), {
            name,
            subject,
            status: "호출 가능",
            updatedAt: serverTimestamp()
          });
        },
        async deleteTeacher(id) {
          await deleteDoc(doc(db, "teachers", id));
        },
        async updateTeacherStatus(id, status) {
          await updateDoc(doc(db, "teachers", id), {
            status,
            updatedAt: serverTimestamp()
          });
        },
        async updateCallStatus(callId, status) {
          await updateDoc(doc(db, "calls", callId), {
            status,
            respondedAt: serverTimestamp()
          });
        },
        async clearAllCalls(calls) {
          const promises = calls.map(c => deleteDoc(doc(db, "calls", c.id)));
          await Promise.all(promises);
        }
      };
      document.getElementById('mock-badge').style.display = 'none';
    } catch (error) {
      console.error("Firebase load failed, falling back to Mock Mode:", error);
      setupMockService();
    }
  } else {
    setupMockService();
  }
}

function setupMockService() {
  console.log("Initializing LocalStorage Mock Mode (Admin)...");
  
  dbService = {
    isMock: true,
    subscribeTeachers(callback) {
      teacherSubscribers.push(callback);
      callback(getMockTeachers());
      return () => {
        teacherSubscribers = teacherSubscribers.filter(cb => cb !== callback);
      };
    },
    subscribeCalls(callback) {
      callSubscribers.push(callback);
      callback(getMockCalls());
      return () => {
        callSubscribers = callSubscribers.filter(cb => cb !== callback);
      };
    },
    async addTeacher(name, subject) {
      const teachers = getMockTeachers();
      teachers.push({
        id: "T_" + Date.now(),
        name,
        subject,
        status: "호출 가능",
        updatedAt: Date.now()
      });
      localStorage.setItem(MOCK_TEACHERS_KEY, JSON.stringify(teachers));
      notifySubscribers();
    },
    async deleteTeacher(id) {
      let teachers = getMockTeachers();
      teachers = teachers.filter(t => t.id !== id);
      localStorage.setItem(MOCK_TEACHERS_KEY, JSON.stringify(teachers));
      notifySubscribers();
    },
    async updateTeacherStatus(id, status) {
      const teachers = getMockTeachers();
      const teacher = teachers.find(t => t.id === id);
      if (teacher) {
        teacher.status = status;
        teacher.updatedAt = Date.now();
        localStorage.setItem(MOCK_TEACHERS_KEY, JSON.stringify(teachers));
        notifySubscribers();
      }
    },
    async updateCallStatus(callId, status) {
      const calls = getMockCalls();
      const call = calls.find(c => c.id === callId);
      if (call) {
        call.status = status;
        call.respondedAt = Date.now();
        localStorage.setItem(MOCK_CALLS_KEY, JSON.stringify(calls));
        notifySubscribers();
      }
    },
    async clearAllCalls() {
      localStorage.setItem(MOCK_CALLS_KEY, JSON.stringify([]));
      notifySubscribers();
    }
  };
  
  document.getElementById('mock-badge').style.display = 'inline-flex';
}

// Text to Speech
function speakCallNotification(teacherName) {
  if (!audioEnabled) return;
  
  const text = `${teacherName} 선생님 호출입니다.`;
  
  const speakOnce = () => {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      const koVoice = voices.find(voice => voice.lang.includes('ko') || voice.lang.includes('KO'));
      if (koVoice) utterance.voice = koVoice;
      
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      
      window.speechSynthesis.speak(utterance);
    });
  };
  
  speakOnce().then(() => {
    setTimeout(() => {
      speakOnce();
    }, 600);
  });
}

// UI Rendering - Admin Screen
function renderAdminScreen(teachers, calls) {
  const audioBanner = document.getElementById('audio-banner');
  if (audioEnabled) {
    audioBanner.classList.add('active');
    audioBanner.innerHTML = '<span>✅ 한국어 음성 안내 시스템이 정상 작동 중입니다. (새 호출 발생 시 안내 방송 송출)</span>';
  }
  
  const sidebarList = document.getElementById('sidebar-teacher-list');
  sidebarList.innerHTML = '';
  teachers.forEach(t => {
    const item = document.createElement('div');
    item.className = 'sidebar-teacher-item';
    item.innerHTML = `
      <span>${t.name} (${t.subject || '미정'})</span>
      <button class="btn-delete" data-id="${t.id}">삭제</button>
    `;
    sidebarList.appendChild(item);
  });
  
  sidebarList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (confirm("정말 이 선생님 정보를 삭제하시겠습니까?")) {
        await dbService.deleteTeacher(id);
      }
    });
  });
  
  const adminGrid = document.getElementById('teachers-admin-grid');
  adminGrid.innerHTML = '';
  teachers.forEach(t => {
    const card = document.createElement('div');
    card.className = 'teacher-admin-card';
    
    const isAvail = t.status === "호출 가능" ? "checked" : "";
    const isAway = t.status === "자리비움" ? "checked" : "";
    const isClass = t.status === "수업 중" ? "checked" : "";
    const isTrip = t.status === "출장" ? "checked" : "";
    
    card.innerHTML = `
      <div class="admin-card-header">
        <span class="admin-card-name">${t.name} 선생님</span>
        <span class="teacher-subject">${t.subject}</span>
      </div>
      <div class="status-selector">
        <input type="radio" id="st-${t.id}-avail" class="status-opt" name="st-${t.id}" value="호출 가능" ${isAvail}>
        <label for="st-${t.id}-avail" class="status-label">호출 가능</label>
        
        <input type="radio" id="st-${t.id}-away" class="status-opt" name="st-${t.id}" value="자리비움" ${isAway}>
        <label for="st-${t.id}-away" class="status-label">자리비움</label>
        
        <input type="radio" id="st-${t.id}-class" class="status-opt" name="st-${t.id}" value="수업 중" ${isClass}>
        <label for="st-${t.id}-class" class="status-label">수업 중</label>
        
        <input type="radio" id="st-${t.id}-trip" class="status-opt" name="st-${t.id}" value="출장" ${isTrip}>
        <label for="st-${t.id}-trip" class="status-label">출장</label>
      </div>
    `;
    
    adminGrid.appendChild(card);
    
    card.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        await dbService.updateTeacherStatus(t.id, e.target.value);
      });
    });
  });
  
  const activeCallsList = document.getElementById('active-calls-list');
  activeCallsList.innerHTML = '';
  
  const activeCalls = calls.filter(c => c.status === "pending");
  
  if (activeCalls.length === 0) {
    activeCallsList.innerHTML = '<div class="no-calls-placeholder" style="grid-column: 1/-1;">현재 대기 중인 호출이 없습니다.</div>';
  } else {
    activeCalls.forEach(c => {
      const card = document.createElement('div');
      card.className = 'call-item-card';
      
      const timeStr = new Date(c.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      card.innerHTML = `
        <div class="call-item-header">
          <div>
            <h4 class="call-teacher-name">${c.teacherName} 선생님</h4>
            <span class="call-time">호출 시간: ${timeStr}</span>
          </div>
          <span class="status-badge status-available">호출중</span>
        </div>
        
        ${c.studentInfo 
          ? `<div class="call-student-info">👤 ${c.studentInfo}</div>` 
          : `<div class="call-student-info call-student-waiting">⏳ 대기 중 (30초 카운트다운 진행 중)</div>`
        }
        
        <div class="call-item-actions">
          <button class="btn-action btn-action-primary btn-ack" data-id="${c.id}">확인</button>
          <button class="btn-action btn-action-secondary btn-comp" data-id="${c.id}">완료</button>
        </div>
      `;
      
      activeCallsList.appendChild(card);
    });
    
    activeCallsList.querySelectorAll('.btn-ack').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await dbService.updateCallStatus(id, "acknowledged");
      });
    });
    
    activeCallsList.querySelectorAll('.btn-comp').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await dbService.updateCallStatus(id, "completed");
      });
    });
  }
  
  const historyList = document.getElementById('history-list');
  historyList.innerHTML = '';
  
  if (calls.length === 0) {
    historyList.innerHTML = '<tr><td colspan="5" class="no-calls-placeholder" style="text-align: center;">기록된 호출 내역이 없습니다.</td></tr>';
  } else {
    calls.forEach(c => {
      const row = document.createElement('tr');
      
      const timeStr = new Date(c.timestamp).toLocaleString('ko-KR', { 
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' 
      });
      
      let statusText = '';
      let badgeClass = '';
      
      switch (c.status) {
        case "pending":
          statusText = '호출 대기';
          badgeClass = 'log-status-pending';
          break;
        case "acknowledged":
          statusText = '확인 완료';
          badgeClass = 'log-status-acknowledged';
          break;
        case "completed":
          statusText = '처리 완료';
          badgeClass = 'log-status-completed';
          break;
        case "canceled":
          statusText = '학생 취소';
          badgeClass = 'log-status-canceled';
          break;
      }
      
      row.innerHTML = `
        <td style="font-weight: 700;">${c.teacherName} 선생님</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${timeStr}</td>
        <td><span class="log-status-badge ${badgeClass}">${statusText}</span></td>
        <td style="font-weight: 600;">${c.studentInfo || '<span style="color: var(--text-light); font-weight: 400;">학급 정보 없음</span>'}</td>
        <td>
          ${c.respondedAt 
            ? `<span style="font-size: 0.8rem; color: var(--text-muted);">${new Date(c.respondedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 완료</span>`
            : `<span style="color: var(--text-light);">-</span>`
          }
        </td>
      `;
      historyList.appendChild(row);
    });
  }
}

// Call tracking & Audio synthesis triggering logic
function handleNewCallsAudio(calls) {
  calls.forEach(call => {
    if (call.status === "pending") {
      if (isInitialCallsLoad) {
        knownCallIds.add(call.id);
      } else {
        if (!knownCallIds.has(call.id)) {
          knownCallIds.add(call.id);
          if (call.timestamp > pageLoadTime - 10000) {
            speakCallNotification(call.teacherName);
          }
        }
      }
    }
  });
  
  isInitialCallsLoad = false;
}

// Add Teacher Form
document.getElementById('admin-add-teacher-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('new-teacher-name');
  const subjectInput = document.getElementById('new-teacher-subject');
  
  const name = nameInput.value.trim();
  const subject = subjectInput.value.trim();
  
  if (!name || !subject) {
    alert("이름과 담당 과목을 입력하세요!");
    return;
  }
  
  await dbService.addTeacher(name, subject);
  
  nameInput.value = '';
  subjectInput.value = '';
});

// Clear Call Logs
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-clear-logs') {
    if (confirm("정말 모든 호출 기록을 초기화하시겠습니까? (복구할 수 없습니다)")) {
      await dbService.clearAllCalls(currentCalls);
      alert("모든 호출 기록이 초기화되었습니다.");
    }
  }
});

// Audio Enabler click
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-audio-enable') {
    audioEnabled = true;
    
    const testUtterance = new SpeechSynthesisUtterance("음성 알림 시스템이 정상 가동되었습니다.");
    testUtterance.lang = 'ko-KR';
    window.speechSynthesis.speak(testUtterance);
    
    const audioBanner = document.getElementById('audio-banner');
    audioBanner.classList.add('active');
    audioBanner.innerHTML = '<span>✅ 한국어 음성 안내 시스템이 정상 작동 중입니다. (새 호출 발생 시 안내 방송 송출)</span>';
  }
});

// App Initialization
async function init() {
  await initDbService();
  
  dbService.subscribeTeachers((teachers) => {
    currentTeachers = teachers;
    renderAdminScreen(currentTeachers, currentCalls);
  });
  
  dbService.subscribeCalls((calls) => {
    currentCalls = calls;
    handleNewCallsAudio(currentCalls);
    renderAdminScreen(currentTeachers, currentCalls);
  });
}

document.addEventListener('DOMContentLoaded', init);
