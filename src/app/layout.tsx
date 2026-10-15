import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YT Growth Coach",
  description: "내 채널 지표와 트렌드를 바탕으로 다음에 만들 영상·쇼츠·릴스를 추천합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
