// student.js
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

// Global variables
let dbService = null;
let currentCallId = null;
let countdownInterval = null;
let callSubscription = null;

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

// Listen to other tabs updates for Mock mode
window.addEventListener('storage', (e) => {
  if (e.key === MOCK_TEACHERS_KEY) {
    const teachers = getMockTeachers();
    teacherSubscribers.forEach(cb => cb(teachers));
  }
});

// Setup DB Service
async function initDbService() {
  if (isFirebaseConfigured()) {
    console.log("Initializing Firebase Firestore Mode (Student)...");
    try {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
      const { 
        getFirestore, collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp, query, orderBy, limit 
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
          const q = query(collection(db, "calls"), orderBy("timestamp", "desc"), limit(50));
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
        async createCall(teacherId, teacherName) {
          const docRef = await addDoc(collection(db, "calls"), {
            teacherId,
            teacherName,
            status: "pending",
            timestamp: serverTimestamp(),
            studentInfo: ""
          });
          return docRef.id;
        },
        async updateCallStudentInfo(callId, studentInfo) {
          await updateDoc(doc(db, "calls", callId), {
            studentInfo
          });
        },
        async updateCallStatus(callId, status) {
          await updateDoc(doc(db, "calls", callId), {
            status,
            respondedAt: serverTimestamp()
          });
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
  console.log("Initializing LocalStorage Mock Mode (Student)...");
  
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
      // Direct subscription to localStorage updates for cross-tab calls sync
      const trigger = () => callback(getMockCalls());
      window.addEventListener('storage', (e) => {
        if (e.key === MOCK_CALLS_KEY) trigger();
      });
      trigger();
      return () => {};
    },
    async createCall(teacherId, teacherName) {
      const calls = getMockCalls();
      const callId = "C_" + Date.now();
      calls.unshift({
        id: callId,
        teacherId,
        teacherName,
        status: "pending",
        timestamp: Date.now(),
        studentInfo: ""
      });
      localStorage.setItem(MOCK_CALLS_KEY, JSON.stringify(calls));
      // Trigger a storage event manually for this tab
      window.dispatchEvent(new Event('storage'));
      return callId;
    },
    async updateCallStudentInfo(callId, studentInfo) {
      const calls = getMockCalls();
      const call = calls.find(c => c.id === callId);
      if (call) {
        call.studentInfo = studentInfo;
        localStorage.setItem(MOCK_CALLS_KEY, JSON.stringify(calls));
        window.dispatchEvent(new Event('storage'));
      }
    },
    async updateCallStatus(callId, status) {
      const calls = getMockCalls();
      const call = calls.find(c => c.id === callId);
      if (call) {
        call.status = status;
        call.respondedAt = Date.now();
        localStorage.setItem(MOCK_CALLS_KEY, JSON.stringify(calls));
        window.dispatchEvent(new Event('storage'));
      }
    }
  };
  
  document.getElementById('mock-badge').style.display = 'inline-flex';
}

// UI Rendering - Student Screen
function renderStudentScreen(teachers) {
  const grid = document.getElementById('teachers-grid');
  grid.innerHTML = '';
  
  if (teachers.length === 0) {
    grid.innerHTML = '<div class="no-calls-placeholder" style="grid-column: 1/-1;">등록된 선생님이 없습니다.</div>';
    return;
  }
  
  teachers.forEach(teacher => {
    const card = document.createElement('div');
    card.className = 'teacher-card';
    card.setAttribute('data-status', teacher.status);
    
    const isAvailable = teacher.status === "호출 가능";
    const statusClass = 
      teacher.status === "호출 가능" ? "status-available" :
      teacher.status === "자리비움" ? "status-away" :
      teacher.status === "수업 중" ? "status-class" : "status-trip";
      
    card.innerHTML = `
      <div class="card-header">
        <div class="teacher-avatar">${teacher.name.charAt(0)}</div>
        <span class="status-badge ${statusClass}">${teacher.status}</span>
      </div>
      <div class="teacher-info">
        <h3 class="teacher-name">${teacher.name} 선생님</h3>
        <p class="teacher-subject">${teacher.subject || "담당 과목"}</p>
      </div>
      <button class="btn-call ${isAvailable ? 'btn-call-active' : 'btn-call-disabled'}" 
              ${isAvailable ? '' : 'disabled'} 
              data-id="${teacher.id}" 
              data-name="${teacher.name}">
        📢 ${isAvailable ? '선생님 호출하기' : '호출 불가'}
      </button>
    `;
    
    grid.appendChild(card);
  });
  
  grid.querySelectorAll('.btn-call-active').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      startCallProcess(id, name);
    });
  });
}

// Calling State Machine for Student View
async function startCallProcess(teacherId, teacherName) {
  const overlay = document.getElementById('modal-overlay');
  const modalTeacherName = document.getElementById('modal-teacher-name');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const pulseTimer = document.getElementById('pulse-timer');
  const studentForm = document.getElementById('student-form-section');
  const btnSubmitInfo = document.getElementById('btn-submit-info');
  const btnCancelCall = document.getElementById('btn-cancel-call');
  const btnCloseModal = document.getElementById('btn-close-modal');
  
  // Initialize call in DB
  currentCallId = await dbService.createCall(teacherId, teacherName);
  
  // Open modal & reset inputs
  overlay.classList.add('active');
  modalTeacherName.textContent = `${teacherName} 선생님 호출 중`;
  modalSubtitle.textContent = "30초 이내에 선생님이 오지 않으시면 추가 정보를 남길 수 있습니다.";
  pulseTimer.textContent = "30";
  studentForm.style.display = 'none';
  
  // Reset form inputs
  document.getElementById('student-grade').value = '';
  document.getElementById('student-class').value = '';
  document.getElementById('student-name').value = '';
  
  btnSubmitInfo.style.display = 'none';
  btnCancelCall.style.display = 'block';
  btnCloseModal.textContent = "선생님 오심 (완료)";
  
  let timeLeft = 30;
  
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    timeLeft--;
    pulseTimer.textContent = timeLeft;
    
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      studentForm.style.display = 'block';
      modalSubtitle.textContent = "선생님이 아직 안 나오셨나요? 학급 정보를 남겨주시면 전달됩니다.";
      btnSubmitInfo.style.display = 'block';
    }
  }, 1000);
  
  if (callSubscription) callSubscription();
  callSubscription = dbService.subscribeCalls((calls) => {
    const activeCall = calls.find(c => c.id === currentCallId);
    if (activeCall) {
      if (activeCall.status === "acknowledged") {
        modalTeacherName.textContent = "선생님이 호출을 확인하셨습니다!";
        modalSubtitle.textContent = "확인 완료. 곧 자리로 오십니다.";
        clearInterval(countdownInterval);
        pulseTimer.textContent = "✔";
        setTimeout(closeCallModal, 3000);
      } else if (activeCall.status === "completed") {
        modalTeacherName.textContent = "호출이 완료되었습니다!";
        modalSubtitle.textContent = "교실로 복귀해 주시기 바랍니다.";
        clearInterval(countdownInterval);
        pulseTimer.textContent = "✔";
        setTimeout(closeCallModal, 2000);
      } else if (activeCall.status === "canceled") {
        closeCallModal();
      }
    }
  });
}

function closeCallModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('active');
  clearInterval(countdownInterval);
  if (callSubscription) {
    callSubscription();
    callSubscription = null;
  }
  currentCallId = null;
}

// Student Action Buttons
document.getElementById('btn-close-modal').addEventListener('click', async () => {
  if (currentCallId) {
    await dbService.updateCallStatus(currentCallId, "completed");
  }
  closeCallModal();
});

document.getElementById('btn-cancel-call').addEventListener('click', async () => {
  if (currentCallId) {
    await dbService.updateCallStatus(currentCallId, "canceled");
  }
  closeCallModal();
});

document.getElementById('btn-submit-info').addEventListener('click', async () => {
  const grade = document.getElementById('student-grade').value.trim();
  const classRoom = document.getElementById('student-class').value.trim();
  const name = document.getElementById('student-name').value.trim();
  
  if (!grade || !classRoom || !name) {
    alert("학년, 반, 이름을 모두 정확히 입력해 주세요!");
    return;
  }
  
  const studentInfoString = `${grade}학년 ${classRoom}반 ${name}`;
  
  if (currentCallId) {
    await dbService.updateCallStudentInfo(currentCallId, studentInfoString);
    alert("선생님께 학생 정보가 무사히 전달되었습니다!");
  }
  closeCallModal();
});

// App Initialization
async function init() {
  await initDbService();
  dbService.subscribeTeachers((teachers) => {
    renderStudentScreen(teachers);
  });
}

document.addEventListener('DOMContentLoaded', init);
