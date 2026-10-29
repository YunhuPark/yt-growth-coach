import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { ffmpegHasFilter, FFMPEG } from "../src/lib/editor/render";

describe("ffmpegHasFilter", { skip: !existsSync(FFMPEG) ? "needs ffmpeg" : false }, () => {
  it("finds a filter the build has and says no to one it does not", async () => {
    assert.equal(await ffmpegHasFilter("scale"), true);
    assert.equal(await ffmpegHasFilter("no_such_filter_here"), false);
  });
  it("has the text-drawing filter the captions need (a build without it cannot render a hook)", async () => {
    assert.equal(await ffmpegHasFilter("drawtext"), true, "set FFMPEG_PATH to an ffmpeg that has drawtext");
  });
});
