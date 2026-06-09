// firebase-config.js
// Firebase 프로젝트 설정 값입니다.
// 실제 Firebase 프로젝트를 생성한 후 아래 객체의 값을 채워주세요.

export const firebaseConfig = {
  apiKey: "AIzaSyBdylK3CixCC9pKN1GfK7vXF4SJi3AwjU8",
  authDomain: "school-paging-248e2.firebaseapp.com",
  projectId: "school-paging-248e2",
  storageBucket: "school-paging-248e2.firebasestorage.app",
  messagingSenderId: "797787101106",
  appId: "1:797787101106:web:d7d067cd8cbf688a9df6ab"
};

// Firebase 설정이 유효한지 확인하는 함수
export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
}
