# HDC PCE 설비보전 통합 앱

휴대폰 현장 점검과 PC 대시보드가 같은 Supabase 자료를 사용하는 React·Vite 앱입니다. 통합 대시보드, 현장 점검, 정비 작업, 설비 자산, 수선비 분석, 경영 보고와 계정 승인을 제공합니다.

소스 버전은 `3.2.0`입니다. 이 README는 배포 구성을 설명하며 실제 운영 배포 여부를 증명하지 않습니다.

## 배포 대상

| 구분 | 값 |
| --- | --- |
| 공개 저장소 | [yunyeochul99-ai/HDC-hyundai-pce](https://github.com/yunyeochul99-ai/HDC-hyundai-pce) |
| 배포 브랜치 | `main` |
| 앱 URL | [hdc-pce.netlify.app](https://hdc-pce.netlify.app) |
| Supabase 프로젝트 URL | `https://mfqnaopqlerqddyomscv.supabase.co` |
| Node | `22` 이상, 패키지 요구 버전 `22.13.0` 이상 |
| 패키지 관리 | `pnpm` · `pnpm-lock.yaml` 포함 |
| 빌드 / 배포 폴더 | `pnpm run build` / `dist` |

## 개발과 빌드

이 폴더의 내용을 저장소 루트로 사용합니다. Node와 pnpm이 설치된 환경에서 실행합니다.

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run build
pnpm run preview
```

`build`는 TypeScript 검사 후 정적 파일을 `dist`에 생성합니다. `netlify.toml`이 빌드와 SPA 경로 처리를 지정합니다. 저장소와 연결한 Netlify는 `main` 커밋을 받아 새로 빌드하도록 설정합니다.

## 주요 파일

| 파일 | 용도 |
| --- | --- |
| `src/Workspace.tsx` | 점검·작업·대시보드·분석·보고 화면 |
| `src/AuthGate.tsx` | Supabase 로그인, 가입 요청, 프로필과 관리자 화면 |
| `src/backend.ts` | Supabase DB·사진 업로드·서명 URL 연결 |
| `public-config.ts` | 프로젝트 URL과 브라우저용 publishable key |
| `public/manifest.webmanifest`, `public/sw.js` | 홈 화면 설치와 앱 화면 캐시 |
| `netlify.toml` | Node·빌드·배포·경로 설정 |
| `pnpm-lock.yaml` | 설치 의존성 잠금 파일 |

## 계정과 저장 권한

기존 아이디는 `아이디@hdc-pce.netlify.app` 형태의 기존 Supabase 계정으로 로그인합니다. 신규 가입은 실제 이메일을 사용하고 이메일 확인·공장 관리자 승인을 거칩니다. Google 계정 로그인과는 별개입니다.

승인된 공장 구성원은 공장 기준자료, 점검·작업 기록과 현장 사진을 조회합니다. 기록 수정은 작성자 또는 관리자만 수행합니다. 관리자만 사용자 승인과 기준자료 가져오기를 수행하며 첫 가입자에게 관리자 권한을 자동 부여하지 않습니다. 앱 프로필의 표시 이름은 계정 설정에서 `윤공장장` 등으로 변경합니다.

기준자료는 로그인 후 `hdc_v2_seed`에서 가져옵니다. 실제 수선비 원장·설비 자료를 `public/data.json`이나 JavaScript 번들에 넣지 않습니다. 사진은 Supabase 비공개 버킷에 저장하고 필요한 동안만 유효한 서명 URL로 표시합니다.

네트워크 연결이 끊긴 기기 임시 기록은 해당 계정·기기에 남습니다. 다시 연결한 뒤 전송을 완료해야 다른 기기에서 보이며, 사진 첨부에는 네트워크가 필요합니다. 계정 로그아웃 전 기기 임시 기록 상태를 확인합니다.

## 공개 저장소에 넣는 범위

공개 저장소에는 이 폴더의 앱 소스·정적 아이콘·설정·잠금 파일만 반영합니다. 다음 자료를 포함하지 않습니다.

- 실제 회사 원본·수선비 원장·기준자료 JSON
- `03_Supabase` 비공개 전달 폴더와 원본 JSON 내장 SQL
- 점검·작업 백업 JSON과 현장 사진
- service role key, secret key, DB 비밀번호, 로그인 토큰
- `node_modules`, 빌드 산출물 `dist`, 로컬 `.env`

`public-config.ts`의 publishable key는 브라우저 연결에 사용하는 공개 키입니다. 데이터 접근은 DB의 승인·역할·RLS와 Storage 정책으로 제한해야 합니다. 실제 SQL 적용과 권한 검증은 별도 비공개 운영 패키지의 `README_SETUP.md`를 따릅니다.

기존 `check_records`와 Sites D1·R2 기록은 별도로 보존합니다. 새 테이블로 자동 변환하는 배포가 아니며, 이전 JSON에 있는 사진 ID만으로 사진 파일을 옮길 수 없습니다.

## 운영 확인

배포 후 PC에서 점검 1건을 저장하고 휴대폰에서 같은 기록을 확인합니다. 사진 저장·재조회, 작성자·관리자 수정, 일반 구성원의 타인 기록 수정 차단, 미승인 계정의 자료 차단을 확인합니다. 같은 기록의 오래된 버전을 저장하면 충돌을 표시하고 최신 내용을 확인해야 합니다.

참고: [Supabase API 키](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Netlify Vite 배포](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/).

## 설비보전 정책과 작업계획 (3.1)

설비보전 절차서에서 여섯 가지 목적과 부서 정책을 확인합니다. 평일 08:00~09:30, 주말 계획 제외, 90분 초과 장기 및 100만 원 이상 고액 특별관리 기준을 반영했습니다. 보전 작업계획에서 시간·비용·영향·관리자 승인과 복구 확인을 기록합니다.

새 DB를 설치할 때 supabase/schema.sql → supabase/storage.sql → supabase/maintenance.sql 순서로 적용합니다. 마지막 maintenance.sql은 새 계획 테이블과 정책·승인·완료 규칙을 적용하므로 생략하지 않습니다. 제조원가 비율은 같은 월의 실제비용 입력 상태를 확인한 뒤 사용합니다.

## 장비·점검 양식 추가 (3.2)

보전 작업계획 → +새 점검 → 장비·양식 추가에서 새 장비와 점검 양식을 함께 등록하거나 기존 장비에 양식을 추가합니다. 장비 코드는 생략 시 자동 생성되며, 각 점검 항목의 이름과 판정 기준을 입력합니다. 양식 저장 후 바로 점검에 적용하고 결과를 입력해 점검 기록을 별도로 저장합니다. 승인된 구성원이 폰과 PC에서 양식을 재사용합니다.

신규 설치는 schema.sql → storage.sql → maintenance.sql → custom-checklists.sql 순서입니다. 추가 장비·양식은 별도 RLS 테이블에 보관하며 기존 회사 기준자료를 변경하지 않습니다. 장비를 변경하면 이전 장비의 점검 항목과 사진 선택을 초기화합니다.

## 기존 시스템 적용 내역 (2026-10-17)

이 저장소에는 기존 운영 앱 3.2.0의 앱 소스, PWA 아이콘, 빌드 설정과 DB 구조 SQL을 적용했습니다. 기준 소스는 [HDC-PCE의 f45e84a](https://github.com/yunyeochul99-ai/HDC-PCE/commit/f45e84a032af962a7d144eb4719f8c03f9bb7875)입니다. 앱 실행 파일과 Supabase 연결 설정은 기준 소스와 같습니다. 보전 절차서, 작업계획, 100만 원 이상 특별관리, 새 장비·점검 양식 추가 기능을 포함합니다.

기존 Netlify 앱과 같은 Supabase 프로젝트를 사용하므로 기존 계정·기록·사진·추가 양식을 그대로 조회합니다. 저장소를 바꾸기 위해 기존 DB를 재설치하거나 SQL을 다시 실행할 필요는 없습니다. 회사 원장과 운영 데이터는 이 공개 저장소에 포함하지 않았습니다.

### 기존 Netlify 사이트의 자동 배포 원본 변경

GitHub 코드 반영과 Netlify 저장소 연결은 별도 작업입니다. 이 저장소에 코드를 반영한 것만으로 기존 사이트의 자동 배포 원본이 변경되지는 않습니다.

1. Netlify에서 기존 `hdc-pce` 프로젝트를 선택합니다.
2. 프로젝트의 Build & deploy 설정에서 연결된 저장소를 `yunyeochul99-ai/HDC-hyundai-pce`로 변경하고 브랜치를 `main`으로 지정합니다.
3. Base directory는 비워 두고, build command는 `pnpm run build`, publish directory는 `dist`로 설정합니다. Node 22 설정은 `netlify.toml`에 포함되어 있습니다.
4. 새 배포가 성공하면 기존 `https://hdc-pce.netlify.app` 주소에서 로그인과 기록·사진 조회를 확인합니다. 기존 사이트 주소와 Supabase 프로젝트는 유지합니다.

폰과 PC에서 기존 주소를 사용하면 됩니다. 새 GitHub 저장소 주소는 앱 접속 주소가 아닙니다.
