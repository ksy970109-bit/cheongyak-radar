# Oracle Cloud 무료 서버에 배포하기

국내 리전(춘천·서울)의 Always Free VM에 올리면 PC를 꺼도 3시간마다 수집이 돌고, 실거래가 API(해외 접속 차단)도 정상 동작합니다. 비용은 0원입니다.

전체 흐름: **GitHub에 코드 올리기 → Oracle 가입 → VM 만들 때 세팅 스크립트 붙여넣기 → 포트 열기 → 접속**

---

## 1. GitHub 저장소 만들기 (1분)

1. https://github.com/new
2. Repository name: `cheongyak-radar`, **Public** 선택, README·.gitignore 추가는 **체크하지 않음** → Create repository
3. 만들었다고 Claude에게 알려주면 코드를 올려 드립니다.

## 2. Oracle Cloud 가입 (10~20분)

1. https://signup.cloud.oracle.com 에서 가입
2. **Home Region**을 반드시 **South Korea North (Chuncheon)** 또는 **South Korea Central (Seoul)**로 고르세요.
   - 홈 리전은 나중에 못 바꾸고, 무료 자원은 홈 리전에서만 만들 수 있어요.
3. 카드 인증이 있지만 Always Free 자원만 쓰면 요금이 나가지 않습니다.

## 3. VM 만들기

1. 콘솔 왼쪽 위 ☰ → **컴퓨트(Compute) → 인스턴스(Instances) → 인스턴스 생성**
2. **이미지와 구성(Image and shape)**
   - 이미지 변경 → **Canonical Ubuntu 24.04**
   - Shape은 **VM.Standard.E2.1.Micro** (Always Free 표시)
     - Ampere A1(ARM)도 무료지만 국내 리전은 "용량 부족" 오류가 자주 나요. 그럴 땐 E2.1.Micro로.
3. **네트워킹**: 기본값(새 VCN 생성) 그대로, **공용 IPv4 주소 지정**이 켜져 있는지 확인
4. **SSH 키 추가**: "개인 키 저장"을 눌러 파일을 받아 두세요 (나중에 접속할 때 필요)
5. 아래로 내려 **고급 옵션 표시 → 관리(Management) → 초기화 스크립트(Initialization script)**
   - "cloud-init 스크립트 붙여넣기" 선택
   - GitHub의 [`deploy/oracle-init.sh`](deploy/oracle-init.sh) 내용을 **전체 복사해서 붙여넣기**
   - 맨 위 `DATA_GO_KR_KEY=""` 따옴표 안에 공공데이터포털 인증키(Decoding)를 넣으면 로또 판별까지 바로 켜집니다
6. **생성** → 1~2분 뒤 상태가 "실행 중(Running)"이 되면 **공용 IP 주소**를 메모

## 4. 웹 포트(80, 443) 열기

Oracle은 기본으로 SSH(22)만 열려 있어요.

1. 인스턴스 상세 화면 → **기본 VNIC**의 **서브넷** 링크 클릭
2. **보안 목록(Security Lists)** → `Default Security List for ...` 클릭
3. **수신 규칙 추가(Add Ingress Rules)**
   - 소스 CIDR: `0.0.0.0/0`
   - IP 프로토콜: TCP
   - 대상 포트 범위: `80,443`
4. 저장

## 5. 접속

VM을 만들고 5~10분 정도 지나면(패키지 설치 + 첫 수집) 아래 주소로 열립니다.

```
https://<공용IP의 점(.)을 대시(-)로 바꾼 것>.sslip.io
예) 공용 IP가 146.56.10.20 이면 → https://146-56-10-20.sslip.io
```

`http://공용IP` 로 들어가도 위 주소로 넘어갑니다. HTTPS 인증서는 Let's Encrypt로 자동 발급돼요.
나중에 도메인을 사면 `/etc/caddy/Caddyfile`의 주소만 바꾸면 됩니다.

---

## 운영

**코드 수정 반영**: GitHub에 push하면 서버가 30분마다 확인해서 자동으로 반영합니다.

**서버 접속(SSH)** — PowerShell에서:

```
ssh -i C:\Users\User\Downloads\<받은키파일>.key ubuntu@<공용IP>
```

"UNPROTECTED PRIVATE KEY FILE" 오류가 나면 먼저:

```
icacls C:\Users\User\Downloads\<받은키파일>.key /inheritance:r /grant:r "${env:USERNAME}:R"
```

**자주 쓰는 명령 (SSH 접속 후)**

| 하고 싶은 것 | 명령 |
| --- | --- |
| 인증키 넣기·바꾸기 | `sudo cheongyak-key` |
| 사이트 주소 확인 | `cat /etc/cheongyak-radar.url` |
| 서버 로그 | `sudo journalctl -u cheongyak-radar -n 100` |
| 첫 세팅 로그 | `sudo tail -100 /var/log/cheongyak-setup.log` |
| 지금 바로 업데이트 | `sudo cheongyak-update` |
| 재시작 | `sudo systemctl restart cheongyak-radar` |

## 무료로 계속 쓰려면

Oracle은 Always Free 인스턴스가 7일 동안 CPU를 거의 안 쓰면 회수할 수 있다고 안내합니다(정책은 바뀔 수 있으니 Oracle 공지를 확인하세요). 이 사이트는 가벼워서 해당될 수 있어요.

- 계정을 **종량제(Pay As You Go)**로 업그레이드하면 회수 대상에서 빠지고, Always Free 한도 안에서는 요금이 나오지 않습니다.
- 혹시 회수되더라도 3단계를 다시 하면 똑같이 복구됩니다(코드는 GitHub에, 데이터는 자동 재수집).
