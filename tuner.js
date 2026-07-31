var active_strobes = [];


function init_stream (audioContext, mediaStream) {
	var stream = audioContext.createMediaStreamSource(mediaStream);

	var strobes = document.querySelectorAll("canvas.strobe");

	for ( var i = 0; i < strobes.length; i++ ) {
		active_strobes.push(init_strobe(strobes[i],stream,audioContext));
	};

	var hint = document.getElementById('hint');
	if ( hint ) hint.style.display = 'none';

	draw_strobes();
}

function patch_nodes () {
	Array.prototype.reduce.call(arguments, function (i,j) { i && i.connect(j); return j });
}

function init_strobe (canvas,stream,audioContext) {
	var canvasContext = canvas.getContext('2d');

	var strobe_width = canvas.width;
	var strobe_height = canvas.height;

	var strobe_pitch = parseFloat(canvas.getAttribute("class").substr(canvas.getAttribute("class").lastIndexOf("_")+1));

	var bufferSize = 1024; // samplerate/bufsize = update frequency

	var proc = new AudioWorkletNode(audioContext, 'strobe-processor', {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
		processorOptions: { bufferSize: bufferSize }
	});

	var buffers = [ new Float32Array(bufferSize), new Float32Array(bufferSize) ];
	var buffer_t = 0;
	var last_frame = 0;

	var strobe_segments = strobe_width;

	var strobe_period = 1/strobe_pitch;
	var sample_rate = audioContext.sampleRate;
	var sample_duration = 1/sample_rate;
	var samples_per_strobe = Math.ceil(strobe_period/sample_duration);
	var strobe_delta_t = 0;
	var strobe_remainder = 0;

	// The worklet ships a filled buffer plus the timestamp of its leading edge.
	// This mirrors the old onaudioprocess: swap buffers, store the new samples,
	// and advance the phase offset by the amount of new audio time that arrived.
	proc.port.onmessage = function (e) {
		var msg = e.data;

		buffers.reverse();
		buffers[1].set(new Float32Array(msg.samples));

		// decrement the buffer length from the time based offset of the strobe
		strobe_delta_t -= ( msg.time - buffer_t );
		buffer_t = msg.time;
	};

	var taps = makeBandpassKernel(strobe_pitch, audioContext.sampleRate, 512);
	var impulse = audioContext.createBuffer(1, taps.length, audioContext.sampleRate);
	impulse.copyToChannel(taps, 0);
	var bandpass = audioContext.createConvolver();
	bandpass.normalize = false;
	bandpass.buffer = impulse;

	var gain = audioContext.createGain();
	gain.gain.value = 200;

	var bit_bucket = audioContext.createGain();
	bit_bucket.gain.value = 0;

	// Kept from the ScriptProcessorNode version, which needed a path to the
	// destination to be scheduled at all. Chromium 151 pulls the worklet
	// without it, but the spec leaves this to the implementation and the sink
	// costs nothing: the worklet writes no output, so it only carries silence.
	patch_nodes(stream,bandpass,gain,proc,bit_bucket,audioContext.destination);

	var seg_width = strobe_width / strobe_segments;

	return {
		canvas: canvas,
		buffers: buffers,
		processor: proc,
		stream: stream, // GC bug in FireFox
		draw: function (raf_time ) {
			if ( !buffer_t ) return; // no data yet

			// calculate how much time the strobe has gone forward since the last frame
			var frame_duration = last_frame ? ( raf_time - last_frame ) / 1000 : 0;
			if ( frame_duration && frame_duration < strobe_period ) return; // plausible for bass or lower registers of piano

			last_frame = raf_time;

			// skip to the present, the remainder tracking is for better responsiveness
			// underruns are normal at first and with smaller buffer sizes, but don't really matter since all we really care about is phase information
			strobe_delta_t += strobe_period * Math.floor( (frame_duration + strobe_remainder) / strobe_period );
			strobe_remainder = ( frame_duration + strobe_remainder ) % strobe_period;
			while ( strobe_delta_t < 0 ) {
				// console.log("underrun");
				strobe_delta_t += strobe_period;
			}
			while ( strobe_delta_t * sample_rate + samples_per_strobe > 2 * buffers[0].length ) {
				// console.log("overrun");
				strobe_delta_t -= strobe_period;
			}

			// calculate the offset to the first sample of the strobe relative to the saved buffer
			var offset = Math.floor( strobe_delta_t * sample_rate ); // FIXME restore sub-sub-subpixel interpolation ;-)

			// draw right to left because low pitch =
			// longer period = offset grows modulu period
			// which means motion is to the right and by
			// convention it goes to the left
			var g = canvasContext.createLinearGradient(strobe_width,0,0,0);

			for ( var i = 0; i < samples_per_strobe; i++ ) {
				var b = buffers[0];
				var j = offset + i;

				if ( j >= b.length ) {
					j -= b.length;
					b = buffers[1];
				}

				var v = Math.floor( 256 * (1 + b[j])/2 );

				g.addColorStop(i/samples_per_strobe, 'rgb(' + v + ',' + v + ',' + v + ')');
			}

			canvasContext.fillStyle = g;
			canvasContext.fillRect(0,0,strobe_width,strobe_height);
		}
	};
}

function draw_strobes (raf_time) {
	for ( var i = 0; i < active_strobes.length; i++ ) {
		var strobe = active_strobes[i];
		strobe.draw(raf_time || 0);
	}

	requestAnimationFrame(draw_strobes);
}

// Constructed synchronously in the gesture handler so the autoplay policy sees
// it as gesture-blessed. The worklet module must finish loading before any
// AudioWorkletNode naming 'strobe-processor' can be constructed.
function init_audio () {
	var audioContext = new (window.AudioContext || window.webkitAudioContext)();

	var constraints = {
		"audio": {
			"echoCancellation": false,
			"autoGainControl": true,
			"noiseSuppression": false
		}
	};

	return Promise.all([
		audioContext.audioWorklet.addModule('strobe-processor.js'),
		navigator.mediaDevices.getUserMedia(constraints)
	]).then(function (results) {
		return audioContext.resume().then(function () {
			init_stream(audioContext, results[1]);
		});
	}).catch(function (err) {
		console.log("audio init failed", err);
	});
}

// AudioContext starts suspended until a user gesture (autoplay policy), and
// getUserMedia needs a secure context. Gate startup behind a click.
function start_on_gesture () {
	var started = false;
	function go () {
		if ( started ) return;
		started = true;
		init_audio();
		document.removeEventListener('click', go);
		document.removeEventListener('keydown', go);
	}
	document.addEventListener('click', go);
	document.addEventListener('keydown', go);
}

// --- FIR bandpass helpers ---

function sinc(x) {
	if (x === 0) return 1;
	return Math.sin(Math.PI * x) / (Math.PI * x);
}

function lowpassKernel(cutoff, sampleRate, length) {
	var h = new Float32Array(length);
	var fc = cutoff / sampleRate;
	var M = length - 1;

	for (var n = 0; n < length; n++) {
		var k = n - M / 2;
		h[n] = 2 * fc * sinc(2 * fc * k);
	}

	return h;
}

function applyHannWindow(h) {
	var N = h.length;

	for (var n = 0; n < N; n++) {
		h[n] *= 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1)));
	}

	return h;
}

function makeBandpassKernel(pitch, sampleRate, length) {
	var semitone = Math.pow(2, 1 / 12);
	var lo = lowpassKernel(pitch * semitone, sampleRate, length);
	var hi = lowpassKernel(pitch / semitone, sampleRate, length);

	var h = new Float32Array(length);

	for (var i = 0; i < length; i++) {
		h[i] = lo[i] - hi[i];
	}

	applyHannWindow(h);

	// Normalize to unity gain at the center frequency so that all
	// strings come through at the same level regardless of bandwidth.
	var w = 2 * Math.PI * pitch / sampleRate;
	var re = 0;
	var im = 0;
	for (var i = 0; i < length; i++) {
		re += h[i] * Math.cos(w * i);
		im -= h[i] * Math.sin(w * i);
	}
	var mag = Math.sqrt(re * re + im * im);
	if (mag > 0) {
		for (var i = 0; i < length; i++) {
			h[i] /= mag;
		}
	}

	return h;
}

document.addEventListener('DOMContentLoaded', start_on_gesture);
