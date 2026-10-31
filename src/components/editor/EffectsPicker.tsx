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
        <p className="text-xs text-muted">
          컷이 이어지는 자리에 화면 전환과 효과음을 자동으로 넣습니다. 효과음은 파일을 쓰지 않고 영상 도구가 직접 합성하는 단순한 소리라 저작권 걱정은 없지만, 전문 효과음만큼 다채롭지는 않습니다.
          자막 타이밍은 바뀌지 않습니다.
        </p>
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
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.hookSound} onChange={(e) => set({ hookSound: e.target.checked })} />후크 글자가 나올 때 “톡”</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.endingSound} onChange={(e) => set({ endingSound: e.target.checked })} />엔딩 카드가 나올 때 “띵”</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.onBeats} onChange={(e) => set({ onBeats: e.target.checked })} />컷 대신 음악의 박자에 넣기</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={effects.allCuts} onChange={(e) => set({ allCuts: e.target.checked })} />짧은 무음 컷(점프컷)에도 넣기</label>
      </div>
      {effects.onBeats && (
        <div className="flex flex-col gap-2">
          <label className="field w-fit text-xs">박자에 넣는 간격
            <select className="input w-auto" value={effects.beatEvery} onChange={(e) => set({ beatEvery: Number(e.target.value) as 1 | 2 | 4 })}>
              <option value={1}>모든 박</option>
              <option value={2}>2박마다</option>
              <option value={4}>4박마다 (한 마디)</option>
            </select>
          </label>
          <p className="text-xs text-muted">
            만들 때 쓰이는 부분의 소리에서 박자를 찾아 컷 대신 박마다 전환·효과음을 넣습니다. 음악이 있고 박자가 일정한 영상에 맞고, 말소리뿐인 영상이나 박자가 뚜렷하지 않은 영상은 찾지 못해
            컷에 넣고 그렇게 알려 줍니다. 템포를 두 배·절반으로 잡거나 박 위치가 어긋날 수 있어서, 확인하며 다듬으려면 ‘박자에 맞춰 효과 넣기’ 도구를 쓰세요. 쇼츠의 경우 길이가 1분이면 효과가 100곳 안팎이라 정신없을 수 있어 “2박마다”나 “4박마다”를 권합니다.
          </p>
        </div>
      )}
      {any && (
        <p className="text-xs text-muted">
          전환·컷 효과음은 <b>컷에서 원본을 1초 이상 건너뛴 곳</b>(장면이 바뀌는 곳)에만, 서로 1.5초 이상 떨어진 곳에 최대 40곳까지 넣습니다. “짧은 무음 컷에도 넣기”를 켜면 짧게 잘라 낸 곳에도 넣지만 컷이 많으면 정신없을 수 있습니다.
          한 덩어리로 자르는 쇼츠에는 컷이 없어 후크·엔딩 소리만 들어갑니다.
        </p>
      )}
    </section>
  );
}
