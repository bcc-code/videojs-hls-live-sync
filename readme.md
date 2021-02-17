# video-hls-live-sync

This package attempts to synchronize playback of hls (others not tested) based
live video streams across browsers running on different computers.

The primary use case is when you want to play a synchronized stream in a different
language in the same room on different speakers.

## Requirements:

You will need a [HTTPsTime Server](https://web.archive.org/web/20210103104032/http://phk.freebsd.dk/time/20151129/) that provides the `X-HTTPSTIME` header, in order to get sufficient accuracy.

The system also performs the sync 6 times. The first result is ignored as there are often
delays that are not present in later requests (cold functions, routing etc), and 
then computes the average of the next 5 results.


In addition you will need a Firebase project with enabled RealTime Database.

## Usage

An example page playing a dummy live stream is available at [./src/index.html](./src/index.html).
You should modify that file to include your firebase config.
Then you can easily run it using `npm install && make demo` and visiting http://localhost:8000/
It requires you to have `python3` installed as it is used as a dummy web server.

When you open the page, the URL will be updated with a session code in the hash,
like for example `http://localhost:8000/#90jv47`. This url can be copied into another
browser, where the player will then act as a slave and attempt to sync to the
master that was automatically created in the first window.

It is possible to force a certain ID on a master by using `#master-<ID>` but remember
that 2 masters in the same session are not a good idea.

After the system has finished syncing as best it can<sup>[1](#fn-1)</sup>, you can perform
fine adjustments using the `.nudge(<time>)` method.

In the example this is implemented in the form of two buttons:

```
document.getElementById("add").addEventListener("click", () => liveSync.nudge(0.2));
document.getElementById("sub").addEventListener("click", () => liveSync.nudge(-0.2));
```

This usually allows for a diff of < 80ms within a few clicks. Note that due to
the components involved (Browser, Js engine, Garbage collection, network, etc.)
it is pretty much not possible to synchronize the playback with an accuracy that 
audible no phase shift occurs on headphones. It is *not* meant to be used on one output!


In the cases where the system does not converge, you should just do a full reload of the page.

It is also possible to request a `.resync()` for example like this:

```
document.getElementById("resync").addEventListener("click", () => liveSync.resync());
```

## FAQ:

*The stream sometimes doesn't converge or errors out in the start:* Just reload the whole page.

`.nudge()` *function is not accurate*: Yeah, I know.

*Can I use this with players other than Video.js*: Unlikely in this form, but if you get it working send a patch.

*Can I use this for VOD*: No, not as is, but it could likely be adjusted to work.

*I'm getting odd results*: We rely on AWS using consecutive segment numbers, and a segment length of 6 seconds.

*Do the two computers need to have tightly synchronized clocks*: No, the time is synced for that reason.

## References:

* HTTPsTime specs: https://web.archive.org/web/20210103104032/http://phk.freebsd.dk/time/20151129/
* Inspiration: https://github.com/webtiming/timingsrc
* NTP code, inspiration: https://stackoverflow.com/questions/1638337/the-best-way-to-synchronize-client-side-javascript-clock-with-server-date


<a name="fn-1">1</a>: Sometimes +- 0.5 sec but usually a lot closer.
 
