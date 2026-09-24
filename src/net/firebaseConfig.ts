import type { FirebaseOptions } from "firebase/app";

/**
 * Firebase 웹 앱 설정. 아직 만들지 않았다면 null이고, 그러면 화면에서 "온라인" 버튼이 꺼져 있다.
 * (이 값들은 웹페이지에 그대로 들어가는 공개용 식별값이라 저장소에 올려도 괜찮다. 접근 제한은 데이터베이스 규칙으로 한다.)
 */
export const FIREBASE_CONFIG: FirebaseOptions | null = null;
