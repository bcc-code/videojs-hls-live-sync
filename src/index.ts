// Firebase App (the core Firebase SDK) is always required and must be listed first
import firebase from 'firebase/app';
import 'firebase/analytics';
import 'firebase/database';
import '@types/video.js'

const firebaseConfig = {
	apiKey: 'AIzaSyCdS5jYDWSQhydHorldI3Gmz0RXQuA1aM4',
	authDomain: 'btv-live-sync-dev.firebaseapp.com',
	databaseURL: 'https://btv-live-sync-dev-default-rtdb.europe-west1.firebasedatabase.app',
	projectId: 'btv-live-sync-dev',
	storageBucket: 'btv-live-sync-dev.appspot.com',
	messagingSenderId: '196561865340',
	appId: '1:196561865340:web:ec879d1b082856c60b57f9',
	measurementId: 'G-C1EGY1D8J8'

};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
firebase.analytics();

const timeUrl = 'http://localhost:56758/.well-known/time';

let db : firebase.database.Reference;

let globalOffset : number;
let sessionID : string;
let master : boolean = false;
let startTimestamp  : number;
let remoteStart : number;
let globalPlayer : videojs.VideoJsPlayer;
let globalActiveCue: TextTrackCue;
let synced = false;

let segmentStarts = new Map();

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

function now() : number {
	return Date.now() + globalOffset
}

export async function init(player: videojs.VideoJsPlayer) {
	let t0 = Date.now()
	let res = await fetch(timeUrl)
	let t3 = Date.now()
	let t2 = Number(res.headers.get("x-httpstime"))
	console.log(t0, t2, t3)
	let delta = ntp(t0, t2, t2, t3);
	console.log(delta)
	let offset1 = delta.offset

	t0 = Date.now()
	res = await fetch(timeUrl);
	t3 = Date.now()
	t2 = Number(res.headers.get("x-httpstime"))
	console.log(t0, t2, t3)
	delta = ntp(t0, t2, t2, t3);
	console.log(delta)
	let offset2 = delta.offset

	t0 = Date.now()
	res = await fetch(timeUrl);
	t3 = Date.now()
	t2 = Number(res.headers.get("x-httpstime"))
	console.log(t0, t2, t3)
	delta = ntp(t0, t2, t2, t3);
	console.log(delta)
	let offset3 = delta.offset

	globalOffset = (offset1 + offset2 +offset3) / 3
	console.log("calculated offset: ", globalOffset);

	globalPlayer = player
	globalPlayer.muted(true) // Can't auto play otherwise

	if (document.location.hash == "") {
		sessionID = Math.random().toString(36).substring(7);
		document.location.hash = sessionID
		master = true
	} else {
		sessionID = document.location.hash.substring(1) // Skip '#'
		let spl = sessionID.split('-')
		if (spl.length  == 2 && spl[0] == 'master') {
			sessionID = spl[1]
			master = true
		}
	}

	globalPlayer.play()?.then(playerStarted, console.log)

	document.getElementById("add")?.addEventListener("click", add);
	document.getElementById("sub")?.addEventListener("click", sub);
}

function add() {
	globalPlayer.currentTime(globalPlayer.currentTime() + 0.5)
}

function sub() {
	globalPlayer.currentTime(globalPlayer.currentTime() - 0.5)
}

async function playerStarted() {
	startTimestamp = now()
	let startTime;
	let segmentRef = firebase.database().ref(`${sessionID}/segment`)

	if (master) {
		firebase.database().ref(`${sessionID}/start`).set(startTimestamp)
		globalPlayer.currentTime(globalPlayer.liveTracker.liveCurrentTime() - 10)
	} else {
		startTime = firebase.database().ref(`${sessionID}/start`).get()
		firebase.database().ref(`${sessionID}/segment`).on('value', handleSyncData)
	}

	let textTracks = globalPlayer.textTracks();
	let cuesTrack = textTracks[0];
	remoteStart = (await startTime)?.val()

	cuesTrack.addEventListener('cuechange', function() {
		let ts = now()
		let activeCues = cuesTrack.activeCues!;
		let activeCue = activeCues[0];


		console.log('Cue runs from ' + activeCue.startTime + ' to ' + activeCue.endTime);
		let uri: string = (activeCue as any).value.uri;
		globalActiveCue = activeCue

		segmentStarts.set(uri, activeCue.startTime)

		if (master) {
			segmentRef.set({ ts: ts, uri: uri, playerPos: globalPlayer.currentTime(), cueStart: activeCue.startTime })
		}

		document.getElementById("time")!.textContent = `${globalPlayer.currentTime()}`
	});

}

function handleSyncData(data : firebase.database.DataSnapshot) {
	if (synced || globalActiveCue == null) {
		return
	}

	const val = data.val()
	let signalDelay = now() - val.ts

	let segmentStartOffset = (remoteStart - startTimestamp)

	console.log("Delay: ", signalDelay, " Segment offset: ", segmentStartOffset)
	let localUri = (globalActiveCue as any).value.uri

	let remoteSegNr  = Number(new RegExp(/_(\d+)\.ts/).exec(val.uri)![1]);
	let localSegNr  = Number(new RegExp(/_(\d+)\.ts/).exec(localUri)![1]);

	let segmentCountOffset = remoteSegNr = localSegNr;
	console.log("Segment offset: ", localSegNr);

	console.log(localUri, val.uri);
	if (localUri == val.uri) {
		synced = true
	}
	/*if (localUri!=val.uri) {
		signalDelay += 6000
	}	if (Math.abs(segmentStartOffset) < 90) {
		synced = true;
		return
	}*/

	document.getElementById("time")!.textContent = `${globalPlayer.currentTime()}`
	console.log(globalPlayer.currentTime())

	let gotoTime = val.playerPos - segmentStartOffset; //val.cueStart + (6*segmentCountOffset) + segmentStartOffset + (now() - val.ts)/1000.0
	globalPlayer.currentTime(gotoTime)
	console.log("Start & End",
				globalPlayer.liveTracker.seekableEnd(),
				globalPlayer.liveTracker.seekableStart(),
			   )
}

export async function setTime() {
	await db.set(Date.now() + globalOffset).then(() => console.log("Wrote timestamp"))
}
