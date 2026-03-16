# GitHub Actions 설정

`ebook_viewer` 저장소는 루트 `.github/workflows/ebook-viewer-build.yml`로 GitHub Actions 빌드를 수행합니다.

## 동작

- `main` 브랜치에 주요 파일 변경이 push되면 실행
- 수동 실행(`workflow_dispatch`) 가능
- `npm ci` 후 `npm run build` 실행
- Windows 빌드 산출물을 GitHub Actions artifact로 업로드

## 산출물

- `ebook-viewer-build`
- `ebook-viewer-docs`

## SignPath 양식 기준 Build System

GitHub Actions
