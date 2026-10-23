import Link from "next/link";
import Brand, { BRAND } from "./Brand";
import SiteHeader from "./SiteHeader";

const FEATURES: { icon: string; title: string; text: string; uses: "ai" | "local" }[] = [
  { icon: "🎬", title: "쇼츠 구간 뽑기", text: "긴 영상에서 쇼츠로 올리기 좋은 구간을 점수와 이유까지 붙여 골라 줍니다.", uses: "ai" },
  { icon: "✨", title: "한 편 자동 편집", text: "컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤에 영상으로 만들어 줍니다.", uses: "ai" },
  { icon: "✂️", title: "무음·군말 자르기", text: "말이 끊긴 빈 구간과 “음…”, “어…”를 찾아 하나씩 들어 보고 잘라 냅니다.", uses: "local" },
  { icon: "📱", title: "자동 프레임", text: "가로 영상을 세로로 자를 때 사람·동물을 따라 화면 위치를 옮깁니다.", uses: "local" },
  { icon: "🎚️", title: "전환·효과음", text: "컷마다 번쩍임·줌 펀치와 효과음을 자동으로 넣습니다. 자막 타이밍은 그대로.", uses: "local" },
  { icon: "🔗", title: "주소로 분석", text: "유튜브 주소만 붙이면 요약과 주제·제목·쇼츠 구간·롱폼 구성안을 만듭니다.", uses: "ai" },
];

const HOW: { n: string; title: string; text: string }[] = [
  { n: "1", title: "하고 싶은 걸 고르세요", text: "쇼츠 뽑기, 자동 편집, 무음 컷, 세로 변환 중 하나를 고릅니다." },
  { n: "2", title: "영상을 끌어다 놓으세요", text: "파일을 올리고 쓸 수 있는 영상인지 확인에 체크합니다." },
  { n: "3", title: "확인하고 내려받으세요", text: "AI의 제안을 보고 고친 뒤 mp4로 만듭니다. 자막은 SRT로도 받을 수 있어요." },
];

const TRUST: { icon: string; title: string; text: string }[] = [
  { icon: "🔒", title: "영상은 내 컴퓨터에서", text: "자르고 붙이고 인코딩하는 모든 처리가 내 컴퓨터에서 일어납니다. 영상 파일이 서버로 올라가지 않아요." },
  { icon: "🧾", title: "AI 비용이 눈에 보입니다", text: "AI를 쓰는 작업은 표시가 붙고, 호출마다 토큰과 시간을 기록해 작업당 원가를 직접 확인할 수 있습니다." },
  { icon: "✅", title: "권리 확인이 먼저", text: "방송·타사 영상을 내려받는 기능은 없습니다. 내가 찍었거나 허락받은 영상에만 쓰도록 확인을 거칩니다." },
];

/** The front page: what the tool does, how to use it in three steps, and why it is safe to try. Static. */
export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link className="btn-primary !py-2" href="/edit">지금 시작하기</Link>
      </SiteHeader>

      <main className="flex-1">
        {/* hero */}
        <section className="hero-bg relative overflow-hidden">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:py-24">
            <div className="flex flex-col items-start gap-6">
              <span className="chip bg-accent/10 px-3 py-1 text-accent">✨ AI 영상 편집 도우미 · 내 컴퓨터에서 처리</span>
              <h1 className="text-4xl font-black leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl">
                긴 영상 한 편이,
                <br />
                <span className="bg-gradient-to-r from-indigo-500 to-fuchsia-500 bg-clip-text text-transparent">올릴 수 있는 쇼츠</span>가 됩니다
              </h1>
              <p className="max-w-xl text-lg text-muted">
                구간 고르기, 컷, 자막, 세로 변환, 효과음까지. 영상을 고르면 AI가 제안하고, 내가 확인한 뒤에 만들어 줍니다.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/edit" className="btn-primary !px-7 !py-3.5 !text-base">지금 시작하기 →</Link>
                <a href="#how" className="btn !px-6 !py-3.5 !text-base">사용 방법 보기</a>
              </div>
              <p className="text-sm text-muted">Google 로그인 없이 바로 · 영상은 이 컴퓨터 밖으로 나가지 않아요</p>
            </div>

            <PhoneMock />
          </div>
        </section>

        {/* features */}
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-bold text-accent">기능</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">편집에서 가장 번거로운 일부터 덜어 드려요</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card flex flex-col gap-2 transition-shadow hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-2xl" aria-hidden>{f.icon}</span>
                <h3 className="mt-1 text-lg font-bold">{f.title}</h3>
                <p className="text-sm text-muted">{f.text}</p>
                <span className={`chip mt-auto w-fit ${f.uses === "ai" ? "bg-accent/10 text-accent" : "bg-good/15 text-good"}`}>
                  {f.uses === "ai" ? "AI 사용" : "내 컴퓨터에서만"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* how */}
        <section id="how" className="scroll-mt-20 bg-card/60 py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="mb-10 max-w-2xl">
              <p className="text-sm font-bold text-accent">사용 방법</p>
              <h2 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">세 걸음이면 끝나요</h2>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {HOW.map((h) => (
                <li key={h.n} className="relative rounded-2xl border border-line bg-card p-6 shadow-sm">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-strong text-lg font-black text-white">{h.n}</span>
                  <h3 className="mt-4 text-lg font-bold">{h.title}</h3>
                  <p className="mt-1 text-sm text-muted">{h.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* trust */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-bold text-accent">안심하고 쓰는 이유</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">내 영상, 내 비용, 내 책임을 분명하게</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {TRUST.map((t) => (
              <div key={t.title} className="flex flex-col gap-2 rounded-2xl border border-line p-6">
                <span className="text-3xl" aria-hidden>{t.icon}</span>
                <h3 className="text-lg font-bold">{t.title}</h3>
                <p className="text-sm text-muted">{t.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* closing call */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 rounded-3xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 px-6 py-14 text-center text-white shadow-lg">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">영상 하나로 지금 바로 해 보세요</h2>
            <p className="max-w-xl text-white/85">파일을 끌어다 놓기만 하면 시작됩니다. 계정도 설치도 필요 없어요.</p>
            <Link href="/edit" className="inline-flex items-center rounded-xl bg-white px-8 py-3.5 text-base font-bold text-indigo-700 shadow hover:bg-white/90">
              영상 편집 시작하기 →
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <Brand size={24} />
          <p>© {BRAND} · 내 채널을 키우는 편집 도구</p>
          <nav className="flex gap-4" aria-label="바로가기">
            <Link href="/edit" className="hover:text-foreground">영상 편집</Link>
            <Link href="/channel" className="hover:text-foreground">채널 분석</Link>
            <a href="https://github.com/YunhuPark/yt-growth-coach" className="hover:text-foreground">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** A phone showing a Short being cut, with the kinds of things the tool adds around it. Decoration, not a screenshot. */
function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden>
      <div className="absolute -left-4 top-10 z-10 rounded-xl border border-line bg-card px-3 py-2 text-xs font-bold shadow-lg">🎯 AI가 고른 구간 · 점수 예시</div>
      <div className="absolute -right-2 top-1/2 z-10 rounded-xl border border-line bg-card px-3 py-2 text-xs font-bold shadow-lg">📱 사람을 따라가는 프레임</div>
      <div className="absolute -bottom-3 left-6 z-10 rounded-xl border border-line bg-card px-3 py-2 text-xs font-bold shadow-lg">✂️ 무음 구간 자동 컷</div>

      <div className="mx-auto w-64 rounded-[2.2rem] border-[6px] border-zinc-900 bg-zinc-900 shadow-2xl dark:border-zinc-700">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[1.7rem] bg-gradient-to-b from-indigo-400 via-fuchsia-400 to-orange-300">
          <div className="absolute left-1/2 top-[22%] h-20 w-20 -translate-x-1/2 rounded-full bg-white/70" />
          <div className="absolute left-1/2 top-[38%] h-36 w-32 -translate-x-1/2 rounded-t-[3rem] bg-white/60" />
          <div className="absolute inset-x-4 top-5 rounded-lg bg-black/50 px-3 py-1.5 text-center text-sm font-black text-white">이 구간이 제일 반응 좋았어요</div>
          <div className="absolute inset-x-4 bottom-12 rounded-md bg-black/60 px-3 py-1.5 text-center text-sm font-bold text-white">자막이 이렇게 들어가요</div>
          <div className="absolute inset-x-4 bottom-5 flex h-2 gap-0.5">
            {[28, 12, 20, 9, 31].map((w, i) => (
              <span key={i} className="h-full rounded-full bg-white/80" style={{ flexGrow: w }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
