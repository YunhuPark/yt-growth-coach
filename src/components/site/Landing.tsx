import Image from "next/image";
import Link from "next/link";
import { DEMO } from "@/lib/shared/demo";
import Brand, { BRAND } from "./Brand";
import Icon, { type IconName } from "./Icon";
import SiteHeader from "./SiteHeader";

const FEATURES: { icon: IconName; title: string; text: string; uses: "ai" | "local" }[] = [
  { icon: "clapper", title: "쇼츠 구간 뽑기", text: "긴 영상에서 쇼츠로 올리기 좋은 구간을 점수와 이유까지 붙여 골라 줍니다.", uses: "ai" },
  { icon: "timeline", title: "한 편 자동 편집", text: "컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤에 영상으로 만들어 줍니다.", uses: "ai" },
  { icon: "scissors", title: "무음·군말 자르기", text: "말이 끊긴 빈 구간과 “음…”, “어…”를 찾아 하나씩 들어 보고 잘라 냅니다.", uses: "local" },
  { icon: "frame", title: "자동 프레임", text: "가로 영상을 세로로 자를 때 사람·동물을 따라 화면 위치를 옮깁니다.", uses: "local" },
  { icon: "wave", title: "전환·효과음", text: "컷마다 번쩍임·줌 펀치와 효과음을 자동으로 넣습니다. 자막 타이밍은 그대로입니다.", uses: "local" },
  { icon: "wave", title: "박자에 맞춰 효과 넣기", text: "영상 속 음악의 박자를 찾아서, 박자마다 번쩍임·확대·효과음을 넣습니다.", uses: "local" },
  { icon: "chart", title: "시청 지속 분석", text: "Studio의 시청 지속률 데이터를 붙이면 시청자가 어디서 떠나는지, 어디를 다시 돌려 봤는지 찾아 줍니다.", uses: "local" },
  { icon: "link", title: "주소로 분석", text: "유튜브 주소만 붙이면 요약과 주제·제목·쇼츠 구간·롱폼 구성안을 만듭니다.", uses: "ai" },
];

const HOW: { title: string; text: string }[] = [
  { title: "하고 싶은 걸 고릅니다", text: "쇼츠 뽑기, 자동 편집, 무음 컷, 세로 변환 중 하나를 고릅니다." },
  { title: "영상을 끌어다 놓습니다", text: "파일을 올리고, 쓸 수 있는 영상인지 확인에 체크합니다." },
  { title: "확인하고 내려받습니다", text: "AI의 제안을 보고 고친 뒤 mp4로 만듭니다. 자막은 SRT로도 받을 수 있어요." },
];

const TRUST: { icon: IconName; title: string; text: string }[] = [
  { icon: "film", title: "영상은 내 컴퓨터에서", text: "자르고 붙이고 인코딩하는 모든 처리가 내 컴퓨터에서 일어납니다. 영상 파일이 서버로 올라가지 않아요." },
  { icon: "timeline", title: "AI 비용이 눈에 보입니다", text: "AI를 쓰는 작업은 표시가 붙고, 호출마다 토큰과 시간을 기록해 작업당 원가를 직접 확인할 수 있습니다." },
  { icon: "check", title: "권리 확인이 먼저", text: "방송·타사 영상을 내려받는 기능은 없습니다. 내가 찍었거나 허락받은 영상에만 쓰도록 확인을 거칩니다." },
];

const RUN_STEPS = [
  "git clone https://github.com/YunhuPark/yt-growth-coach.git",
  "cd yt-growth-coach",
  "docker build -t cliplab .",
  "docker run --rm -p 3000:3000 -v cliplab-data:/app/.data cliplab",
];

/** How to run the whole tool on one's own computer; shown on the public demo, which only runs what needs no server. */
function RunLocally() {
  return (
    <section id="run" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
      <Eyebrow n="05" text="직접 실행하기" />
      <h2 className="mt-3 max-w-3xl text-4xl font-bold sm:text-5xl">전체 기능은 내 컴퓨터에서 실행하세요</h2>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        이 공개 데모에서는 시청 지속 분석만 쓸 수 있습니다. 컷·자막·세로 변환 같은 영상 처리는 영상이 서버에 올라가지 않도록 내 컴퓨터에서 돌아가게 만들었고, AI 기능은 내 API 키로 호출합니다.
      </p>
      <pre className="mt-8 overflow-x-auto rounded-[10px] border border-line bg-card p-5 font-mono text-sm leading-7" aria-label="실행 명령">
        {RUN_STEPS.join("\n")}
      </pre>
      <ul className="mt-6 grid gap-6 text-sm text-muted md:grid-cols-3">
        <li><b className="text-foreground">Docker가 필요합니다.</b> 처음 빌드는 몇 분 걸리고, 이미지에 영상 처리 도구(ffmpeg)와 한글 글꼴이 들어 있습니다.</li>
        <li><b className="text-foreground">실행하면 http://localhost:3000</b> 에서 열립니다. 만든 결과와 설정은 <code>cliplab-data</code> 저장 공간에 남습니다.</li>
        <li><b className="text-foreground">AI 기능을 쓰려면</b> 실행할 때 <code>-e ANTHROPIC_API_KEY=내키</code>를 덧붙이세요. 음성 인식·사람 찾기 모델은 처음 쓸 때 한 번 내려받습니다.</li>
      </ul>
    </section>
  );
}

/** A small label above a heading: a number in the film-timecode style, then what the section is. */
function Eyebrow({ n, text }: { n: string; text: string }) {
  return (
    <p className="flex items-center gap-3">
      <span className="timecode !text-foreground">{n}</span>
      <span className="h-px w-8 bg-foreground/40" aria-hidden />
      <span className="text-sm font-semibold text-muted">{text}</span>
    </p>
  );
}

/** A real screenshot of the app in a plain frame, with what it shows underneath. */
function Shot({ src, w, h, alt, caption, priority = false }: { src: string; w: number; h: number; alt: string; caption: string; priority?: boolean }) {
  return (
    <figure className="flex flex-col gap-3">
      <Image src={src} width={w} height={h} alt={alt} priority={priority} unoptimized className="h-auto w-full rounded-[10px] border border-line" />
      <figcaption className="text-sm font-medium text-muted">{caption}</figcaption>
    </figure>
  );
}

/** The front page: what the tool does, how to use it in three steps, and why it is safe to try. Static. */
export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link className="btn-primary" href="/edit">지금 시작하기</Link>
      </SiteHeader>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {/* hero */}
        <section>
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.05fr_0.95fr] md:py-24">
            <div className="flex flex-col items-start gap-7">
              <Eyebrow n="00:00:00:00" text="AI 영상 편집 도우미" />
              <h1 className="text-5xl font-bold leading-[1.08] sm:text-6xl lg:text-7xl">
                긴 영상 한 편을,
                <br />
                <span className="mark">올릴 수 있는 쇼츠</span>로.
              </h1>
              <p className="max-w-xl text-lg text-muted">
                구간 고르기, 컷, 자막, 세로 변환, 효과음까지. 영상을 고르면 AI가 제안하고, 내가 확인한 뒤에 만들어 줍니다.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/edit" className="btn-primary gap-2 !px-7 !py-3.5 !text-base">
                  지금 시작하기 <Icon name="arrow" size={18} />
                </Link>
                <a href="#how" className="btn !px-6 !py-3.5 !text-base">사용 방법 보기</a>
              </div>
              <p className="text-sm font-medium text-muted">로그인 없음 · 영상은 내 컴퓨터에서 처리</p>
              {DEMO && (
                <p className="callout max-w-xl text-sm">
                  <b>공개 데모</b> — 브라우저 안에서만 계산하는 <b>시청 지속 분석</b>을 바로 써 볼 수 있어요. 영상 처리와 AI 기능은 <a className="font-semibold underline underline-offset-4" href="#run">내 컴퓨터에서 실행</a>하면 모두 쓸 수 있습니다.
                </p>
              )}
            </div>

            <Shot src="/shots/cut.webp" w={1712} h={1160} alt="무음·군말 자르기: 자를 곳 목록과 원본·결과 길이" caption="실제 화면 · 무음·군말 자르기 결과 (테스트 영상)" priority />
          </div>
        </section>

        <div className="sprockets text-foreground" aria-hidden />

        {/* real screens */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <Eyebrow n="01" text="실제 화면" />
          <h2 className="mt-3 max-w-2xl text-4xl font-bold sm:text-5xl">한 번에 하나씩, 버튼으로 넘어가요</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">작업을 고르고, 영상을 올리고, 꾸밀지 정하고, 만듭니다. 아래는 이 도구의 실제 화면입니다.</p>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <Shot src="/shots/task.webp" w={1904} h={1370} alt="1단계: 하고 싶은 작업 고르기" caption="1단계 · 하고 싶은 작업을 고릅니다" />
            <Shot src="/shots/style.webp" w={1904} h={1394} alt="3단계: 자막 스타일 고르기" caption="3단계 · 자막 스타일을 고릅니다 (선택)" />
          </div>
        </section>

        {/* features */}
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
          <Eyebrow n="02" text="기능" />
          <h2 className="mt-3 max-w-2xl text-4xl font-bold sm:text-5xl">편집에서 가장 번거로운 일부터 덜어 드려요</h2>
          <ul className="mt-12 divide-y divide-line border-y border-line">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="grid items-start gap-3 py-6 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.4fr)_8rem] sm:gap-6">
                <span className="timecode pt-1">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="flex items-center gap-3 text-xl font-bold">
                  <Icon name={f.icon} size={22} />
                  {f.title}
                </h3>
                <p className="text-muted">{f.text}</p>
                <span className={`${f.uses === "ai" ? "chip-ai" : "chip-local"} w-fit sm:justify-self-end`}>{f.uses === "ai" ? "AI 사용" : "내 컴퓨터에서만"}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* how */}
        <section id="how" className="scroll-mt-16 border-y border-line bg-foreground/[0.03]">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <Eyebrow n="03" text="사용 방법" />
            <h2 className="mt-3 text-4xl font-bold sm:text-5xl">세 걸음이면 끝나요</h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {HOW.map((h, i) => (
                <li key={h.title} className="border-t-2 border-foreground pt-5">
                  <span className="font-mono text-5xl font-bold tabular-nums">{i + 1}</span>
                  <h3 className="mt-4 text-xl font-bold">{h.title}</h3>
                  <p className="mt-2 text-muted">{h.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* trust */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <Eyebrow n="04" text="안심하고 쓰는 이유" />
          <h2 className="mt-3 max-w-2xl text-4xl font-bold sm:text-5xl">내 영상, 내 비용, 내 책임을 분명하게</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {TRUST.map((t) => (
              <div key={t.title} className="flex flex-col gap-3">
                <Icon name={t.icon} size={28} />
                <h3 className="text-xl font-bold">{t.title}</h3>
                <p className="text-muted">{t.text}</p>
              </div>
            ))}
          </div>
        </section>

        {DEMO && <RunLocally />}

        {/* closing call: the one dark band on the page */}
        <section className="bg-foreground text-background">
          <div className="sprockets text-background" aria-hidden />
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6">
            <h2 className="max-w-3xl text-4xl font-bold sm:text-6xl">영상 하나로 지금 바로 해 보세요.</h2>
            <p className="max-w-xl text-lg opacity-70">파일을 끌어다 놓기만 하면 시작됩니다. 계정도 설치도 필요 없어요.</p>
            <Link href="/edit" className="inline-flex items-center gap-2 rounded-lg bg-background px-8 py-3.5 text-base font-semibold text-foreground hover:opacity-85">
              영상 편집 시작하기 <Icon name="arrow" size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <Brand size={24} />
          <p>© {BRAND} · 내 채널을 키우는 편집 도구</p>
          <nav className="flex gap-5" aria-label="바로가기">
            <Link href="/edit" className="inline-block py-2 hover:text-foreground">영상 편집</Link>
            {!DEMO && <Link href="/channel" className="inline-block py-2 hover:text-foreground">채널 분석</Link>}
            <a href="https://github.com/YunhuPark/yt-growth-coach" className="inline-block py-2 hover:text-foreground">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
