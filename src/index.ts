// Firebase App (the core Firebase SDK) is always required and must be listed first
import firebase from 'firebase/app';
import 'firebase/analytics';
import 'firebase/database';
import '@types/video.js'

const httpTimeHeader = 'x-httpstime'
const timeSyncRounds = 5

// the NTP algorithm
// t0 is the client's timestamp of the request packet transmission,
// t1 is the server's timestamp of the request packet reception,
// t2 is the server's timestamp of the response packet transmission and
// t3 is the client's timestamp of the response packet reception.
function ntp(t0 : number, t1: number, t2: number, t3: number) {
	return {
		roundtripdelay: (t3 - t0) - (t2 - t1),
		offset: ((t1 - t0) + (t2 - t3)) / 2
	};
}

// Polyfill for performance.now() as Safari on iOS doesn't have it...
(function(){
    	if ("performance" in window === false) {
        	window.performance = {};
        	window.performance.timeOrigin = new Date().getTime();
    	}
    	if ("now" in window.performance === false){
      		window.performance.now = function now(){
        		return new Date().getTime() - window.performance.timeOrigin;
      		};
    	}
})();

export class LiveVideoSync {

	synced : boolean = false;
	master : boolean = false;
	statusCallback:  (status: string) => void = console.log

	db? : firebase.database.Reference;
	globalOffset : number = 0;
	sessionID? : string;
	startTimestamp?  : number;
	remoteStart? : number;
	globalPlayer : videojs.VideoJsPlayer;
	globalActiveCue?: TextTrackCue;
	localSegmentTs : number = 0;
	timeServerURL : string;
	segmentMetadataTrack? : TextTrack;
	manualSyncDone : boolean = false;
	lockedDelta : number = 9999999;

	constructor(
		player: videojs.VideoJsPlayer,
		statusCallback: (status: string) => void,
		timeserverURL: string,
		firebaseConfig: any,
	) {
		this.globalPlayer = player
		this.timeServerURL = timeserverURL

		if (statusCallback != null) {
			this.statusCallback = statusCallback
		}

		// Initialize Firebase
		firebase.initializeApp(firebaseConfig);
		firebase.analytics();

	}

	async syncClock() {
		this.statusCallback("Syncing Clock");
		// First fetch in invalid, if we hit a cold endpoint
		await fetch(this.timeServerURL)

		let offsetSum = 0;
		for (let i = 0; i < timeSyncRounds; i++) {
			let t0 = performance.timeOrigin + performance.now()
			let res = await fetch(this.timeServerURL)
			let t3 = performance.timeOrigin + performance.now()
			let t2 = Number(res.headers.get(httpTimeHeader))
			let delta = ntp(t0, t2, t2, t3);
			console.log(delta)
			offsetSum += delta.offset
		}

		this.globalOffset = offsetSum/timeSyncRounds
		console.log("calculated time offset: ", this.globalOffset);
		this.statusCallback("Done syncing clock")
	}

	setupSession() {
		if (document.location.hash == "") {
			this.sessionID = Math.random().toString(36).substring(7);
			document.location.hash = this.sessionID
			this.master = true
		} else {
			this.sessionID = document.location.hash.substring(1) // Skip '#'
			let spl = this.sessionID.split('-')
			if (spl.length  == 2 && spl[0] == 'master') {
				this.sessionID = spl[1]
				this.master = true
			}
		}
	}

	async start() {
		await this.syncClock()
		this.setupSession()

		this.statusCallback("Setting up player")
		this.globalPlayer.muted(true) // Can't auto play otherwise
		this.globalPlayer.play()?.then(() => this.playerStarted(), console.log)
	}

	// Time as synced with the remote server
	now() : number {
		return performance.timeOrigin + performance.now() + this.globalOffset
	}

	resetSyncStatus() {
		this.synced = false
	}

	lockManualSync() {
		this.manualSyncDone = true;
	}

	async playerStarted() {
		this.startTimestamp = this.now()
		this.statusCallback("Setting up player 2")

		let startTime;
		if (this.master) {
			// Store synchronized start time in firebase
			firebase.database().ref(`${this.sessionID}/start`).set(this.startTimestamp)

			// start at T-10 so we are not one the newest segment, otherwise sync can't happen
			// from time to time due to the other player being on an older playlist
			this.globalPlayer.currentTime(this.globalPlayer.liveTracker.liveCurrentTime() - 10)
		} else {
			// Fetch remote start time
			startTime = firebase.database().ref(`${this.sessionID}/start`).get()

			// Start listening for segment events on the master
			firebase.database().ref(`${this.sessionID}/segment`).on('value', (data) => this.handleSyncData(data))
		}

		let textTracks = this.globalPlayer.textTracks();
		for (let i = 0; i < textTracks.length; i++) {
			if (textTracks[i].label === 'segment-metadata') {
				this.segmentMetadataTrack = textTracks[i];
			}
		}

		if (this.segmentMetadataTrack == null) {
			this.statusCallback("Unable to read segment meta. Aborting!")
			console.error("Unable to read segmentMetadataTrack. Aborting!")
			return
		}

		// Store the time when remote player has started playing
		this.remoteStart = (await startTime)?.val()

		this.segmentMetadataTrack.addEventListener('cuechange', () => this.handleCueChange());

	}

	handleCueChange() {
		let ts = this.now()
		if (!this.master) {
			this.localSegmentTs = ts
		}

		if (!this.segmentMetadataTrack) {
			return
		}

		let activeCues = this.segmentMetadataTrack!.activeCues!;
		let activeCue = activeCues[0];

		console.log('Cue runs from ' + activeCue.startTime + ' to ' + activeCue.endTime);
		let uri: string = (activeCue as any).value.uri;
		this.globalActiveCue = activeCue

		if (this.master) {
			let segmentRef = firebase.database().ref(`${this.sessionID}/segment`)
			segmentRef.set({ ts: ts, uri: uri, playerPos: this.globalPlayer.currentTime(), cueStart: activeCue.startTime })
			this.statusCallback("Publishing segment info")
		}
	}

	handleSyncData(data : firebase.database.DataSnapshot) {
		if ((this.synced && !this.manualSyncDone) || this.globalActiveCue == null) {
			return
		}

		this.statusCallback('Syncing')

		const val = data.val()
		let localUri = (this.globalActiveCue as any).value.uri

		let remoteSegNr = Number(new RegExp(/_(\d+)\.(ts|mp4)/).exec(val.uri)![1]);
		let localSegNr  = Number(new RegExp(/_(\d+)\.(ts|mp4)/).exec(localUri)![1]);

		let segmentCountOffset = localSegNr - remoteSegNr;
		console.log('Segment offset: ', segmentCountOffset);

		if (segmentCountOffset != 0 && this.manualSyncDone) {
			return
		}

		if (segmentCountOffset != 0) {
			this.statusCallback("Rough sync")
			this.globalPlayer.currentTime(this.globalPlayer.currentTime() + segmentCountOffset*-6)

			if (this.globalPlayer.playbackRate() != 1.0) {
				this.globalPlayer.playbackRate(1.0);
			}

			return
		}

		this.statusCallback("Fine sync")

		console.log(localUri, val.uri);

		if (localUri == val.uri) {
			console.log("Same URL")
		}

		console.log(this.globalPlayer.currentTime())


		// We know we are playing the same segment
		// Thus we can check what the difference between when we started playing it and when "they" did
		// There is no real need to account for latency as the times are as absolute as we can be and
		// we can assume that we both continued playing at a constant rate from then on
		// Since everything is in ms we need to convert to seconds by dividing
		let diffSegmentStart =  ((this.localSegmentTs - val.ts) / 1000);

		console.log('Diff in segment start time:', diffSegmentStart);
		if (this.manualSyncDone) {
			if (this.lockedDelta > 10) {
				this.lockedDelta = diffSegmentStart;
				return
			}

			let totalDelta = diffSegmentStart - this.lockedDelta;
			console.log("Total delta ", totalDelta);

			let speedOffset = totalDelta/6000;
			let playbackRate = 1.0-speedOffset;

			if (Math.abs(speedOffset) > 0.01) {
				this.globalPlayer.playbackRate(playbackRate)
				this.statusCallback(`Playback rate: ${playbackRate}`)
			} else if (this.globalPlayer.playbackRate() != 1.0) {
				this.globalPlayer.playbackRate(1.0);
			}
			return
		}

		//let diffSegmentStart += 0.3;

		this.globalPlayer.currentTime(this.globalPlayer.currentTime() + diffSegmentStart)

		// Don't attempt to sync again unless asked.
		// If we continuously sync, we just jump around and destroy eventual manual adjustments
		this.synced = true
		this.statusCallback("Done!")
	}

	nudge(seconds : number) {
		this.globalOffset += seconds;
		this.globalPlayer.currentTime(this.globalPlayer.currentTime() + seconds + 0.2)
	}
}
