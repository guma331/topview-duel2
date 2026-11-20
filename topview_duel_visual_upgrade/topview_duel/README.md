# TOPVIEW DUEL – UI 개선판

## 실행
```bash
npm install
npm start
```
브라우저에서 `http://localhost:3000` 접속.

## Firebase 설정
`public/firebase-config.js`에 Firebase 웹 앱 설정값을 입력하세요. 기존 프로젝트에서 이미 설정해 둔 값이 있다면 새 파일의 예시값 대신 기존 값을 그대로 복사하면 됩니다.

Firebase Console에서 Authentication의 Google 로그인 제공업체와 Firestore를 활성화하고, Authentication의 승인된 도메인에 Render 도메인을 추가하세요.

개발용 Firestore 규칙 예시(로그인한 사용자가 자기 문서만 읽고 쓰도록 제한):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

주의: 위 규칙은 자기 점수 문서에만 접근하도록 제한하지만, 브라우저에서 점수를 직접 기록하는 개발용 구조입니다. 정식 랭킹 서비스에서는 서버가 경기 결과를 검증하고 Admin SDK로 점수를 기록하도록 바꿔야 합니다.

## 이번 개선
- 로비 배경과 패널을 밝고 입체적인 아레나 테마로 변경
- 로그인 후 점수, 승리, 패배 통계 표시
- 캐릭터 선택 카드에 원소별 아이콘과 색상 적용
- 화염/바람/땅/물 캐릭터를 서로 다른 실루엣으로 렌더링
- 원소별 투사체와 범위 이펙트 구분
- 승리 시 축하 파티클과 결과 화면 연출
