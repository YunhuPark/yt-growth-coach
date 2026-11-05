"use client";

import { CUT_SOUNDS, TRANSITIONS, type CutSound, type TransitionKind } from "@/lib/editor/effects";
import { useEffects } from "./effectsContext";

/** Transitions and sound effects for the cuts of the videos made on this page. */
export default function EffectsPicker({ title = "전환·효과음 (선택)", bare = false }: { title?: string; bare?: boolean }) {
  const { effects, setEffects } = useEffects();
  const set = (patch: Partial<typeof effects>) => setEffects({ ...effects, ...patch });
  const any = effects.transition !== "none" || effects.cutSound !== "none" || effects.hookSound || effects.endingSound;
  return (
    <section className={bare ? "flex flex-col gap-3" : "card flex flex-col gap-3"}>
      {!bare && (
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted">컷에 화면 전환과 효과음을 넣어요. 자막 타이밍은 그대로예요.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field text-xs">컷에서의 화면 전환
          <select className="input" value={effects.transition} onChange={(e) => set({ transition: e.target.value as TransitionKind })}>
            {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="field text-xs">컷에서의 효과음
          <select className="input" value={effects.cutSound} onChange={(e) => set({ cutSound: e.target.value as CutSound })}>
            {CUT_SOUNDS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="field text-xs">효과음 크기: <b>{Math.round(effects.volume * 100)}%</b>
          <input type="range" min={0.1} max={1} step={0.05} value={effects.volume} onChange={(e) => set({ volume: Number(e.target.value) })} disabled={effects.cutSound === "none" && !effects.hookSound && !effects.endingSound} />
        </label>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.hookSound} onChange={(e) => set({ hookSound: e.target.checked })} />훅 글자가 나올 때 “톡”</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.endingSound} onChange={(e) => set({ endingSound: e.target.checked })} />엔딩 카드가 나올 때 “띵”</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.allCuts} onChange={(e) => set({ allCuts: e.target.checked })} />짧은 무음 컷에도 넣기</label>
        <label className="flex items-start gap-2">
          <input className="mt-1" type="checkbox" checked={effects.onBeats} onChange={(e) => set({ onBeats: e.target.checked })} />
          <span>
            컷 대신 음악 박자에 넣기
            <span className="block text-xs text-muted">음악이 있는 영상용이에요. 박이 뚜렷하지 않으면 컷에 넣어요.</span>
          </span>
        </label>
      </div>
      {effects.onBeats && (
        <label className="field w-fit text-xs">박자에 넣는 간격
          <select className="input w-auto" value={effects.beatEvery} onChange={(e) => set({ beatEvery: Number(e.target.value) as 1 | 2 | 4 })}>
            <option value={1}>모든 박</option>
            <option value={2}>2박마다</option>
            <option value={4}>4박마다 (한 마디) · 쇼츠에 추천</option>
          </select>
        </label>
      )}
      {any && !effects.onBeats && <p className="text-xs text-muted">기본은 장면이 1초 이상 넘어가는 컷에만, 최대 40곳에 넣어요.</p>}
    </section>
  );
}
