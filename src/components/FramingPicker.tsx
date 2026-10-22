"use client";

import { TARGETS, type Target } from "@/lib/reframe";
import { useFraming } from "./framingContext";

/** Whether Shorts made from a wider video follow the person instead of showing the whole picture over a blurred copy. */
export default function FramingPicker({ title = "세로 화면 (선택)" }: { title?: string }) {
  const { follow, smooth, target, zoom, setFollow, setSmooth, setTarget, setZoom } = useFraming();
  return (
    <section className="card flex flex-col gap-2">
      <h2 className="font-semibold">{title}</h2>
      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        <span>
          가로 영상을 세로로 만들 때 따라가며 자르기
          <span className="block text-xs text-muted">
            끄면 화면 전체를 흐린 배경 위에 얹습니다(기본). 켜면 사람 쪽으로 꽉 차게 잘라 만들며, 만들기 전에 사람 찾는 시간이 더 걸립니다(이 컴퓨터에서 처리, 처음 한 번은 모델 약 9MB 내려받음).
            이미 세로인 영상이나 가로 결과에는 적용되지 않습니다. 따라가는 위치를 눈으로 보고 조절하려면 아래 “자동 프레임” 도구를 쓰세요.
          </span>
        </span>
      </label>
      {follow && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field text-xs">따라갈 것
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
              {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="field text-xs">확대
            <select className="input" value={String(zoom)} onChange={(e) => setZoom(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
              <option value="1">확대 안 함</option>
              <option value="auto">자동 (작으면 키움, 최대 2배)</option>
              <option value="1.5">1.5배</option>
              <option value="2">2배</option>
            </select>
          </label>
          <label className="field text-xs">카메라 움직임: <b>{smooth}/5</b> (낮을수록 바짝 따라감)
            <input type="range" min={1} max={5} step={1} value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} />
          </label>
          <p className="text-xs text-muted sm:col-span-3">여럿 중 특정 사람만 따라가려면 아래 “자동 프레임” 도구에서 사진 속 상자를 눌러 지정하세요. 확대할수록 화면이 흐려집니다.</p>
        </div>
      )}
    </section>
  );
}
