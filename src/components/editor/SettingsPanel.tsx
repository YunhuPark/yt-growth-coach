"use client";

import { PRESET_LABEL } from "@/lib/editor/captionStyle";
import { CUT_SOUNDS, TRANSITIONS } from "@/lib/editor/effects";
import { TARGETS } from "@/lib/editor/reframe";
import { useCaptionStyle } from "./captionStyleContext";
import EffectsPicker from "./EffectsPicker";
import { useEffects } from "./effectsContext";
import FramingPicker from "./FramingPicker";
import { useFraming } from "./framingContext";
import Icon from "../site/Icon";
import StylePicker from "./StylePicker";

/** What is currently chosen for the finishing options, as short chips, so it can be shown wherever the choices apply. */
export function SettingsSummary() {
  const { style } = useCaptionStyle();
  const { follow, target } = useFraming();
  const { effects } = useEffects();

  const vertical = follow ? `따라가며 자르기 (${TARGETS.find((t) => t.id === target)?.label ?? ""})` : "전체 화면 + 흐린 배경";
  const fxParts = [
    effects.transition !== "none" ? TRANSITIONS.find((t) => t.id === effects.transition)?.label : null,
    effects.cutSound !== "none" ? CUT_SOUNDS.find((t) => t.id === effects.cutSound)?.label : null,
    effects.hookSound ? "후크 소리" : null,
    effects.endingSound ? "엔딩 소리" : null,
  ].filter(Boolean);

  return (
    <>
      <span className="chip">자막: {PRESET_LABEL[style.preset]}</span>
      <span className="chip">세로 화면: {vertical}</span>
      <span className="chip">전환·효과음: {fxParts.length ? fxParts.join(" · ") : "없음"}</span>
    </>
  );
}

/**
 * The finishing choices: how the captions look, how a wide video becomes vertical, and the transitions and sounds. They apply to
 * every video made in this session, and each is fine as it is.
 */
export default function SettingsPanel() {
  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Icon name="type" size={20} />자막 스타일</h2>
        <p className="text-sm text-muted">훅 자막과 구간 자막의 모양입니다. 그림은 실제 영상에 들어가는 방식과 같게 그린 것입니다.</p>
        <StylePicker bare />
      </section>
      <section className="card flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Icon name="frame" size={20} />세로 화면</h2>
        <p className="text-sm text-muted">가로 영상으로 쇼츠를 만들 때 어떻게 세로로 바꿀지 정합니다.</p>
        <FramingPicker bare />
      </section>
      <section className="card flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Icon name="wave" size={20} />전환·효과음</h2>
        <p className="text-sm text-muted">컷이 이어지는 자리에 화면 전환과 효과음을 자동으로 넣습니다. 효과음은 직접 합성한 단순한 소리이고, 자막 타이밍은 바뀌지 않습니다.</p>
        <EffectsPicker bare />
      </section>
    </div>
  );
}
