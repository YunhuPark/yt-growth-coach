// music-tempo ships no types. This is the part that is used: new MusicTempo(mono samples at any sample rate of 22050 or so).
declare module "music-tempo" {
  export default class MusicTempo {
    constructor(audioData: ArrayLike<number>, params?: Record<string, number>);
    /** beats per minute */
    tempo: number;
    /** beat times in seconds */
    beats: number[];
  }
}
