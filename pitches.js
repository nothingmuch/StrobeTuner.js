var NOTE_NAMES = [
	"C",
	"C#/Db",
	"D",
	"D#/Eb",
	"E",
	"F",
	"F#/Gb",
	"G",
	"G#/Ab",
	"A",
	"A#/Bb",
	"B"
];

var TUNING_PRESETS = [
	{
		name: "Guitar Standard",
		label: "E A D G B E",
		notes: [
			{ note: "E", octave: 2 },
			{ note: "A", octave: 2 },
			{ note: "D", octave: 3 },
			{ note: "G", octave: 3 },
			{ note: "B", octave: 3 },
			{ note: "E", octave: 4 }
		]
	},
	{
		name: "Guitar Drop D",
		label: "D A D G B E",
		notes: [
			{ note: "D", octave: 2 },
			{ note: "A", octave: 2 },
			{ note: "D", octave: 3 },
			{ note: "G", octave: 3 },
			{ note: "B", octave: 3 },
			{ note: "E", octave: 4 }
		]
	},
	{
		name: "Guitar Open G",
		label: "D G D G B D",
		notes: [
			{ note: "D", octave: 2 },
			{ note: "G", octave: 2 },
			{ note: "D", octave: 3 },
			{ note: "G", octave: 3 },
			{ note: "B", octave: 3 },
			{ note: "D", octave: 4 }
		]
	},
	{
		name: "Guitar DADGAD",
		label: "D A D G A D",
		notes: [
			{ note: "D", octave: 2 },
			{ note: "A", octave: 2 },
			{ note: "D", octave: 3 },
			{ note: "G", octave: 3 },
			{ note: "A", octave: 3 },
			{ note: "D", octave: 4 }
		]
	},
	{
		name: "Bass 4-String",
		label: "E A D G",
		notes: [
			{ note: "E", octave: 1 },
			{ note: "A", octave: 1 },
			{ note: "D", octave: 2 },
			{ note: "G", octave: 2 }
		]
	},
	{
		name: "Bass 5-String",
		label: "B E A D G",
		notes: [
			{ note: "B", octave: 0 },
			{ note: "E", octave: 1 },
			{ note: "A", octave: 1 },
			{ note: "D", octave: 2 },
			{ note: "G", octave: 2 }
		]
	},
	{
		name: "Ukulele Standard",
		label: "G C E A",
		notes: [
			{ note: "G", octave: 4 },
			{ note: "C", octave: 4 },
			{ note: "E", octave: 4 },
			{ note: "A", octave: 4 }
		]
	},
	{
		name: "Mandolin Standard",
		label: "G D A E",
		notes: [
			{ note: "G", octave: 3 },
			{ note: "D", octave: 4 },
			{ note: "A", octave: 4 },
			{ note: "E", octave: 5 }
		]
	},
	{
		name: "Guitalele Standard",
		label: "A D G C E A",
		notes: [
			{ note: "A", octave: 2 },
			{ note: "D", octave: 3 },
			{ note: "G", octave: 3 },
			{ note: "C", octave: 4 },
			{ note: "E", octave: 4 },
			{ note: "A", octave: 4 }
		]
	}
];

var DEFAULT_REFERENCE_PITCH = 440;

function noteNameToSemitone(noteName) {
	var map = {
		"C": 0, "B#": 0,
		"C#": 1, "Db": 1,
		"D": 2,
		"D#": 3, "Eb": 3,
		"E": 4, "Fb": 4,
		"F": 5, "E#": 5,
		"F#": 6, "Gb": 6,
		"G": 7,
		"G#": 8, "Ab": 8,
		"A": 9,
		"A#": 10, "Bb": 10,
		"B": 11, "Cb": 11
	};
	var semitone = map[noteName];
	if (semitone === undefined) {
		throw new Error("Unknown note name: " + noteName);
	}
	return semitone;
}

function noteFrequency(noteName, octave, referencePitch) {
	if (referencePitch === undefined) {
		referencePitch = DEFAULT_REFERENCE_PITCH;
	}
	var semitone = noteNameToSemitone(noteName);
	// A4 is semitone 9 in octave 4, i.e. 57 semitones above C0
	var semitonesFromA4 = (octave * 12 + semitone) - (4 * 12 + 9);
	return referencePitch * Math.pow(2, semitonesFromA4 / 12);
}

function nearestNote(frequency, referencePitch) {
	if (referencePitch === undefined) {
		referencePitch = DEFAULT_REFERENCE_PITCH;
	}
	// Number of semitones from A4
	var semitonesFromA4 = 12 * Math.log2(frequency / referencePitch);
	var roundedSemitones = Math.round(semitonesFromA4);

	// Convert back to octave and semitone index
	// A4 is at absolute semitone 57 (4*12 + 9)
	var absoluteSemitone = roundedSemitones + 57;
	var octave = Math.floor(absoluteSemitone / 12);
	var semitoneIndex = absoluteSemitone - octave * 12;

	var noteName = NOTE_NAMES[semitoneIndex];
	var exactFrequency = referencePitch * Math.pow(2, roundedSemitones / 12);
	var centsOffset = (semitonesFromA4 - roundedSemitones) * 100;

	return {
		note: noteName,
		octave: octave,
		cents: centsOffset,
		frequency: exactFrequency
	};
}
