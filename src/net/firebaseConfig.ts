import type { FirebaseOptions } from "firebase/app";

/**
 * Firebase 웹 앱 설정 (프로젝트 hanbakwi-trip).
 * 이 값들은 웹페이지에 그대로 들어가는 공개용 식별값이라 저장소에 올려도 괜찮다.
 * 접근 제한은 Firebase 콘솔의 데이터베이스 규칙(docs/02-online-setup.md)으로 한다.
 */
export const FIREBASE_CONFIG: FirebaseOptions | null = {
  apiKey: "AIzaSyCnCDADnUICcyhwJEk1PCyRyIivo-z0kiQ",
  authDomain: "hanbakwi-trip.firebaseapp.com",
  databaseURL: "https://hanbakwi-trip-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hanbakwi-trip",
  storageBucket: "hanbakwi-trip.firebasestorage.app",
  messagingSenderId: "74413863880",
  appId: "1:74413863880:web:203165c6605ce19b2a06fd",
};
