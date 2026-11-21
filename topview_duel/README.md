# TOPVIEW DUEL 2.0

2D 탑뷰 실시간 1:1 원소 대전 게임. Node.js + Express + Socket.IO + Firebase Authentication/Firestore.

## 1) 로컬 실행

Node.js 20~24 설치 후 프로젝트 폴더에서:

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속.

## 2) Firebase 웹 설정

`public/firebase-config.js`의 예시 문자열을 기존 Firebase 웹 앱 설정값으로 교체합니다.

Firebase Console에서 다음을 활성화합니다.
- Authentication > Sign-in method > Google
- Firestore Database 생성
- Authentication > Settings > Authorized domains에 배포 도메인 등록

### Firestore Rules

이 버전은 브라우저가 점수를 직접 수정하지 않습니다. 브라우저는 자기 프로필을 읽기만 하고, 점수 변경은 Firebase Admin SDK를 사용하는 게임 서버가 수행합니다.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false;
    }
  }
}
```

## 3) Render 배포 및 안전한 점수 저장

1. GitHub 저장소에 이 폴더 안의 파일들을 업로드합니다.
2. Render Web Service를 생성하고 올바른 프로젝트 루트 폴더를 지정합니다.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Firebase Console > Project settings > Service accounts에서 서버용 서비스 계정 키(JSON)를 생성합니다.
6. Render > 해당 서비스 > Environment에 아래 환경 변수를 추가합니다.
   - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: 다운로드한 서비스 계정 JSON 파일의 전체 내용
7. 저장 후 재배포합니다.

**서비스 계정 JSON은 비밀키입니다.** GitHub, 게임의 `public` 폴더, 채팅, 프런트엔드 코드에 절대 올리지 마세요. Render의 Environment에만 넣으세요. 이 키를 잃어버리거나 공개했다면 Firebase 콘솔에서 폐기하고 새 키를 발급해야 합니다.

서버가 이 키로 Firebase ID 토큰을 검증하므로, 환경 변수가 없으면 로그인 화면은 표시되더라도 매칭은 허용되지 않고 점수 저장도 동작하지 않습니다. 서버 로그에 `Firebase Admin connected`가 나오는지 확인하세요.

## 4) 게임 조작

- WASD: 이동
- 마우스: 조준
- 좌클릭: 평타
- Q / E / R / T: 스킬

모든 캐릭터 기본 체력은 300입니다. 승리 +10점, 패배 -3점(최저 0점).

## 5) 구현 범위 및 밸런스 해석

- 이동, 투사체 이동/충돌, 쿨타임, 피해, 상태이상, 벽/함정/장판, 경기 종료 및 점수 변경은 서버에서 처리합니다.
- 상태이상 설명의 '틱'은 별도 표기가 없는 경우 0.4초로 해석했습니다. 물 파도의 초당 피해는 1초 간격으로 7회까지 적용합니다.
- 바람 R은 적과의 거리에 따라 짧게 접근/후퇴하는 1초 재사용 스킬로 구현했습니다.
- 일부 원문 수치에 의미가 불명확한 괄호 표기(예: 20(12))는 첫 번째 값을 기본 쿨타임으로 사용했습니다. 괄호 안 수치는 업그레이드/대체 쿨타임으로 추정되지만 별도 업그레이드 시스템은 아직 없습니다.
- 그래픽은 Canvas 기반으로 구현된 원소별 절차적 스프라이트/이펙트이며, 외부 일러스트 스프라이트를 사용하지 않습니다.

## 6) 점수 보안

클라이언트 Firestore 규칙은 `players/{uid}` 문서 읽기만 허용합니다. 점수는 서버가 Firebase Admin SDK로 경기 결과를 반영합니다. 다만 이 버전은 게임 서버 한 인스턴스에서 동작하는 초기 1:1 게임 구조이며, 시즌 랭킹/재접속 복구/다중 서버 확장/관전/리플레이는 별도 작업입니다.
