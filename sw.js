var CACHE_VERSION = 'strobetuner-v1';
var CACHE_FILES = [
	'./',
	'index.html',
	'tuner.js',
	'pitches.js',
	'strobe-processor.js',
	'style.css',
	'manifest.json',
	'icon.svg'
];

self.addEventListener('install', function (e) {
	e.waitUntil(
		caches.open(CACHE_VERSION).then(function (cache) {
			return cache.addAll(CACHE_FILES);
		})
	);
});

self.addEventListener('activate', function (e) {
	e.waitUntil(
		caches.keys().then(function (names) {
			return Promise.all(
				names.filter(function (name) {
					return name !== CACHE_VERSION;
				}).map(function (name) {
					return caches.delete(name);
				})
			);
		})
	);
});

self.addEventListener('fetch', function (e) {
	e.respondWith(
		caches.match(e.request).then(function (response) {
			return response || fetch(e.request);
		})
	);
});
