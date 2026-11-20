# TOPVIEW DUEL

## 실행
1. Node.js 20 이상 설치
2. 이 폴더에서 CMD 열기
3. `npm install`
4. `npm start`
5. `http://localhost:3000` 접속

## Render 배포
- Root Directory: 저장소에서 `package.json`이 있는 폴더
- Build Command: `npm install`
- Start Command: `npm start`

## Firebase 연결
1. Firebase Console에서 프로젝트 생성
2. 웹 앱 추가 후 SDK 설정의 `apiKey`, `authDomain`, `projectId`, `appId`를 복사
3. `public/firebase-config.js`의 네 항목에 붙여넣기
4. Authentication > Sign-in method에서 Google 활성화
5. Authentication > Settings > Authorized domains에 Render 도메인 추가
6. Firestore Database 생성
7. 아래 firestore.rules 내용을 Firestore 규칙에 게시

## Firestore 규칙 (개발용)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{uid} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null && request.auth.uid == uid;
    }
  }
}

주의: 현재 점수 저장은 브라우저에서 수행하는 개발용 구현이다. 사용자가 자기 점수를 조작할 수 있으므로 공개 랭킹 운영 전에는 Firebase Admin SDK를 서버에 연결하고 서버가 경기 결과를 검증하도록 바꿔야 한다. 서비스 계정 JSON/개인키를 브라우저나 GitHub에 올리지 말 것.

## 조작
- WASD: 이동
- 마우스: 조준
- 좌클릭: 평타
- Q / E / R / T: 스킬

## 캐릭터
- 화염 / 바람 / 땅 / 물, 체력 300
- 캐릭터별 평타 재사용 대기시간과 스킬 쿨타임 반영
- 각 스킬의 기본 피해/투사체/범위/돌진 유형 구현
- 일부 지속 피해, 기절, 넉백, 보호막, 벽/함정 등 세부 판정은 다음 개발 단계에서 완성 필요
