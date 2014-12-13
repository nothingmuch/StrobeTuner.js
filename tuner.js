var active_strobes = [];


function init_stream (mediaStream) {
	var audioContext = new (window.AudioContext || window.webkitAudioContext)();
	var stream = audioContext.createMediaStreamSource(mediaStream);

	var strobes = jQuery("canvas.strobe");

	for ( var i = 0; i < strobes.length; i++ ) {
		active_strobes.push(init_strobe(strobes[i],stream,audioContext));
	};

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

	// FIXME deprecated
	var proc = audioContext.createScriptProcessor(1024, 1, 1); // FIXME samplerate/bufsize = update frequency?

	var buffers = [ new Float32Array(proc.bufferSize), new Float32Array(proc.bufferSize) ];
	var buffer_t = 0;
	var last_frame = 0;
	var last_strobe = 0;
	var strobe_buf;

	var strobe_segments = strobe_width;

	var strobe_period = 1/strobe_pitch;
	var sample_rate = audioContext.sampleRate;
	var sample_duration = 1/sample_rate;
	var samples_per_strobe = Math.ceil(strobe_period/sample_duration);
	var strobe_delta_t = 0;
	var strobe_remainder = 0;

	proc.onaudioprocess = function (e) {
		// e's buffer is only valid for the duration of the callback, so copy it over
		// we keep two copies since we read in samples_per_strobe chunks
		buffers.reverse();
		buffers[1].set(e.inputBuffer.getChannelData(0)); // e.inputBuffer.copyFromChanel(buffers[1],0) broken in Chrome?

		// decrement the buffer length from the time based offset of the strobe
		strobe_delta_t -= ( e.playbackTime - buffer_t );
		buffer_t = e.playbackTime;
	};

	var bandpass = audioContext.createBiquadFilter();
	bandpass.type = 'bandpass';
	bandpass.frequency.value = strobe_pitch;
	bandpass.Q.value = 3;

	var gain = audioContext.createGain();
	gain.gain.value = 100;

	var bit_bucket = audioContext.createGain();
	bit_bucket.gain.value = 0;

	// route output of streamprocessor to a null gain node and to the audio destination to force processing to actually happen
	// apparently a bug in chrome
	patch_nodes(stream,bandpass,gain,proc,bit_bucket,audioContext.destination);

	var seg_width = strobe_width / strobe_segments;

	return {
		canvas: canvas,
		buffers: buffers,
		processor: proc, // GC bug in Chrome
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

function init_audio () {
	return (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia).call(navigator,{
		"audio": {
			"mandatory": {
				"googEchoCancellation": "false",
				"googAutoGainControl": "true",
				"googNoiseSuppression": "true",
				"googHighpassFilter": "false"
			},
			"optional": []
		},
	},init_stream,console.log);
}

jQuery().ready(init_audio);
