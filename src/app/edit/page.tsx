import type { Metadata } from "next";
import Editor from "@/components/editor/Editor";

export const metadata: Metadata = {
  title: "영상 편집 도우미",
  description: "영상을 고르면 AI가 컷·자막·제목·쇼츠 구간을 제안하고, 확인한 뒤 영상으로 만들어 줍니다.",
};

export default function EditPage() {
  return <Editor />;
}
