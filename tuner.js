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
	var image_data = canvasContext.createImageData(strobe_width,strobe_height);

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
			// Smooth will handle the fractional component of the offset
			var offset = strobe_delta_t * sample_rate;
			var offset_int = Math.floor(offset);
			offset -= offset_int;

			// Smooth needs a non typed array so copy over.
			// fuck you javascript, why don't typed arrays support slice()?
			var small_buf;
			var bufer;
			if ( offset_int + samples_per_strobe >= buffers[0].length && offset_int < buffers[0].length ) {
				var diff = offset_int + samples_per_strobe - buffers[0].length;
				// complex case of strobe sample intersecting with buffer pair boundary...
				// we could just skip one more strobe period forward i suppose ;-)
				small_buf = Array.prototype.slice.call(buffers[0], offset_int);
				Array.prototype.push.apply( small_buf, buffers[1], 0, diff);
			} else {
				var buffer = buffers[0];

				if ( offset_int >= buffers[0].length ) {
					offset_int -= buffers[0].length;
					buffer = buffers[1];
				}

				small_buf = Array.prototype.slice.call( buffer, offset_int, offset_int + samples_per_strobe );
			}

			if ( small_buf.length >= samples_per_strobe ) {
				// otherwise low pitch = longer period = offset grows modulu period which means motion is to the right and by convention it goes to the left
				small_buf.reverse();

				Smooth.deepValidation = false; // FIXME barf
				var s = Smooth(small_buf); // FIXME config?

				// interpolate the buffer slice into the strobe segments
				for (var i = 0; i < strobe_segments; i++) {
					var v = s( offset + i * (samples_per_strobe / strobe_segments) );
					var alpha = Math.floor(256 * (1+v)/2);
					for (var col = i * seg_width; col < (i+1) * seg_width; col++) {
						for ( var row = 0; row < strobe_height; row++ ) {
							image_data.data[(row * strobe_width + col) * 4 + 3] = alpha;
						}
					}
				}

				canvasContext.putImageData(image_data,0,0);
			} else {
				// a real buffer overrun
				console.log("OH SHIT");
			}
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
