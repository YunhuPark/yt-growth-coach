import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { normalizeStyle, type CaptionStyle } from "@/lib/captionStyle";
import { errorResponse } from "@/lib/http";
import { rendersDir, startRenderJob } from "@/lib/renderJobs";
import { acceptSource, Rights, SourceError } from "@/lib/source";

const Options = z.object({
  layout: z.enum(["short", "long"]).default("short"),
  fit: z.enum(["blur", "cover"]),
  trimStart: z.number().min(0).max(14400).optional(),
  trimEnd: z.number().min(0).max(14400).optional(),
  // Keep only these source ranges, joined in order (from the AI edit plan). Replaces trimStart/trimEnd.
  segments: z.array(z.object({ start: z.number().min(0).max(14400), end: z.number().min(0).max(14400) })).min(1).max(600).optional(),
  hook: z.object({ text: z.string().max(120), seconds: z.number().min(0.5).max(10) }).optional(),
  captions: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(120) })).max(120),
  ending: z.object({ text: z.string().max(60), seconds: z.number().min(0.5).max(20) }).optional(),
  // How the hook and caption text look. Unknown values are treated as the default, never as an error.
  style: z
    .object({ preset: z.string(), position: z.string(), scale: z.number() })
    .optional()
    .transform((s) => (s ? normalizeStyle(s as Partial<CaptionStyle>) : undefined)),
  // Vertical result from a wider video: follow the person. `auto` finds them here; `keyframes` is a path the page already worked out.
  reframe: z
    .union([
      z.object({
        auto: z.literal(true),
        smooth: z.number().min(1).max(5).optional(),
        target: z.enum(["person", "animal", "vehicle", "all"]).optional(),
        zoom: z.union([z.literal("auto"), z.number().min(1).max(3)]).optional(),
      }),
      z.object({
        keyframes: z.array(z.object({ t: z.number().min(0).max(14400), cx: z.number().min(0).max(1), cy: z.number().min(0).max(1).optional() })).min(1).max(60000),
        zoom: z.number().min(1).max(3).optional(),
      }),
    ])
    .optional(),
  // For files too large to upload: an absolute path on this computer. Only video files are read.
  sourcePath: z.string().max(500).optional(),
  rights: Rights,
});

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("options") ?? "{}"));
    } catch {
      return Response.json({ error: "옵션 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const parsed = Options.safeParse(raw);
    if (!parsed.success) {
      const noRights = parsed.error.issues.some((i) => i.path[0] === "rights");
      return Response.json(
        { error: noRights ? "영상 사용 권한 확인에 체크해야 렌더링할 수 있습니다." : "입력값을 확인해 주세요." },
        { status: 400 },
      );
    }
    const { sourcePath, reframe, ...rest } = parsed.data;
    const opts = { ...rest, reframe: reframe && "keyframes" in reframe ? { keyframes: reframe.keyframes, zoom: reframe.zoom } : undefined };
    const autoReframe = reframe && "auto" in reframe ? { smooth: reframe.smooth, target: reframe.target, zoom: reframe.zoom } : undefined;

    const id = randomBytes(8).toString("hex");
    const dir = path.join(rendersDir(), id);
    let src;
    try {
      src = await acceptSource({ file: form.get("file"), sourcePath, dir });
    } catch (e) {
      if (e instanceof SourceError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }

    const { reframe: _path, ...metaOpts } = opts; // the path itself is long and only useful to the render
    void _path;
    startRenderJob({ id, dir, input: src.input, opts, meta: { sourceName: src.sourceName, ...metaOpts, reframe: opts.reframe ? "path" : autoReframe ? "auto" : undefined }, deleteInput: src.deleteInput, autoReframe });
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
