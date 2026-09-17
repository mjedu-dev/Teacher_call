// admin/admin.js
import { firebaseConfig, isFirebaseConfigured } from '../firebase-config.js';

// =====================================================
// Global variables
// =====================================================
let dbService = null;

let audioEnabled = false;
let pageLoadTime = Date.now();

let knownCallIds = new Set();
let isInitialCallsLoad = true;

let currentTeachers = [];
let currentCalls = [];

let teacherSubscribers = [];
let callSubscribers = [];

// Mock database keys
const MOCK_TEACHERS_KEY = "mock_teachers";
const MOCK_CALLS_KEY = "mock_calls";

// Firebase에 등록된 교사 목록을 사용하므로 기본 목록은 비워둠
const DEFAULT_TEACHERS = [];


// =====================================================
// TTS 초기화
// =====================================================

// Android / Chrome / Samsung Internet에서
// 음성 목록이 늦게 로딩되는 경우 대응
function loadVoices() {
  if (!('speechSynthesis' in window)) {
    console.warn("이 브라우저는 speechSynthesis를 지원하지 않습니다.");
    return [];
  }

  const voices = window.speechSynthesis.getVoices();

  console.log(
    "사용 가능한 TTS 음성:",
    voices.map(v => `${v.name} / ${v.lang}`)
  );

  return voices;
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    loadVoices();
  };

  loadVoices();
}


// 화면을 껐다 켜거나 다른 앱을 다녀온 뒤
// Android TTS가 멈추는 현상 대응
document.addEventListener('visibilitychange', () => {
  if (
    document.visibilityState === 'visible' &&
    'speechSynthesis' in window
  ) {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();

      loadVoices();

      console.log("TTS 상태 재활성화");
    } catch (error) {
      console.error("TTS 재활성화 오류:", error);
    }
  }
});


// =====================================================
// Mock DB
// =====================================================

function getMockTeachers() {
  const stored = localStorage.getItem(MOCK_TEACHERS_KEY);

  if (!stored) {
    localStorage.setItem(
      MOCK_TEACHERS_KEY,
      JSON.stringify(DEFAULT_TEACHERS)
    );

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


// 다른 탭 LocalStorage 변경 감지
window.addEventListener('storage', (e) => {
  if (
    e.key === MOCK_TEACHERS_KEY ||
    e.key === MOCK_CALLS_KEY
  ) {
    notifySubscribers();
  }
});


// =====================================================
// DB Service
// =====================================================

async function initDbService() {

  if (isFirebaseConfigured()) {

    console.log(
      "Initializing Firebase Firestore Mode (Admin)..."
    );

    try {

      const {
        initializeApp
      } = await import(
        "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"
      );

      const {
        getFirestore,
        collection,
        doc,
        addDoc,
        updateDoc,
        deleteDoc,
        onSnapshot,
        serverTimestamp,
        query,
        orderBy,
        limit
      } = await import(
        "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"
      );


      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);


      dbService = {

        isMock: false,


        subscribeTeachers(callback) {

          return onSnapshot(
            collection(db, "teachers"),
            (snapshot) => {

              const teachers = [];

              snapshot.forEach(document => {
                teachers.push({
                  id: document.id,
                  ...document.data()
                });
              });


              // 기본 교사가 있을 경우에만 생성
              if (
                teachers.length === 0 &&
                DEFAULT_TEACHERS.length > 0
              ) {

                DEFAULT_TEACHERS.forEach(t => {

                  addDoc(
                    collection(db, "teachers"),
                    {
                      name: t.name,
                      subject: t.subject,
                      status: t.status,
                      updatedAt: serverTimestamp()
                    }
                  );

                });
              }

              callback(teachers);
            }
          );
        },


        subscribeCalls(callback) {

          const q = query(
            collection(db, "calls"),
            orderBy("timestamp", "desc"),
            limit(100)
          );

          return onSnapshot(
            q,
            (snapshot) => {

              const calls = [];

              snapshot.forEach(document => {

                const data = document.data();

                const timestamp =
                  data.timestamp
                    ? data.timestamp.toMillis()
                    : Date.now();

                let respondedAt = data.respondedAt;

                if (
                  respondedAt &&
                  typeof respondedAt.toMillis === 'function'
                ) {
                  respondedAt = respondedAt.toMillis();
                }

                calls.push({
                  id: document.id,
                  ...data,
                  timestamp,
                  respondedAt
                });
              });

              callback(calls);
            },
            (error) => {
              console.error(
                "호출 목록 실시간 수신 오류:",
                error
              );
            }
          );
        },


        async addTeacher(name, subject) {

          await addDoc(
            collection(db, "teachers"),
            {
              name,
              subject,
              status: "호출 가능",
              updatedAt: serverTimestamp()
            }
          );
        },


        async deleteTeacher(id) {

          await deleteDoc(
            doc(db, "teachers", id)
          );
        },


        async updateTeacherStatus(id, status) {

          await updateDoc(
            doc(db, "teachers", id),
            {
              status,
              updatedAt: serverTimestamp()
            }
          );
        },


        async updateCallStatus(callId, status) {

          await updateDoc(
            doc(db, "calls", callId),
            {
              status,
              respondedAt: serverTimestamp()
            }
          );
        },


        async clearAllCalls(calls) {

          console.log(
            `삭제할 호출 기록: ${calls.length}개`
          );

          const promises = calls.map(call =>
            deleteDoc(
              doc(db, "calls", call.id)
            )
          );

          await Promise.all(promises);
        }
      };


      const mockBadge =
        document.getElementById('mock-badge');

      if (mockBadge) {
        mockBadge.style.display = 'none';
      }


    } catch (error) {

      console.error(
        "Firebase load failed, falling back to Mock Mode:",
        error
      );

      setupMockService();
    }

  } else {

    setupMockService();
  }
}


// =====================================================
// Mock Service
// =====================================================

function setupMockService() {

  console.log(
    "Initializing LocalStorage Mock Mode (Admin)..."
  );


  dbService = {

    isMock: true,


    subscribeTeachers(callback) {

      teacherSubscribers.push(callback);

      callback(
        getMockTeachers()
      );

      return () => {

        teacherSubscribers =
          teacherSubscribers.filter(
            cb => cb !== callback
          );
      };
    },


    subscribeCalls(callback) {

      callSubscribers.push(callback);

      callback(
        getMockCalls()
      );

      return () => {

        callSubscribers =
          callSubscribers.filter(
            cb => cb !== callback
          );
      };
    },


    async addTeacher(name, subject) {

      const teachers =
        getMockTeachers();

      teachers.push({
        id: "T_" + Date.now(),
        name,
        subject,
        status: "호출 가능",
        updatedAt: Date.now()
      });

      localStorage.setItem(
        MOCK_TEACHERS_KEY,
        JSON.stringify(teachers)
      );

      notifySubscribers();
    },


    async deleteTeacher(id) {

      let teachers =
        getMockTeachers();

      teachers =
        teachers.filter(
          t => t.id !== id
        );

      localStorage.setItem(
        MOCK_TEACHERS_KEY,
        JSON.stringify(teachers)
      );

      notifySubscribers();
    },


    async updateTeacherStatus(id, status) {

      const teachers =
        getMockTeachers();

      const teacher =
        teachers.find(
          t => t.id === id
        );

      if (teacher) {

        teacher.status = status;
        teacher.updatedAt = Date.now();

        localStorage.setItem(
          MOCK_TEACHERS_KEY,
          JSON.stringify(teachers)
        );

        notifySubscribers();
      }
    },


    async updateCallStatus(callId, status) {

      const calls =
        getMockCalls();

      const call =
        calls.find(
          c => c.id === callId
        );

      if (call) {

        call.status = status;
        call.respondedAt =
          Date.now();

        localStorage.setItem(
          MOCK_CALLS_KEY,
          JSON.stringify(calls)
        );

        notifySubscribers();
      }
    },


    async clearAllCalls() {

      localStorage.setItem(
        MOCK_CALLS_KEY,
        JSON.stringify([])
      );

      notifySubscribers();
    }
  };


  const mockBadge =
    document.getElementById('mock-badge');

  if (mockBadge) {
    mockBadge.style.display =
      'inline-flex';
  }
}


// =====================================================
// TTS
// =====================================================

function getKoreanVoice() {

  const voices = loadVoices();

  if (!voices.length) {
    return null;
  }


  // ko-KR을 가장 먼저 찾음
  let koreanVoice = voices.find(
    voice =>
      voice.lang &&
      voice.lang.toLowerCase() === 'ko-kr'
  );


  // 없다면 ko 계열 검색
  if (!koreanVoice) {

    koreanVoice = voices.find(
      voice =>
        voice.lang &&
        voice.lang
          .toLowerCase()
          .startsWith('ko')
    );
  }


  return koreanVoice || null;
}


// 실제 한 번 읽기
function speakOnce(text) {

  return new Promise(resolve => {

    if (
      !('speechSynthesis' in window)
    ) {

      console.error(
        "이 브라우저는 음성 합성을 지원하지 않습니다."
      );

      resolve();
      return;
    }


    // Android에서 이전 발화가 걸려있는 경우 제거
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    } catch (error) {
      console.warn(
        "TTS 상태 초기화 오류:",
        error
      );
    }


    const utterance =
      new SpeechSynthesisUtterance(text);


    utterance.lang = 'ko-KR';

    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;


    const koreanVoice =
      getKoreanVoice();


    if (koreanVoice) {

      utterance.voice =
        koreanVoice;

      console.log(
        "선택된 TTS:",
        koreanVoice.name,
        koreanVoice.lang
      );

    } else {

      // 일부 Android 브라우저에서는
      // voice를 직접 지정하지 않는 것이 더 잘 동작함
      console.warn(
        "한국어 voice를 직접 찾지 못했습니다. 기본 Android TTS를 사용합니다."
      );
    }


    let finished = false;


    const finish = () => {

      if (finished) return;

      finished = true;

      resolve();
    };


    utterance.onstart = () => {

      console.log(
        "TTS 재생 시작:",
        text
      );
    };


    utterance.onend = () => {

      console.log(
        "TTS 재생 완료:",
        text
      );

      finish();
    };


    utterance.onerror = (event) => {

      console.error(
        "TTS 오류:",
        event.error
      );

      finish();
    };


    window.speechSynthesis.speak(
      utterance
    );


    // 모바일 브라우저에서 onend 이벤트가
    // 누락되는 경우 무한 대기 방지
    setTimeout(
      finish,
      10000
    );
  });
}


// 실제 학생 호출 음성
async function speakCallNotification(
  teacherName
) {

  if (!audioEnabled) {

    console.log(
      "음성 알림 비활성화 상태"
    );

    return;
  }


  const text =
    `${teacherName} 선생님 호출입니다.`;


  await speakOnce(text);


  // 두 번 안내
  setTimeout(() => {

    speakOnce(text);

  }, 700);
}


// =====================================================
// UI Rendering
// =====================================================

function renderAdminScreen(
  teachers,
  calls
) {

  // -------------------------------------------------
  // Audio banner
  // -------------------------------------------------

  const audioBanner =
    document.getElementById(
      'audio-banner'
    );


  if (
    audioBanner &&
    audioEnabled
  ) {

    audioBanner.classList.add(
      'active'
    );

    audioBanner.innerHTML =
      '<span>✅ 한국어 음성 안내 시스템이 활성화되어 있습니다. (새 호출 발생 시 안내 방송)</span>';
  }


  // -------------------------------------------------
  // Sidebar teacher list
  // -------------------------------------------------

  const sidebarList =
    document.getElementById(
      'sidebar-teacher-list'
    );


  if (sidebarList) {

    sidebarList.innerHTML = '';


    teachers.forEach(t => {

      const item =
        document.createElement(
          'div'
        );


      item.className =
        'sidebar-teacher-item';


      item.innerHTML = `
        <span>
          ${t.name}
          (${t.subject || '미정'})
        </span>

        <button
          class="btn-delete"
          data-id="${t.id}"
        >
          삭제
        </button>
      `;


      sidebarList.appendChild(
        item
      );
    });


    sidebarList
      .querySelectorAll(
        '.btn-delete'
      )
      .forEach(btn => {

        btn.addEventListener(
          'click',
          async () => {

            const id =
              btn.getAttribute(
                'data-id'
              );


            if (
              !confirm(
                "정말 이 선생님 정보를 삭제하시겠습니까?"
              )
            ) {
              return;
            }


            try {

              await dbService
                .deleteTeacher(id);

            } catch (error) {

              console.error(
                "교사 삭제 실패:",
                error
              );

              alert(
                "교사 정보를 삭제하지 못했습니다.\n\n" +
                (error.message || error)
              );
            }
          }
        );
      });
  }


  // -------------------------------------------------
  // Teacher status cards
  // -------------------------------------------------

  const adminGrid =
    document.getElementById(
      'teachers-admin-grid'
    );


  if (adminGrid) {

    adminGrid.innerHTML = '';


    teachers.forEach(t => {

      const card =
        document.createElement(
          'div'
        );


      card.className =
        'teacher-admin-card';


      const isAvail =
        t.status === "호출 가능"
          ? "checked"
          : "";


      const isAway =
        t.status === "자리비움"
          ? "checked"
          : "";


      const isClass =
        t.status === "수업 중"
          ? "checked"
          : "";


      const isTrip =
        t.status === "출장"
          ? "checked"
          : "";


      card.innerHTML = `

        <div class="admin-card-header">

          <span class="admin-card-name">
            ${t.name} 선생님
          </span>

          <span class="teacher-subject">
            ${t.subject || ''}
          </span>

        </div>


        <div class="status-selector">

          <input
            type="radio"
            id="st-${t.id}-avail"
            class="status-opt"
            name="st-${t.id}"
            value="호출 가능"
            ${isAvail}
          >

          <label
            for="st-${t.id}-avail"
            class="status-label"
          >
            호출 가능
          </label>


          <input
            type="radio"
            id="st-${t.id}-away"
            class="status-opt"
            name="st-${t.id}"
            value="자리비움"
            ${isAway}
          >

          <label
            for="st-${t.id}-away"
            class="status-label"
          >
            자리비움
          </label>


          <input
            type="radio"
            id="st-${t.id}-class"
            class="status-opt"
            name="st-${t.id}"
            value="수업 중"
            ${isClass}
          >

          <label
            for="st-${t.id}-class"
            class="status-label"
          >
            수업 중
          </label>


          <input
            type="radio"
            id="st-${t.id}-trip"
            class="status-opt"
            name="st-${t.id}"
            value="출장"
            ${isTrip}
          >

          <label
            for="st-${t.id}-trip"
            class="status-label"
          >
            출장
          </label>

        </div>
      `;


      adminGrid.appendChild(
        card
      );


      card
        .querySelectorAll(
          'input[type="radio"]'
        )
        .forEach(radio => {

          radio.addEventListener(
            'change',
            async e => {

              try {

                await dbService
                  .updateTeacherStatus(
                    t.id,
                    e.target.value
                  );

              } catch (error) {

                console.error(
                  "교사 상태 변경 실패:",
                  error
                );

                alert(
                  "교사 상태 변경에 실패했습니다."
                );
              }
            }
          );
        });
    });
  }


  // -------------------------------------------------
  // Active calls
  // -------------------------------------------------

  const activeCallsList =
    document.getElementById(
      'active-calls-list'
    );


  if (activeCallsList) {

    activeCallsList.innerHTML = '';


    const activeCalls =
      calls.filter(
        c => c.status === "pending"
      );


    if (
      activeCalls.length === 0
    ) {

      activeCallsList.innerHTML =
        `
        <div
          class="no-calls-placeholder"
          style="grid-column:1/-1;"
        >
          현재 대기 중인 호출이 없습니다.
        </div>
        `;

    } else {

      activeCalls.forEach(c => {

        const card =
          document.createElement(
            'div'
          );


        card.className =
          'call-item-card';


        const timeStr =
          new Date(
            c.timestamp
          ).toLocaleTimeString(
            'ko-KR',
            {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }
          );


        card.innerHTML = `

          <div class="call-item-header">

            <div>

              <h4 class="call-teacher-name">
                ${c.teacherName} 선생님
              </h4>

              <span class="call-time">
                호출 시간: ${timeStr}
              </span>

            </div>

            <span
              class="status-badge status-available"
            >
              호출중
            </span>

          </div>


          ${
            c.studentInfo

              ? `
                <div class="call-student-info">
                  👤 ${c.studentInfo}
                </div>
              `

              : `
                <div
                  class="call-student-info call-student-waiting"
                >
                  ⏳ 대기 중
                  (30초 카운트다운 진행 중)
                </div>
              `
          }


          <div class="call-item-actions">

            <button
              class="btn-action
                     btn-action-primary
                     btn-ack"
              data-id="${c.id}"
            >
              확인
            </button>

            <button
              class="btn-action
                     btn-action-secondary
                     btn-comp"
              data-id="${c.id}"
            >
              완료
            </button>

          </div>
        `;


        activeCallsList.appendChild(
          card
        );
      });


      activeCallsList
        .querySelectorAll('.btn-ack')
        .forEach(btn => {

          btn.addEventListener(
            'click',
            async () => {

              const id =
                btn.getAttribute(
                  'data-id'
                );


              try {

                await dbService
                  .updateCallStatus(
                    id,
                    "acknowledged"
                  );

              } catch (error) {

                console.error(
                  "호출 확인 실패:",
                  error
                );

                alert(
                  "호출 상태 변경에 실패했습니다."
                );
              }
            }
          );
        });


      activeCallsList
        .querySelectorAll('.btn-comp')
        .forEach(btn => {

          btn.addEventListener(
            'click',
            async () => {

              const id =
                btn.getAttribute(
                  'data-id'
                );


              try {

                await dbService
                  .updateCallStatus(
                    id,
                    "completed"
                  );

              } catch (error) {

                console.error(
                  "호출 완료 처리 실패:",
                  error
                );

                alert(
                  "호출 완료 처리에 실패했습니다."
                );
              }
            }
          );
        });
    }
  }


  // -------------------------------------------------
  // History
  // -------------------------------------------------

  const historyList =
    document.getElementById(
      'history-list'
    );


  if (historyList) {

    historyList.innerHTML = '';


    if (calls.length === 0) {

      historyList.innerHTML =
        `
        <tr>
          <td
            colspan="5"
            class="no-calls-placeholder"
            style="text-align:center;"
          >
            기록된 호출 내역이 없습니다.
          </td>
        </tr>
        `;

    } else {

      calls.forEach(c => {

        const row =
          document.createElement(
            'tr'
          );


        const timeStr =
          new Date(
            c.timestamp
          ).toLocaleString(
            'ko-KR',
            {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }
          );


        let statusText = '';
        let badgeClass = '';


        switch (c.status) {

          case "pending":

            statusText =
              '호출 대기';

            badgeClass =
              'log-status-pending';

            break;


          case "acknowledged":

            statusText =
              '확인 완료';

            badgeClass =
              'log-status-acknowledged';

            break;


          case "completed":

            statusText =
              '처리 완료';

            badgeClass =
              'log-status-completed';

            break;


          case "canceled":

            statusText =
              '학생 취소';

            badgeClass =
              'log-status-canceled';

            break;


          default:

            statusText =
              c.status || '-';

            badgeClass = '';
        }


        let respondedText = '-';


        if (c.respondedAt) {

          respondedText =
            new Date(
              c.respondedAt
            ).toLocaleTimeString(
              'ko-KR',
              {
                hour: '2-digit',
                minute: '2-digit'
              }
            ) + ' 완료';
        }


        row.innerHTML = `

          <td style="font-weight:700;">
            ${c.teacherName} 선생님
          </td>

          <td
            style="
              font-size:0.85rem;
              color:var(--text-muted);
            "
          >
            ${timeStr}
          </td>

          <td>

            <span
              class="
                log-status-badge
                ${badgeClass}
              "
            >
              ${statusText}
            </span>

          </td>

          <td style="font-weight:600;">

            ${
              c.studentInfo ||

              `
              <span
                style="
                  color:var(--text-light);
                  font-weight:400;
                "
              >
                학급 정보 없음
              </span>
              `
            }

          </td>

          <td>

            ${
              c.respondedAt

                ? `
                  <span
                    style="
                      font-size:0.8rem;
                      color:var(--text-muted);
                    "
                  >
                    ${respondedText}
                  </span>
                `

                : `
                  <span
                    style="
                      color:var(--text-light);
                    "
                  >
                    -
                  </span>
                `
            }

          </td>
        `;


        historyList.appendChild(
          row
        );
      });
    }
  }
}


// =====================================================
// 새 호출 음성 감지
// =====================================================

function handleNewCallsAudio(calls) {

  calls.forEach(call => {

    if (
      call.status !== "pending"
    ) {
      return;
    }


    // 페이지 처음 열었을 때 이미 존재하던 호출은
    // 갑자기 방송하지 않음
    if (isInitialCallsLoad) {

      knownCallIds.add(
        call.id
      );

      return;
    }


    if (
      knownCallIds.has(call.id)
    ) {
      return;
    }


    knownCallIds.add(
      call.id
    );


    // 최근 생성된 호출만 방송
    if (
      call.timestamp >
      pageLoadTime - 10000
    ) {

      speakCallNotification(
        call.teacherName
      );
    }
  });


  isInitialCallsLoad = false;
}


// =====================================================
// Add Teacher
// =====================================================

const addTeacherForm =
  document.getElementById(
    'admin-add-teacher-form'
  );


if (addTeacherForm) {

  addTeacherForm.addEventListener(
    'submit',
    async e => {

      e.preventDefault();


      const nameInput =
        document.getElementById(
          'new-teacher-name'
        );


      const subjectInput =
        document.getElementById(
          'new-teacher-subject'
        );


      const name =
        nameInput.value.trim();


      const subject =
        subjectInput.value.trim();


      if (
        !name ||
        !subject
      ) {

        alert(
          "이름과 담당 과목을 입력하세요!"
        );

        return;
      }


      try {

        await dbService
          .addTeacher(
            name,
            subject
          );


        nameInput.value = '';
        subjectInput.value = '';


      } catch (error) {

        console.error(
          "교사 추가 실패:",
          error
        );


        alert(
          "교사 추가에 실패했습니다.\n\n" +
          (error.message || error)
        );
      }
    }
  );
}


// =====================================================
// Clear Call Logs
// =====================================================

const clearLogsButton =
  document.getElementById(
    'btn-clear-logs'
  );


if (clearLogsButton) {

  clearLogsButton.addEventListener(
    'click',
    async () => {

      if (
        !confirm(
          "정말 모든 호출 기록을 초기화하시겠습니까?\n삭제된 기록은 복구할 수 없습니다."
        )
      ) {

        return;
      }


      try {

        console.log(
          "로그 삭제 시작:",
          currentCalls
        );


        await dbService
          .clearAllCalls(
            [...currentCalls]
          );


        console.log(
          "로그 삭제 완료"
        );


        // 화면에서도 즉시 제거
        currentCalls = [];

        knownCallIds.clear();

        renderAdminScreen(
          currentTeachers,
          currentCalls
        );


        alert(
          "모든 호출 기록이 초기화되었습니다."
        );


      } catch (error) {

        console.error(
          "로그 삭제 실패:",
          error
        );


        alert(
          "로그 삭제에 실패했습니다.\n\n" +
          "오류 코드: " +
          (error.code || "없음") +
          "\n\n" +
          (error.message || error)
        );
      }
    }
  );
}


// =====================================================
// Audio Enabler
// =====================================================

const audioEnableButton =
  document.getElementById(
    'btn-audio-enable'
  );


if (audioEnableButton) {

  audioEnableButton.addEventListener(
    'click',
    async () => {

      if (
        !('speechSynthesis' in window)
      ) {

        alert(
          "현재 브라우저에서는 음성 안내 기능을 지원하지 않습니다."
        );

        return;
      }


      audioEnabled = true;


      try {

        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();

        loadVoices();


        // 버튼을 직접 눌렀을 때 테스트 음성을 내보냄
        await speakOnce(
          "음성 알림 시스템이 정상 가동되었습니다."
        );


        const audioBanner =
          document.getElementById(
            'audio-banner'
          );


        if (audioBanner) {

          audioBanner.classList.add(
            'active'
          );


          audioBanner.innerHTML =
            '<span>✅ 한국어 음성 안내 시스템이 활성화되었습니다. (새 호출 발생 시 안내 방송)</span>';
        }


        console.log(
          "음성 알림 활성화 완료"
        );


      } catch (error) {

        console.error(
          "음성 알림 활성화 실패:",
          error
        );


        alert(
          "음성 안내 활성화 중 오류가 발생했습니다.\n\n" +
          (error.message || error)
        );
      }
    }
  );
}


// =====================================================
// App Initialization
// =====================================================

async function init() {

  try {

    await initDbService();


    dbService.subscribeTeachers(
      teachers => {

        currentTeachers =
          teachers;


        renderAdminScreen(
          currentTeachers,
          currentCalls
        );
      }
    );


    dbService.subscribeCalls(
      calls => {

        currentCalls =
          calls;


        handleNewCallsAudio(
          currentCalls
        );


        renderAdminScreen(
          currentTeachers,
          currentCalls
        );
      }
    );


  } catch (error) {

    console.error(
      "관리자 페이지 초기화 실패:",
      error
    );


    alert(
      "관리자 페이지를 불러오는 중 오류가 발생했습니다.\n\n" +
      (error.message || error)
    );
  }
}


document.addEventListener(
  'DOMContentLoaded',
  init
);
