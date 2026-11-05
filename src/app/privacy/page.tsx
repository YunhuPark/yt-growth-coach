import type { Metadata } from "next";
import SiteHeader from "@/components/site/SiteHeader";
import { BRAND } from "@/components/site/Brand";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: `${BRAND}가 어떤 정보를 쓰고, 어디에 저장하고, 어떻게 지울 수 있는지 안내합니다.`,
};

const POINTS: { title: string; items: string[] }[] = [
  {
    title: "이 앱이 하는 일",
    items: ["유튜브 크리에이터를 위한 영상 편집 도우미와 채널 분석 도구예요. 대부분 사용자의 컴퓨터에서 실행하는 로컬 앱이에요."],
  },
  {
    title: "Google 계정 정보 (채널 분석을 쓸 때만)",
    items: [
      "읽기 전용 권한 두 가지만 요청해요: YouTube 데이터(youtube.readonly)와 YouTube Analytics(yt-analytics.readonly).",
      "채널 지표·영상 목록·시청 지표를 화면에 보여 주고 분석하는 데만 써요. 영상을 올리거나 고치거나 지우지 않아요.",
      "로그인 정보(토큰)는 사용자 컴퓨터의 .data 폴더에만 저장돼요. 개발자나 다른 서버로 보내지 않아요.",
      "Google 사용자 데이터를 팔거나, 광고에 쓰거나, 제3자와 공유하지 않아요.",
      "Google API 서비스에서 받은 정보의 사용과 전달은 제한적 사용 요구사항을 포함한 Google API 서비스 사용자 데이터 정책을 따라요.",
    ],
  },
  {
    title: "AI 기능을 쓸 때",
    items: [
      "사용자가 직접 넣은 Anthropic API 키로만 호출해요. 키가 없으면 AI 기능은 쓰이지 않아요.",
      "분석에 필요한 글자(채널 지표, 영상 제목, 인식된 대사 등)와 이미지 일부가 Anthropic API로 전송돼요. 영상 파일과 소리는 보내지 않아요.",
    ],
  },
  {
    title: "공개 데모 사이트",
    items: ["로그인도 영상 업로드도 없어요. 시청 지속 분석은 브라우저 안에서만 계산하고, 입력한 데이터를 서버에 저장하지 않아요.", "호스팅 서비스(Vercel)가 접속 기록을 일반적인 방식으로 남길 수 있어요."],
  },
  {
    title: "지우는 방법",
    items: [
      "채널 분석 화면의 “연결 해제”를 누르면 저장된 로그인 정보가 바로 지워져요.",
      "Google 계정의 “타사 앱 및 서비스” 권한 화면에서 이 앱의 접근을 직접 취소할 수도 있어요.",
      "그 밖의 기록(추천 결과, 추적 기록 등)은 사용자 컴퓨터의 .data 폴더에 있고, 폴더를 지우면 모두 사라져요.",
    ],
  },
  {
    title: "문의",
    items: ["GitHub 저장소의 Issues로 알려 주세요: github.com/YunhuPark/yt-growth-coach/issues"],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 focus:outline-none sm:px-6">
        <div>
          <p className="timecode">2026. 11. 5. 기준</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">개인정보 처리방침</h1>
        </div>
        {POINTS.map((p, i) => (
          <section key={p.title} className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">
              {i + 1}. {p.title}
            </h2>
            <ul className="flex flex-col gap-2 text-[15px]">
              {p.items.map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden className="select-none text-muted">·</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
