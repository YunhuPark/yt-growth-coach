import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ClipLab · AI 영상 편집 도우미", template: "%s · ClipLab" },
  description: "긴 영상 한 편을 올릴 수 있는 쇼츠로. 구간 고르기, 컷, 자막, 세로 변환, 효과음까지 AI가 제안하고 내 컴퓨터에서 만들어 줍니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
