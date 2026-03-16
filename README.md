# ebook_viewer

교재용 Electron 기반 뷰어 애플리케이션입니다.

이 프로젝트는 Windows 환경에서 실행되는 `ebook_viewer.exe`를 빌드합니다.

## 공개 배포 문서

- `2025/template/electron/GITHUB_RELEASE_TEMPLATE.md`
- `2025/template/electron/VERSIONING_GUIDE.md`
- `2025/template/electron/SIGNPATH_PROJECT_DESCRIPTION.md`

## 주요 기능

- Electron 기반 교재 뷰어 실행
- Windows 빌드 지원

## 개발 환경

- Node.js
- npm
- Electron
- electron-builder

## 설치

```powershell
npm install
```

## 실행

```powershell
npm start
```

## 빌드

```powershell
npm run build
```

기본 설정 기준 산출물은 `2025/template/run/` 아래에 생성됩니다.

## 배포 파일

- `ebook_viewer.exe`

공개 릴리스에는 버전, SHA256, 대응 태그를 함께 제공합니다.

## 코드 서명

공개 배포 시 `ebook_viewer.exe`는 코드 서명 대상입니다.

## 라이선스

ISC License

