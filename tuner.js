var active_strobes = [];
var tuner_audioContext = null;
var tuner_source = null;

var tuner_gain = 200;
var tuner_filterWidth = 1.0;
var tuner_filterTaps = 512;


function createStrobeAudio(audioContext, source, pitch) {
	var bufferSize = 1024;

	var proc = new AudioWorkletNode(audioContext, 'strobe-processor', {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
		processorOptions: { bufferSize: bufferSize }
	});

	var buffers = [ new Float32Array(bufferSize), new Float32Array(bufferSize) ];
	var buffer_t = 0;

	var sample_rate = audioContext.sampleRate;
	var strobe_delta_t = 0;

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

	var taps = makeBandpassKernel(pitch, audioContext.sampleRate, tuner_filterTaps, tuner_filterWidth);
	var impulse = audioContext.createBuffer(1, taps.length, audioContext.sampleRate);
	impulse.copyToChannel(taps, 0);
	var bandpass = audioContext.createConvolver();
	bandpass.normalize = false;
	bandpass.buffer = impulse;

	var gain = audioContext.createGain();
	gain.gain.value = tuner_gain;

	var bit_bucket = audioContext.createGain();
	bit_bucket.gain.value = 0;

	// Kept from the ScriptProcessorNode version, which needed a path to the
	// destination to be scheduled at all. Chromium 151 pulls the worklet
	// without it, but the spec leaves this to the implementation and the sink
	// costs nothing: the worklet writes no output, so it only carries silence.
	patch_nodes(source,bandpass,gain,proc,bit_bucket,audioContext.destination);

	var state = {
		buffers: buffers,
		processor: proc,
		source: source, // GC bug in FireFox
		sampleRate: sample_rate,
		pitch: pitch,
		gainNode: gain,
		bandpass: bandpass,
		getBufferTime: function () { return buffer_t; },
		getStrobeDeltaT: function () { return strobe_delta_t; },
		setStrobeDeltaT: function (v) { strobe_delta_t = v; },
		disconnect: function () {
			proc.port.onmessage = null;
			proc.disconnect();
			gain.disconnect();
			bandpass.disconnect();
			bit_bucket.disconnect();
		}
	};

	return state;
}


function createStrobeDisplay(canvas, pitch, audioState) {
	var canvasContext = canvas.getContext('2d');

	var strobe_width = canvas.width;
	var strobe_height = canvas.height;

	var strobe_period = 1/pitch;
	var sample_rate = audioState.sampleRate;
	var sample_duration = 1/sample_rate;
	var samples_per_strobe = Math.ceil(strobe_period/sample_duration);
	var strobe_remainder = 0;
	var last_frame = 0;

	return {
		canvas: canvas,
		draw: function (raf_time) {
			var buffer_t = audioState.getBufferTime();
			if ( !buffer_t ) return; // no data yet

			// calculate how much time the strobe has gone forward since the last frame
			var frame_duration = last_frame ? ( raf_time - last_frame ) / 1000 : 0;
			if ( frame_duration && frame_duration < strobe_period ) return; // plausible for bass or lower registers of piano

			last_frame = raf_time;

			var strobe_delta_t = audioState.getStrobeDeltaT();

			// skip to the present, the remainder tracking is for better responsiveness
			// underruns are normal at first and with smaller buffer sizes, but don't really matter since all we really care about is phase information
			strobe_delta_t += strobe_period * Math.floor( (frame_duration + strobe_remainder) / strobe_period );
			strobe_remainder = ( frame_duration + strobe_remainder ) % strobe_period;
			while ( strobe_delta_t < 0 ) {
				// console.log("underrun");
				strobe_delta_t += strobe_period;
			}
			var buffers = audioState.buffers;
			while ( strobe_delta_t * sample_rate + samples_per_strobe > 2 * buffers[0].length ) {
				// console.log("overrun");
				strobe_delta_t -= strobe_period;
			}

			audioState.setStrobeDeltaT(strobe_delta_t);

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


function createStrobe(audioContext, source, canvas, pitch) {
	var audio = createStrobeAudio(audioContext, source, pitch);
	var display = createStrobeDisplay(canvas, pitch, audio);

	var strobe = {
		canvas: display.canvas,
		draw: display.draw,
		audio: audio,
		destroy: function () {
			audio.disconnect();
			var idx = active_strobes.indexOf(strobe);
			if (idx !== -1) active_strobes.splice(idx, 1);
		}
	};

	return strobe;
}


function buildPresetSelector() {
	var select = document.getElementById('preset-select');
	if ( !select ) return;

	for ( var i = 0; i < TUNING_PRESETS.length; i++ ) {
		var opt = document.createElement('option');
		opt.value = i;
		opt.textContent = TUNING_PRESETS[i].name;
		select.appendChild(opt);
	}
}

function applyPreset(presetIndex, audioContext, source) {
	// Destroy existing strobes
	while ( active_strobes.length ) {
		active_strobes[0].destroy();
	}

	// Clear the container
	var container = document.getElementById('strobe-container');
	container.innerHTML = '';

	var preset = TUNING_PRESETS[presetIndex];

	for ( var i = preset.notes.length - 1; i >= 0; i-- ) {
		var n = preset.notes[i];
		var pitch = noteFrequency(n.note, n.octave, DEFAULT_REFERENCE_PITCH);
		var pitchStr = pitch.toFixed(2).replace(/0$/, '');

		var wrapper = document.createElement('div');
		wrapper.className = 'strobe-row';

		var label = document.createElement('span');
		label.className = 'strobe-label';
		label.textContent = n.note + n.octave;
		wrapper.appendChild(label);

		var canvas = document.createElement('canvas');
		canvas.className = 'strobe pitch_' + pitchStr;
		canvas.width = 512;
		canvas.height = 100;
		wrapper.appendChild(canvas);

		container.appendChild(wrapper);

		if ( audioContext && source ) {
			active_strobes.push(createStrobe(audioContext, source, canvas, pitch));
		}
	}
}

function updateAllGains(value) {
	for ( var i = 0; i < active_strobes.length; i++ ) {
		active_strobes[i].audio.gainNode.gain.value = value;
	}
}

function rebuildConvolvers(audioContext) {
	for ( var i = 0; i < active_strobes.length; i++ ) {
		var audio = active_strobes[i].audio;
		var taps = makeBandpassKernel(audio.pitch, audioContext.sampleRate, tuner_filterTaps, tuner_filterWidth);
		var impulse = audioContext.createBuffer(1, taps.length, audioContext.sampleRate);
		impulse.copyToChannel(taps, 0);
		audio.bandpass.buffer = impulse;
	}
}

function initTuner(audioContext, mediaStream) {
	var source = audioContext.createMediaStreamSource(mediaStream);

	tuner_audioContext = audioContext;
	tuner_source = source;

	var select = document.getElementById('preset-select');
	var presetIndex = select ? parseInt(select.value, 10) : 0;

	applyPreset(presetIndex, audioContext, source);

	var hint = document.getElementById('hint');
	if ( hint ) hint.style.display = 'none';

	draw_strobes();
}


function patch_nodes () {
	Array.prototype.reduce.call(arguments, function (i,j) { i && i.connect(j); return j });
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
			initTuner(audioContext, results[1]);
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

function makeBandpassKernel(pitch, sampleRate, length, semitoneWidth) {
	if (semitoneWidth === undefined) semitoneWidth = 1.0;
	var semitone = Math.pow(2, semitoneWidth / 12);
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

document.addEventListener('DOMContentLoaded', function () {
	buildPresetSelector();

	// Create canvases for the default preset (before audio starts)
	applyPreset(0, null, null);

	var select = document.getElementById('preset-select');
	if ( select ) {
		select.addEventListener('change', function () {
			var idx = parseInt(select.value, 10);
			applyPreset(idx, tuner_audioContext, tuner_source);
		});
	}

	// Gain slider
	var gainSlider = document.getElementById('gain-slider');
	var gainValue = document.getElementById('gain-value');
	if ( gainSlider ) {
		gainSlider.addEventListener('input', function () {
			tuner_gain = parseFloat(gainSlider.value);
			if ( gainValue ) gainValue.textContent = tuner_gain;
			updateAllGains(tuner_gain);
		});
	}

	// Filter width slider
	var filterWidthSlider = document.getElementById('filter-width-slider');
	var filterWidthValue = document.getElementById('filter-width-value');
	if ( filterWidthSlider ) {
		filterWidthSlider.addEventListener('input', function () {
			tuner_filterWidth = parseFloat(filterWidthSlider.value);
			if ( filterWidthValue ) filterWidthValue.textContent = tuner_filterWidth;
			if ( tuner_audioContext ) {
				rebuildConvolvers(tuner_audioContext);
			}
		});
	}

	// Filter order select
	var filterOrderSelect = document.getElementById('filter-order-select');
	if ( filterOrderSelect ) {
		filterOrderSelect.addEventListener('change', function () {
			tuner_filterTaps = parseInt(filterOrderSelect.value, 10);
			if ( tuner_audioContext && tuner_source ) {
				var presetIndex = select ? parseInt(select.value, 10) : 0;
				applyPreset(presetIndex, tuner_audioContext, tuner_source);
			}
		});
	}

	// Reference pitch input
	var refPitchInput = document.getElementById('reference-pitch-input');
	if ( refPitchInput ) {
		refPitchInput.addEventListener('change', function () {
			var val = parseFloat(refPitchInput.value);
			if ( val >= 400 && val <= 480 ) {
				DEFAULT_REFERENCE_PITCH = val;
				if ( tuner_audioContext && tuner_source ) {
					var presetIndex = select ? parseInt(select.value, 10) : 0;
					applyPreset(presetIndex, tuner_audioContext, tuner_source);
				}
			}
		});
	}

	start_on_gesture();
});
