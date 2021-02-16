/// <reference types="video.js" />
declare function init(player: videojs.VideoJsPlayer): Promise<void>;
declare function setTime(): Promise<void>;
export { init, setTime };
