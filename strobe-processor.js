// AudioWorkletProcessor replacement for the old ScriptProcessorNode.
//
// The old code used createScriptProcessor(1024,1,1) and, in onaudioprocess,
// copied the input buffer into one of two Float32Arrays while recording
// e.playbackTime. The main-thread draw loop then walked across those two
// buffers using phase math to render the strobe.
//
// AudioWorklet runs on the audio render thread in fixed 128-sample quanta,
// so we accumulate quanta into a buffer of the requested size and, once it
// is full, post it to the main thread together with the timestamp of the
// buffer's leading edge. The main thread keeps the exact same two-buffer
// swap + phase math it always had.

class StrobeProcessor extends AudioWorkletProcessor {
	constructor (options) {
		super();
		var opts = (options && options.processorOptions) || {};
		this.bufferSize = opts.bufferSize || 1024;
		this.acc = new Float32Array(this.bufferSize);
		this.filled = 0;
	}

	process (inputs) {
		var input = inputs[0];

		// No connected input this quantum: keep the node alive, emit silence-equivalent.
		if ( !input || input.length === 0 ) return true;

		var channel = input[0];
		if ( !channel ) return true;

		for ( var i = 0; i < channel.length; i++ ) {
			this.acc[this.filled++] = channel[i];

			if ( this.filled === this.bufferSize ) {
				// currentFrame is the frame index of the FIRST sample of THIS
				// render quantum. The sample we just wrote is (i) frames into
				// this quantum, and it is the (bufferSize-1)th sample of the
				// buffer we are shipping, so the buffer's leading edge is:
				var leadingEdgeFrame = currentFrame + i - (this.bufferSize - 1);

				// Transfer a copy so we can keep accumulating without tearing.
				var out = this.acc.slice(0);
				this.port.postMessage(
					{
						samples: out,
						// seconds; equivalent to the old e.playbackTime anchor
						time: leadingEdgeFrame / sampleRate
					},
					[ out.buffer ]
				);

				this.filled = 0;
			}
		}

		return true;
	}
}

registerProcessor('strobe-processor', StrobeProcessor);
