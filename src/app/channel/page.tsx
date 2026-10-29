import type { Metadata } from "next";
import Dashboard from "@/components/channel/Dashboard";
import SiteHeader from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "채널 분석",
  description: "내 채널 지표와 트렌드를 바탕으로 다음에 만들 영상·쇼츠·릴스를 추천하고, 올린 뒤의 성과를 추적합니다.",
};

export default function ChannelPage() {
  return (
    <>
      <SiteHeader active="channel" />
      <Dashboard />
    </>
  );
}
